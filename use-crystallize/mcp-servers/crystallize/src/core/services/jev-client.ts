import type { JevClient, JevRequest, JevResponse } from "../../contracts/jev";

export const JEV_MODEL = "typesafe/jev";

// A slow Workers AI must not hold the tool call: failing fast lets the caller fall back.
export const JEV_TIMEOUT_MS = 8000;

// Jev runs through AI Gateway, which logs prompts and responses by default. The request carries the caller's
// intent/task text, so every call opts out of the gateway log (Jev itself is zero-data-retention at TypeSafe).
export const JEV_GATEWAY_OPTIONS = { gateway: { id: "default", collectLog: false } } as const;

// The generated `Ai` types predate typesafe/jev, so the binding is narrowed to the one call we make.
export type JevBinding = {
    run(model: typeof JEV_MODEL, input: JevRequest, options: typeof JEV_GATEWAY_OPTIONS): Promise<unknown>;
};

/**
 * Third-party models on Workers AI answer through AI Gateway as `{ state, result, gatewayMetadata }`
 * (verified live for typesafe/jev), while the model page documents the bare `{ model, answers }`. Accept both.
 */
function unwrapGatewayEnvelope(raw: unknown): Partial<JevResponse> | null {
    if (!raw || typeof raw !== "object" || !("state" in raw)) return raw as Partial<JevResponse> | null;
    const { state, result } = raw as { state: unknown; result?: unknown };
    if (state !== "Completed") throw new Error(`Jev request ended in state "${String(state)}"`);
    return result as Partial<JevResponse> | null;
}

export const createJevClient =
    ({ ai }: { ai: JevBinding }, timeoutMs = JEV_TIMEOUT_MS): JevClient =>
    async (request) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Jev timed out after ${timeoutMs}ms`)), timeoutMs);
        });
        try {
            const response = unwrapGatewayEnvelope(await Promise.race([ai.run(JEV_MODEL, request, JEV_GATEWAY_OPTIONS), timeout]));
            if (!response || typeof response !== "object" || !response.answers) {
                throw new Error("Jev returned no answers");
            }
            return response as JevResponse;
        } finally {
            clearTimeout(timer);
        }
    };
