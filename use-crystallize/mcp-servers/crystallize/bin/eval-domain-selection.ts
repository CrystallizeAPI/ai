import { readFileSync } from "node:fs";
import { createRestJevClient, requireEnv } from "./lib/jev-rest";
import { MAX_DOMAINS, pickDomains, scoreDomains } from "../src/core/services/core-domain-selector";
import { createCoreSchemaDomainSplitter } from "../src/core/services/core-schema-domain-splitter";
import { fetchIntrospection } from "../src/core/services/compact-schema-builder";
import { buildAtApiUrl } from "../src/core/security";

const { jevClient, printUsage } = createRestJevClient();

const url = buildAtApiUrl("https://api.crystallize.com", process.env.CRYSTALLIZE_TENANT || "furnitut", "");
const introspection = await fetchIntrospection(url, {
    "X-Crystallize-Access-Token-Id": requireEnv("CRYSTALLIZE_TOKEN_ID"),
    "X-Crystallize-Access-Token-Secret": requireEnv("CRYSTALLIZE_TOKEN_SECRET"),
});
const index = createCoreSchemaDomainSplitter().listDomains(introspection);
const names = new Set(index.domains.map((d) => d.name));
console.log(`${index.domains.length} domains: ${[...names].join(", ")}\n`);

const cases = JSON.parse(readFileSync(new URL("./eval-domain-selection.cases.json", import.meta.url), "utf-8")) as {
    intent: string;
    expected: string[];
}[];

const THRESHOLDS = [0.2, 0.3, 0.5];
const totals = new Map(THRESHOLDS.map((t) => [t, { fullRecall: 0, returned: 0 }]));

for (const c of cases) {
    const missingFromIndex = c.expected.filter((e) => !names.has(e));
    if (missingFromIndex.length > 0) console.warn(`! case expects unknown domains: ${missingFromIndex.join(", ")}`);

    const scored = await scoreDomains(jevClient, index, c.intent);
    const top = [...scored].sort((a, b) => b.probability - a.probability).slice(0, 6);
    console.log(`- ${c.intent}\n  expected: ${c.expected.join(", ")}`);
    console.log(`  top: ${top.map((d) => `${d.name} ${d.probability.toFixed(2)}`).join(", ")}`);

    for (const t of THRESHOLDS) {
        const picked = pickDomains(scored, t, MAX_DOMAINS).map((d) => d.name);
        const totalsForT = totals.get(t)!;
        if (c.expected.every((e) => picked.includes(e))) totalsForT.fullRecall++;
        totalsForT.returned += picked.length;
    }
}

console.log("\nthreshold  full-recall  avg-domains-returned");
for (const [t, { fullRecall, returned }] of totals) {
    console.log(`${t.toFixed(2)}       ${fullRecall}/${cases.length}         ${(returned / cases.length).toFixed(2)}`);
}

printUsage();
