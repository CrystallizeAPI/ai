import { readFileSync } from "node:fs";
import type { JevClient, JevResponse } from "../src/contracts/jev";
import { JEV_MODEL } from "../src/core/services/jev-client";
import { MAX_DOMAINS, pickDomains, scoreDomains } from "../src/core/services/core-domain-selector";
import { createCoreSchemaDomainSplitter } from "../src/core/services/core-schema-domain-splitter";
import { fetchIntrospection } from "../src/core/services/compact-schema-builder";
import { buildAtApiUrl } from "../src/core/security";

const env = (name: string) => {
    const value = process.env[name];
    if (!value) {
        console.error(`Missing env var ${name}`);
        process.exit(1);
    }
    return value;
};

const accountId = env("CLOUDFLARE_ACCOUNT_ID");
const apiToken = env("CLOUDFLARE_API_TOKEN");

// Same request shape as the binding, over the REST API, so the eval runs outside a Worker.
const jevClient: JevClient = async (request) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: JEV_MODEL, input: request }),
    });
    const json = (await response.json()) as { success: boolean; result: JevResponse; errors?: unknown };
    if (!json.success) throw new Error(`Workers AI error: ${JSON.stringify(json.errors)}`);
    return json.result;
};

const url = buildAtApiUrl("https://api.crystallize.com", env("CRYSTALLIZE_TENANT"), "");
const introspection = await fetchIntrospection(url, {
    "X-Crystallize-Access-Token-Id": env("CRYSTALLIZE_TOKEN_ID"),
    "X-Crystallize-Access-Token-Secret": env("CRYSTALLIZE_TOKEN_SECRET"),
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
