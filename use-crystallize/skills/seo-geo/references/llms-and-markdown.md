# llms.txt, llms-full.txt and Markdown twins

Answer engines quote text. A Crystallize store can give them its own: a short map of the site (`/llms.txt`), the
whole catalogue in one file (`/llms-full.txt`), and a Markdown version of every page. All three are built from
the same cached Discovery reads and the same typed spec rows as the pages and the JSON-LD, so they never
disagree and they follow a publish in the same revalidation ([[storefront]]).

## /llms.txt

Follows [llmstxt.org](https://llmstxt.org): an `#` title, a `>` summary, a few lines on how the store works, then
sections of links. Link to the **Markdown** twins, not the HTML pages. What to say up front:

- What the store sells, to whom, and in which markets, currencies and VAT rates. Which part of the URL decides the
  market.
- Whether catalogue prices are net, and what each segment sees (incl. or excl. VAT).
- How the catalogue is structured: versions and variants with their own SKU and price, platforms or systems that
  decide compatibility, what typed specs and codes mean.
- The MCP endpoint, if there is one, and the page that explains it.
- That every page has a Markdown version (`.md` suffix or `Accept: text/markdown`), and the languages.
- Where the data comes from (for example, manufacturer data).

Trimmed from a working store:

```ts
export async function llmsTxt() {
    const items = await allItems("en"); // one cached browse per shape
    const of = (shape: string) => items.filter((i) => i.shape === shape);
    return [
        `# ${SITE_NAME}`,
        "",
        `> ${SUMMARY}`,
        "",
        "- Markets and currencies: … The site language decides the market: `/en` EUR, `/no` NOK, `/sv` SEK.",
        "- Prices in the catalogue are net, excluding VAT. Trade customers see prices excl. VAT; consumers incl. VAT.",
        "- Specs are typed: numbers with their unit (and its UN/CEFACT code), yes/no, and fixed option sets, with ETIM codes.",
        `- MCP server for AI assistants: ${absolute("/api/mcp")} (Streamable HTTP). Setup and tools: ${absolute("/en/mcp")}.`,
        "- Every page has a Markdown version: append `.md` to its URL (`/en.md` for the front page), or request it with `Accept: text/markdown`.",
        "",
        "## Catalogue",
        "",
        `- [Front page](${mdUrl("en", "/")})`,
        ...of("category").map((c) => `- [${c.name}](${mdUrl("en", c.path)}): ${c.tagline ?? ""}`.trim()),
        "",
        "## Brands",
        "",
        ...of("brand").map((b) => `- [${b.name}](${mdUrl("en", b.path)})`),
        "",
        "## Optional",
        "",
        `- [Full catalogue with prices](${absolute("/llms-full.txt")}): every product in one file`,
        `- [Search](${absolute("/en/search?q=")}): append a term`,
        `- [Sitemap](${absolute("/sitemap.xml")})`,
        "",
    ].join("\n");
}

// app/llms.txt/route.ts
export async function GET() {
    return new Response(await llmsTxt(), { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
```

Write it in the default language and link the other languages' front pages.

## /llms-full.txt

The catalogue in one file: per category, every product with brand, price incl. and excl. VAT per currency, SKU,
stock, the Markdown link, classification and every **stated** typed spec with its codes. Page through Discovery
with the cursor, in a cached function:

```ts
let after: string | null = null;
do {
    const data = await discovery(
        `query Typed($after: String) { browse { product(language: en, pagination: { limit: 100, after: $after }, sorting: { path: asc }) {
           summary { hasMoreHits endToken } hits { path topics ${SPEC_FIELDS} } } } }`,
        after ? { after } : {},
    );
    for (const t of data.browse.product.hits) {
        const facts = specGroups(t.specs, t.power, t.physical, "en")
            .flatMap((g) => g.rows)
            .filter(stated) // unset booleans read false: leave them out
            .map((r) => `${r.label} ${specFact(r)}${r.etim ? ` [${r.etim}]` : ""}`);
        out.set(t.path, facts.join(" · "));
    }
    after = data.browse.product.summary.hasMoreHits ? data.browse.product.summary.endToken : null;
} while (after);

/** "230 Nm (NU)", "SDS-max (EV005657)": the value with its codes, for text-only readers. */
export function specFact(r: SpecRow) {
    const codes = [r.unitCode, ...(r.options ?? []).map((o) => o.etim)].filter(Boolean);
    return `${r.text}${codes.length ? ` (${codes.join(", ")})` : ""}`;
}
```

A full scan of a large index can come back incomplete when Discovery is re-indexing (totals flicker, `hasMoreHits`
false too early). For files that claim to be complete, compare the count with a `search` total and retry.

## Markdown twins of every page

Every storefront URL has a Markdown version at `<url>.md` (`/en.md` for the home page), and the same URL with
`Accept: text/markdown` returns it too. The proxy rewrites both to one route:

```ts
// proxy.ts, inside the language branch
const accept = request.headers.get("accept") ?? "";
if (pathname.endsWith(".md") || (accept.includes("text/markdown") && !accept.includes("text/html"))) {
    const url = request.nextUrl.clone();
    url.pathname = `/md${pathname.replace(/\.md$/, "")}`;
    return NextResponse.rewrite(url);
}
// Same URL, two representations: caches must key on Accept.
const res = NextResponse.next();
res.headers.set("Vary", "Accept");
return res;

// matcher: skip files, but not .md
export const config = { matcher: ["/((?!_next|api|md/|.*\\..*).*)", "/(.*\\.md)"] };
```

The route answers Markdown, out of the index, pointing at the HTML page as canonical:

```ts
// app/md/[lang]/[[...path]]/route.ts
export async function GET(_: Request, { params }: { params: Promise<{ lang: string; path?: string[] }> }) {
    const { lang, path = [] } = await params;
    const page = await pageMarkdown("/" + path.map(decodeURIComponent).join("/"), lang);
    if (!page) return new Response("Not found", { status: 404 });
    return new Response(page.body + "\n", {
        headers: {
            "content-type": "text/markdown; charset=utf-8",
            "x-robots-tag": "noindex",
            link: `<${page.canonical}>; rel="canonical"`,
            vary: "Accept",
        },
    });
}
```

Announce the twin from the HTML page with `<link rel="alternate" type="text/markdown">`. In Next.js metadata:

```ts
alternates: { ...alternates(paths, lang), types: { "text/markdown": `${canonical}.md` } },
```

What a twin contains:

- The page's facts without markup: name, brand, price incl. and excl. VAT in the page's market, stock, SKU and
  GTIN per variant.
- The typed spec sheet as a table: spec, value (with `≤`/`≥` for bounds), UN/CEFACT code, classification codes.
- Links to other twins (`[name](https://shop.example/en/path.md)`), so a model can walk the catalogue.
- Listings as tables of products, with the same prices.

```ts
/** The typed spec sheet: value with unit, the unit's UN/CEFACT code, and the ETIM feature (and value) codes. */
const specTables = (groups: SpecGroup[], lang: Lang) =>
    groups
        .map((g) => ({ ...g, rows: g.rows.filter(stated) }))
        .filter((g) => g.rows.length)
        .flatMap((g) => [
            `### ${g.title}`,
            "",
            ...table(
                ["Spec", "Value", "UN/CEFACT", "ETIM"],
                g.rows.map((r) => [
                    r.label,
                    `${r.bound === "max" ? "≤ " : r.bound === "min" ? "≥ " : ""}${r.text}`,
                    r.unitCode ?? "",
                    [r.etim, ...(r.options ?? []).map((o) => o.etim)].filter(Boolean).join(" · "),
                ]),
            ),
            "",
        ]);

const cell = (s: unknown) =>
    String(s ?? "")
        .replace(/\|/g, "\\|")
        .replace(/\s*\n\s*/g, " ");
const table = (head: string[], rows: unknown[][]) => [
    `| ${head.map(cell).join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
];
```

Another pattern from a Norwegian build: a Markdown twin per SKU (`/produkt/{sku}.md`, and `?format=md`), via
`rewrites()` in `next.config.ts`.

## One source of truth

The HTML spec sheet, the JSON-LD `additionalProperty`, the Markdown table, llms-full.txt and an MCP server's
product detail all render the same `SpecRow`s. Build them in one module (`spec-text.ts`), and the five readers
can't disagree about a value, a unit or whether a feature is stated.
