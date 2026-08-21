import assert from "node:assert/strict";
import test from "node:test";
import { OrchestrationError } from "./errors";
import {
  executeGenerationRequest,
  type GenerationExecutionDeps,
} from "./generation-execution-service";

function baseDeps(): GenerationExecutionDeps {
  return {
    resolveOwner: () => "temporal",
    startWorkflow: async ({ generationId }) => ({
      generationId,
      workflowId: `generation:${generationId}`,
      runId: "run-test",
    }),
    runDirect: (async () => {
      throw new Error("direct path must not run in this test");
    }) as GenerationExecutionDeps["runDirect"],
    resolveStartIntent: async () => {},
    authorizeBilling: async ({ generationId }) => ({
      generationId,
      reservationId: "11111111-1111-4111-8111-111111111111",
      credits: 10,
      replayed: false,
      freeMock: false,
    }),
  };
}

test("billing refusal happens before Temporal starts", async () => {
  let workflowStarts = 0;
  const deps = baseDeps();
  deps.startWorkflow = async (params) => {
    workflowStarts += 1;
    return {
      generationId: params.generationId,
      workflowId: `generation:${params.generationId}`,
      runId: "must-not-run",
    };
  };
  deps.authorizeBilling = async () => {
    throw new OrchestrationError("GENERATION_OWNER_UNAVAILABLE", {
      userMessage: "Generation billing is temporarily unavailable. Please try again later.",
    });
  };

  await assert.rejects(
    () =>
      executeGenerationRequest(
        {
          generationId: "22222222-2222-4222-8222-222222222222",
          clerkUserId: "user-security-test",
        },
        deps
      ),
    (error: unknown) =>
      error instanceof OrchestrationError && error.code === "GENERATION_OWNER_UNAVAILABLE"
  );

  assert.equal(workflowStarts, 0, "Temporal must not start when billing authorization fails");
});

test("Temporal starts only after billing authorization succeeds", async () => {
  const order: string[] = [];
  const deps = baseDeps();
  deps.authorizeBilling = async ({ generationId }) => {
    order.push("billing");
    return {
      generationId,
      reservationId: "33333333-3333-4333-8333-333333333333",
      credits: 10,
      replayed: false,
      freeMock: false,
    };
  };
  deps.startWorkflow = async ({ generationId }) => {
    order.push("temporal");
    return {
      generationId,
      workflowId: `generation:${generationId}`,
      runId: "run-after-billing",
    };
  };

  const outcome = await executeGenerationRequest(
    {
      generationId: "44444444-4444-4444-8444-444444444444",
      clerkUserId: "user-security-test",
    },
    deps
  );

  assert.equal(outcome.outcome, "started");
  assert.deepEqual(order, ["billing", "temporal"]);
});
