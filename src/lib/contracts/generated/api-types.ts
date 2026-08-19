/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by `npm run contracts:generate-types` from `openapi/cinefield.json`
 * (itself produced by `npm run contracts:generate-openapi` from
 * `src/lib/events/event-schemas.ts`). Edit the source schema, not this file —
 * `contract-ci.yml` (Phase 20-D) regenerates and diffs on every PR that
 * touches either input and fails the build on drift.
 */

export interface paths {
    "/api/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Public liveness probe — process is answering, nothing more. */
        get: operations["getHealthLive"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/privileged-actions/decide": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A second, distinct admin approves or rejects a pending Phase 16-E two-person privileged action. */
        post: operations["decidePrivilegedAction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        DomainEventEnvelope: {
            /** Format: uuid */
            eventId: string;
            eventType: string;
            eventVersion: number;
            aggregateType: string;
            aggregateId: string;
            /** Format: date-time */
            occurredAt: string;
            traceId?: string;
            tenantId?: string;
            payload: Record<string, never>;
        };
        AssetRejectedPayloadV1: {
            /** Format: uuid */
            assetId: string;
        };
        AssetReleasedPayloadV1: {
            /** Format: uuid */
            assetId: string;
        };
        AuditEvalRunCompletedPayloadV1: {
            /** Format: uuid */
            runId: string;
            providerId: string;
            providerModelId: string;
            evalSetKey: string;
            /** @enum {string} */
            status: "completed" | "failed";
            caseCount: number;
            failedCaseCount?: number;
            meanQualityScore?: number | null;
        };
        AuditFlagChangedPayloadV1: {
            flagKey: string;
            /** @enum {string} */
            riskTier: "OPERATOR" | "HIGH_RISK_TIER0";
            newValue: string;
            previousValue?: string | null;
        };
        CreditRefundedPayloadV1: {
            /** Format: uuid */
            reservationId: string;
            generationId?: string | null;
            returned: number;
            reason?: string;
        };
        CreditReservedPayloadV1: {
            /** Format: uuid */
            reservationId: string;
            generationId?: string | null;
            amount: number;
        };
        CreditSettledPayloadV1: {
            /** Format: uuid */
            reservationId: string;
            generationId?: string | null;
            charged: number;
            returned?: number;
        };
        GenerationCancelledPayloadV1: {
            /** Format: uuid */
            generationId: string;
            provider?: string;
        };
        GenerationCompletedPayloadV1: {
            /** Format: uuid */
            generationId: string;
            provider: string;
            attemptNo?: number;
            durationMs?: number;
        };
        GenerationCreatedPayloadV1: {
            /** Format: uuid */
            generationId: string;
            /** @enum {string} */
            generationType: "image" | "video" | "audio" | "text";
            provider: string;
            model: string;
        };
        GenerationFailedPayloadV1: {
            /** Format: uuid */
            generationId: string;
            provider: string;
            errorCode: string;
            attemptNo?: number;
        };
        GenerationProcessingPayloadV1: {
            /** Format: uuid */
            generationId: string;
            provider?: string;
        };
        ProviderFailedPayloadV1: {
            /** Format: uuid */
            generationId: string;
            /** Format: uuid */
            attemptId: string;
            provider: string;
            errorCode: string;
            /** @enum {string} */
            submissionEvidence?: "none" | "ambiguous" | "job";
        };
        ProviderSubmittedPayloadV1: {
            /** Format: uuid */
            generationId: string;
            /** Format: uuid */
            attemptId: string;
            provider: string;
            providerJobId?: string | null;
            /** @enum {string} */
            submissionEvidence: "none" | "ambiguous" | "job";
        };
        SecurityWarningPayloadV1: {
            reasonCode: string;
            /** @enum {string} */
            severity: "info" | "low" | "medium" | "high";
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealthLive: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The process is alive. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "HEALTHY";
                        /** Format: date-time */
                        timestamp: string;
                    };
                };
            };
        };
    };
    decidePrivilegedAction: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    requestId: string;
                    action: string;
                    targetType: string;
                    targetId?: string | null;
                    /** @enum {string} */
                    decision: "approve" | "reject";
                    reasonCode?: string | null;
                };
            };
        };
        responses: {
            /** @description The decision outcome — never the underlying action's execution result. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        outcome: "INVALID_REQUEST" | "UNKNOWN_ACTION" | "ROLE_NOT_PERMITTED" | "STEP_UP_REQUIRED" | "SELF_APPROVAL_BLOCKED" | "NO_MATCHING_REQUEST" | "REQUEST_EXPIRED" | "REJECTED" | "APPROVAL_RECORDED" | "SOURCE_UNAVAILABLE";
                        reasonCode?: string;
                        approvals?: number;
                        required?: number;
                        satisfied?: boolean;
                    };
                };
            };
            /** @description Malformed request body. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Caller is not a console admin (opaque, matches every other Phase 16 admin route). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
