---
name: agentic-commerce
description: >
    Let AI agents shop a Crystallize store: a shopper-facing MCP server (search, product detail, cart, checkout) on
    Discovery and the Shop API, typed-spec filters parsed from the shopper's words, "Did you mean" suggestions,
    baskets handed off by cartId, checkout as a destructive tool, OAuth sign-in for the shopper, MCP Apps product
    cards with host detection, WebMCP tools and agentic forms in the store's own pages, and an on-site shopping
    assistant, all ranked by the shopper's taste. Use when building an MCP server or connector for a shop, making a
    store usable from Claude, ChatGPT, Gemini in Chrome or another agent, adding agent checkout or a hand-off to the
    browser, declaring WebMCP tools, or building a chat assistant on the catalogue. Trigger on "MCP server", "MCP
    connector", "shopping agent", "agentic commerce", "agent checkout", "AI assistant", "chat assistant",
    "conversational commerce", "tools for Claude", "ChatGPT apps", "MCP Apps", "ui://", "structuredContent",
    "updateModelContext", "callServerTool", "WebMCP", "navigator.modelContext", "document.modelContext",
    "toolname", "agentic forms", "useWebMCP", "OAuth for MCP", "protected resource metadata", "DCR", "CIMD",
    "PKCE", "cartId", "hand-off", "destructiveHint", "readOnlyHint", "Did you mean".
metadata:
    author: Crystallize
    version: "1.0"
---

# Agentic Commerce on Crystallize

Agents shop a store in three places: a **remote MCP server** that Claude, ChatGPT and other hosts connect to; **WebMCP**
tools in the shopper's own browser tab; and an **on-site assistant** in the store. All three run on the same
code as the storefront: Discovery for the catalogue and ranking, the Shop API for baskets, orders and bookings. No
Core, no extra state.

This is the active half. Being found and quoted (JSON-LD, llms.txt, Markdown twins, crawlers) is in [[seo-geo]];
the storefront it runs inside is [[storefront]].

> Built and running on two Crystallize stores, Tools Universe (18 tools, typed ETIM specs, rentals) and Photo
> Store (15 tools, typed lens and camera specs), September–November 2026, on Next.js 16 and the MCP TypeScript SDK
> with `@modelcontextprotocol/ext-apps`. WebMCP is designed but not shipped by either: it is an early preview
> behind a Chrome flag.

## Three surfaces, one code path

|                    | Remote MCP server                                     | WebMCP                                                            | On-site assistant                       |
| ------------------ | ----------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------- |
| Agent              | Claude, ChatGPT, VS Code, any MCP host                | The agent in the shopper's browser (Gemini in Chrome, extensions) | Your own model loop, in the store's UI  |
| Where it runs      | `app/api/mcp/route.ts`, stateless Streamable HTTP     | The store's pages                                                 | `app/api/assistant/route.ts`, streaming |
| Who the shopper is | OAuth access token (optional, lazy)                   | The page's session (cookies)                                      | The page's session                      |
| Basket             | `cartId` passed between calls, a hand-off link to pay | The page's cart cookie                                            | The page's cart cookie                  |
| Results            | MCP Apps cards, else Markdown with links              | The page updates as the agent works                               | The store's own product cards           |

Use **the same tool names and arguments** on all three (snake_case: `search_products`, `get_product`,
`add_to_cart`, `view_cart`, `checkout`), so an agent that knows one surface knows the others. Call the same
server-side functions the storefront's actions call.

## What an agent needs from the model

- **Typed specs.** Numbers with units, booleans and selections, not a label/value table. Discovery indexes each as
  its own filter field: a numeric in a nested piece is `<component>_<piece>_<field>_number`, a boolean is
  `<…>_<field>`, and each selection option is its own field `<…>_<field>_<optionKeyCamel>` filtered with
  `exists: true`. "18V impact driver over 200 Nm" then becomes three hard filters instead of a fuzzy text match
  where 12 V and 150 Nm score almost as well. See [[content-model]] and [[query]].
- **One unit per numeric** where possible: Discovery range filters ignore the unit.
- **Unset booleans read `false`.** An agent filter for "without Bluetooth" must not match products that just
  don't say.
- **Taxonomy topics** for product types, brands, platforms, trades, in every language: they are what the parser
  matches words against, from Discovery facets.
- **A taste vector** per shopper for ranking: rebuilt from Shop API order history per call, sent as
  `context.userTaste`, with `{ signal: relevance }` added when there is a text term ([[vector-ranking]]).

## The MCP server, in short

- Stateless: every request builds a fresh server; nothing is stored. Every tool takes `lang`, which sets market,
  currency, VAT and links.
- **Search parses the shopper's words** into typed-spec, platform, brand and type filters, generated from the
  content model, not from a word list; what is left goes to fuzzy text. When filters plus leftover words find
  nothing, rerun without the words.
- **"Did you mean"**: up to four suggestions, each with the exact arguments to run it, when the words missed,
  matched far too much, or a spec was too strict.
- **Server instructions** tell the model to show products only through tool calls, never as prose lists or
  hand-built links.
- Annotations on every tool: reads are `readOnlyHint: true`; `checkout` is `destructiveHint: true`.

Tool list, the parser and the instructions: [references/mcp-server.md](references/mcp-server.md).

## Checkout rules

- **Prefer the hand-off.** The basket tools return a `checkoutUrl` that opens the basket in the shopper's browser,
  where they review and pay. `checkout` places the order directly, and is only called when the shopper explicitly
  asks.
- **`checkout` is destructive** (`destructiveHint: true`), so hosts ask before running it.
- **Signed-in limits.** Invoice and quote checkout only for a signed-in trade buyer, after the same credit check
  the storefront does. A guest card order needs the shopper's email and name: the tool asks for them rather than
  inventing them.
- **The same Shop API flow** as the storefront: `setCustomer`, `setMeta`, `place`, `confirmCartBooking`,
  `createFromCart` with pipelines and payments, `confirmCartBooking` again once `cart.orderId` is set. See
  [[storefront]] `references/cart-checkout.md`.
- **A real payment never happens inside the conversation** in these builds: card orders in the demos are recorded
  as paid. A production store hands off to its payment page ([[payments]]).

## Baskets without sessions

A conversation has no cookies. `add_to_cart` without a `cartId` creates a basket and returns its id; later basket
calls pass it back. The hand-off route adopts it in the browser:

```ts
// app/mcp/cart/route.ts: `checkoutUrl` = /mcp/cart?id=…&lang=…&as=…
export async function GET(request: NextRequest) {
    const q = request.nextUrl.searchParams;
    const lang = isLang(q.get("lang") ?? "") ? (q.get("lang") as Lang) : "en";
    const id = q.get("id");
    const jar = await cookies();
    const { cart } = id
        ? await shop<{ cart: { id: string; state: string } | null }>(
              `query($id: UUID!) { cart(id: $id) { id state } }`,
              { id },
          ).catch(() => ({ cart: null }))
        : { cart: null };
    if (cart?.state === "cart") {
        // A signed-in conversation's link carries a signed note (`as`) of the shopper, bound to this cart.
        const claims = q.get("as") ? await readHandoff(q.get("as")!, siteUrl(request)) : null;
        if (claims?.cart === cart.id) signInAs(jar, claims.sub); // keeps the company's prices and invoice checkout
        jar.set("cart", cart.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    }
    return Response.redirect(new URL(`/${lang}/cart`, siteUrl(request)), 303);
}
```

Two more hand-off routes: `/mcp/view?skus=…` (the store's own cards for a list of SKUs, for hosts without MCP
Apps) and `/mcp/buy?sku=…` (add one variant to this browser's basket). Keep `/mcp/*` hand-off routes out of the
language proxy and disallowed in robots.txt.

## Sign-in

Search, product detail and the basket work without an account. Tools that act for a shopper (`whoami`,
`my_orders`, `recommendations`, bookings) need an OAuth access token: the route answers **401 with
`WWW-Authenticate: resource_metadata=…`** for those tools only, and the host starts sign-in. Once signed in, every
ranking uses the shopper's taste, prices follow their price lists and VAT display, and baskets belong to their
customer.

The Crystallize MCP server's own OAuth tokens work only on Core, so a shop still needs an identity provider for
shoppers. The demos run a small stateless authorization server where "signing in" picks a demo customer:
[references/oauth.md](references/oauth.md).

## Product cards (MCP Apps)

Tools that return products point at a UI resource (`_meta.ui.resourceUri`); hosts that support MCP Apps render it
as cards under the tool call, with **Add to basket** buttons that call the same tools. The text result depends on
the host: hosts that render cards get a short "N cards rendered, don't repeat them" text, the others get
Markdown with a link to `/mcp/view` and an Add-to-basket link per product. Claude's hosted apps render cards but
identify as `Claude-User` rather than declaring the capability. Details:
[references/mcp-apps.md](references/mcp-apps.md).

## WebMCP (early preview)

WebMCP lets a page declare its own tools to the browser's agent. **Early preview: Chromium 146+ behind
`chrome://flags/#enable-webmcp-testing`**, under a draft Community Group spec; no major browser supports it
natively yet. The declarative form attributes are ignored elsewhere, so they are safe to ship now; imperative tools
feature-detect first. Add `toolname`/`tooldescription` to the search and add-to-basket forms, never
`toolautosubmit` on a financial form, and register imperative tools (filters, product, cart) with read-only and
consequential hints. Prerequisites: labelled native controls, live-region errors and security headers.
[references/webmcp.md](references/webmcp.md).

## On-site assistant

A streaming model loop over the store's own tools, answered as NDJSON to a drawer: text deltas, tool status, and
product rails rendered as the store's own cards. Small, fast model by default, low effort, prompt caching on the
rules and taxonomy, the last round without tools so the reply always ends in words.
[references/on-site-assistant.md](references/on-site-assistant.md).

## Pitfalls

| Symptom                                              | Cause                                                          | Fix                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Agent recommends 12 V when asked for 18 V            | Specs searched as text                                         | Parse the words into typed-spec filters                              |
| "Without X" returns products that don't mention X    | Unset booleans read `false`                                    | Treat `false` as not stated; filter on `true` or on the option field |
| Model lists products in prose under rendered cards   | Text result repeats the cards                                  | Detect UI hosts; thin text result; server instructions               |
| Model builds its own `/mcp/view` links or tables     | Instructions don't forbid it                                   | "The only way to show products is a tool call"                       |
| Hosts never prompt for sign-in                       | Auth error returned from inside a tool handler                 | 401 with `WWW-Authenticate` from the HTTP route, before the SDK      |
| Basket lost between calls                            | Cookie-based cart in a conversation                            | `cartId` in every basket tool; hand-off link to adopt it             |
| Signed-in basket re-priced as a guest in the browser | Hand-off link without the shopper                              | A signed, cart-bound `as` note on `checkoutUrl`                      |
| Order placed without the shopper asking              | `checkout` not marked destructive, or described as the default | `destructiveHint: true`; describe the `checkoutUrl` as the default   |
| Taste ranking ignores the query                      | `rankBy` without `relevance`                                   | Add `{ signal: relevance }` when there is a term                     |
| Cards show no images                                 | Media host missing from the resource CSP                       | `resourceDomains: [site, "https://media.crystallize.com"]`           |
| OAuth consent popup can't report back                | `Cross-Origin-Opener-Policy: same-origin` on the OAuth pages   | Exclude the OAuth routes from COOP                                   |

## Live examples

- [tools-universe.superfast.shop/en/mcp](https://tools-universe.superfast.shop/en/mcp): connect Claude to the
  store; the 18 tools, typed-spec parsing in four languages, rentals, OAuth demo sign-in, MCP Apps cards. The MCP
  endpoint is `/api/mcp`.
- [photo-store-vector.superfast.shop/llms.txt](https://photo-store-vector.superfast.shop/llms.txt): a store with an
  MCP server, lens-spec parsing and a per-shopper vector ranking.
- More, by capability (`ai-agent`, `agent-checkout`): [superfast.shop/demos.json](https://superfast.shop/demos.json).

## References

| File                                                               | Read it when                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [references/mcp-server.md](references/mcp-server.md)               | Building the MCP endpoint, its tools, instructions, spec parser, "Did you mean" |
| [references/oauth.md](references/oauth.md)                         | Shopper sign-in: lazy 401, RFC 9728/8414 metadata, DCR, CIMD, PKCE              |
| [references/mcp-apps.md](references/mcp-apps.md)                   | Product cards, host detection, the resource CSP, `updateModelContext`           |
| [references/webmcp.md](references/webmcp.md)                       | Browser-side tools and agentic forms (early preview)                            |
| [references/on-site-assistant.md](references/on-site-assistant.md) | A chat assistant in the store on the same tools                                 |

## Related skills

[[storefront]] for the Discovery and Shop API code these tools call, and the checkout flow; [[seo-geo]] for the
passive half; [[vector-ranking]] for taste and `rankBy`; [[content-model]] and [[taxonomy]] for typed specs and
topics; [[payments]] for the payment page the hand-off leads to; [[bookable-resources]] for bookings.
