import { Services } from "../core/container";

export type AuthContext = {
    accessTokenId: string;
    accessTokenSecret: string;
    tenants: Array<{
        id: string;
        identifier: string;
        name: string;
        staticAuthToken?: string;
    }>;
};
export type AppContext = {
    Bindings: CloudflareBindings;
    Variables: {
        authContext: AuthContext;
        services: Services;
    };
};
