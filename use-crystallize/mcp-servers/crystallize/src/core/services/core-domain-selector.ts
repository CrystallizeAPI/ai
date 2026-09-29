import type { CoreDomainSelector, SelectedDomain } from "../../contracts/core-domain-selector";
import type { DomainIndex } from "../../contracts/core-schema-domain-splitter";
import type { JevClient, JevRequest } from "../../contracts/jev";

/**
 * Missing a needed domain costs the agent another round-trip; an extra domain only costs output size.
 * So the threshold leans low and the cap bounds the output.
 */
export const DOMAIN_THRESHOLD = 0.3;
export const MAX_DOMAINS = 4;

/**
 * One Noul per domain over a shared state, sent as a single request (Jev answers them in parallel).
 * Question ids are opaque to the model, so each instruction names its domain in full.
 */
export function buildDomainRequest(
    index: DomainIndex,
    intent: string,
): { request: JevRequest; domainByQuestionId: Map<string, string> } {
    const domainByQuestionId = new Map<string, string>();
    const questions: JevRequest["questions"] = {};
    index.domains.forEach((domain, i) => {
        const id = `d${i}`;
        domainByQuestionId.set(id, domain.name);
        questions[id] = {
            type: "noul",
            instructions:
                `Does accomplishing \`intent\` against the Crystallize Core API require at least one of the ` +
                `queries or mutations listed for the "${domain.name}" domain in \`domains\`?`,
            criteria: {
                true: `At least one "${domain.name}" query or mutation is needed to read or write what the intent is about`,
                false: `The intent can be accomplished without any "${domain.name}" query or mutation`,
            },
        };
    });
    return { request: { state: { intent, domains: index.domains }, questions }, domainByQuestionId };
}

export async function scoreDomains(
    jevClient: JevClient,
    index: DomainIndex,
    intent: string,
): Promise<SelectedDomain[]> {
    const { request, domainByQuestionId } = buildDomainRequest(index, intent);
    const response = await jevClient(request);
    const scored: SelectedDomain[] = [];
    for (const [id, name] of domainByQuestionId) {
        const noul = response.answers[id]?.noul;
        if (typeof noul === "number" && Number.isFinite(noul)) scored.push({ name, probability: noul });
    }
    // Zero usable answers means the response shape changed, not that nothing is relevant: fail loudly.
    if (scored.length === 0 && domainByQuestionId.size > 0) {
        throw new Error("Jev returned no usable answers");
    }
    return scored;
}

export function pickDomains(
    scored: SelectedDomain[],
    threshold = DOMAIN_THRESHOLD,
    max = MAX_DOMAINS,
): SelectedDomain[] {
    return scored
        .filter((d) => d.probability >= threshold)
        .sort((a, b) => b.probability - a.probability)
        .slice(0, max);
}

export const createCoreDomainSelector = ({ jevClient }: { jevClient: JevClient }): CoreDomainSelector => ({
    async select(index, intent) {
        if (!intent.trim()) return [];
        return pickDomains(await scoreDomains(jevClient, index, intent));
    },
});
