import { describe, it, expect } from "bun:test";
import {
    collectDroppedKeys,
    validateMassOperations,
    type MassOperationValidationError,
} from "../../src/core/mass-operation";

const priceList = (variant: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    intent: "pricelist/upsert",
    identifier: "contract-acme",
    name: "Contract Acme",
    modifierType: "PERCENTAGE",
    priceVariants: [{ identifier: "default", modifier: -15 }],
    selectedProductVariants: { type: "SOME_SKUS", variants: [variant] },
    targetAudience: { type: "SOME", customerIdentifiers: ["acme"] },
    ...extra,
});

const goodVariant = { sku: "FU-19746", priceVariants: [{ identifier: "default", modifier: -15 }] };

const errorsOf = (result: ReturnType<typeof validateMassOperations>): MassOperationValidationError[] => {
    if (result.ok) throw new Error("expected the operations to be rejected");
    return result.errors;
};

describe("validateMassOperations", () => {
    it("accepts a valid operation", () => {
        const result = validateMassOperations([priceList(goodVariant)]);
        expect(result.ok).toBe(true);
    });

    // The reason this check exists: Zod strips what it doesn't know, so this file
    // used to validate clean, run "successfully" and discount nothing.
    it("rejects a key the schema would silently drop, and points at it", () => {
        const errors = errorsOf(validateMassOperations([priceList({ ...goodVariant, discount: -15 })]));

        expect(errors).toHaveLength(1);
        expect(errors[0]?.path).toBe("operations.0.selectedProductVariants.variants.0.discount");
        expect(errors[0]?.code).toBe("unrecognized_keys");
        expect(errors[0]?.message).toContain('"discount"');
    });

    it("rejects an unknown key at the top level of an operation", () => {
        const errors = errorsOf(validateMassOperations([priceList(goodVariant, { wibble: true })]));

        expect(errors).toHaveLength(1);
        expect(errors[0]?.path).toBe("operations.0.wibble");
        expect(errors[0]?.code).toBe("unrecognized_keys");
    });

    it("reports every dropped key, not just the first", () => {
        const errors = errorsOf(
            validateMassOperations([priceList({ ...goodVariant, discount: -15 }, { alsoWrong: 1 })]),
        );

        expect(errors.map((error) => error.path).sort()).toEqual([
            "operations.0.alsoWrong",
            "operations.0.selectedProductVariants.variants.0.discount",
        ]);
    });

    // A misnamed *required* field was already caught, because the real one goes missing.
    // That path must keep reporting the Zod issue rather than a dropped-key one.
    it("still reports a misnamed required field as the schema does", () => {
        const errors = errorsOf(
            validateMassOperations([
                priceList({ skuu: "FU-19746", priceVariants: [{ identifier: "default", modifier: -15 }] }),
            ]),
        );

        expect(errors.some((error) => error.path.endsWith(".sku") && error.code === "invalid_type")).toBe(true);
    });

    it("keeps the same error shape as a schema failure", () => {
        const errors = errorsOf(validateMassOperations([priceList(goodVariant, { wibble: true })]));

        for (const error of errors) {
            expect(Object.keys(error).sort()).toEqual(["code", "message", "path"]);
        }
    });

    it("counts the errors it reports", () => {
        const result = validateMassOperations([priceList({ ...goodVariant, discount: -15 })]);
        if (result.ok) throw new Error("expected the operations to be rejected");
        expect(result.errorCount).toBe(result.errors.length);
    });

    // Some schemas in the package are already strict and raise Zod's own issue. Both
    // paths carry the code `unrecognized_keys`, so an agent has one thing to look for.
    it("uses the code the strict schemas already use", () => {
        const strictlyRejected = validateMassOperations([
            {
                intent: "order/register",
                customer: { identifier: "acme@example.com" },
                cart: [
                    {
                        name: "Olive oil",
                        sku: "FU-19746",
                        quantity: 1,
                        price: { currency: "EUR", gross: 11.7, net: 11.7 },
                        wibble: true,
                    },
                ],
                total: { currency: "EUR", gross: 11.7, net: 11.7 },
            },
        ]);

        expect(errorsOf(strictlyRejected).some((error) => error.code === "unrecognized_keys")).toBe(true);
    });
});

describe("collectDroppedKeys", () => {
    // Free-form regions (`z.record`: meta, externalReferences, variant attributes) keep
    // their keys through parsing, so they are permissive by construction — the check only
    // ever fires on a key the schema actually removed.
    it("ignores keys the schema kept, whatever they are called", () => {
        const errors: MassOperationValidationError[] = [];
        const freeForm = { meta: { shelf: "A3", "last-count": "2026-09-01" } };

        collectDroppedKeys(freeForm, structuredClone(freeForm), [], errors);

        expect(errors).toEqual([]);
    });

    it("does not descend where the schema replaced an object with something else", () => {
        const errors: MassOperationValidationError[] = [];

        collectDroppedKeys({ price: { amount: 10 } }, { price: 10 }, [], errors);

        expect(errors).toEqual([]);
    });

    it("compares only the array entries that both sides have", () => {
        const errors: MassOperationValidationError[] = [];

        collectDroppedKeys([{ a: 1, b: 2 }, { c: 3 }], [{ a: 1 }], [], errors);

        expect(errors.map((error) => error.path)).toEqual(["0.b"]);
    });

    it("treats an explicit undefined as absent", () => {
        const errors: MassOperationValidationError[] = [];

        collectDroppedKeys({ sku: undefined }, {}, [], errors);

        expect(errors).toEqual([]);
    });
});
