/**
 * The three per-request feature gates, read off the MCP URL's query string.
 *
 * Shared so the middleware that acts on them and the analytics that report them
 * can never disagree about a default — the defaults are the interesting part,
 * since every reading of the session data is "how many people deviated from them".
 */
export type ExposeFlags = {
    /** Write tools. Off by default — the only gate you opt *into*. */
    write: boolean;
    /** UI panel tools. On by default. */
    ui: boolean;
    /** The bundled skills tool. On by default. */
    skills: boolean;
};

export const readExposeFlags = (query: (key: string) => string | undefined): ExposeFlags => ({
    write: query("exposeWrite") === "true",
    ui: query("exposeUi") !== "false",
    skills: query("exposeSkills") !== "false",
});
