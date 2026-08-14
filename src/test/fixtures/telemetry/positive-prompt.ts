// Phase 13-E POSITIVE CONTROL — test fixture only, never imported by
// runtime code. Each file contains one risky log call site the CI
// telemetry scan must flag. Values are assembled from fragments so no
// literal credential shape is typed by hand.

export function gen(prompt: string) {
  console.info("generating", { prompt });
}
