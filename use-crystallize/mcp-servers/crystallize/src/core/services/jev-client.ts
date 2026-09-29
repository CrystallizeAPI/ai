import type { JevClient, JevRequest, JevResponse } from "../../contracts/jev";

export const JEV_MODEL = "typesafe/jev";

// A slow Workers AI must not hold the tool call: failing fast lets the caller fall back.
export const JEV_TIMEOUT_MS = 8000;

// The generated `Ai` types predate typesafe/jev, so the binding is narrowed to the one call we make.
export type JevBinding = {
    run(model: typeof JEV_MODEL, input: JevRequest): Promise<unknown>;
};

export const createJevClient =
    ({ ai }: { ai: JevBinding }, timeoutMs = JEV_TIMEOUT_MS): JevClient =>
    async (request) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Jev timed out after ${timeoutMs}ms`)), timeoutMs);
        });
        try {
            const response = (await Promise.race([ai.run(JEV_MODEL, request), timeout])) as Partial<JevResponse> | null;
            if (!response || typeof response !== "object" || !response.answers) {
                throw new Error("Jev returned no answers");
            }
            return response as JevResponse;
        } finally {
            clearTimeout(timer);
        }
    };
