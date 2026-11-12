# A shopper-facing MCP server on Discovery and the Shop API

A Model Context Protocol server inside the storefront, at `/api/mcp`. Claude (web, desktop, mobile, Claude Code),
ChatGPT, VS Code and other MCP hosts connect to it as a custom connector. It reads only Discovery and the Shop
API, keeps no state, and calls the same functions as the storefront's server actions.

This is a shopper's server, not the Crystallize MCP server (which is for developers working on a tenant).

Code is trimmed from two working stores on `@modelcontextprotocol/server` and
`@modelcontextprotocol/ext-apps`, Next.js 16.

## Layout

| Piece                                           | Where                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| Endpoint (Streamable HTTP, stateless)           | `app/api/mcp/route.ts`                                               |
| Tools, resources, prompt, server instructions   | `lib/mcp/server.ts`                                                  |
| Question → filters (typed specs, brands, types) | `lib/mcp/understand.ts`, a pure module with unit tests               |
| "Did you mean" suggestions                      | `lib/mcp/suggest.ts`, pure, unit-tested                              |
| Search, cards, detail, basket views             | `lib/mcp/catalogue.ts`                                               |
| Basket and order operations without cookies     | `lib/mcp/shop.ts`, the same Shop API calls as the server actions     |
| MCP App (cards)                                 | `lib/mcp/ui.ts`, client bundle served from the store                 |
| OAuth                                           | `lib/mcp/{auth,env,metadata}.ts`, `app/oauth/*`, `app/.well-known/*` |
| Hand-off pages                                  | `app/mcp/{view,buy,cart}`                                            |
| Spec model for the parser                       | A JSON file generated from the content model                         |

Keep `/api/*`, `/oauth/*`, `/.well-known/*` and `/mcp/{view,buy,cart}` out of the language proxy.

## The endpoint

Stateless Streamable HTTP: every request builds a fresh server from a factory, so it runs on serverless functions.
The route parses the body itself, so it can answer 401 for protected tools before the SDK sees the request
(see [oauth.md](oauth.md)), and adds CORS, because hosts call from their own origins:

```ts
import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";

export const maxDuration = 60;

const handler = createMcpHandler((ctx) => buildServer({ authInfo: ctx.authInfo, site: siteUrl(ctx.requestInfo) }), {
    onerror: (error) => console.error("[mcp]", error),
});

const CORS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
    "Access-Control-Max-Age": "86400",
};

async function serve(req: Request): Promise<Response> {
    let parsedBody: unknown;
    if (req.method === "POST") {
        const text = await req.text();
        try {
            parsedBody = text ? JSON.parse(text) : undefined;
        } catch {
            return withCors(
                Response.json(
                    { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null },
                    { status: 400 },
                ),
            );
        }
        req = new Request(req.url, { method: req.method, headers: req.headers, body: text }); // the body was consumed
    }
    const authInfo = await bearer(req); // verified access token, or undefined; an invalid one answers 401
    if (!authInfo && callsProtectedTool(parsedBody)) return challenge(req, "Sign in to use this tool");
    return withCors(await handler.fetch(req, { authInfo, parsedBody }));
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
```

## Tools

Every tool takes `lang`, which sets market, currency, price variant, VAT, names and links. Without it, a signed-in
shopper gets their own market and everyone else the default.

| Tool                                     | Does                                                                                                                                                | Annotations                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `search_products`                        | Free text plus `category`, `brand`, `topics`, structured `specs`, stock and price bounds. Words become filters (below). Cards, facets, suggestions  | `readOnlyHint`                 |
| `show_products`                          | Cards for an explicit list of SKUs, in order: the model's own shortlist                                                                             | `readOnlyHint`                 |
| `get_product`                            | One product by SKU or path (any language): every variant with SKU, price, volume price, stock; the typed spec sheet; the packshot as an image block | `readOnlyHint`                 |
| `similar_products`                       | `nearestTo` in a vector vocabulary                                                                                                                  | `readOnlyHint`                 |
| `list_categories`, `list_brands`         | The taxonomy with counts, in the market's language, with the ids the search accepts                                                                 | `readOnlyHint`                 |
| Domain tools                             | Whatever the catalogue needs: battery platforms and what fits a tool, rentals and availability, campaigns                                           | `readOnlyHint` for reads       |
| `add_to_cart`                            | Adds a variant by SKU; creates a basket when there is no `cartId`; returns the basket with `cartId` and `checkoutUrl`                               | not read-only, not destructive |
| `update_cart_line`                       | Sets a quantity; 0 removes the line (and cancels a booking)                                                                                         | `idempotentHint`               |
| `view_cart`                              | Lines, bookings, totals, `checkoutUrl`                                                                                                              | `readOnlyHint`                 |
| `suggest_add_ons`                        | Accessories and consumables for what is in the basket                                                                                               | `readOnlyHint`                 |
| `checkout`                               | Places the order, with the storefront's checkout flow                                                                                               | **`destructiveHint`**          |
| `whoami`, `my_orders`, `recommendations` | Signed in only: the shopper, their orders, their personal ranking                                                                                   | `readOnlyHint`                 |

Register tools that return products as MCP App tools ([mcp-apps.md](mcp-apps.md)):

```ts
const langArg = z
    .enum(["en", "no", "sv", "nl"])
    .optional()
    .describe("Market and language: en (EUR), no (NOK), sv (SEK), nl (EUR). Prices, names and links follow it.");
const cartIdArg = z
    .string()
    .uuid()
    .optional()
    .describe("Basket id from an earlier add_to_cart call, so items land in the same basket.");

registerAppTool(
    server,
    "search_products",
    {
        title: "Search products",
        description:
            "Search the catalogue. Put the user's words in `query` as they are: numbers with units ('18V', 'over 60 Nm', 'under 2 kg'), option and yes/no names, brands and product types become hard filters on the typed specs and the taxonomy; the remaining words are a typo-tolerant text search. Returns product cards, facets and 'Did you mean' suggestions with ready-made arguments.",
        inputSchema: z.object({
            query: z.string().min(1).max(160).optional(),
            category: z.string().optional(),
            brand: z.string().optional(),
            topics: z
                .array(z.string())
                .max(4)
                .optional()
                .describe(`Taxonomy filters. Valid ids — ${topicHint(vocab)}.`),
            specs: z
                .array(
                    z.object({
                        field: z.string().describe("'<group>.<field>', e.g. 'drilling.torqueHard', 'power.voltage'."),
                        gte: z.number().optional(),
                        lte: z.number().optional(),
                        equals: z.union([z.boolean(), z.number(), z.string(), z.array(z.string())]).optional(),
                        unit: z.string().optional(),
                    }),
                )
                .max(6)
                .optional()
                .describe(`Typed spec filters, all of which must hold. Groups and fields — ${SPEC_HINT}.`),
            inStockOnly: z.boolean().optional(),
            priceMin: z.number().optional(),
            priceMax: z.number().optional(),
            limit: z.number().int().min(1).max(24).optional(),
            lang: langArg,
            cartId: cartIdArg,
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
        _meta: { ui: { resourceUri: UI_RESOURCE_URI } },
    },
    async (args, tool) => {
        /* resolve arguments, understand the words, search, suggest — below */
    },
);

server.registerTool(
    "checkout",
    {
        title: "Place order",
        description:
            "Place the basket as an order. mode: card (anyone; a guest needs email and name), invoice or quote (signed-in trade buyers). Prefer giving the user the checkoutUrl unless they explicitly ask you to order now.",
        inputSchema: z.object({
            cartId: z.string().uuid(),
            mode: z.enum(["card", "invoice", "quote"]).optional(),
            email: z.string().email().optional().describe("Guest checkout only."),
            name: z.string().max(80).optional().describe("Guest checkout only."),
            reference: z.string().max(80).optional().describe("Order reference / PO number."),
            lang: langArg,
        }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ cartId, mode, email, name, reference, lang }) => {
        const ctx = await ctxFor(lang);
        const r = await placeOrder(ctx, cartId, mode ?? (ctx.session?.trade ? "invoice" : "card"), {
            email,
            name,
            reference,
        });
        if (!r.ok) return textResult(r.error, undefined, true); // e.g. "A guest order needs the shopper's email and name. Ask the user."
        return textResult(`Order **${r.orderId}** placed: ${money(r.gross, ctx.lang)}.`, {
            kind: "order",
            orderId: r.orderId,
        });
    },
);
```

- **Errors are answers the model can act on**, with `isError: true`: "Unknown brand "milwauke". Brands: …", "Invalid
  specs filter: …, valid fields: …". Validate arguments against the vocabulary and say what is valid.
- **The tool description lists the spec fields** (generated, compact: `drilling: torqueHard Nm, hammerMode y/n,
  toolHolder [sds-plus|sds-max]`), and the topic ids. The model then knows what it can ask for.
- **The vocabulary read must not take the server down.** Catch it and fall back to empty lists.

## Server instructions

Instructions go to the model with the tool list. The ones that changed behaviour most (from both stores):

```
Language and market: every tool takes lang. Pick it from the user's language or country and keep it for the whole
conversation; prices, VAT rate, product names and links follow it.

Specifications are typed numbers, yes/no and options, and search_products filters on them: write the user's words
into query as they are. Never filter or compare specs from memory; the result titles name the filters that were
applied.

Imprecise questions: search results may carry "Did you mean" suggestions. When the question was vague, matched
nothing or matched far too much, offer two to four of them as a one-line question and run the one the user picks
(the arguments are given). When the result already answers the question, just answer.

Showing products: whenever you recommend, compare or shortlist products — even ones you already have from an
earlier call — call a tool so the interactive cards render: search_products for a new query, or show_products with
the SKUs for your own picks. Never answer a product question with a prose list alone.

Presenting results: the only way to show products is a tool call. Never build /mcp/view links or product tables
yourself. Hosts that support MCP Apps draw each result as cards; your reply then adds one or two sentences — the
pick and why — and must not repeat names, prices, SKUs or stock. If a result says "cards rendered", you are on such
a host. Otherwise start your reply with the result's "See ... with pictures →" link and present each product as
**[name](url)**, SKU, price, availability and [Add to basket](buyUrl); never use markdown images.

Basket: add_to_cart returns a cartId. Pass it to later basket calls so everything lands in one basket. Give the
user the checkoutUrl to finish in the store; only call checkout when they explicitly ask you to place the order.

Sign-in: search, details and the basket work without an account. whoami, my_orders and recommendations need the
shopper to sign in (the host will prompt).
```

Start with one paragraph on what the store sells and to whom, and add domain rules (versions, compatibility,
rentals) as the catalogue needs.

## Typed specs from the shopper's words

A free-text search for "18V 5Ah" or "125 mm angle grinder" is a fuzzy token match where "12V", "8.0 Ah" and a 125
mm cutting disc score almost as well. Turn the words into the filters the index has, **generated from the content
model**, not from a word list:

1. Generate a spec model at build time: every spec field's type, units, decimals and options, and its labels in
   every content language. One store generates it from its seed model, another from shared spec definitions.
2. **Numbers with units** ("18V", "5,0 Ah", "over 60 Nm", "under 2 kg", "100–200 mm", "minst 8 Ah") go to the fields
   that carry the unit. When several do (mm, kg, Nm), the field-label words in the question decide ("blade diameter
   190 mm"), then the spec families of the product type it names, then the shared pieces; what is still open is an
   OR across the candidates.
3. **A bare value is a ±3 % band** (18 V is not 20 V); comparators in every language ("over", "minst", "meer
   dan", "under", "høyst") make it a bound.
4. **Options and yes/no** match their labels in any language ("SDS-plus", "M class", "brushless", "with hammer
   mode"); a negation ("uten Bluetooth", "without") flips them.
5. **Brands, product types, platforms** match the catalogue's own translated taxonomy (Discovery facets per
   language).
6. **What is left** goes to Discovery's fuzzy text search, ranked with `relevance` plus the house and taste terms.
   If the filters plus leftover words find nothing, rerun without the words: the filters alone are the better
   answer.
7. Offer a structured `specs` argument too, for models that want to be explicit; explicit arguments win.

Discovery's filter names for typed fields, and the filter for one parsed constraint:

```ts
export const optionId = (key: string) =>
    key.replace(/-([a-z0-9])/g, (_, c: string) => (/\d/.test(c) ? `_${c}` : c.toUpperCase()));
const base = (key: string) => key.replace(/\./g, "_");

/** "specs.drilling.torqueHard" → specs_drilling_torqueHard_number; option "sds-plus" → specs_drilling_toolHolder_sdsPlus */
export function filterName(field: Field, option?: string) {
    if (field.type === "number") return `${base(field.key)}_number`;
    if (field.type === "option") return `${base(field.key)}_${optionId(option ?? "")}`;
    return base(field.key);
}

function partFilter(p: Part): Record<string, unknown> {
    const f = p.field;
    if (f.type === "boolean") return { [filterName(f)]: { equals: p.bool !== false } };
    if (f.type === "option") {
        const opts = (p.options ?? []).map((o) => ({ [filterName(f, o)]: { exists: !p.negate } }));
        return opts.length === 1 ? opts[0] : p.negate ? { AND: opts } : { OR: opts };
    }
    return {
        [filterName(f)]: { range: { ...(p.gte != null && { gte: p.gte }), ...(p.lte != null && { lte: p.lte }) } },
    };
}

/** A bare number: about this value, ±3 % (at least half a step of the field's precision). */
function about(v: number, field: Field) {
    const step = 10 ** -(field.decimals ?? 0);
    const tol = Math.max(v * 0.03, step / 2);
    return { gte: v - tol, lte: v + tol };
}

/** AND across constraints, OR across the parts of one (the same words on several fields). */
export const constraintFilters = (constraints: Constraint[]) =>
    constraints.map((c) => (c.parts.length === 1 ? partFilter(c.parts[0]) : { OR: c.parts.map(partFilter) }));
```

Check the generated names against your tenant's Discovery schema (`ToolFilter`, `ProductFilter`, …): they follow
the component, piece and field identifiers. A field measured in several units (airflow in m³/h or l/s) can't be
range-filtered in one unit, because range filters ignore the unit: match each convertible unit and check the hits.

## The search query

```ts
const ranking = term ? { ...base, terms: [{ signal: "relevance", weight: 2 }, ...base.terms] } : base;
const data = await discovery(
    `query McpTools($term: String!, $filters: ToolFilter, $facets: ToolFacet, $rankBy: RankByInput, $context: ContextInput, $limit: Int!, $skip: Int!) {
       browse { tool(language: ${lang}, term: $term, options: { fuzzy: { fuzziness: SINGLE } }, filters: $filters, facets: $facets,
                     rankBy: $rankBy, context: $context, pagination: { limit: $limit, skip: $skip }) {
         summary { totalHits facets } hits { score rankScore ${CARD} } } } }`,
    {
        term,
        filters: { AND: [...constraintFilters(constraints), ...topicFilters] },
        facets: { topics: { key: "topics", limit: 200 } },
        rankBy: ranking,
        ...(taste?.length ? { context: { userTaste: taste } } : {}), // omit, never null
        limit,
        skip,
    },
);
// With words, a hit scoring 0 only matched through a filter: noise.
const hits = term ? data.browse.tool.hits.filter((h) => (h.score ?? 0) > 0) : data.browse.tool.hits;
```

`rankBy`, `context` and the taste vector are covered in [[vector-ranking]]. When the shopper is signed in, rebuild
the taste from their Shop API order history per call (cached per customer), never from a stored profile.

## "Did you mean"

For imprecise questions, return up to four suggestions, each with the exact `search_products` arguments that run
it:

- **Nothing matched**: a word is probably misspelt ("vinkelslipr", "milwauke") → the closest product type, brand or
  platform (edit distance against the vocabulary); or a spec was too strict → the same search without it, or "at
  least" instead of "about".
- **Far too much matched** ("drill") → the facets that split the result best: product types, brands, platforms,
  trades.
- **Nothing in the corner the filters picked** → the words across the whole store.

```ts
export type Suggestion = {
    label: string;
    why: "spelling" | "relax" | "narrow" | "widen";
    args: Record<string, unknown>;
};

export function suggestionsMarkdown(list: Suggestion[]): string {
    if (!list.length) return "";
    return (
        "\n\nDid you mean? Offer these to the user as a short question (if the question was imprecise), then call search_products with the chosen arguments:\n" +
        list.map((s) => `- ${s.label} → \`${JSON.stringify(s.args)}\``).join("\n")
    );
}
```

Keep the base arguments (`lang`, `limit`) in each suggestion's `args`, and drop `cartId`. The cards widget shows
the suggestions as chips.

## Results the model can't misuse

- Every product carries its `url` (the storefront page in the market's language), `buyUrl`
  (`/mcp/buy?sku=…&lang=…`) and, for lists, a `viewUrl` (`/mcp/view?skus=…`).
- `get_product` also returns the packshot as an `image` content block (WebP, about 500 px, under 1.5 MB). Hosts
  show it inline even without MCP Apps.
- Prices say their currency and whether they are incl. or excl. VAT.
- Titles name the filters that were applied ("Results for impact driver · 18 V · ≥ 200 Nm"), so the model can
  tell the user what it searched for.

## Resources and prompts

- `store://spec-fields`: every filterable spec field with type, units and options (the same text as the tool
  description hint).
- `store://how-it-works`: Markdown on typed specs, ranking and prices.
- A prompt that guides a job to a basket (`kit-out` with a `job` argument; `shop-for` with a `need`).
- The MCP App resource ([mcp-apps.md](mcp-apps.md)).

## Testing

```bash
claude mcp add --transport http my-store http://localhost:3000/api/mcp
claude -p "Find an 18V impact driver over 200 Nm from the my-store server, priced for Norway"
npx @modelcontextprotocol/inspector   # against the local endpoint
```

- **Unit tests** (`node:test`) on the pure modules: question → filters in every language, structured spec
  arguments, multi-unit checks, "Did you mean".
- **A smoke test** against a running server: discovery documents, the 401 gate, searches in each language,
  details, basket and hand-off, the UI resource, DCR + PKCE + consent + token + signed-in calls. Don't place real
  orders from it; check that checkout asks a guest for their details.
- **Claude.ai and other hosted apps** need a public URL (a deployment, or a tunnel such as `cloudflared tunnel
  --url http://localhost:3000`): add `https://<host>/api/mcp` as a custom connector, with "Sign in when needed".
