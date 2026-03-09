import fs from "node:fs";
import path from "node:path";
import { type Plugin } from "vite";

type SkillReference = {
    slug: string;
    content: string;
};

type SkillEntry = {
    slug: string;
    name: string;
    description: string;
    content: string;
    references: SkillReference[];
};

function parseFrontmatter(raw: string): { name: string; description: string; body: string } {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
        return { name: "", description: "", body: raw };
    }
    const frontmatter = match[1];
    const body = match[2];

    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

    return {
        name: nameMatch?.[1]?.trim() ?? "",
        description: descMatch?.[1]?.trim() ?? "",
        body: body.trim(),
    };
}

function loadSkills(skillsDir: string): SkillEntry[] {
    if (!fs.existsSync(skillsDir)) return [];

    const entries: SkillEntry[] = [];
    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true });

    for (const dir of dirs) {
        if (!dir.isDirectory()) continue;

        const skillDir = path.join(skillsDir, dir.name);
        const skillFile = path.join(skillDir, "SKILL.md");

        if (!fs.existsSync(skillFile)) continue;

        const raw = fs.readFileSync(skillFile, "utf-8");
        const { name, description, body } = parseFrontmatter(raw);

        const references: SkillReference[] = [];
        const refsDir = path.join(skillDir, "references");
        if (fs.existsSync(refsDir)) {
            const refFiles = fs
                .readdirSync(refsDir)
                .filter((f) => f.endsWith(".md"))
                .sort();
            for (const refFile of refFiles) {
                const refContent = fs.readFileSync(path.join(refsDir, refFile), "utf-8");
                references.push({
                    slug: refFile.replace(/\.md$/, ""),
                    content: refContent,
                });
            }
        }

        entries.push({
            slug: dir.name,
            name,
            description,
            content: body,
            references,
        });
    }

    return entries.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function skillsPlugin(): Plugin {
    const virtualModuleId = "virtual:skills";
    const resolvedVirtualModuleId = "\0" + virtualModuleId + ".js";
    const skillsDir = path.resolve(process.cwd(), "../../skills");

    return {
        name: "vite-plugin-crystallize-skills",
        resolveId(id) {
            if (id === virtualModuleId) {
                return resolvedVirtualModuleId;
            }
        },
        load(id) {
            if (id === resolvedVirtualModuleId) {
                const skills = loadSkills(skillsDir);
                return `export const skills = ${JSON.stringify(skills, null, 2)};`;
            }
        },
        configureServer(server) {
            if (fs.existsSync(skillsDir)) {
                server.watcher.add(skillsDir);
                server.watcher.on("all", (_event, file) => {
                    if (file.startsWith(skillsDir) && file.endsWith(".md")) {
                        const mod = server.moduleGraph.getModuleById(resolvedVirtualModuleId);
                        if (mod) {
                            server.moduleGraph.invalidateModule(mod);
                        }
                    }
                });
            }
        },
    };
}
