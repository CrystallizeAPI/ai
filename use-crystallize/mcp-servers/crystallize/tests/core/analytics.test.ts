import { describe, it, expect } from "bun:test";
import {
    buildSessionEvent,
    buildToolCallEvent,
    MULTIPLE_TENANTS,
    resolveTenant,
    UNKNOWN_TENANT,
} from "../../src/core/analytics";
import { readExposeFlags } from "../../src/core/expose-flags";
import type { AuthContext } from "../../src/contracts/app-context";
import { testAuthContext, testTenants } from "../utils/fixtures";

const singleTenantAuth: AuthContext = {
    type: "bearer",
    bearerToken: "jwt",
    tenants: [testTenants[0]],
};

/** Bearer auth puts the raw X-Crystallize-Tenant-Identifier header here, unvalidated. */
const bearerWithIdentifier = (identifier: string): AuthContext => ({
    type: "bearer",
    bearerToken: "jwt",
    tenants: [{ id: "t", identifier, name: "n" }],
});

describe("resolveTenant", () => {
    it("prefers the tenant passed as tool input", () => {
        expect(resolveTenant({ tenant: "furniture" }, testAuthContext)).toBe("furniture");
    });

    it("falls back to the only tenant the credential can see", () => {
        expect(resolveTenant({}, singleTenantAuth)).toBe("shop");
    });

    it("does not guess when the credential spans several tenants", () => {
        expect(resolveTenant({}, testAuthContext)).toBe(MULTIPLE_TENANTS);
    });

    it("reports unknown when there are no tenants at all", () => {
        expect(resolveTenant({}, { ...testAuthContext, tenants: [] })).toBe(UNKNOWN_TENANT);
    });

    it("ignores a non-string or empty tenant input", () => {
        expect(resolveTenant({ tenant: 42 }, singleTenantAuth)).toBe("shop");
        expect(resolveTenant({ tenant: "" }, singleTenantAuth)).toBe("shop");
    });

    // The sentinels are path segments now, so they must not need percent-encoding
    // and must not be able to collide with a real identifier.
    it("uses sentinels that tenantSchema can never produce", () => {
        for (const sentinel of [UNKNOWN_TENANT, MULTIPLE_TENANTS]) {
            expect(sentinel).toMatch(/^_[a-z]+$/);
            expect(encodeURIComponent(sentinel)).toBe(sentinel);
        }
    });

    it("caps an oversized auth-derived tenant", () => {
        expect(resolveTenant({}, bearerWithIdentifier("a".repeat(4000))).length).toBe(128);
    });

    // A slash would add a path segment and break every wildcard goal's shape.
    it("strips characters that would break the path shape", () => {
        expect(resolveTenant({}, bearerWithIdentifier("Sh op/../evil"))).toBe("shopevil");
        expect(resolveTenant({}, bearerWithIdentifier("a/b"))).toBe("ab");
    });

    it("falls back to the unknown sentinel when a tenant slugs away to nothing", () => {
        expect(resolveTenant({}, bearerWithIdentifier("!!!"))).toBe(UNKNOWN_TENANT);
    });

    it("leaves a legitimate identifier untouched at the schema's maximum length", () => {
        const maxLength = "a".repeat(128);
        expect(resolveTenant({ tenant: maxLength }, singleTenantAuth)).toBe(maxLength);
    });
});

describe("buildToolCallEvent", () => {
    it("puts the tenant then the tool in the path", () => {
        const event = buildToolCallEvent("query-core", { tenant: "furniture" }, testAuthContext);
        expect(event.name).toBe("pageview");
        expect(event.path).toBe("/t/furniture/query-core");
    });

    it("sends no properties — they are Business-gated and invisible on Growth", () => {
        expect(buildToolCallEvent("query-core", { tenant: "furniture" }, testAuthContext).props).toBeUndefined();
    });

    it("uses a sentinel segment when the tenant is ambiguous", () => {
        expect(buildToolCallEvent("skills", {}, testAuthContext).path).toBe("/t/_multiple/skills");
    });

    it("always produces exactly three path segments so the wildcard goals match", () => {
        const paths = [
            buildToolCallEvent("query-core", { tenant: "furniture" }, testAuthContext).path,
            buildToolCallEvent("skills", {}, testAuthContext).path,
            buildToolCallEvent("mutate-core", {}, bearerWithIdentifier("a/b/c")).path,
        ];
        for (const path of paths) {
            expect(path.split("/")).toHaveLength(4); // leading "" + t + tenant + tool
        }
    });

    // Mirrors how Plausible compiles a pageview goal: escape, "*" -> ".*", anchor.
    const goalMatches = (goalPath: string, path: string) =>
        new RegExp(`^${goalPath.replace(/[.+?^${}()[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(path);

    it("matches the per-tool wildcard goal across different tenants", () => {
        expect(goalMatches("/t/*/query-core", "/t/furniture/query-core")).toBe(true);
        expect(goalMatches("/t/*/query-core", "/t/acme-shop/query-core")).toBe(true);
        expect(goalMatches("/t/*/query-core", "/t/_multiple/query-core")).toBe(true);
    });

    it("does not let a tool goal bleed into a longer tool name", () => {
        expect(goalMatches("/t/*/mutate-core", "/t/furniture/mutate-shop-cart")).toBe(false);
        expect(goalMatches("/t/*/query-core", "/t/furniture/fetch-core-graphql-schema")).toBe(false);
    });

    it("matches the total-tool-calls goal but not the session paths", () => {
        expect(goalMatches("/t/*", "/t/furniture/query-core")).toBe(true);
        expect(goalMatches("/t/*", "/mcp/session/furniture/write-on/ui-on/skills-on")).toBe(false);
    });
});

describe("buildSessionEvent", () => {
    const flagsFrom = (queryString: string) => {
        const params = new URLSearchParams(queryString);
        return readExposeFlags((key) => params.get(key) ?? undefined);
    };

    it("encodes the tenant and the default configuration", () => {
        const event = buildSessionEvent(flagsFrom(""), singleTenantAuth);
        expect(event.name).toBe("pageview");
        expect(event.path).toBe("/mcp/session/shop/write-off/ui-on/skills-on");
    });

    // The common case for the landing page's access-token install: the credential
    // legitimately spans several tenants and the client has not named one yet.
    it("falls back to the multiple sentinel when the credential spans tenants", () => {
        expect(buildSessionEvent(flagsFrom(""), testAuthContext).path).toBe(
            "/mcp/session/_multiple/write-off/ui-on/skills-on",
        );
    });

    it("reflects every opted-in and opted-out flag", () => {
        expect(buildSessionEvent(flagsFrom("exposeWrite=true"), singleTenantAuth).path).toBe(
            "/mcp/session/shop/write-on/ui-on/skills-on",
        );
        expect(buildSessionEvent(flagsFrom("exposeUi=false&exposeSkills=false"), singleTenantAuth).path).toBe(
            "/mcp/session/shop/write-off/ui-off/skills-off",
        );
    });

    it("slugs the tenant segment so the path shape cannot break", () => {
        expect(buildSessionEvent(flagsFrom(""), bearerWithIdentifier("a/b")).path).toBe(
            "/mcp/session/ab/write-off/ui-on/skills-on",
        );
    });

    it("produces exactly eight configuration paths per tenant", () => {
        const combinations = [false, true].flatMap((write) =>
            [false, true].flatMap((ui) =>
                [false, true].map((skills) => buildSessionEvent({ write, ui, skills }, singleTenantAuth).path),
            ),
        );
        expect(new Set(combinations).size).toBe(8);
        for (const path of combinations) {
            expect(path).toMatch(/^\/mcp\/session\/shop\/write-(on|off)\/ui-(on|off)\/skills-(on|off)$/);
        }
    });

    const goalMatches = (goalPath: string, path: string) =>
        new RegExp(`^${goalPath.replace(/[.+?^${}()[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(path);

    const allCombinations = (auth: AuthContext = singleTenantAuth) =>
        [false, true].flatMap((write) =>
            [false, true].flatMap((ui) =>
                [false, true].map((skills) => ({
                    write,
                    ui,
                    skills,
                    path: buildSessionEvent({ write, ui, skills }, auth).path,
                })),
            ),
        );

    it("has each config goal match exactly the four sessions it should", () => {
        const all = allCombinations();
        const matching = (goal: string, predicate: (c: (typeof all)[number]) => boolean) => {
            const matched = all.filter((c) => goalMatches(goal, c.path));
            expect(matched).toHaveLength(4);
            expect(matched.every(predicate)).toBe(true);
        };
        matching("/mcp/session/*/write-on/*", (c) => c.write);
        matching("/mcp/session/*/*/ui-off/*", (c) => !c.ui);
        matching("/mcp/session/*/*/*/skills-off", (c) => !c.skills);
    });

    it("has the sessions-started goal match every configuration", () => {
        expect(allCombinations().filter((c) => goalMatches("/mcp/session/*", c.path))).toHaveLength(8);
    });

    // Tenant identifiers are [a-z0-9-], so one could legitimately be called
    // "write-on". The flag tokens are slash-delimited, which is what stops it
    // from satisfying a config goal it has nothing to do with.
    it("does not let a tenant named after a flag token satisfy that flag's goal", () => {
        const confusing = allCombinations(bearerWithIdentifier("write-on"));
        expect(confusing.filter((c) => goalMatches("/mcp/session/*/write-on/*", c.path)).every((c) => c.write)).toBe(
            true,
        );
        expect(confusing.filter((c) => goalMatches("/mcp/session/*/write-on/*", c.path))).toHaveLength(4);
    });

    it("keeps tool goals and session paths in separate namespaces", () => {
        const session = buildSessionEvent({ write: true, ui: true, skills: true }, singleTenantAuth).path;
        expect(goalMatches("/t/*", session)).toBe(false);
        expect(goalMatches("/t/*/skills", session)).toBe(false);
        expect(goalMatches("/mcp/session/*", buildToolCallEvent("skills", {}, singleTenantAuth).path)).toBe(false);
    });
});

describe("readExposeFlags", () => {
    const flagsFrom = (queryString: string) => {
        const params = new URLSearchParams(queryString);
        return readExposeFlags((key) => params.get(key) ?? undefined);
    };

    it("defaults to read-only with UI and skills on", () => {
        expect(flagsFrom("")).toEqual({ write: false, ui: true, skills: true });
    });

    it("only enables write on the exact opt-in value", () => {
        expect(flagsFrom("exposeWrite=true").write).toBe(true);
        expect(flagsFrom("exposeWrite=1").write).toBe(false);
        expect(flagsFrom("exposeWrite=TRUE").write).toBe(false);
    });

    it("only disables ui and skills on the exact opt-out value", () => {
        expect(flagsFrom("exposeUi=false&exposeSkills=false")).toMatchObject({ ui: false, skills: false });
        expect(flagsFrom("exposeUi=0&exposeSkills=no")).toMatchObject({ ui: true, skills: true });
    });
});
