import "server-only";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { reserveCredits } from "@/lib/credits";
import { OrchestrationError } from "@/lib/orchestration/errors";
import { findModel } from "@/lib/orchestration/model-registry";
import { mapMetadataToSettings } from "@/lib/orchestration/generation-settings-mapper";
import { calculateGenerationPrice } from "@/lib/pricing/pricing";

interface GenerationBillingRow {
  id: string;
  clerk_user_id: string;
  model: string;
  metadata: Record<string, unknown> | null;
  status: string;
}

interface HeldReservationRow {
  id: string;
  amount: number;
  status: string;
  generation_id: string | null;
  clerk_user_id: string;
}

export interface GenerationBillingAuthorization {
  generationId: string;
  reservationId: string | null;
  credits: number;
  replayed: boolean;
  freeMock: boolean;
}

function billingUnavailable(context: Record<string, unknown>): OrchestrationError {
  return new OrchestrationError("GENERATION_OWNER_UNAVAILABLE", {
    userMessage: "Generation billing is temporarily unavailable. Please try again later.",
    context,
  });
}

function mapReservationFailure(error: unknown): OrchestrationError {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("insufficient_credits") || message.includes("wallet_not_found")) {
    return new OrchestrationError("PROVIDER_QUOTA_EXCEEDED", {
      userMessage: "You do not have enough credits for this generation.",
      context: { operation: "reserve_credits", reason: "insufficient_credits" },
    });
  }

  if (message.includes("concurrency_limit_reached")) {
    return new OrchestrationError("PROVIDER_RATE_LIMIT", {
      userMessage: "Your generation concurrency limit has been reached. Please wait for another generation to finish.",
      context: { operation: "reserve_credits", reason: "concurrency_limit_reached" },
    });
  }

  return billingUnavailable({ operation: "reserve_credits" });
}

async function readOwnedGeneration(
  generationId: string,
  clerkUserId: string
): Promise<GenerationBillingRow> {
  if (!isSupabaseAdminConfigured()) {
    throw billingUnavailable({ operation: "read_generation", reason: "supabase_admin_not_configured" });
  }

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("generations")
    .select("id, clerk_user_id, model, metadata, status")
    .eq("id", generationId)
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    throw billingUnavailable({ operation: "read_generation" });
  }

  if (!data) {
    throw new OrchestrationError("GENERATION_NOT_FOUND");
  }

  return data as GenerationBillingRow;
}

async function readHeldReservation(
  generationId: string,
  clerkUserId: string
): Promise<HeldReservationRow | null> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("credit_reservations")
    .select("id, amount, status, generation_id, clerk_user_id")
    .eq("generation_id", generationId)
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "held")
    .maybeSingle();

  if (error) {
    throw billingUnavailable({ operation: "read_credit_reservation" });
  }

  return (data as HeldReservationRow | null) ?? null;
}

/**
 * Ensures a real provider generation has a durable credit hold BEFORE any
 * workflow or provider execution may start.
 *
 * The generation row is authoritative for owner/model/settings. The browser
 * cannot supply a credit amount. Pricing comes from model_pricing and the
 * existing atomic reserve_credits() SQL function decides affordability and
 * per-plan concurrency under a wallet row lock.
 *
 * Mock models are the only exception: they never call an external provider,
 * so they are explicitly allowed to execute without a reservation.
 */
export async function ensureGenerationBillingAuthorized(params: {
  generationId: string;
  clerkUserId: string;
}): Promise<GenerationBillingAuthorization> {
  const generation = await readOwnedGeneration(params.generationId, params.clerkUserId);
  const model = findModel(generation.model);

  if (!model) {
    throw new OrchestrationError("UNKNOWN_MODEL");
  }

  if (model.isMock) {
    return {
      generationId: generation.id,
      reservationId: null,
      credits: 0,
      replayed: false,
      freeMock: true,
    };
  }

  const existing = await readHeldReservation(generation.id, params.clerkUserId);
  if (existing) {
    return {
      generationId: generation.id,
      reservationId: existing.id,
      credits: existing.amount,
      replayed: true,
      freeMock: false,
    };
  }

  // Never charge after work may already have started. A legacy/inconsistent
  // processing row without a hold is refused rather than retroactively billed.
  if (generation.status !== "queued") {
    throw billingUnavailable({
      operation: "authorize_generation",
      reason: "missing_hold_for_nonqueued_generation",
      generationId: generation.id,
      status: generation.status,
    });
  }

  const metadata = generation.metadata ?? {};
  const settings = mapMetadataToSettings(metadata);
  const outputCount = settings.outputCount ?? model.defaults.outputCount;
  const price = await calculateGenerationPrice({
    platformModelId: model.id,
    outputCount,
  });

  if (!price.ok || price.credits <= 0) {
    throw billingUnavailable({
      operation: "calculate_generation_price",
      reason: price.ok ? "nonpositive_real_model_price" : price.error,
      modelId: model.id,
    });
  }

  try {
    const reservation = await reserveCredits({
      clerkUserId: params.clerkUserId,
      amount: price.credits,
      // Server-derived and stable for this generation. Concurrent/replayed
      // execution requests therefore converge on one hold in Postgres.
      idempotencyKey: `generation:${generation.id}`,
      generationId: generation.id,
      quote: {
        platformModelId: model.id,
        pricingVersion: price.pricingVersion,
        credits: price.credits,
        providerEstimatedCost: price.providerEstimatedCost,
        currency: price.currency,
        breakdown: price.breakdown,
      },
    });

    if (
      reservation.status !== "held" ||
      (reservation.generationId !== null && reservation.generationId !== generation.id)
    ) {
      throw billingUnavailable({
        operation: "reserve_credits",
        reason: "reservation_not_held",
        generationId: generation.id,
        reservationStatus: reservation.status,
      });
    }

    return {
      generationId: generation.id,
      reservationId: reservation.reservationId,
      credits: reservation.amount,
      replayed: reservation.replayed,
      freeMock: false,
    };
  } catch (error) {
    if (error instanceof OrchestrationError) throw error;
    throw mapReservationFailure(error);
  }
}

/**
 * Defense-in-depth gate for the provider submission boundary. It never
 * creates a reservation: by the time a worker reaches this point the hold
 * must already exist. This prevents a future route/workflow regression from
 * silently restoring unpaid provider execution.
 */
export async function assertGenerationBillingAuthorized(params: {
  generationId: string;
  clerkUserId: string;
}): Promise<void> {
  const generation = await readOwnedGeneration(params.generationId, params.clerkUserId);
  const model = findModel(generation.model);

  if (!model) {
    throw new OrchestrationError("UNKNOWN_MODEL");
  }

  if (model.isMock) return;

  const held = await readHeldReservation(generation.id, params.clerkUserId);
  if (!held) {
    throw billingUnavailable({
      operation: "provider_submission_billing_gate",
      reason: "held_reservation_missing",
      generationId: generation.id,
    });
  }
}
