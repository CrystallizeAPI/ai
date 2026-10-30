import { Services } from "../core/container";

type Tenant = {
    id: string;
    identifier: string;
    name: string;
    staticAuthToken?: string;
};

type AuthContextBase = {
    /**
     * js-api-client `origin` suffix of the environment this credential belongs to (`.crystallize.com` in
     * production). A credential is only valid on one environment, so it lives with the credential: every
     * `createClient` and every hand-built API URL must take it from here. See `src/core/api-origin.ts`.
     */
    origin: string;
    tenants: Tenant[];
};

type TokenAuthContext = AuthContextBase & {
    type: "token";
    accessTokenId: string;
    accessTokenSecret: string;
};

type SessionAuthContext = AuthContextBase & {
    type: "session";
    sessionId: string;
};

type BearerAuthContext = AuthContextBase & {
    type: "bearer";
    bearerToken: string;
};

export type AuthContext = TokenAuthContext | SessionAuthContext | BearerAuthContext;

export type AppContext = {
    // CRYSTALLIZE_DEV_API_ORIGIN is a *secret* (`wrangler secret put` / `.env` locally), so `bun cf-typegen` only
    // emits it when the local `.env` has it. Declared here so the type never depends on that.
    Bindings: CloudflareBindings & { CRYSTALLIZE_DEV_API_ORIGIN?: string };
    Variables: {
        authContext: AuthContext;
        services: Services;
    };
};
