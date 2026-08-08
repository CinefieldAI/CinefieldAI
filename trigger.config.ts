import { defineConfig } from "@trigger.dev/sdk";

/**
 * Cinefield Trigger.dev configuration.
 *
 * `project` is a project reference id, not a secret — it identifies which
 * Trigger.dev project tasks belong to but does not authenticate anything by
 * itself (TRIGGER_SECRET_KEY does that, and is never referenced here). It is
 * read from an env var rather than hardcoded because no real project has
 * been connected yet in this phase; see .env.example.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "",
  dirs: ["./src/trigger"],
  maxDuration: 300,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 5_000,
      maxTimeoutInMs: 60_000,
      factor: 2,
      randomize: true,
    },
  },
});
