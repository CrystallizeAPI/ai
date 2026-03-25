import { defineCollection, z } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { skillsLoader } from "./loaders/skills-loader";
import { mcpToolsLoader } from "./loaders/mcp-tools-loader";

export const collections = {
    docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
    skills: defineCollection({
        loader: skillsLoader(),
        schema: z.object({
            name: z.string(),
            description: z.string(),
            slug: z.string(),
        }),
    }),
    mcpTools: defineCollection({
        loader: mcpToolsLoader(),
        schema: z.object({
            toolName: z.string(),
            description: z.string(),
            inputSchema: z.array(
                z.object({
                    name: z.string(),
                    type: z.string(),
                    required: z.boolean(),
                    description: z.string(),
                }),
            ),
        }),
    }),
};
