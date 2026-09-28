import { OperationsSchema } from "@crystallize/schema/mass-operation";

export type MassOperationValidationError = {
    path: string;
    message: string;
    code: string;
};

export type MassOperationValidationResult =
    | { ok: true; data: ReturnType<typeof OperationsSchema.parse> }
    | { ok: false; errorCount: number; errors: MassOperationValidationError[] };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// Zod objects STRIP keys they don't know instead of complaining, so a misnamed field
// (`discount` for a modifier, `skus` for `sku`) parses clean, runs "successfully" and
// does nothing. The parsed output is the schema's own answer to "which keys survived",
// so anything present in the input and absent from the output was dropped — and a key
// inside a `z.record` (meta, externalReferences, variant attributes) survives, which is
// exactly the free-form content that must stay permissive.
export const collectDroppedKeys = (
    input: unknown,
    output: unknown,
    path: (string | number)[],
    errors: MassOperationValidationError[],
): void => {
    if (Array.isArray(input) && Array.isArray(output)) {
        const paired = Math.min(input.length, output.length);
        for (let index = 0; index < paired; index++) {
            collectDroppedKeys(input[index], output[index], [...path, index], errors);
        }
        return;
    }

    if (!isPlainObject(input) || !isPlainObject(output)) return;

    for (const [key, value] of Object.entries(input)) {
        // An explicit `undefined` is the same as absent, and JSON can't carry it anyway.
        if (value === undefined) continue;

        const keyPath = [...path, key];
        if (!(key in output)) {
            errors.push({
                path: keyPath.join("."),
                message: `Unrecognized key "${key}": it is not part of this operation's schema and would be ignored.`,
                code: "unrecognized_keys",
            });
            continue;
        }

        collectDroppedKeys(value, output[key], keyPath, errors);
    }
};

// Shared by build-mass-operation (pre-flight) and run-mass-operation (one-shot)
// so an invalid operations file produces the SAME structured feedback in both,
// rather than a clean structure in one tool and a raw ZodError blob in the other.
export const validateMassOperations = (operations: unknown, version?: string): MassOperationValidationResult => {
    const input = {
        version: version ?? "1.0.0",
        operations,
    };
    const result = OperationsSchema.safeParse(input);

    if (result.success) {
        const dropped: MassOperationValidationError[] = [];
        collectDroppedKeys(input, result.data, [], dropped);

        if (dropped.length > 0) {
            return { ok: false, errorCount: dropped.length, errors: dropped };
        }

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
