import { describe, it, expect } from "bun:test";
import {
    apiBaseUrl,
    DEFAULT_ENVIRONMENT_VAR,
    ENVIRONMENT_HEADER,
    PRODUCTION_API_ORIGIN,
    resolveApiOrigin,
} from "../../src/core/api-origin";

describe("resolveApiOrigin", () => {
    const devOrigin = "-dev.example.test";

    it("defaults to production when no environment is named", () => {
        expect(resolveApiOrigin(undefined, devOrigin)).toEqual({ ok: true, origin: PRODUCTION_API_ORIGIN });
        expect(resolveApiOrigin("", devOrigin)).toEqual({ ok: true, origin: PRODUCTION_API_ORIGIN });
    });

    it("accepts production by name without any secret", () => {
        expect(resolveApiOrigin("production", undefined)).toEqual({ ok: true, origin: ".crystallize.com" });
    });

    it("resolves dev to the configured suffix", () => {
        expect(resolveApiOrigin("dev", devOrigin)).toEqual({ ok: true, origin: "-dev.example.test" });
    });

    it("ignores case and surrounding whitespace in the header value", () => {
        expect(resolveApiOrigin(" DEV ", devOrigin)).toEqual({ ok: true, origin: "-dev.example.test" });
        expect(resolveApiOrigin("Production", devOrigin)).toEqual({ ok: true, origin: ".crystallize.com" });
    });

    it("rejects dev with 400 when the server has no dev suffix configured", () => {
        const result = resolveApiOrigin("dev", undefined);
        expect(result).toMatchObject({ ok: false, status: 400 });
        if (!result.ok) expect(result.error).toContain("not configured");
    });

    it("rejects any other value with 400 and names the header and the choices", () => {
        const result = resolveApiOrigin("staging", devOrigin);
        expect(result).toMatchObject({ ok: false, status: 400 });
        if (!result.ok) {
            expect(result.error).toContain(ENVIRONMENT_HEADER);
            expect(result.error).toContain("dev");
        }
    });

    describe("with a server default (CRYSTALLIZE_DEFAULT_ENVIRONMENT)", () => {
        it("uses the default when no environment is named", () => {
            expect(resolveApiOrigin(undefined, devOrigin, "dev")).toEqual({ ok: true, origin: "-dev.example.test" });
            expect(resolveApiOrigin("  ", devOrigin, " DEV ")).toEqual({ ok: true, origin: "-dev.example.test" });
        });

        it("lets the header override the default", () => {
            expect(resolveApiOrigin("production", devOrigin, "dev")).toEqual({ ok: true, origin: ".crystallize.com" });
        });

        it("treats a blank default as production", () => {
            expect(resolveApiOrigin(undefined, devOrigin, "")).toEqual({ ok: true, origin: ".crystallize.com" });
        });

        it("resolves a production default without reading the dev secret", () => {
            // env.production sets the default explicitly; a broken dev secret must not matter there.
            expect(resolveApiOrigin(undefined, "not/a-suffix", "production")).toEqual({
                ok: true,
                origin: ".crystallize.com",
            });
        });

        it("blames the server with 500 when the default is not a known environment", () => {
            const result = resolveApiOrigin(undefined, devOrigin, "staging");
            expect(result).toMatchObject({ ok: false, status: 500 });
            if (!result.ok) expect(result.error).toContain(DEFAULT_ENVIRONMENT_VAR);
        });

        it("blames the server with 500 when the default is dev but no dev suffix is configured", () => {
            const result = resolveApiOrigin(undefined, undefined, "dev");
            expect(result).toMatchObject({ ok: false, status: 500 });
            if (!result.ok) expect(result.error).toContain("not configured");
        });
    });

    it("rejects a dev suffix that could change the URL path or host prefix with 500", () => {
        for (const bad of ["-dev.example.test/evil", "dev.example.test", "-Dev.Example.Test", "-dev.example.test?x"]) {
            const result = resolveApiOrigin("dev", bad);
            expect(result).toMatchObject({ ok: false, status: 500 });
            if (!result.ok) expect(result.error).toContain("CRYSTALLIZE_DEV_API_ORIGIN");
        }
    });
});

describe("apiBaseUrl", () => {
    it("builds the host from the prefix and the origin suffix", () => {
        expect(apiBaseUrl("api", ".crystallize.com")).toBe("https://api.crystallize.com");
        expect(apiBaseUrl("shop-api", ".crystallize.com")).toBe("https://shop-api.crystallize.com");
        expect(apiBaseUrl("api", "-dev.example.test")).toBe("https://api-dev.example.test");
    });
});
