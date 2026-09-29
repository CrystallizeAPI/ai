#!/usr/bin/env bun
// Bumps the version everywhere it is declared, and prints the new one.
//
//   bun use-crystallize/mcp-servers/crystallize/bin/bump-version.ts <patch|minor|major>
//
// The plugin, its marketplace entry and the MCP server ship as one release, so
// they share one version. The script refuses to run if they have drifted apart.
// It rewrites the `"version": "x.y.z"` line in place rather than re-serialising
// the JSON, so the files keep their formatting.

// Makes this file a module, so the top-level awaits below are allowed.
export {};

const FILES = [
    "use-crystallize/.claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    "use-crystallize/mcp-servers/crystallize/package.json",
];

const VERSION_LINE = /("version":\s*")(\d+)\.(\d+)\.(\d+)(")/g;

const bump = process.argv[2];
if (bump !== "patch" && bump !== "minor" && bump !== "major") {
    console.error("Usage: bun use-crystallize/mcp-servers/crystallize/bin/bump-version.ts <patch|minor|major>");
    process.exit(1);
}

// Paths are relative to the repo root, four levels up from this file.
const root = new URL("../../../../", import.meta.url).pathname;
const sources = await Promise.all(FILES.map((file) => Bun.file(root + file).text()));

const current = sources.map((source, i) => {
    const matches = [...source.matchAll(VERSION_LINE)];
    if (matches.length !== 1) {
        console.error(`${FILES[i]}: expected exactly one "version" field, found ${matches.length}.`);
        process.exit(1);
    }
    return matches[0]!.slice(2, 5).join(".");
});

if (new Set(current).size !== 1) {
    console.error("Versions have drifted apart, fix them by hand first:");
    FILES.forEach((file, i) => console.error(`  ${current[i]}  ${file}`));
    process.exit(1);
}

const [major, minor, patch] = current[0]!.split(".").map(Number) as [number, number, number];
const next = {
    major: `${major + 1}.0.0`,
    minor: `${major}.${minor + 1}.0`,
    patch: `${major}.${minor}.${patch + 1}`,
}[bump];

await Promise.all(FILES.map((file, i) => Bun.write(root + file, sources[i]!.replace(VERSION_LINE, `$1${next}$5`))));

console.log(next);
