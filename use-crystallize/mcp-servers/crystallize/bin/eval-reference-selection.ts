import { readFileSync } from "node:fs";
import path from "node:path";
import { createRestJevClient } from "./lib/jev-rest";
import { MAX_REFERENCES, pickReferences, scoreReferences } from "../src/core/services/skill-reference-selector";
import { loadSkills } from "../vite/plugins/skills";

// The same loader the Vite plugin bundles into `virtual:skills`, so this scores exactly what ships.
const skills = loadSkills(path.resolve(import.meta.dir, "../../../skills"));
const { jevClient, printUsage } = createRestJevClient();

const cases = JSON.parse(readFileSync(new URL("./eval-reference-selection.cases.json", import.meta.url), "utf-8")) as {
    task: string;
    skills: string[];
    expected: string[];
}[];

const THRESHOLDS = [0.3, 0.5, 0.7];
const totals = new Map(THRESHOLDS.map((t) => [t, { fullRecall: 0, returned: 0 }]));
const key = (r: { skill: string; slug: string }) => `${r.skill}/${r.slug}`;

for (const c of cases) {
    const candidates = c.skills.flatMap((slug) => {
        const skill = skills.find((s) => s.slug === slug);
        if (!skill) console.warn(`! case uses unknown skill: ${slug}`);
        return (skill?.references ?? []).map((r) => ({ skill: slug, slug: r.slug, content: r.content }));
    });
    const missing = c.expected.filter((e) => !candidates.some((r) => key(r) === e));
    if (missing.length > 0) console.warn(`! case expects unknown references: ${missing.join(", ")}`);

    const scored = await scoreReferences(jevClient, candidates, c.task);
    const top = [...scored].sort((a, b) => b.probability - a.probability).slice(0, 5);
    console.log(`- ${c.task}\n  expected: ${c.expected.join(", ")}`);
    console.log(`  top: ${top.map((r) => `${key(r)} ${r.probability.toFixed(2)}`).join(", ")}`);

    for (const t of THRESHOLDS) {
        const picked = pickReferences(scored, t, MAX_REFERENCES).map(key);
        const totalsForT = totals.get(t)!;
        if (c.expected.every((e) => picked.includes(e))) totalsForT.fullRecall++;
        totalsForT.returned += picked.length;
    }
}

console.log("\nthreshold  full-recall  avg-references-returned");
for (const [t, { fullRecall, returned }] of totals) {
    console.log(`${t.toFixed(2)}       ${fullRecall}/${cases.length}         ${(returned / cases.length).toFixed(2)}`);
}

printUsage();
