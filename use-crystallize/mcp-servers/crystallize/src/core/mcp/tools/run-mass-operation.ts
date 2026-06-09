import { createClient, JSApiClientCallError } from "@crystallize/js-api-client";
import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { MassOperationRunner } from "../../../contracts/mass-operation-runner";
import { AuthContextResolver } from "../../../contracts/auth-context-resolver";
import { tenantSchema, sanitizeErrorMessage } from "../../security";
import { validateMassOperations } from "../../mass-operation";

type Deps = {
    tenantMatcher: TenantMatcher;
    massOperationRunner: MassOperationRunner;
    authContextResolver: AuthContextResolver;
};

export const createRunMassOperationToolWrapper = ({
    tenantMatcher,
    massOperationRunner,
    authContextResolver,
}: Deps) => {
    return defineToolWrapper({
        write: true,
        description:
            "Run a Crystallize mass operation against the tenant. This WRITES — it validates the operations, " +
            "uploads them, creates a bulk task, and starts it in one shot. " +
            "Use `build-mass-operation` first to validate your operations, and `fetch-content-model` to understand " +
            "the tenant's shapes. The task runs asynchronously: this returns a taskId and initial status — " +
            "poll `get-mass-operation-status` to follow its progress.",
        inputSchema: z.object({
            tenant: tenantSchema,
            operations: z
                .array(z.record(z.string(), z.unknown()))
                .describe("Array of operation objects. Each must have an 'intent' field matching a valid intent."),
            version: z.string().optional().describe("Mass operation file version. Defaults to '1.0.0'."),
        }),
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
        },
        handler: async ({ tenant, operations, version, authContext }) => {
            // Validate up-front with the same structured feedback as
            // build-mass-operation, and fail fast before we build a client or
            // touch the tenant. The runner re-validates as a defensive backstop.
            const validation = validateMassOperations(operations, version);
            if (!validation.ok) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(
                                { valid: false, errorCount: validation.errorCount, errors: validation.errors },
                                null,
                                2,
                            ),
                        },
                    ],
                };
            }

            const matchedTenant = tenantMatcher(authContext.tenants, { identifier: tenant });
            const client = createClient({
                tenantIdentifier: matchedTenant.identifier,
                tenantId: matchedTenant.id,
                ...authContextResolver.getClientCredentials(authContext),
            });

            try {
                const task = await massOperationRunner.start(client, validation.data);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(
                                {
                                    taskId: task.id,
                                    status: task.status,
                                    message: `Mass operation task ${task.id} started (${task.status}). Poll get-mass-operation-status with this taskId.`,
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                };
            } catch (error) {
                let text = `Mass operation failed to start:\n${sanitizeErrorMessage(error)}`;
                if (error instanceof JSApiClientCallError && error.errors) {
                    text += `\n\nDetails:\n${JSON.stringify(error.errors, null, 2)}`;
                }
                return { content: [{ type: "text", text }] };
            }
        },
    });
};
