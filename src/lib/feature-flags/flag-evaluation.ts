import type { FlagEvaluationContext, FlagEvaluationDetails, FlagProvider } from "./flag-contract";
import { flagDefinition, isValidFlagValue } from "./flag-registry";

/**
 * Phase 21-A — `evaluateFlag()`, the one function every caller uses.
 *
 * "Server flag evaluation kontrollü çalışıyor" (21-A's own done-criterion)
 * means exactly this: a registered key, resolved through a provider, never
 * an ad-hoc `process.env` read scattered across call sites — the same
 * "one reviewable contract" discipline `sqs-topology.ts`/`redis-keys.ts`/
 * `queue-names.ts` already apply to their own name spaces.
 *
 * An unregistered key, a provider error, or a durable value that no longer
 * satisfies its own definition's shape (e.g. `release_stage` holding
 * something outside `["alpha","beta","public"]` after a registry edit) all
 * fail to the definition's `defaultValue` — never to `undefined`, and never
 * by throwing into a render path.
 */
export async function evaluateFlag(
  key: string,
  provider: FlagProvider,
  context: FlagEvaluationContext = {}
): Promise<FlagEvaluationDetails> {
  const definition = flagDefinition(key);
  if (!definition) {
    return { flagKey: key, value: false, reason: "ERROR" };
  }

  let record: Awaited<ReturnType<FlagProvider["resolve"]>>;
  try {
    record = await provider.resolve(key, context);
  } catch {
    return { flagKey: key, value: definition.defaultValue, reason: "ERROR" };
  }

  if (!record) {
    return { flagKey: key, value: definition.defaultValue, reason: "DEFAULT" };
  }

  if (!isValidFlagValue(definition, record.value)) {
    return { flagKey: key, value: definition.defaultValue, reason: "ERROR" };
  }

  return { flagKey: key, value: record.value, reason: "STATIC" };
}

export async function evaluateBoolean(
  key: string,
  provider: FlagProvider,
  context: FlagEvaluationContext = {}
): Promise<boolean> {
  const details = await evaluateFlag(key, provider, context);
  return typeof details.value === "boolean" ? details.value : false;
}
