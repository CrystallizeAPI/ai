import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";
import { createSkillsToolWrapper } from "../../../../src/core/mcp/tools/skills";
import type { SkillEntry } from "../../../../src/contracts/skills";
import type { SkillReferenceSelector } from "../../../../src/contracts/skill-reference-selector";
import { testAuthContext } from "../../../utils/fixtures";

const catalog: SkillEntry[] = [
    {
        slug: "payments",
        name: "Payments",
        description: "Payment providers",
        content: "PAYMENTS MAIN DOC",
        references: [
            { slug: "klarna", content: "# Klarna\n\nKLARNA BODY" },
            { slug: "stripe", content: "# Stripe\n\nSTRIPE BODY" },
            { slug: "vipps", content: "# Vipps\n\nVIPPS BODY" },
        ],
    },
    { slug: "query", name: "Query", description: "Reading data", content: "QUERY MAIN DOC", references: [] },
];

describe("skills tool", () => {
    let select: ReturnType<typeof mock>;
    let tool: ReturnType<typeof createSkillsToolWrapper>;

    type Input = { skills: string[]; references?: string[]; includeAllReferences?: boolean; task?: string };
    const call = (input: Input) => tool.handler({ ...input, authContext: testAuthContext });
    const run = async (input: Input) => (await call(input)).content[0].text;
    const eventPaths = async (input: Input) => ((await call(input)).events ?? []).map((e) => e.path);

    beforeEach(() => {
        select = mock(async () => ({ picked: [], qualified: 0 }));
        tool = createSkillsToolWrapper({
            skillsCatalog: catalog,
            skillReferenceSelector: { select } as unknown as SkillReferenceSelector,
        });
    });

    it("lists the catalog's skills and references in its description", () => {
        expect(tool.description).toContain("payments, query");
        expect(tool.description).toContain("klarna, stripe, vipps");
    });

    it("without a task, returns the main document and lists the references", async () => {
        const text = await run({ skills: ["payments"] });
        expect(text).toContain("PAYMENTS MAIN DOC");
        expect(text).not.toContain("KLARNA BODY");
        expect(text).toContain("Available references for payments: klarna, stripe, vipps");
        expect(select).not.toHaveBeenCalled();
    });

    it("with a task, includes the references the selector picks and lists the others", async () => {
        select.mockImplementation(async () => ({
            picked: [{ skill: "payments", slug: "klarna", probability: 0.96 }],
            qualified: 1,
        }));
        const text = await run({ skills: ["payments", "query"], task: "add Klarna to my checkout" });

        expect(select.mock.calls[0][0].map((c: { slug: string }) => c.slug)).toEqual(["klarna", "stripe", "vipps"]);
        expect(select.mock.calls[0][1]).toBe("add Klarna to my checkout");
        expect(text).toContain("References picked for your task: klarna (96%)");
        expect(text).toContain("KLARNA BODY");
        expect(text).not.toContain("STRIPE BODY");
        expect(text).toContain("Other references for payments: stripe, vipps");
        expect(text).toContain("QUERY MAIN DOC");
    });

    it("prefers explicit references over a task", async () => {
        const text = await run({ skills: ["payments"], references: ["stripe"], task: "add Klarna" });
        expect(text).toContain("STRIPE BODY");
        expect(text).not.toContain("KLARNA BODY");
        expect(select).not.toHaveBeenCalled();
    });

    it("prefers includeAllReferences over a task", async () => {
        const text = await run({ skills: ["payments"], includeAllReferences: true, task: "add Klarna" });
        expect(text).toContain("KLARNA BODY");
        expect(text).toContain("VIPPS BODY");
        expect(select).not.toHaveBeenCalled();
    });

    it("ignores a blank task", async () => {
        const text = await run({ skills: ["payments"], task: "   " });
        expect(text).toContain("Available references for payments");
        expect(select).not.toHaveBeenCalled();
    });

    it("falls back to listing the references when the selector throws", async () => {
        select.mockImplementation(async () => {
            throw new Error("Workers AI is down");
        });
        const text = await run({ skills: ["payments"], task: "add Klarna" });
        expect(text).toContain("PAYMENTS MAIN DOC");
        expect(text).toContain("Available references for payments: klarna, stripe, vipps");
    });

    describe("selection telemetry", () => {
        it("reports picked, capped, none and failed", async () => {
            select.mockImplementation(async () => ({
                picked: [{ skill: "payments", slug: "klarna", probability: 0.9 }],
                qualified: 1,
            }));
            expect(await eventPaths({ skills: ["payments"], task: "add Klarna" })).toEqual(["/jev/skills/picked-1"]);

            select.mockImplementation(async () => ({
                picked: [{ skill: "payments", slug: "klarna", probability: 0.9 }],
                qualified: 4,
            }));
            expect(await eventPaths({ skills: ["payments"], task: "every provider" })).toEqual(["/jev/skills/capped"]);

            select.mockImplementation(async () => ({ picked: [], qualified: 0 }));
            expect(await eventPaths({ skills: ["payments"], task: "bake a cake" })).toEqual(["/jev/skills/none"]);

            select.mockImplementation(async () => {
                throw new Error("down");
            });
            expect(await eventPaths({ skills: ["payments"], task: "add Klarna" })).toEqual(["/jev/skills/failed"]);
        });

        it("sends nothing when Jev was not asked", async () => {
            expect(await eventPaths({ skills: ["payments"] })).toEqual([]);
            expect(await eventPaths({ skills: ["payments"], references: ["stripe"], task: "x" })).toEqual([]);
            expect(await eventPaths({ skills: ["nope"], task: "add Klarna" })).toEqual([]);
        });

        it("logs the picks and scores as one JSON line, without the task text", async () => {
            const log = spyOn(console, "log").mockImplementation(() => {});
            select.mockImplementation(async () => ({
                picked: [{ skill: "payments", slug: "klarna", probability: 0.96 }],
                qualified: 1,
            }));
            await run({ skills: ["payments"], task: "secret launch plan" });
            const line = JSON.parse(log.mock.calls.at(-1)![0] as string);
            log.mockRestore();

            expect(line).toMatchObject({
                event: "jev_selection",
                tool: "skills",
                outcome: "picked-1",
                candidates: 3,
                qualified: 1,
                picked: [{ name: "payments/klarna", probability: 0.96 }],
            });
            expect(JSON.stringify(line)).not.toContain("secret");
        });
    });

    it("still reports an unknown skill", async () => {
        const text = await run({ skills: ["nope"], task: "add Klarna" });
        expect(text).toContain('Skill "nope" not found');
        expect(select).not.toHaveBeenCalled();
    });
});
