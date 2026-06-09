import { createClient, JSApiClientCallError } from "@crystallize/js-api-client";
import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { MassOperationRunner } from "../../../contracts/mass-operation-runner";
import { AuthContextResolver } from "../../../contracts/auth-context-resolver";
import { tenantSchema, sanitizeErrorMessage } from "../../security";

type Deps = {
    tenantMatcher: TenantMatcher;
    massOperationRunner: MassOperationRunner;
    authContextResolver: AuthContextResolver;
};

export const createGetMassOperationStatusToolWrapper = ({
    tenantMatcher,
    massOperationRunner,
    authContextResolver,
}: Deps) => {
    return defineToolWrapper({
        description:
            "Read the status of a Crystallize mass operation bulk task by its taskId. " +
            "Use this to poll a task started with `run-mass-operation`. Read-only.",
        inputSchema: z.object({
            tenant: tenantSchema,
            taskId: z.string().min(1).describe("The bulk task id returned by run-mass-operation."),
        }),
        annotations: {
            readOnlyHint: true,
        },
        handler: async ({ tenant, taskId, authContext }) => {
            const matchedTenant = tenantMatcher(authContext.tenants, { identifier: tenant });
            const client = createClient({
                tenantIdentifier: matchedTenant.identifier,
                tenantId: matchedTenant.id,
                ...authContextResolver.getClientCredentials(authContext),
            });

            try {
                const status = await massOperationRunner.status(client, taskId);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ id: status.id, status: status.status }, null, 2),
                        },
                    ],
                };
            } catch (error) {
                let text = `Failed to read mass operation status:\n${sanitizeErrorMessage(error)}`;
                if (error instanceof JSApiClientCallError && error.errors) {
                    text += `\n\nDetails:\n${JSON.stringify(error.errors, null, 2)}`;
                }
                return { content: [{ type: "text", text }] };
            }
        },
    });
};
