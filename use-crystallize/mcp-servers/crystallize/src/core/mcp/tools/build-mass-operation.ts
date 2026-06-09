import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { OperationSchema } from "@crystallize/schema/mass-operation";
import { validateMassOperations } from "../../mass-operation";

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
        annotations: {
            readOnlyHint: true,
        },
        handler: async ({ operations, version }) => {
            const result = validateMassOperations(operations, version);

            if (result.ok) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(result.data, null, 2),
                        },
                    ],
                };
            }

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                valid: false,
                                errorCount: result.errorCount,
                                errors: result.errors,
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
