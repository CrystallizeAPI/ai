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

/** `qualified` counts every reference that cleared the threshold, before the cap: more than `picked` means capped. */
export type ReferenceSelection = {
    picked: SelectedReference[];
    qualified: number;
};

export type SkillReferenceSelector = {
    select(candidates: ReferenceCandidate[], task: string): Promise<ReferenceSelection>;
};
