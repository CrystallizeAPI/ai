import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { skillsLoader } from './loaders/skills-loader';

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
};
