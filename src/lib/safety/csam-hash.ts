import "server-only";

/**
 * Known-CSAM hash matching seam (Phase 28-B).
 *
 * ---------------------------------------------------------------------------
 * ZERO TOLERANCE IS NOT A SETTING
 * ---------------------------------------------------------------------------
 * REFERANS M.1, on the one category the roadmap refuses to leave to product
 * judgement: "CSAM — KARAR YOK — sıfır tolerans + yasal zorunluluk.
 * Hash-eşleştirme (PhotoDNA/Safer), pozitifte anında quarantine + hesap bloke
 * + NCMEC raporu."
 *
 * So there is no threshold, no confidence score, no environment flag and no
 * admin action in this module. A positive match is a positive match.
 *
 * ---------------------------------------------------------------------------
 * "NOT CONFIGURED" IS NEVER "NO MATCH"
 * ---------------------------------------------------------------------------
 * This is the single most important property in the file, and it is why the
 * outcome is a union rather than a boolean. A boolean has exactly two values
 * and a system with no provider would have to return one of them — which in
 * practice means `false`, which reads as "we checked and it is clean". It is
 * not: nothing was checked.
 *
 * `PROVIDER_NOT_CONFIGURED` and `NO_MATCH` are therefore different members,
 * and only `NO_MATCH` is reachable after a provider has actually answered.
 *
 * ---------------------------------------------------------------------------
 * NO CONNECTIVITY IS CLAIMED
 * ---------------------------------------------------------------------------
 * PhotoDNA, Thorn Safer and IWF all require an application, a signed
 * agreement and — for the hash lists themselves — legal standing that a code
 * batch cannot manufacture. Nothing here calls them, holds a credential for
 * them, or implements their protocol. The provider is INJECTED, which is what
 * lets the positive-match BEHAVIOUR be proven today with a deterministic test
 * provider while real access stays an external dependency.
 */

export type CsamHashOutcome =
  /** A provider answered: these bytes match a known-illegal hash. */
  | { readonly outcome: "POSITIVE_MATCH"; readonly providerName: string; readonly listId: string }
  /** A provider answered: no entry matched. Reachable ONLY after a real query. */
  | { readonly outcome: "NO_MATCH"; readonly providerName: string }
  /** No provider is installed. NOTHING WAS CHECKED. */
  | { readonly outcome: "PROVIDER_NOT_CONFIGURED" }
  /** A provider is installed but did not answer: outage, timeout, throw. */
  | { readonly outcome: "PROVIDER_UNAVAILABLE"; readonly providerName: string }
  /** A provider answered outside its own contract. */
  | { readonly outcome: "MALFORMED_RESULT"; readonly providerName: string };

/**
 * What a real hash-matching provider must implement.
 *
 * The input is the content digest Phase 9-B already computed in its sandbox —
 * NOT the bytes. A perceptual-hash service would need the image itself, and
 * that is a deliberate limitation recorded here rather than designed around:
 * this seam supports exact known-hash lists today, and widening it to carry
 * bytes is a change a reviewer should see, because it moves illegal material
 * to a third party.
 */
export interface CsamHashProvider {
  readonly name: string;
  /** Resolves to a match, a non-match, or null for "no answer". */
  lookup(input: {
    readonly contentDigestSha256: string;
    readonly verifiedMime: string;
  }): Promise<{ readonly matched: boolean; readonly listId?: string } | null>;
}

let provider: CsamHashProvider | null = null;

/**
 * Installs a provider, or clears it with `null`.
 *
 * Not called in production wiring: no CSAM hash provider has been contracted.
 * Tests install a deterministic fake through this seam, which is how §18 of
 * the Phase 28 brief is satisfied — the CODE path for a positive match is
 * proven while the VENDOR relationship remains deferred.
 */
export function installCsamHashProvider(next: CsamHashProvider | null): void {
  provider = next;
}

export function isCsamHashProviderConfigured(): boolean {
  return provider !== null;
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Asks the installed provider about one asset's digest.
 *
 * Never throws. A provider that throws becomes `PROVIDER_UNAVAILABLE`, which
 * the output evaluator treats as "not cleared" — the same non-permissive
 * handling every other unknown gets.
 */
export async function checkKnownCsamHash(input: {
  readonly contentDigestSha256: string;
  readonly verifiedMime: string;
}): Promise<CsamHashOutcome> {
  const active = provider;
  if (!active) return { outcome: "PROVIDER_NOT_CONFIGURED" };

  if (!DIGEST_PATTERN.test(input.contentDigestSha256)) {
    // A malformed digest is refused rather than sent onward. Forwarding
    // arbitrary caller text to a hash service would make this function a
    // channel to a third party for anything a caller can put in a string.
    return { outcome: "MALFORMED_RESULT", providerName: active.name };
  }

  let answer: Awaited<ReturnType<CsamHashProvider["lookup"]>>;
  try {
    answer = await active.lookup(input);
  } catch {
    return { outcome: "PROVIDER_UNAVAILABLE", providerName: active.name };
  }

  if (answer === null) return { outcome: "PROVIDER_UNAVAILABLE", providerName: active.name };
  if (typeof answer.matched !== "boolean") {
    return { outcome: "MALFORMED_RESULT", providerName: active.name };
  }

  if (answer.matched) {
    // The list identifier is bounded and non-secret — it names WHICH list
    // matched, which an incident record needs, and carries no part of the
    // material itself.
    const listId =
      typeof answer.listId === "string" && /^[a-z][a-z0-9_]{1,64}$/.test(answer.listId)
        ? answer.listId
        : "unspecified_list";
    return { outcome: "POSITIVE_MATCH", providerName: active.name, listId };
  }

  return { outcome: "NO_MATCH", providerName: active.name };
}
