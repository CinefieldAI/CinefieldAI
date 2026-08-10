/**
 * Cinefield Temporal worker entry point (Phase 6R.2).
 *
 * Runs as a long-lived process on AWS ECS Fargate (locked decision C), NOT on
 * Vercel: a Temporal worker holds open long-poll connections for its
 * lifetime, which a request-scoped serverless function cannot do.
 *
 * WHY THIS LIVES OUTSIDE src/
 * `@temporalio/worker` ships a native Rust core. Anything under `src/` risks
 * being pulled into the Next.js bundle by an accidental import; keeping the
 * worker at the repository root makes that impossible by construction. It
 * still shares `src/lib/temporal/{task-queues,workflow-ids}` — pure,
 * dependency-free modules safe on both sides.
 *
 * WHAT IS REGISTERED
 * GenerationWorkflow (workflows/generation-workflow.ts) and its activities
 * (activities/generation-activities.ts). The workflow module is registered by
 * PATH, not by import: Temporal bundles it into an isolated, deterministic
 * sandbox, and importing it here would pull non-deterministic module state
 * into that bundle.
 *
 * Registering the workflow does NOT move production traffic. Nothing starts a
 * GenerationWorkflow unless TEMPORAL_GENERATION_ENABLED is explicitly true —
 * the direct/trigger paths remain the default.
 *
 * Run:  npm run temporal:worker
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities/generation-activities";
import { TASK_QUEUES } from "../src/lib/temporal/task-queues";
import { setCommandBus } from "../src/lib/contracts/command-bus";
import { createSqsCommandBus } from "../src/lib/aws/sqs-command-bus";
import { describeSqsConfig, isSqsCommandBusEnabled } from "../src/lib/aws/sqs-config";

/**
 * Read directly from the process environment. On ECS these values are
 * injected by the task definition from AWS Secrets Manager — never copied
 * from .env.local, and never written into a Temporal payload or log.
 *
 * `src/lib/temporal/config.ts` is intentionally NOT imported: it is marked
 * `server-only`, a Next.js construct that throws outside the Next runtime.
 * The validation rules below mirror it exactly.
 */
function readConfig() {
  const value = (name: string): string | undefined => {
    const raw = process.env[name];
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
  };

  const address = value("TEMPORAL_ADDRESS");
  const namespace = value("TEMPORAL_NAMESPACE");
  const apiKey = value("TEMPORAL_API_KEY");
  const clientCertPem = value("TEMPORAL_CLIENT_CERT");
  const clientKeyPem = value("TEMPORAL_CLIENT_KEY");

  if (!address || !namespace) return null;

  const hasApiKey = apiKey !== undefined;
  const hasMtls = clientCertPem !== undefined && clientKeyPem !== undefined;
  // Both or neither is a misconfiguration, not a preference to resolve.
  if (hasApiKey === hasMtls) return null;

  return { address, namespace, apiKey, clientCertPem, clientKeyPem, hasApiKey };
}

async function main(): Promise<void> {
  const config = readConfig();
  if (!config) {
    // Exit non-zero so ECS restarts and the failure is visible in CloudWatch,
    // rather than a worker that runs forever polling nothing. The message
    // names the missing variables — never their values.
    console.error(
      "[cinefield:worker]",
      JSON.stringify({
        result: "not_configured",
        required: "TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, and exactly one of TEMPORAL_API_KEY or TEMPORAL_CLIENT_CERT+TEMPORAL_CLIENT_KEY",
      })
    );
    process.exit(1);
  }

  // ---- CommandBus composition (Phase 6R.4) --------------------------------
  // The ONLY place the SQS transport is wired in. When the explicit gate is
  // off, the default NoopCommandBus stays in place and the submit activity
  // performs direct in-process submission — configuration alone never
  // switches the transport.
  if (isSqsCommandBusEnabled()) {
    const bus = createSqsCommandBus();
    if (bus) {
      setCommandBus(bus);
      console.info(
        "[cinefield:worker]",
        JSON.stringify({ result: "command_bus", transport: "sqs", ...describeSqsConfig() })
      );
    }
  }

  const connection = await NativeConnection.connect({
    address: config.address,
    tls: config.hasApiKey
      ? true
      : {
          clientCertPair: {
            crt: Buffer.from(config.clientCertPem ?? "", "utf8"),
            key: Buffer.from(config.clientKeyPem ?? "", "utf8"),
          },
        },
    ...(config.hasApiKey ? { apiKey: config.apiKey } : {}),
  });

  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: TASK_QUEUES.generation,
    workflowsPath: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "workflows/generation-workflow.ts"
    ),
    activities,
  });

  console.info(
    "[cinefield:worker]",
    JSON.stringify({
      result: "started",
      taskQueue: TASK_QUEUES.generation,
      authMethod: config.hasApiKey ? "api-key" : "mtls",
    })
  );

  // Resolves when the worker shuts down. Worker.run() installs its own
  // SIGINT/SIGTERM handling, which is what lets ECS stop a task without
  // abandoning in-flight tasks.
  await worker.run();

  await connection.close();
  console.info("[cinefield:worker]", JSON.stringify({ result: "stopped" }));
}

main().catch((error: unknown) => {
  // Code/class only: a provider or connection error must not print a token,
  // an address, or a payload into CloudWatch.
  console.error(
    "[cinefield:worker]",
    JSON.stringify({
      result: "fatal",
      error: error instanceof Error ? error.name : "UnknownError",
    })
  );
  process.exit(1);
});
