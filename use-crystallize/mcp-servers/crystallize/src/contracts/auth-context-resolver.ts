import type { AuthContext } from "./app-context";

export type AuthContextResolver = {
    getClientCredentials(authContext: AuthContext): {
        accessTokenId?: string;
        accessTokenSecret?: string;
        sessionId?: string;
        bearerToken?: string;
    };
    getAuthHeaders(authContext: AuthContext): Record<string, string>;
};
