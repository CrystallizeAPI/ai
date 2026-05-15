import type { AuthContextResolver } from "../../contracts/auth-context-resolver";

export const createAuthContextResolver = (): AuthContextResolver => ({
    getClientCredentials(authContext) {
        if (authContext.type === "token") {
            return {
                accessTokenId: authContext.accessTokenId,
                accessTokenSecret: authContext.accessTokenSecret,
            };
        }
        if (authContext.type === "session") {
            return { sessionId: authContext.sessionId };
        }
        return { bearerToken: authContext.bearerToken };
    },
    getAuthHeaders(authContext): Record<string, string> {
        if (authContext.type === "token") {
            return {
                "X-Crystallize-Access-Token-Id": authContext.accessTokenId,
                "X-Crystallize-Access-Token-Secret": authContext.accessTokenSecret,
            };
        }
        if (authContext.type === "session") {
            return { Cookie: `connect.sid=${authContext.sessionId}` };
        }
        return { Authorization: `Bearer ${authContext.bearerToken}` };
    },
});
