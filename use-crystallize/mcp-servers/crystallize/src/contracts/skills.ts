// Mirrors the shape the `virtual:skills` module provides, so the catalog can be injected (and faked in tests).
export type SkillReference = {
    slug: string;
    content: string;
};

export type SkillEntry = {
    slug: string;
    name: string;
    description: string;
    content: string;
    references: SkillReference[];
};
