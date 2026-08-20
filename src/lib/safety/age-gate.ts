import "server-only";
import { GENERIC_REFUSAL_MESSAGE, type SafetyRiskCategory } from "./safety-contract";

/**
 * The 18+ age gate (Phase 28-C).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT DECIDE
 * ---------------------------------------------------------------------------
 * The roadmap asks for "18+ konumlandırma, signup'ta yaş doğrulama/onay". HOW
 * to verify — a self-declaration checkbox, a document check, or a third-party
 * KYC provider — is not a decision this batch may make: it determines what
 * personal data Cinefield collects, which is a GDPR question owned by Phase 23
 * and a contractual one owned by Phase 29. REFERANS M.1 puts the surrounding
 * category in the same bucket: "Yetişkin / NSFW — İŞ KARARI."
 *
 * So this file builds the STATE and the ENFORCEMENT, and leaves the method
 * unchosen. `AGE_VERIFICATION_NOT_CONFIGURED` is the honest state today.
 *
 * ---------------------------------------------------------------------------
 * NOT-CONFIGURED IS NEVER "VERIFIED ADULT"
 * ---------------------------------------------------------------------------
 * The same rule as every other seam in this package, and here it matters most:
 * a system that fabricates adult confidence is a system that has, in writing,
 * asserted something about a user it never checked. There is no default, no
 * environment flag, and no test hook in this file that produces
 * `VERIFIED_ADULT`.
 *
 * ---------------------------------------------------------------------------
 * NOTHING RESTRICTED IS REACHABLE TODAY, AND THAT IS RECORDED HONESTLY
 * ---------------------------------------------------------------------------
 * REFERANS M.1's recommendation is that MVP ban adult content outright
 * ("MVP'de tamamen yasakla — ödeme sağlayıcıları hesabı kapatabilir"). No
 * enabled model exposes an adult mode and no restricted category is currently
 * requestable, so this gate has no live traffic to guard. It is wired anyway,
 * because the alternative — adding it at the moment the first restricted
 * category ships — is how a gate gets forgotten.
 */

export type AgeAssuranceState =
  /** No verification method has been chosen or configured. The state today. */
  | "AGE_VERIFICATION_NOT_CONFIGURED"
  /** A method exists; this user has not completed it. */
  | "UNVERIFIED"
  /** A method exists and this user passed it. Never produced by default. */
  | "VERIFIED_ADULT"
  /** A method exists and this user is known to be under 18. */
  | "VERIFIED_MINOR";

export const AGE_ASSURANCE_STATES: readonly AgeAssuranceState[] = [
  "AGE_VERIFICATION_NOT_CONFIGURED",
  "UNVERIFIED",
  "VERIFIED_ADULT",
  "VERIFIED_MINOR",
];

/** Exactly one member, and it cannot be reached without a real provider. */
export const ADULT_STATES: ReadonlySet<AgeAssuranceState> = new Set<AgeAssuranceState>(["VERIFIED_ADULT"]);

/**
 * Which risk categories require an adult before the request may proceed.
 *
 * Bounded and small. `csam` is deliberately ABSENT — it is not an age-gated
 * category, it is a prohibited one, and listing it here would imply that some
 * age assurance could unlock it.
 */
export const AGE_RESTRICTED_CATEGORIES: ReadonlySet<SafetyRiskCategory> = new Set<SafetyRiskCategory>([
  "sexual_content",
]);

/**
 * What a real age-assurance provider must implement.
 *
 * Returning `null` means "no answer", which resolves to
 * `AGE_VERIFICATION_NOT_CONFIGURED` rather than to a guess.
 */
export interface AgeAssuranceProvider {
  readonly name: string;
  assess(input: { readonly clerkUserId: string }): Promise<AgeAssuranceState | null>;
}

let provider: AgeAssuranceProvider | null = null;

/** Installs a provider, or clears it. Not called in production wiring. */
export function installAgeAssuranceProvider(next: AgeAssuranceProvider | null): void {
  provider = next;
}

export function isAgeAssuranceConfigured(): boolean {
  return provider !== null;
}

export async function resolveAgeAssurance(clerkUserId: string): Promise<AgeAssuranceState> {
  const active = provider;
  if (!active) return "AGE_VERIFICATION_NOT_CONFIGURED";

  let state: AgeAssuranceState | null;
  try {
    state = await active.assess({ clerkUserId });
  } catch {
    return "AGE_VERIFICATION_NOT_CONFIGURED";
  }

  if (state === null || !AGE_ASSURANCE_STATES.includes(state)) {
    return "AGE_VERIFICATION_NOT_CONFIGURED";
  }
  // A provider CAN report VERIFIED_ADULT — that is what installing one means.
  return state;
}

export type AgeGateOutcome =
  | { readonly allowed: true; readonly state: AgeAssuranceState; readonly reasonCode: string }
  | {
      readonly allowed: false;
      readonly state: AgeAssuranceState;
      readonly reasonCode: string;
      readonly userMessage: string;
    };

/**
 * Applies the gate to one request's flagged categories.
 *
 * REFUSES rather than routing to review when age is unknown. The roadmap's
 * wording for 28-C is "18+ yaş kapısı" — a gate, not a queue — and a human
 * reviewer looking at an age question has nothing to review: they cannot
 * determine a stranger's age from a generation request either.
 */
export async function evaluateAgeGate(input: {
  readonly clerkUserId: string;
  readonly categories: readonly SafetyRiskCategory[];
}): Promise<AgeGateOutcome> {
  const restricted = input.categories.filter((category) => AGE_RESTRICTED_CATEGORIES.has(category));

  // Nothing restricted was requested. The gate does not fire, and no age
  // assurance is consulted — asking would collect a signal about a user for a
  // request that did not need it.
  if (restricted.length === 0) {
    return { allowed: true, state: "AGE_VERIFICATION_NOT_CONFIGURED", reasonCode: "age_gate_not_applicable" };
  }

  const state = await resolveAgeAssurance(input.clerkUserId);
  if (ADULT_STATES.has(state)) {
    return { allowed: true, state, reasonCode: "age_verified_adult" };
  }

  return {
    allowed: false,
    state,
    reasonCode:
      state === "AGE_VERIFICATION_NOT_CONFIGURED" ? "age_verification_not_configured" : "age_not_verified_adult",
    // The same single string as every other refusal. A message that said
    // "verify your age to continue" would tell a caller exactly which lever to
    // pull, and REFERANS M.1's rule about not teaching the bypass applies to
    // every gate in this package, not only the content classifier.
    userMessage: GENERIC_REFUSAL_MESSAGE,
  };
}
