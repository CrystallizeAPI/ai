import type { JevClient, JevRequest, JevResponse } from "../../contracts/jev";

export const JEV_MODEL = "typesafe/jev";

// The generated `Ai` types predate typesafe/jev, so the binding is narrowed to the one call we make.
export type JevBinding = {
    run(model: typeof JEV_MODEL, input: JevRequest): Promise<unknown>;
};

export const createJevClient =
    ({ ai }: { ai: JevBinding }): JevClient =>
    async (request) => {
        const response = (await ai.run(JEV_MODEL, request)) as Partial<JevResponse> | null;
        if (!response || typeof response !== "object" || !response.answers) {
            throw new Error("Jev returned no answers");
        }
        return response as JevResponse;
    };
