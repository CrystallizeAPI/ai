import type { JevClient, JevRequest } from "../../contracts/jev";
import type {
    ReferenceCandidate,
    SelectedReference,
    SkillReferenceSelector,
} from "../../contracts/skill-reference-selector";

/**
 * A missed reference costs the agent another call; an extra one costs a whole document (~15k chars) of context.
 * Tuned with bin/eval-reference-selection.ts: 0.5 kept 12/12 tasks at full recall with 1.75 references returned on
 * average (0.7 dropped to 9/12). The cap bounds the worst case.
 */
export const REFERENCE_THRESHOLD = 0.5;
export const MAX_REFERENCES = 3;

const INTRO_MAX_CHARS = 400;

export type ReferenceSummary = {
    title: string;
    intro: string;
    sections: string[];
};

/**
 * What Jev sees of a reference instead of its full text: every reference opens with a `#` title and an intro
 * paragraph, and its `##` headings list what it covers.
 */
export function describeReference(content: string): ReferenceSummary {
    const lines = content.split("\n");
    const title = lines.find((line) => line.startsWith("# "))?.slice(2).trim() ?? "";
    const sections = lines.filter((line) => line.startsWith("## ")).map((line) => line.slice(3).trim());

    const introLines: string[] = [];
    for (const raw of lines) {
        const line = raw.trim();
        const isProse = line !== "" && !/^(#|>|---|```|\||[-*] )/.test(line);
        if (isProse) introLines.push(line);
        else if (introLines.length > 0) break;
    }
    const intro = introLines.join(" ").slice(0, INTRO_MAX_CHARS).trim();

    return { title, intro, sections };
}

/**
 * One Noul per reference over a shared state, sent as a single request (Jev answers them in parallel).
 * Question ids are opaque to the model, so each instruction names its reference in full.
 */
export function buildReferenceRequest(
    candidates: ReferenceCandidate[],
    task: string,
): { request: JevRequest; referenceByQuestionId: Map<string, { skill: string; slug: string }> } {
    const referenceByQuestionId = new Map<string, { skill: string; slug: string }>();
    const questions: JevRequest["questions"] = {};
    candidates.forEach(({ skill, slug }, i) => {
        const id = `r${i}`;
        referenceByQuestionId.set(id, { skill, slug });
        questions[id] = {
            type: "noul",
            instructions:
                `Does carrying out \`task\` need the "${slug}" reference of the "${skill}" skill, ` +
                `as summarized in \`references\`?`,
            criteria: {
                true: `The "${slug}" reference covers something the task has to do or decide`,
                false: `The task can be done without the "${slug}" reference`,
            },
        };
    });
    const references = candidates.map(({ skill, slug, content }) => ({ skill, slug, ...describeReference(content) }));
    return { request: { state: { task, references }, questions }, referenceByQuestionId };
}

export async function scoreReferences(
    jevClient: JevClient,
    candidates: ReferenceCandidate[],
    task: string,
): Promise<SelectedReference[]> {
    const { request, referenceByQuestionId } = buildReferenceRequest(candidates, task);
    const response = await jevClient(request);
    const scored: SelectedReference[] = [];
    for (const [id, reference] of referenceByQuestionId) {
        const noul = response.answers[id]?.noul;
        if (typeof noul === "number" && Number.isFinite(noul)) scored.push({ ...reference, probability: noul });
    }
    // Zero usable answers means the response shape changed, not that nothing is relevant: fail loudly.
    if (scored.length === 0 && referenceByQuestionId.size > 0) {
        throw new Error("Jev returned no usable answers");
    }
    return scored;
}

export function pickReferences(
    scored: SelectedReference[],
    threshold = REFERENCE_THRESHOLD,
    max = MAX_REFERENCES,
): SelectedReference[] {
    return scored
        .filter((r) => r.probability >= threshold)
        .sort((a, b) => b.probability - a.probability)
        .slice(0, max);
}

export const createSkillReferenceSelector = ({ jevClient }: { jevClient: JevClient }): SkillReferenceSelector => ({
    async select(candidates, task) {
        if (!task.trim() || candidates.length === 0) return [];
        return pickReferences(await scoreReferences(jevClient, candidates, task));
    },
});
