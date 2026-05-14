import { Services } from "../core/container";

type Tenant = {
    id: string;
    identifier: string;
    name: string;
    staticAuthToken?: string;
};

type TokenAuthContext = {
    type: "token";
    accessTokenId: string;
    accessTokenSecret: string;
    tenants: Tenant[];
};

type SessionAuthContext = {
    type: "session";
    sessionId: string;
    tenants: Tenant[];
};

type BearerAuthContext = {
    type: "bearer";
    bearerToken: string;
    tenants: Tenant[];
};

export type AuthContext = TokenAuthContext | SessionAuthContext | BearerAuthContext;

export type AppContext = {
    Bindings: CloudflareBindings;
    Variables: {
        authContext: AuthContext;
        services: Services;
    };
};
