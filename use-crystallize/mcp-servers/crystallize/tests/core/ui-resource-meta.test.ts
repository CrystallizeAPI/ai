import { describe, it, expect } from "bun:test";
import { withEnvironmentResourceDomains } from "../../src/core/ui-resource-meta";

describe("withEnvironmentResourceDomains", () => {
    const meta = { csp: { resourceDomains: ["https://media.crystallize.com", "https://*.crystallize.com"] } };

    it("leaves the meta untouched on production", () => {
        expect(withEnvironmentResourceDomains(meta, ".crystallize.com")).toEqual(meta);
    });

    it("adds the dev environment's parent-domain wildcard", () => {
        expect(withEnvironmentResourceDomains(meta, "-dev.example.test")).toEqual({
            csp: {
                resourceDomains: [
                    "https://media.crystallize.com",
                    "https://*.crystallize.com",
                    "https://*.example.test",
                ],
            },
        });
    });

    it("wildcards the whole suffix when it is a domain rather than a host prefix", () => {
        expect(withEnvironmentResourceDomains(meta, ".example.test")?.csp?.resourceDomains).toContain(
            "https://*.example.test",
        );
    });

    it("passes an absent meta through", () => {
        expect(withEnvironmentResourceDomains(undefined, "-dev.example.test")).toBeUndefined();
    });

    it("does not mutate the tool's static meta", () => {
        withEnvironmentResourceDomains(meta, "-dev.example.test");
        expect(meta.csp.resourceDomains).toHaveLength(2);
    });
});
