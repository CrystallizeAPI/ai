import type { DomainIndex } from "./core-schema-domain-splitter";

export type SelectedDomain = {
    name: string;
    probability: number;
};

/** `qualified` counts every domain that cleared the threshold, before the cap: more than `picked` means capped. */
export type DomainSelection = {
    picked: SelectedDomain[];
    qualified: number;
};

export type CoreDomainSelector = {
    select(index: DomainIndex, intent: string): Promise<DomainSelection>;
};
