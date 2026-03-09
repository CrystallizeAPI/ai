import { describe, it, expect } from "vitest";
import { createTenantMatcher } from "../../../src/core/services/tenant-matcher";
import { testTenants } from "../../utils/fixtures";

describe("tenantMatcher", () => {
    const matcher = createTenantMatcher();

    it("matches by id", () => {
        const result = matcher(testTenants, { id: "t2" });
        expect(result).toEqual(testTenants[1]);
    });

    it("matches by identifier", () => {
        const result = matcher(testTenants, { identifier: "docs" });
        expect(result).toEqual(testTenants[2]);
    });

    it("id takes precedence over identifier", () => {
        const result = matcher(testTenants, { id: "t1", identifier: "blog" });
        expect(result).toEqual(testTenants[0]);
    });

    it("throws when neither id nor identifier provided", () => {
        expect(() => matcher(testTenants, {})).toThrow("Either id or identifier must be provided");
    });

    it("throws when tenant not found by id", () => {
        expect(() => matcher(testTenants, { id: "nonexistent" })).toThrow("Tenant not found");
    });

    it("throws when tenant not found by identifier", () => {
        expect(() => matcher(testTenants, { identifier: "nonexistent" })).toThrow("Tenant not found");
    });
});
