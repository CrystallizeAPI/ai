import { describe, it, expect, mock } from "bun:test";
import {
    buildReferenceRequest,
    createSkillReferenceSelector,
    describeReference,
    pickReferences,
    scoreReferences,
} from "../../../src/core/services/skill-reference-selector";
import type { ReferenceCandidate } from "../../../src/contracts/skill-reference-selector";
import type { JevClient, JevResponse } from "../../../src/contracts/jev";

const KLARNA = `# Klarna

Klarna lets shoppers pay later or in instalments. This reference wires Klarna Payments into a Crystallize checkout.

More intro text that is not part of the summary.

## Create a payment session
## Handle the push notification
`;

const candidates: ReferenceCandidate[] = [
    { skill: "payments", slug: "klarna", content: KLARNA },
    { skill: "payments", slug: "stripe", content: "# Stripe\n\nCards and wallets with Stripe.\n\n## Payment intents\n" },
    { skill: "payments", slug: "vipps", content: "# Vipps MobilePay\n\nNordic mobile payments.\n" },
];

const answers = (nouls: Record<string, number>): JevResponse => ({
    model: "jev-1.13.0",
    answers: Object.fromEntries(Object.entries(nouls).map(([id, noul]) => [id, { type: "noul", noul }])),
});

describe("describeReference", () => {
    it("keeps the title, the intro paragraph and the section headings", () => {
        expect(describeReference(KLARNA)).toEqual({
            title: "Klarna",
            intro: "Klarna lets shoppers pay later or in instalments. This reference wires Klarna Payments into a Crystallize checkout.",
            sections: ["Create a payment session", "Handle the push notification"],
        });
    });

    it("skips blockquotes and rules before the intro, and caps its length", () => {
        const long = "word ".repeat(200);
        const summary = describeReference(`# Title\n\n> Based on something\n\n---\n\n${long}\n`);
        expect(summary.title).toBe("Title");
        expect(summary.intro.startsWith("word word")).toBe(true);
        expect(summary.intro.length).toBeLessThanOrEqual(400);
    });

    it("copes with a document without a title", () => {
        expect(describeReference("Just text.")).toEqual({ title: "", intro: "Just text.", sections: [] });
    });
});

describe("buildReferenceRequest", () => {
    it("puts the task and the reference summaries in state and asks one noul per reference", () => {
        const { request, referenceByQuestionId } = buildReferenceRequest(candidates, "add Klarna to my checkout");

        expect(request.state).toEqual({
            task: "add Klarna to my checkout",
            references: candidates.map((c) => ({ skill: c.skill, slug: c.slug, ...describeReference(c.content) })),
        });
        expect(Object.keys(request.questions)).toEqual(["r0", "r1", "r2"]);
        expect(referenceByQuestionId.get("r0")).toEqual({ skill: "payments", slug: "klarna" });
        expect(request.questions.r0.instructions).toContain('"klarna"');
        expect(request.questions.r0.criteria?.true).toContain("klarna");
    });
});

describe("pickReferences", () => {
    it("keeps references at or above the threshold, most likely first, capped", () => {
        const picked = pickReferences(
            [
                { skill: "s", slug: "a", probability: 0.2 },
                { skill: "s", slug: "b", probability: 0.9 },
                { skill: "s", slug: "c", probability: 0.5 },
                { skill: "s", slug: "d", probability: 0.7 },
            ],
            0.5,
            2,
        );
        expect(picked.map((r) => r.slug)).toEqual(["b", "d"]);
    });
});

describe("scoreReferences", () => {
    it("skips missing or non-numeric answers", async () => {
        const jevClient: JevClient = async () =>
            ({
                model: "jev-1.13.0",
                answers: { r0: { type: "noul", noul: 0.96 }, r1: { type: "noul", noul: Number.NaN } },
            }) as JevResponse;
        expect(await scoreReferences(jevClient, candidates, "add Klarna")).toEqual([
            { skill: "payments", slug: "klarna", probability: 0.96 },
        ]);
    });

    it("throws when no answer is usable, so a shape change is not mistaken for 'nothing relevant'", async () => {
        const jevClient: JevClient = async () => answers({});
        await expect(scoreReferences(jevClient, candidates, "add Klarna")).rejects.toThrow(
            "Jev returned no usable answers",
        );
    });
});

describe("createSkillReferenceSelector", () => {
    it("returns the picked references for a task", async () => {
        const jevClient: JevClient = async () => answers({ r0: 0.96, r1: 0.1, r2: 0.05 });
        const selector = createSkillReferenceSelector({ jevClient });

        expect(await selector.select(candidates, "add Klarna to my checkout")).toEqual({
            picked: [{ skill: "payments", slug: "klarna", probability: 0.96 }],
            qualified: 1,
        });
    });

    it("counts every reference that cleared the threshold, even beyond the cap", async () => {
        const four = [...candidates, { skill: "payments", slug: "adyen", content: "# Adyen\n\nAdyen." }];
        const jevClient: JevClient = async () => answers({ r0: 0.9, r1: 0.8, r2: 0.7, r3: 0.6 });
        const result = await createSkillReferenceSelector({ jevClient }).select(four, "every provider");

        expect(result.picked.map((r) => r.slug)).toEqual(["klarna", "stripe", "vipps"]);
        expect(result.qualified).toBe(4);
    });

    it("does not call Jev for a blank task or when there is nothing to choose from", async () => {
        const jevClient = mock(async () => answers({}));
        const selector = createSkillReferenceSelector({ jevClient });

        expect(await selector.select(candidates, "  ")).toEqual({ picked: [], qualified: 0 });
        expect(await selector.select([], "add Klarna")).toEqual({ picked: [], qualified: 0 });
        expect(jevClient).not.toHaveBeenCalled();
    });
});
