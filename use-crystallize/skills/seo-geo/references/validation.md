# Validating structured data and the crawler's view

Three layers, each catching what the others miss: the schema.org vocabulary (does every type and property exist,
and fit where it is used), Google's rules for rich results (which ask for more than schema.org), and what a
crawler actually receives (headers, `<head>`, robots, sitemap, Markdown).

## 1. The schema.org vocabulary check

Easy-to-get-wrong properties pass JSON syntax checks and most linters: `leaseLength` on a `Product` (it belongs to
`Offer`), `isConsumableFor` on an `Offer` (it belongs to `Product`), a misspelt `inCodeSet`, a type that doesn't
exist. This script reads the official schema.org release file and checks every `@type` and property on a page,
through the class hierarchy (`ProductGroup` is a `Product`, `OnlineStore` an `Organization`). Node 20+, no
dependencies. Put it in `scripts/` and run it in CI against a deployment or saved HTML.

```js
#!/usr/bin/env node
// Checks the JSON-LD on pages against the schema.org vocabulary: every @type must exist, every property must exist
// and be allowed on the node's type (domainIncludes, through the class hierarchy). Node 20+, no dependencies.
//
//   node check-schema-org.mjs https://shop.example/en https://shop.example/en/some/product
//   node check-schema-org.mjs page.html data.jsonld
//
// Exit code 1 when anything is wrong, so it can gate CI.
import { readFile } from "node:fs/promises";

const VOCAB = "https://schema.org/version/latest/schemaorg-current-https.jsonld";
const S = "schema:";
// Keys that are JSON-LD syntax or Google conventions, not schema.org properties.
const IGNORE = new Set(["@context", "@id", "@type", "@graph", "@value", "@language", "query-input"]);

const graph = (await (await fetch(VOCAB)).json())["@graph"];
const types = (n) => [n["@type"]].flat();
const ids = (v) => [v ?? []].flat().map((x) => x["@id"]);
const parents = new Map();
const props = new Map();
for (const n of graph) {
    if (types(n).includes("rdfs:Class")) parents.set(n["@id"], ids(n["rdfs:subClassOf"]));
    if (types(n).includes("rdf:Property")) props.set(n["@id"], { domain: ids(n["schema:domainIncludes"]) });
}
const ancestors = (t, seen = new Set()) => {
    if (seen.has(t)) return seen;
    seen.add(t);
    for (const p of parents.get(t) ?? []) ancestors(p, seen);
    return seen;
};

async function sources(arg) {
    const text = /^https?:\/\//.test(arg)
        ? await (await fetch(arg, { headers: { "user-agent": "schema-check" } })).text()
        : await readFile(arg, "utf8");
    if (arg.endsWith(".json") || arg.endsWith(".jsonld")) return [JSON.parse(text)];
    return [...text.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) =>
        JSON.parse(m[1]),
    );
}

const problems = [];
function walk(node, where) {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}[${i}]`));
    if (!node || typeof node !== "object") return;
    const own = node["@type"]
        ? [node["@type"]].flat().map((t) => (t.startsWith("http") ? t.replace(/^https?:\/\/schema\.org\//, S) : S + t))
        : [];
    for (const t of own) if (!parents.has(t)) problems.push(`${where}: unknown type ${t.slice(S.length)}`);
    const all = new Set(own.flatMap((t) => [...ancestors(t)]));
    for (const [key, value] of Object.entries(node)) {
        if (IGNORE.has(key)) continue;
        const p = props.get(S + key);
        if (!p) problems.push(`${where}: unknown property ${key}`);
        else if (own.length && !p.domain.some((d) => all.has(d)))
            problems.push(
                `${where}: ${key} is not a property of ${own.map((t) => t.slice(S.length)).join("/")} (domain: ${p.domain.map((d) => d.slice(S.length)).join(", ")})`,
            );
        walk(value, `${where}.${key}`);
    }
}

for (const arg of process.argv.slice(2)) {
    const blocks = await sources(arg);
    if (!blocks.length) problems.push(`${arg}: no JSON-LD found`);
    blocks.forEach((b, i) => walk(b, `${arg}#${i}`));
}
for (const p of problems) console.log(p);
console.log(
    problems.length
        ? `${problems.length} problem(s)`
        : "OK: every type and property is in schema.org and fits its type",
);
process.exit(problems.length ? 1 : 0);
```

```bash
node scripts/check-schema-org.mjs https://shop.example/en https://shop.example/en/some/product
node scripts/check-schema-org.mjs page.html structured-data.jsonld
```

What it reports (a deliberately broken sample):

```
bad.jsonld#0: leaseLength is not a property of Product (domain: Accommodation, Offer, RealEstateListing)
bad.jsonld#0: unknown property colour
bad.jsonld#0.offers: isConsumableFor is not a property of Offer (domain: Product)
bad.jsonld#0.brand: unknown type Brandd
4 problem(s)
```

- It checks names and domains, not value types (`rangeIncludes`) or Google's required fields.
- `query-input` on a `SearchAction` is a Google convention, not a schema.org property; the script ignores it.
- Pick sample URLs from the sitemap so every page type is covered: home, a category, a brand, a product with
  variants, a product without, a rental, an article.
- Fetching a page with a plain user agent tests what browsers get. To test a crawler's copy, add the crawler's
  user agent to the `fetch` headers.

## 2. Google's rules

The [Rich Results Test](https://search.google.com/test/rich-results) and the Merchant listing reports check what
Google needs for product snippets and merchant listings: `offers` with `price` and `priceCurrency`, `availability`,
and recommended `shippingDetails`, `hasMerchantReturnPolicy`, `aggregateRating`/`review`. Treat its warnings as
questions, not orders: add a return policy or shipping details only if the store has them, and never a rating
without reviews. The [Schema Markup Validator](https://validator.schema.org) shows the parsed graph, useful for
`@id` links between nodes.

## 3. The crawler's view, with curl

Run these against the deployment, not a local `next start`:

```bash
SITE=https://shop.example
GB='Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/138.0.0.0 Safari/537.36'

# robots.txt: AI crawler block, Content-Signal, private routes, sitemap
curl -s $SITE/robots.txt

# sitemap: count URLs and hreflang alternates
curl -s $SITE/sitemap.xml | grep -c '<loc>'
curl -s $SITE/sitemap.xml | grep -c 'xhtml:link'

# llms.txt and a Markdown twin, both ways
curl -sI $SITE/llms.txt | grep -i content-type
curl -sI $SITE/en/some/product.md | grep -i 'content-type\|x-robots-tag\|^link\|^vary'
curl -s -H 'Accept: text/markdown' $SITE/en/some/product | head -20

# <head> as Googlebot sees it (see crawlers.md for the loop over every user agent)
curl -s -A "$GB" $SITE/en/some/product | head -c 6000 | grep -o '<title>[^<]*</title>'
```

Expect `text/markdown` with `x-robots-tag: noindex`, a canonical `Link` header and `Vary: Accept` on the
Markdown twin; a `<title>` before `</head>` for every user agent.

## 4. Ask an answer engine

The end-to-end test: ask ChatGPT, Claude or Perplexity (with browsing) for a product's voltage, weight and price
incl. VAT in a given market, and for the store's llms.txt. Wrong or missing answers usually point at metadata
outside `<head>`, a disallowed path, or a fact that is only in client-rendered HTML.

## What to automate

- The vocabulary check on a sample of sitemap URLs, after each deploy.
- The `<head>` check per user agent on a product and a category URL.
- A test that no spec `PropertyValue` has `value: false` (unset booleans read `false` and should have been left
  out; `valueAddedTaxIncluded: false` is fine).
- A test that hreflang in the sitemap matches the translated paths from Discovery.
