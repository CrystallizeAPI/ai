import { OperationsSchema } from "@crystallize/schema/mass-operation";

export type MassOperationValidationError = {
    path: string;
    message: string;
    code: string;
};

export type MassOperationValidationResult =
    | { ok: true; data: ReturnType<typeof OperationsSchema.parse> }
    | { ok: false; errorCount: number; errors: MassOperationValidationError[] };

// Shared by build-mass-operation (pre-flight) and run-mass-operation (one-shot)
// so an invalid operations file produces the SAME structured feedback in both,
// rather than a clean structure in one tool and a raw ZodError blob in the other.
export const validateMassOperations = (operations: unknown, version?: string): MassOperationValidationResult => {
    const result = OperationsSchema.safeParse({
        version: version ?? "1.0.0",
        operations,
    });

    if (result.success) {
        return { ok: true, data: result.data };
    }

    return {
        ok: false,
        errorCount: result.error.issues.length,
        errors: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
            code: issue.code,
        })),
    };
};
