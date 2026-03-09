import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import react from "@astrojs/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const skillsDir = join(import.meta.dirname, "../use-crystallize/skills");
const skillItems = readdirSync(skillsDir)
  .filter((dir) => {
    try {
      readFileSync(join(skillsDir, dir, "SKILL.md"), "utf-8");
      return true;
    } catch {
      return false;
    }
  })
  .sort()
  .map((dir) => {
    const content = readFileSync(join(skillsDir, dir, "SKILL.md"), "utf-8");
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    return {
      label: nameMatch ? nameMatch[1].trim() : dir,
      link: `/skills/${dir}/`,
    };
  });

const github = "https://github.com/crystallizeapi/ai";
const githubURL = new URL(github);
const githubPathParts = githubURL.pathname.split("/");
const title = "Crystallize AI";

export default defineConfig({
  site: `https://${githubPathParts[1]}.github.io/${githubPathParts[2]}`,
  base: `${githubPathParts[2]}`,
  trailingSlash: "ignore",
  integrations: [
    starlight({
      title,
      logo: {
        src: "./src/assets/crystallize.svg",
        alt: title,
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/crystallizeapi/ai",
        },
      ],
      customCss: ["./src/tailwind.css"],
      components: {
        Footer: "./src/ui/components/astro/footer.astro",
      },
      sidebar: [
        {
          label: "Guides",
          autogenerate: { directory: "guides" },
        },
        {
          label: "Skills",
          items: [
            { label: "Overview", link: "/skills/" },
            ...skillItems,
          ],
        },
      ],
    }),
    react(),
  ],

  vite: {
    plugins: [tailwindcss()],
  },
});
