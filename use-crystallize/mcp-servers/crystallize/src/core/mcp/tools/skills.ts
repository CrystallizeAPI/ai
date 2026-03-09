import z from "zod";
import { skills } from "virtual:skills";
import { defineToolWrapper } from "../../../contracts/tool";

type Deps = {};

const skillSlugs = skills.map((s) => s.slug);
const allReferenceSlugs = [...new Set(skills.flatMap((s) => s.references.map((r) => r.slug)))];

export const createSkillsToolWrapper = (_deps: Deps) => {
    return defineToolWrapper({
        description: `Retrieve Crystallize documentation and skills. If you already have Crystallize skills loaded in your context, you do NOT need to call this tool — use your existing knowledge instead. Available skills: ${skillSlugs.join(", ")}. Each skill has a main document and optional reference documents. Call with a skill slug to get its content. Optionally specify reference slugs to include specific references (or use includeAllReferences). Available reference slugs across skills: ${allReferenceSlugs.join(", ")}.`,
        inputSchema: z.object({
            skills: z
                .array(z.string())
                .describe(`One or more skill slugs to retrieve. Available: ${skillSlugs.join(", ")}`),
            references: z
                .array(z.string())
                .optional()
                .describe(
                    "Optional: specific reference slugs to include. If omitted, only the main skill document is returned.",
                ),
            includeAllReferences: z
                .boolean()
                .optional()
                .describe("If true, include all references for the requested skills."),
        }),
        handler: async ({ skills: requestedSlugs, references, includeAllReferences }) => {
            console.log("Requested skills:", requestedSlugs);
            const parts: string[] = [];

            for (const slug of requestedSlugs) {
                const skill = skills.find((s) => s.slug === slug);
                if (!skill) {
                    parts.push(`## Skill "${slug}" not found.\nAvailable skills: ${skillSlugs.join(", ")}`);
                    continue;
                }

                parts.push(`## Skill: ${skill.name} (${skill.slug})\n\n${skill.content}`);

                const refsToInclude = includeAllReferences
                    ? skill.references
                    : references
                        ? skill.references.filter((r) => references.includes(r.slug))
                        : [];

                for (const ref of refsToInclude) {
                    parts.push(`### Reference: ${ref.slug}\n\n${ref.content}`);
                }

                if (!includeAllReferences && !references && skill.references.length > 0) {
                    parts.push(
                        `\n_Available references for ${skill.slug}: ${skill.references.map((r) => r.slug).join(", ")}_`,
                    );
                }
            }

            return {
                content: [
                    {
                        type: "text" as const,
                        text: parts.join("\n\n---\n\n"),
                    },
                ],
            };
        },
    });
};
