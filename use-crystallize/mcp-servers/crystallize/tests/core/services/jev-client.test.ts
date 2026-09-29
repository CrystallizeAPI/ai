import { describe, it, expect, mock } from "bun:test";
import { createJevClient, JEV_MODEL, type JevBinding } from "../../../src/core/services/jev-client";
import type { JevRequest, JevResponse } from "../../../src/contracts/jev";

const request: JevRequest = {
    state: { intent: "list orders" },
    questions: { d0: { type: "noul", instructions: "Is the order domain needed?" } },
};

describe("createJevClient", () => {
    it("runs typesafe/jev with the request and returns the response", async () => {
        const response: JevResponse = { model: "jev-1.13.0", answers: { d0: { type: "noul", noul: 0.9 } } };
        const run = mock(async () => response);
        const client = createJevClient({ ai: { run } as JevBinding });

        expect(await client(request)).toEqual(response);
        expect(run).toHaveBeenCalledWith(JEV_MODEL, request);
    });

    it("gives up when Jev does not answer in time", async () => {
        const client = createJevClient({ ai: { run: () => new Promise(() => {}) } as JevBinding }, 20);
        await expect(client(request)).rejects.toThrow("Jev timed out after 20ms");
    });

    it("throws when the response has no answers", async () => {
        const client = createJevClient({ ai: { run: async () => ({}) } as JevBinding });
        await expect(client(request)).rejects.toThrow("Jev returned no answers");
    });
});
