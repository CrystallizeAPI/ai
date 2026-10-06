import type { Loader } from "astro/loaders";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

const SKILLS_DIR = join(new URL(".", import.meta.url).pathname, "../../../use-crystallize/skills");

function parseFrontmatter(content: string) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { name: "", description: "", body: content };

    const meta: Record<string, string> = {};
    const lines = match[1].split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const colonIdx = line.indexOf(":");
        if (colonIdx <= 0 || line.startsWith(" ")) continue;

        const key = line.slice(0, colonIdx).trim();
        const inline = line.slice(colonIdx + 1).trim();

        // YAML block scalars — `description: >` (folded) or `| ` (literal) put the
        // value on the following indented lines. Read as an inline value they yield
        // the marker itself, which is how skills using the folded form ended up
        // rendering a bare ">" as their description.
        if (/^[>|][-+]?$/.test(inline)) {
            const parts: string[] = [];
            while (i + 1 < lines.length && (lines[i + 1].startsWith(" ") || lines[i + 1].trim() === "")) {
                parts.push(lines[++i].trim());
            }
            meta[key] = parts.join(inline.startsWith(">") ? " " : "\n").trim();
            continue;
        }

        meta[key] = inline.replace(/^["']|["']$/g, "");
    }
    return {
        name: meta.name || "",
        description: meta.description || "",
        body: match[2],
    };
}

function referenceAnchor(file: string) {
    return `ref-${file.replace(/\.md$/, "")}`;
}

// A skill page inlines SKILL.md and every references/*.md into one document, so the
// relative .md links between those files (`references/x.md`, `../SKILL.md#y`,
// `../mutation/SKILL.md`) resolve to URLs that were never built. Point each link that
// lands on a skill file at where that file ended up: a reference is the anchor above
// its section, a SKILL.md is the top of its skill page.
function rewriteSkillLinks(markdown: string, fromDir: string, currentSkill: string): string {
    return markdown.replace(/\]\(([^)\s#]+\.md)(#[^)\s]*)?\)/g, (link, path: string, hash = "") => {
        if (/^([a-z]+:|\/)/i.test(path)) return link;

        const [skill, ...rest] = relative(SKILLS_DIR, resolve(fromDir, path)).split(sep);
        const page = skill === currentSkill ? "" : `/ai/skills/${skill}/`;
        if (rest.length === 1 && rest[0] === "SKILL.md") {
            return `](${page}${hash || (page ? "" : "#_top")})`;
        }
        if (rest.length === 2 && rest[0] === "references") {
            return `](${page}${hash || `#${referenceAnchor(rest[1])}`})`;
        }
        return link;
    });
}

async function readReferences(skillDir: string): Promise<string> {
    const refsDir = join(skillDir, "references");
    try {
        const files = await readdir(refsDir);
        const parts: string[] = [];
        for (const file of files.sort()) {
            if (!file.endsWith(".md")) continue;
            const content = await readFile(join(refsDir, file), "utf-8");
            const { body } = parseFrontmatter(content);
            const linked = rewriteSkillLinks(body.trim(), refsDir, basename(skillDir));
            parts.push(`<div id="${referenceAnchor(file)}"></div>\n\n${linked}`);
        }
        if (parts.length > 0) {
            return "\n\n---\n\n## Reference Details\n\n" + parts.join("\n\n");
        }
        return "";
    } catch {
        return "";
    }
}

export function skillsLoader(): Loader {
    return {
        name: "skills-loader",
        load: async ({ store, logger, generateDigest, renderMarkdown }) => {
            logger.info("Loading skills from use-crystallize/skills/");
            store.clear();

            let dirs: string[];
            try {
                dirs = await readdir(SKILLS_DIR);
            } catch (e) {
                logger.error(`Cannot read skills directory: ${SKILLS_DIR}`);
                return;
            }

            for (const dir of dirs.sort()) {
                const skillFile = join(SKILLS_DIR, dir, "SKILL.md");
                let content: string;
                try {
                    content = await readFile(skillFile, "utf-8");
                } catch {
                    continue;
                }

                const { name, description, body } = parseFrontmatter(content);
                const references = await readReferences(join(SKILLS_DIR, dir));
                const fullBody = rewriteSkillLinks(body.trim(), join(SKILLS_DIR, dir), dir) + references;
                const rendered = await renderMarkdown(fullBody);

                store.set({
                    id: dir,
                    data: { name: name || dir, description, slug: dir },
                    body: fullBody,
                    rendered,
                    digest: generateDigest(fullBody),
                });

                logger.info(`  Loaded skill: ${dir}`);
            }
        },
    };
}
