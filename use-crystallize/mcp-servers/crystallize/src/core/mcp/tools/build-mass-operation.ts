import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { OperationSchema, OperationsSchema } from "@crystallize/schema/mass-operation";

const validIntents: string[] = [];
for (const option of OperationSchema.options) {
    const shape = (option as z.ZodObject<Record<string, z.ZodType>>).shape;
    if (shape.intent) {
        // biome-ignore: accessing internal Zod v4 def for intent literal/enum values
        const def = shape.intent._zod.def as any;
        if (def.value) validIntents.push(def.value);
        else if (def.values) validIntents.push(...def.values);
    }
}

export const createBuildMassOperationToolWrapper = () => {
    return defineToolWrapper({
        description:
            "Build and validate a Crystallize mass operation file. " +
            "Validates operations against the official schema and returns either a valid JSON file or detailed error feedback. " +
            `Valid intents: ${validIntents.join(", ")}. ` +
            "Use fetch-content-model to understand the tenant's shapes before building operations.",
        inputSchema: z.object({
            operations: z
                .array(z.record(z.string(), z.unknown()))
                .describe(
                    "Array of operation objects. Each must have an 'intent' field matching one of the valid intents.",
                ),
            version: z.string().optional().describe("Mass operation file version. Defaults to '1.0.0'."),
        }),
        annotions: {
            readOnlyHint: true,
        },
        handler: async ({ operations, version }) => {
            const result = OperationsSchema.safeParse({
                version: version ?? "1.0.0",
                operations,
            });

            if (result.success) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(result.data, null, 2),
                        },
                    ],
                };
            }

            const errors = result.error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
                code: issue.code,
            }));

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                valid: false,
                                errorCount: errors.length,
                                errors,
                            },
                            null,
                            2,
                        ),
                    },
                ],
            };
        },
    });
};
