import type { AuthContext } from "../../src/contracts/app-context";
import { buildSchema, introspectionFromSchema } from "graphql";
import type { IntrospectionQuery } from "graphql";

export const testTenants: AuthContext["tenants"] = [
    { id: "t1", identifier: "shop", name: "Shop Tenant", staticAuthToken: "token-1" },
    { id: "t2", identifier: "blog", name: "Blog Tenant" },
    { id: "t3", identifier: "docs", name: "Docs Tenant", staticAuthToken: "token-3" },
];

export const testAuthContext: AuthContext = {
    accessTokenId: "test-id",
    accessTokenSecret: "test-secret",
    tenants: testTenants,
};

/**
 * Build an IntrospectionResult from a SDL string, suitable for feeding into
 * the graphql-query-corrector or compact-schema-builder.
 */
export function buildIntrospectionFromSDL(sdl: string) {
    const schema = buildSchema(sdl);
    const introspection = introspectionFromSchema(schema);
    return { data: introspection as unknown as IntrospectionQuery & { __schema: unknown } };
}
