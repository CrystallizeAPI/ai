import type { DomainIndex } from "./core-schema-domain-splitter";

export type SelectedDomain = {
    name: string;
    probability: number;
};

export type CoreDomainSelector = {
    select(index: DomainIndex, intent: string): Promise<SelectedDomain[]>;
};
