/**
 * Prints the exact Plausible goals to create for this server.
 *
 * Goals are the only Growth-plan mechanism that turns the `/t/{tenant}/{tool}`
 * paths into a persistent ranked leaderboard, and they must be typed into the
 * dashboard by hand — the Sites API that could script them is Business-gated.
 * Matching is character-exact, so a typo yields a goal that silently stays at
 * zero. Hence this generator rather than a list in a README that can drift.
 *
 * Pageview goals are free, retroactive, and overlapping: create them whenever,
 * history fills in immediately, and one pageview feeds every goal it matches.
 *
 *   bun run goals              # every goal
 *   bun run goals query-core   # just the rows matching "query-core"
 *
 * The filtered form is for step 5 of "register a new tool" in CLAUDE.md: after
 * adding a tool, print its one goal rather than re-reading all 22.
 *
 * Tool names are read out of the real `toolRegistry` rather than re-listed here.
 * Importing the container would pull in Vite virtual modules that only exist
 * during a build, so the registry literal is parsed from source instead.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const readToolNames = (): string[] => {
    const source = readFileSync(join(projectRoot, "src/core/container.ts"), "utf8");
    const registry = source.match(/export const toolRegistry = \{([\s\S]*?)\n\} as const/);
    if (!registry) {
        throw new Error("Could not find the toolRegistry literal in src/core/container.ts");
    }
    const body = registry[1];
    const names = [...body.matchAll(/^\s*"?([A-Za-z0-9_-]+)"?\s*:/gm)].map((match) => match[1]);
    // A key shape the regex does not cover would otherwise vanish silently, and the
    // missing tool would be tracked with no goal to aggregate it. Cross-check the
    // count so an unparsed entry is a loud failure instead.
    const entryCount = body.split("\n").filter((line) => line.trim() && !line.trim().startsWith("//")).length;
    if (names.length !== entryCount) {
        throw new Error(
            `Parsed ${names.length} tool names but toolRegistry has ${entryCount} entries — the parser needs updating`,
        );
    }
    return names;
};

type Goal = { path: string; displayName: string; answers: string };

const buildGoals = (toolNames: string[]): Goal[] => [
    { path: "/t/*", displayName: "total: tool calls", answers: "every tool call, all tenants" },
    { path: "/mcp/session/*", displayName: "total: sessions started", answers: "every initialize handshake" },
    {
        path: "/mcp/session/*/write-on/*",
        displayName: "cfg: write enabled",
        answers: "sessions that opted IN to write (default off)",
    },
    {
        path: "/mcp/session/*/*/ui-off/*",
        displayName: "cfg: UI disabled",
        answers: "sessions that opted OUT of UI (default on)",
    },
    {
        path: "/mcp/session/*/*/*/skills-off",
        displayName: "cfg: skills disabled",
        answers: "sessions that opted OUT of skills (default on)",
    },
    ...toolNames.map((tool) => ({
        path: `/t/*/${tool}`,
        displayName: `tool: ${tool}`,
        answers: `calls to ${tool} across every tenant`,
    })),
];

const filter = process.argv[2]?.toLowerCase();
const allGoals = buildGoals(readToolNames());
const goals = filter
    ? allGoals.filter((goal) => goal.path.toLowerCase().includes(filter) || goal.displayName.toLowerCase().includes(filter))
    : allGoals;

if (goals.length === 0) {
    console.error(`\nNo goal matches ${JSON.stringify(filter)}. Is the tool registered in toolRegistry?\n`);
    process.exit(1);
}

console.log(`\nCreate these in Plausible → Site Settings → Goals → "Pageview".`);
console.log(`Set the display name too, or they render as "Visit /t/*/query-core".`);
console.log(`LEAVE the optional custom-property field EMPTY. A goal narrowed by a custom`);
console.log(`property is Business-gated and is rejected outright on Growth, and we send no`);
console.log(`properties anyway — the path carries everything.`);
console.log(`Pageview goals are free and retroactive — creating one later still shows its full history.\n`);

const width = Math.max(...goals.map((goal) => goal.path.length));
for (const goal of goals) {
    console.log(`  ${goal.path.padEnd(width)}   ${goal.displayName.padEnd(34)} # ${goal.answers}`);
}

if (filter) {
    console.log(`\n(${goals.length} of ${allGoals.length} goals shown. Run without an argument for the full list.)\n`);
    process.exit(0);
}

console.log(`\nPlus one custom-event goal (type "Custom event"). This one is NOT retroactive —`);
console.log(`its counter starts the day you create it, so create it before shipping:`);
console.log(`  Copy Install Command\n`);
console.log(`Outbound links need no setup — they are already enabled in the v2 script.`);
console.log(`Adding a tool later? Run \`bun run goals <tool-name>\` and create just that row.\n`);
