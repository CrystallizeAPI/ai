import { describe, it, expect, mock } from "bun:test";
import {
    buildDomainRequest,
    createCoreDomainSelector,
    pickDomains,
    scoreDomains,
} from "../../../src/core/services/core-domain-selector";
import type { DomainIndex } from "../../../src/contracts/core-schema-domain-splitter";
import type { JevClient, JevResponse } from "../../../src/contracts/jev";

const index: DomainIndex = {
    domains: [
        { name: "customer", queries: ["customer", "customers"], mutations: ["createCustomer"] },
        { name: "order", queries: ["order", "orders"], mutations: ["createOrder"] },
        { name: "subscription", queries: ["subscription"], mutations: [] },
    ],
};

const answers = (nouls: Record<string, number>): JevResponse => ({
    model: "jev-1.13.0",
    answers: Object.fromEntries(Object.entries(nouls).map(([id, noul]) => [id, { type: "noul", noul }])),
});

describe("buildDomainRequest", () => {
    it("puts the intent and the domain index in state and asks one noul per domain", () => {
        const { request, domainByQuestionId } = buildDomainRequest(index, "create an order");

        expect(request.state).toEqual({ intent: "create an order", domains: index.domains });
        expect(Object.keys(request.questions)).toEqual(["d0", "d1", "d2"]);
        expect(domainByQuestionId.get("d1")).toBe("order");
        expect(request.questions.d1.type).toBe("noul");
        expect(request.questions.d1.instructions).toContain('"order"');
        expect(request.questions.d1.criteria?.true).toContain("order");
    });
});

describe("pickDomains", () => {
    it("keeps domains at or above the threshold, most likely first, capped", () => {
        const picked = pickDomains(
            [
                { name: "a", probability: 0.2 },
                { name: "b", probability: 0.9 },
                { name: "c", probability: 0.3 },
                { name: "d", probability: 0.6 },
            ],
            0.3,
            2,
        );
        expect(picked).toEqual([
            { name: "b", probability: 0.9 },
            { name: "d", probability: 0.6 },
        ]);
    });
});

describe("scoreDomains", () => {
    it("maps answers back to domain names and skips missing answers", async () => {
        const jevClient: JevClient = async () => answers({ d0: 0.4, d1: 0.95 });
        expect(await scoreDomains(jevClient, index, "create an order")).toEqual([
            { name: "customer", probability: 0.4 },
            { name: "order", probability: 0.95 },
        ]);
    });
});

describe("createCoreDomainSelector", () => {
    it("returns the picked domains for an intent", async () => {
        const jevClient: JevClient = async () => answers({ d0: 0.7, d1: 0.95, d2: 0.05 });
        const selector = createCoreDomainSelector({ jevClient });

        expect(await selector.select(index, "create an order for a customer")).toEqual([
            { name: "order", probability: 0.95 },
            { name: "customer", probability: 0.7 },
        ]);
    });

    it("does not call Jev for a blank intent", async () => {
        const jevClient = mock(async () => answers({}));
        const selector = createCoreDomainSelector({ jevClient });

        expect(await selector.select(index, "   ")).toEqual([]);
        expect(jevClient).not.toHaveBeenCalled();
    });
});
