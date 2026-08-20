import "server-only";
import { isProduction } from "@/lib/config/environment";
import { getModerationEngine, type ModerationVerdict } from "@/lib/media/moderation-contract";
import { checkKnownCsamHash, type CsamHashOutcome } from "./csam-hash";
import { readProviderNativeSafety, type ProviderNativeSafetySignal } from "./provider-native-safety";
import {
  SAFETY_POLICY_VERSION,
  isSafetyRiskCategory,
  type SafetyDecision,
  type SafetyRiskCategory,
  type SafetySignalSource,
  type SafetyVerdict,
} from "./safety-contract";

/**
 * Gate C — output safety, AFTER generation (Phase 28-B).
 *
 * ---------------------------------------------------------------------------
 * THE MOST CRITICAL GATE, IN THE ROADMAP'S OWN WORDS
 * ---------------------------------------------------------------------------
 * REFERANS M.1 on gate C: "En kritik yer: masum prompt bile kötü çıktı
 * üretebilir." Gate B cannot cover this — a prompt that reads as harmless can
 * produce an output that is not, and no amount of prompt filtering closes
 * that gap. This is the gate 28-B's done-criterion is about: "Pozitif case
 * kullanıcı teslimatına çıkmıyor ve incident kaydı oluşuyor."
 *
 * ---------------------------------------------------------------------------
 * THREE SOURCES, ONE CINEFIELD VERDICT
 * ---------------------------------------------------------------------------
 *   1. KNOWN-HASH MATCH   zero tolerance, checked first, terminal on a match.
 *   2. CINEFIELD ENGINE   Phase 9-E's `MediaModerationEngine` — this function
 *                         is the REAL CALLER that contract was written for and
 *                         never had.
 *   3. PROVIDER-NATIVE    evidence only; can restrict, can never permit.
 *
 * They combine by MOST RESTRICTIVE WINS, never by voting or averaging. A
 * scoring scheme would let two "probably fine" answers outvote one "this is
 * illegal", which is the wrong shape of arithmetic for this problem.
 *
 * ---------------------------------------------------------------------------
 * THE PROVIDER SIGNAL IS RETURNED SEPARATELY, NOT FOLDED IN
 * ---------------------------------------------------------------------------
 * `OutputSafetyAssessment` carries Cinefield's decision AND the raw normalized
 * provider signal as distinct fields, and the store writes them to distinct
 * columns. Merging them would destroy the only evidence that could later
 * answer "did the vendor start flagging everything?" or "did it stop flagging
 * anything?" — the provider-drift question §30 exists to keep answerable.
 */

/** Most restrictive first. Used to combine independent verdicts. */
const SEVERITY: Readonly<Record<SafetyVerdict, number>> = {
  BLOCK: 5,
  REVIEW_REQUIRED: 4,
  MALFORMED_RESULT: 3,
  UNAVAILABLE: 2,
  NOT_CONFIGURED: 1,
  ALLOW: 0,
};

function moreRestrictive(a: SafetyVerdict, b: SafetyVerdict): SafetyVerdict {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

export interface OutputSafetyInput {
  readonly assetId: string;
  readonly bytes: Uint8Array;
  readonly verifiedMime: string;
  /** Phase 9-B's sandboxed SHA-256. Never recomputed here. */
  readonly contentDigestSha256: string;
  /** The output's own `metadata`, carrying any provider-native signal. */
  readonly outputMetadata?: unknown;
}

export interface OutputSafetyAssessment {
  /** Cinefield's decision. The only thing delivery consults. */
  readonly decision: SafetyDecision;
  /** The vendor's opinion, kept intact and separate. Null when silent. */
  readonly providerSignal: ProviderNativeSafetySignal | null;
  /** What the hash lane concluded, including "nothing was checked". */
  readonly hashOutcome: CsamHashOutcome;
  /**
   * Whether a mandatory report is owed. Set ONLY by a real positive hash
   * match — never by a moderation verdict, however severe, because the
   * reporting obligation attaches to the known-illegal finding specifically.
   */
  readonly mandatoryReportRequired: boolean;
  /**
   * The Phase 9-E `moderation_status` value to persist, or null when no
   * verdict was reached. Null means "leave the column alone" — the same rule
   * `moderationStatusFor` states: a caller with no verdict must not pass a
   * stand-in through.
   */
  readonly moderationStatus: string | null;
}

/**
 * Evaluates one finished output.
 *
 * Never throws. Every failure mode resolves to a non-permissive verdict, so a
 * caller cannot make delivery safe or unsafe by how it handles exceptions.
 */
export async function evaluateOutputSafety(input: OutputSafetyInput): Promise<OutputSafetyAssessment> {
  const categories = new Set<SafetyRiskCategory>();
  let verdict: SafetyVerdict = "ALLOW";
  let signalSource: SafetySignalSource = "none";
  let reasonCode = "output_safety_clean";
  let classifierVersion: string | null = null;
  let moderationStatus: string | null = null;

  // ---- 1. KNOWN-CSAM HASH. Zero tolerance, and it goes first --------------
  //
  // First because a positive match is terminal and because it is the one
  // category REFERANS M.1 says has no decision attached to it. Running it
  // ahead of everything else also means a match is recorded even if the
  // moderation engine is down.
  const hashOutcome = await checkKnownCsamHash({
    contentDigestSha256: input.contentDigestSha256,
    verifiedMime: input.verifiedMime,
  });

  if (hashOutcome.outcome === "POSITIVE_MATCH") {
    // Terminal. Nothing below can soften this, and there is no branch after
    // this point that can raise the verdict back toward ALLOW.
    return {
      decision: {
        stage: "output",
        verdict: "BLOCK",
        categories: ["csam"],
        reasonCode: "known_hash_match",
        policyVersion: SAFETY_POLICY_VERSION,
        classifierVersion: null,
        signalSource: "hash_match_provider",
      },
      providerSignal: readProviderNativeSafety(input.outputMetadata),
      hashOutcome,
      mandatoryReportRequired: true,
      moderationStatus: "rejected",
    };
  }

  if (hashOutcome.outcome !== "NO_MATCH") {
    // NOT_CONFIGURED / UNAVAILABLE / MALFORMED. Nothing was checked, and that
    // is NOT "no match" — see csam-hash.ts. In production it withholds
    // delivery; outside production it is recorded and does not block, on the
    // same reasoning as the prompt gate's asymmetry.
    if (isProduction()) {
      verdict = moreRestrictive(verdict, "NOT_CONFIGURED");
      reasonCode = "csam_hash_not_checked";
    }
  }

  // ---- 2. CINEFIELD'S OWN ENGINE — the real caller Phase 9-E never had ----
  const engine = getModerationEngine();
  if (!engine) {
    verdict = moreRestrictive(verdict, "NOT_CONFIGURED");
    if (reasonCode === "output_safety_clean") reasonCode = "output_moderation_not_configured";
  } else {
    signalSource = "cinefield_classifier";
    classifierVersion = engine.name.slice(0, 64);

    let result: Awaited<ReturnType<typeof engine.classify>>;
    try {
      result = await engine.classify({
        bytes: input.bytes,
        verifiedMime: input.verifiedMime,
        assetId: input.assetId,
      });
    } catch {
      // Discarded rather than propagated: a classifier's exception may carry a
      // provider body or a URL, and nothing here may persist either.
      result = null;
    }

    if (result === null) {
      verdict = moreRestrictive(verdict, "UNAVAILABLE");
      reasonCode = "output_moderation_no_verdict";
    } else {
      const mapped = mapEngineVerdict(result.verdict);
      if (mapped === null) {
        verdict = moreRestrictive(verdict, "MALFORMED_RESULT");
        reasonCode = "output_moderation_malformed";
      } else {
        verdict = moreRestrictive(verdict, mapped);
        moderationStatus = result.verdict;
        if (mapped !== "ALLOW") reasonCode = `output_moderation_${result.verdict}`;
        for (const category of result.categories ?? []) {
          // Unrecognised categories are recorded as `unclassified` rather than
          // dropped. Silently discarding an unknown category could discard
          // precisely the signal that mattered.
          categories.add(isSafetyRiskCategory(category) ? category : "unclassified");
        }
      }
    }
  }

  // ---- 3. PROVIDER-NATIVE. Restricts, never permits ----------------------
  const providerSignal = readProviderNativeSafety(input.outputMetadata);
  if (providerSignal?.flagged) {
    // A vendor flag alone is not a block — strictness varies wildly between
    // providers, and REFERANS M.1 says not to trust gate A. But it is never
    // discarded either: it sends an otherwise-clean output to a human.
    verdict = moreRestrictive(verdict, "REVIEW_REQUIRED");
    if (providerSignal.category) categories.add(providerSignal.category);
    if (reasonCode === "output_safety_clean") reasonCode = "provider_native_flagged";
    if (signalSource === "none") signalSource = "provider_native";
    // The Phase 9-E column follows: a flagged output that Cinefield's own
    // engine passed is `manual_review`, not `passed`. Without this the DB
    // release constraint would still see `passed` and permit release.
    if (moderationStatus === "passed" || moderationStatus === null) moderationStatus = "manual_review";
  }

  return {
    decision: {
      stage: "output",
      verdict,
      categories: [...categories],
      reasonCode,
      policyVersion: SAFETY_POLICY_VERSION,
      classifierVersion,
      signalSource,
    },
    providerSignal,
    hashOutcome,
    // Only a real positive hash match creates a reporting obligation, and that
    // path returned above. A severe moderation verdict is not the same thing:
    // reporting attaches to the known-illegal FINDING, not to strictness.
    mandatoryReportRequired: false,
    moderationStatus,
  };
}

/**
 * Maps Phase 9-E's engine vocabulary onto Phase 28's.
 *
 * `error` becomes `UNAVAILABLE`, not a content conclusion: 9-E defines it as a
 * verdict the engine reached ABOUT ITSELF, and treating it as a statement
 * about the media would be a category error in both directions — it is
 * neither an approval nor a finding.
 */
function mapEngineVerdict(verdict: ModerationVerdict): SafetyVerdict | null {
  switch (verdict) {
    case "passed":
      return "ALLOW";
    case "rejected":
      return "BLOCK";
    case "manual_review":
      return "REVIEW_REQUIRED";
    case "error":
      return "UNAVAILABLE";
    default:
      return null;
  }
}
