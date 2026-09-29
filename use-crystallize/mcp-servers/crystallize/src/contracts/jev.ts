export type JevNoulQuestion = {
    type: "noul";
    instructions: string;
    criteria?: { true: string; false: string };
};

export type JevRequest = {
    state: unknown;
    questions: Record<string, JevNoulQuestion>;
};

export type JevResponse = {
    model: string;
    answers: Record<string, { type: "noul"; noul: number }>;
    usage?: { input_tokens: number; output_tokens: number };
};

export type JevClient = (request: JevRequest) => Promise<JevResponse>;
