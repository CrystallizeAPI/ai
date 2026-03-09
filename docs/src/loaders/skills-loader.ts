import type { Loader } from "astro/loaders";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const SKILLS_DIR = join(
  new URL(".", import.meta.url).pathname,
  "../../../use-crystallize/skills",
);

function parseFrontmatter(content: string) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { name: "", description: "", body: content };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0 && !line.startsWith(" ")) {
      const key = line.slice(0, colonIdx).trim();
      meta[key] = line
        .slice(colonIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  }
  return {
    name: meta.name || "",
    description: meta.description || "",
    body: match[2],
  };
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
      parts.push(body.trim());
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
        const fullBody = body.trim() + references;
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
