import { createGraphlSchemaCompacter, INTROSPECTION_QUERY } from "../src/core/services/compact-schema-builder";

const url = process.argv[2];
if (!url) {
    console.error("Usage: bun test-compacter.ts <graphql-endpoint-url>");
    process.exit(1);
}

// Fetch raw introspection
const rawResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: INTROSPECTION_QUERY }),
});
const rawJson = await rawResponse.text();

// Compact version
const compact = createGraphlSchemaCompacter();
const compacted = await compact(url);

const rawSize = Buffer.byteLength(rawJson, "utf-8");
const compactSize = Buffer.byteLength(compacted, "utf-8");
const saving = ((1 - compactSize / rawSize) * 100).toFixed(1);

console.log(`\n--- Compact output ---\n`);
console.log(compacted);

console.log(`\n--- Compaction Summary ---\n`);
console.log(`Endpoint:           ${url}`);
console.log(`Raw introspection:  ${(rawSize / 1024).toFixed(2)} kb`);
console.log(`Compact schema:     ${(compactSize / 1024).toFixed(2)} kb`);
console.log(`Saving:             ${saving}% (${((rawSize - compactSize) / 1024).toFixed(2)} kb)`);
