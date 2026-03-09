export type CorrectionLog = {
    field: string;
    parentType: string;
    suggestion: string;
    kind: "unknown-field" | "unknown-argument";
};

export type CorrectionResult = {
    correctedQuery: string;
    corrections: CorrectionLog[];
    errors: string[];
};

export type GraphqlQueryCorrector = (
    query: string,
    introspectionUrl: string,
    headers: Record<string, string>,
) => Promise<CorrectionResult | null>;
