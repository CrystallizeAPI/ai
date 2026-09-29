import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import type { SkillEntry } from "../../../contracts/skills";
import type { SelectedReference, SkillReferenceSelector } from "../../../contracts/skill-reference-selector";
import { sanitizeErrorMessage } from "../../security";
import { buildSelectionEvent, selectionOutcome } from "../../analytics";
import type { AnalyticsEvent } from "../../../contracts/analytics-tracker";

type Deps = {
    skillsCatalog: SkillEntry[];
    skillReferenceSelector: SkillReferenceSelector;
};

export const createSkillsToolWrapper = ({ skillsCatalog: skills, skillReferenceSelector }: Deps) => {
    const skillSlugs = skills.map((s) => s.slug);
    const allReferenceSlugs = [...new Set(skills.flatMap((s) => s.references.map((r) => r.slug)))];

    return defineToolWrapper({
        description:
            `IMPORTANT: Call this tool FIRST before using any other Crystallize tool. ` +
            `This provides essential documentation, patterns, query examples, and best practices for working with Crystallize APIs. ` +
            `Unless you already have Crystallize skills loaded in your local context, you MUST call this tool before fetching schemas or executing queries — ` +
            `skills contain the knowledge you need to use the APIs correctly and avoid common mistakes. ` +
            `Available skills: ${skillSlugs.join(", ")}. ` +
            `Each skill has a main document and optional reference documents. Call with a skill slug to get its content. ` +
            `Pass \`task\` (one sentence: what you are trying to do) and the server also includes the references ` +
            `that task needs. Or specify reference slugs yourself (or use includeAllReferences). ` +
            `Available reference slugs across skills: ${allReferenceSlugs.join(", ")}.`,
        inputSchema: z.object({
            skills: z
                .array(z.string())
                .describe(`One or more skill slugs to retrieve. Available: ${skillSlugs.join(", ")}`),
            references: z
                .array(z.string())
                .optional()
                .describe(
                    "Optional: specific reference slugs to include. If omitted, only the main skill document is returned " +
                        "(plus the references `task` needs, when given).",
                ),
            includeAllReferences: z
                .boolean()
                .optional()
                .describe("If true, include all references for the requested skills."),
            task: z
                .string()
                .max(1000)
                .optional()
                .describe(
                    "What you are trying to do, in one sentence (e.g. 'add Klarna to my checkout'). " +
                        "The server picks the references of the requested skills that this task needs. " +
                        "Ignored when `references` or `includeAllReferences` is given.",
                ),
        }),
        annotations: {
            readOnlyHint: true,
        },
        handler: async ({ skills: requestedSlugs, references, includeAllReferences, task }) => {
            const requested = requestedSlugs.map((slug) => ({ slug, skill: skills.find((s) => s.slug === slug) }));

            let picked: SelectedReference[] = [];
            const events: AnalyticsEvent[] = [];
            const selecting = !references && !includeAllReferences && !!task?.trim();
            if (selecting) {
                const candidates = requested.flatMap(({ skill }) =>
                    skill ? skill.references.map((r) => ({ skill: skill.slug, slug: r.slug, content: r.content })) : [],
                );
                if (candidates.length > 0) {
                    try {
                        const selection = await skillReferenceSelector.select(candidates, task!);
                        picked = selection.picked;
                        events.push(
                            buildSelectionEvent(
                                "skills",
                                selectionOutcome({ picked: picked.length, qualified: selection.qualified }),
                            ),
                        );
                    } catch (error) {
                        // Selection is an optimization: when Jev is unavailable, listing the references still works.
                        console.warn(`Skill reference selection failed: ${sanitizeErrorMessage(error)}`);
                        events.push(buildSelectionEvent("skills", selectionOutcome("failed")));
                    }
                }
            }

            const parts: string[] = [];
            for (const { slug, skill } of requested) {
                if (!skill) {
                    parts.push(`## Skill "${slug}" not found.\nAvailable skills: ${skillSlugs.join(", ")}`);
                    continue;
                }

                parts.push(`## Skill: ${skill.name} (${skill.slug})\n\n${skill.content}`);

                const pickedHere = picked.filter((p) => p.skill === skill.slug);
                const refsToInclude = includeAllReferences
                    ? skill.references
                    : references
                      ? skill.references.filter((r) => references.includes(r.slug))
                      : pickedHere.map((p) => skill.references.find((r) => r.slug === p.slug)!);

                if (pickedHere.length > 0) {
                    const list = pickedHere.map((p) => `${p.slug} (${Math.round(p.probability * 100)}%)`).join(", ");
                    parts.push(`_References picked for your task: ${list}_`);
                }

                for (const ref of refsToInclude) {
                    parts.push(`### Reference: ${ref.slug}\n\n${ref.content}`);
                }

                if (!includeAllReferences && !references) {
                    const others = skill.references.filter((r) => !pickedHere.some((p) => p.slug === r.slug));
                    if (others.length > 0) {
                        const label = pickedHere.length > 0 ? "Other references" : "Available references";
                        parts.push(`\n_${label} for ${skill.slug}: ${others.map((r) => r.slug).join(", ")}_`);
                    }
                }
            }

            return {
                content: [
                    {
                        type: "text",
                        text: parts.join("\n\n---\n\n"),
                    },
                ],
                ...(events.length > 0 ? { events } : {}),
            };
        },
    });
};
