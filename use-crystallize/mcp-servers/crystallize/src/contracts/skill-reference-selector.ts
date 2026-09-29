export type ReferenceCandidate = {
    skill: string;
    slug: string;
    content: string;
};

export type SelectedReference = {
    skill: string;
    slug: string;
    probability: number;
};

export type SkillReferenceSelector = {
    select(candidates: ReferenceCandidate[], task: string): Promise<SelectedReference[]>;
};
