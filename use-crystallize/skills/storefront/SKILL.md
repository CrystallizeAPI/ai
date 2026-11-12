---
name: storefront
description: >
    Build a storefront (web shop, B2B portal, catalogue site, headless frontend) on Crystallize: which API to call
    for each task (Discovery for every catalogue read, the Shop API for carts, customer prices, checkout, orders,
    bookings and subscriptions, Catalogue and Core only where named), which tokens and scopes each needs and what
    may run in the browser, the request path of category, product, search, cart and checkout pages, caching
    Discovery reads and revalidating on publish, translated paths and language/market routing, B2B contract prices
    against a public Discovery, draft preview in Crystallize custom views, performance, accessibility and security
    headers. Use when starting or reviewing any frontend, choosing between Discovery, Catalogue, Core and the Shop
    API, wiring Next.js, Remix, Astro, Nuxt or another SSR app to Crystallize, or debugging slow pages, wrong
    prices, missing orders, a stale page after publish or a broken page after a model change. Trigger on
    "storefront", "frontend", "headless", "web shop", "PLP", "PDP", "product listing", "product page", "category
    page", "cart drawer", "checkout", "Discovery API", "Shop API", "which API", "use cache", "cacheTag",
    "revalidateTag", "revalidate on publish", "webhook", "preview", "draft", "draft mode", "custom view",
    "publicationState", "hreflang", "i18n routing", "market", "B2B price", "contract price", "variantGroups",
    "variant(selected", "Core Web Vitals", "LCP", "accessibility", "security headers", "CSP", "Next.js", "Cache
    Components", "PPR".
metadata:
    author: Crystallize
    version: "1.0"
---

# Crystallize Storefront

A Crystallize storefront reads the catalogue from **Discovery** and does everything about a shopper on the
**Shop API**. Nothing else is in the request path. That one rule settles most design questions, and breaking it
is behind most of the slow pages, wrong prices and missing orders seen in real builds.

This skill is the workflow: the contract, the request path per page type, and the rules that keep cached pages
correct. The query and mutation details live in [[query]] and [[mutation]]; prices in [[pricing]]; payment in
[[payments]]. Detail for this skill is in `references/`.

> Drawn from seventeen Crystallize storefront builds (September–November 2026, Next.js 16 with Cache Components
> on Vercel, all on Discovery and the Shop API). Draft reads through Discovery were verified on 2026-11-12: on an
> open Discovery, `publicationState: draft` returned the same 541 drafts with and without credentials. Where a
> claim comes from one build, it says so.

## The contract in five lines

1. **Discovery: every catalogue read.** Item by path, browse, search, typeahead, facets, variant groups,
   translated paths, list and market prices, stock per location, ranking and similarity. Published content by
   default; drafts with `publicationState: draft` (on an open Discovery, to anyone). Eventually consistent.
2. **Shop API: everything about a shopper.** Carts, the price for this customer and market, promotions and
   vouchers, `place`, orders, payments, pipeline stages, the shopper's order history, customers, bookings,
   subscription contracts, locks.
3. **Catalogue API: a fallback for one named task.** Per-customer price lists for display
   (`priceFor(customerIdentifiers)`), server-side. Not for path lookups, preview or hreflang: Discovery does
   those.
4. **Core API: never in the request path.** Seeding, imports, scheduled jobs, webhooks, admin tools behind staff
   login. It is rate limited.
5. **Legacy PIM API: setup only.** Markets, VAT types, pipelines, stock locations, tenant defaults.

The full decision table (task → API → call → token → where) is in
[references/api-contract.md](references/api-contract.md).

## Credentials, and what may run in the browser

| API       | Endpoint                                                            | Credential                                                                                              | From the browser?                                                                                                   |
| --------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Discovery | `https://api.crystallize.com/{tenant}/discovery`                    | None when open (the default); `X-Crystallize-Static-Auth-Token` when restricted                         | Yes if open, and then **everything it serves is public**: every price variant, every market price list, every draft |
| Shop API  | `https://shop-api.crystallize.com/{tenant}/{cart,order,customer,…}` | A JWT from `POST …/{tenant}/auth/token`, minted with an access token pair that is **not tenant-scoped** | **No.** Server only. The browser holds the cart id, in an httpOnly cookie                                           |
| Catalogue | `https://api.crystallize.com/{tenant}/catalogue`                    | Open, static token or token pair, per tenant setting                                                    | Only open, published reads; contract prices are server-only                                                         |
| Core      | `https://api.crystallize.com/@{tenant}`                             | Token pair                                                                                              | Never                                                                                                               |

- **The Shop JWT is per tenant, not per shopper.** Cache it on the server and refresh it before it expires. The
  API default is one day; `@crystallize/js-api-client` defaults to 12 hours. An expired or rejected token
  answers 401 with `{ success: false }` and no `errors`: drop the cached token and retry once.
- **Ask for the scopes you use**: `cart`, `cart:admin`, `order`, `customer`, `subscription-contract`, `booking`,
  `booking:admin`, `lock`. `/booking/admin` needs **both** `booking` and `booking:admin`: a token with only
  `booking:admin` is refused with "Invalid Scopes". Mint a separate token for `subscription-contract`; a token
  carrying every scope was seen to lack subscription access silently.
- **The Shop API reads products from the Catalogue with the request's credentials.** On a tenant whose Catalogue
  requires a token, every hydrate needs it.
- Never put a token in a `NEXT_PUBLIC_*` (or any client-bundled) variable. See [[permissions]] for why a
  tenant-scoped token can't mint Shop tokens.

## Before you start

- [ ] The tenant is ignited for Discovery, and every component you render is `discoverable` (a
      non-discoverable component is simply absent from the schema). See [[query]].
- [ ] New shapes or components have been through an ignite and answer reliably: query a new field ten times in a
      row before shipping code that depends on it.
- [ ] You have an unscoped access token pair for the Shop API, server-side only.
- [ ] Languages, price variants, markets, VAT types and stock locations exist, and you know their identifiers
      (they become Discovery field names: `nokPrice`, `<location>Stock`).
- [ ] Find a reference implementation with the capabilities you need (below).

## Two small clients

Discovery, cached on the server, with retries on rate limits and gateway errors
(trimmed from a working Next.js 16 storefront):

```ts
import { cacheLife, cacheTag } from "next/cache";

const ENDPOINT = `https://api.crystallize.com/${process.env.CRYSTALLIZE_TENANT_IDENTIFIER}/discovery`;

export async function discovery<T>(
    query: string,
    variables: Record<string, unknown> = {},
    opts: { draft?: boolean } = {},
) {
    // Draft reads (editor preview) are never cached.
    return opts.draft ? request<T>(query, variables) : cached<T>(query, variables);
}

async function cached<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    "use cache: remote";
    cacheLife("hours");
    cacheTag("discovery"); // the publish webhook clears this tag
    return request<T>(query, variables);
}

async function request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    // Only on a restricted Discovery; an open one takes no credentials.
    const token = process.env.CRYSTALLIZE_STATIC_AUTH_TOKEN;
    if (token) headers["X-Crystallize-Static-Auth-Token"] = token;
    let json;
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
        const text = await res.text();
        try {
            if (res.status === 429 || res.status >= 500) throw new Error(`Discovery ${res.status}`);
            json = JSON.parse(text);
            break;
        } catch (e) {
            if (attempt >= 4) throw e;
            await new Promise((r) => setTimeout(r, 250 * 2 ** attempt + Math.random() * 200));
        }
    }
    if (json.errors) throw new Error(json.errors.map((e: { message: string }) => e.message).join("\n"));
    return json.data as T;
}
```

Shop API, server only, with the token cached in module scope:

```ts
const SHOP = `https://shop-api.crystallize.com/${process.env.CRYSTALLIZE_TENANT_IDENTIFIER}`;
let jwt: { token: string; expires: number } | null = null;

async function token() {
    if (jwt && jwt.expires > Date.now() + 60_000) return jwt.token;
    const res = await fetch(`${SHOP}/auth/token`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-crystallize-access-token-id": process.env.CRYSTALLIZE_ACCESS_TOKEN_ID ?? "",
            "x-crystallize-access-token-secret": process.env.CRYSTALLIZE_ACCESS_TOKEN_SECRET ?? "",
        },
        body: JSON.stringify({ scopes: ["cart", "order"], expiresIn: 18000 }),
    });
    const { token } = (await res.json()) as { token: string };
    jwt = { token, expires: Date.now() + 18000 * 1000 };
    return token;
}

export async function shop<T>(query: string, variables = {}, endpoint: "cart" | "order" = "cart"): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${SHOP}/${endpoint}`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${await token()}` },
            body: JSON.stringify({ query, variables }),
            cache: "no-store",
        });
        // A rejected token answers 401 with { success: false } and no `errors`: get a new one, once.
        if (res.status === 401 && attempt === 0) {
            jwt = null;
            continue;
        }
        const json = await res.json().catch(() => null);
        if (json?.errors) throw new Error(json.errors.map((e: { message: string }) => e.message).join("\n"));
        if (!res.ok || !json?.data) throw new Error(`Shop API ${endpoint}: HTTP ${res.status}`);
        return json.data as T;
    }
}
```

In Next.js with Cache Components, call `await connection()` at the top of `shop()` for anything per-shopper, so a
cart never ends up in a prerendered shell. See [references/nextjs-pitfalls.md](references/nextjs-pitfalls.md).

## The request path, per page type

### Any catalogue page (home, category, brand)

- [ ] Language and market come from the **path** (`/no/…`), not a cookie. A cookie market means crawlers only
      ever see the default market's prices.
- [ ] A server component reads Discovery through the cached client. Build variables in a fixed order (the cache
      key is query + variables).
- [ ] Per-shopper parts (taste-ranked rails, "shopping as", contract prices) stream behind `<Suspense>` with real
      content as the fallback, so the shell is complete without them.
- [ ] Card images ask for trimmed variants only (`variants(types: "webp", minWidth, maxWidth)`). Rails and menus
      skip `facets`, which cost about 17 KB per read.
- [ ] Look up the item by full path, never by the last segment: paths are unique only within their folder.

```graphql
query Resolve($path: String!) {
    search(language: en, filters: { path: { equals: $path } }) {
        hits {
            itemId
            shape
            name
        }
    }
}
```

### Product listing (PLP) with one card per colourway

`variantGroups` groups a product's variants by an attribute, so a listing card shows each colourway with its own
price range, stock and images, filtered to what the shopper asked for. It never removes a group or changes hits,
facets or paging: groups with a matching variant come first, the rest read `matched: false`. Trimmed from a
fashion build:

```graphql
colours: variantGroups(by: ["colour"], filter: $variantFilter) {
    matched
    attributes { value }
    summary {
        matchedInStock(location: "web")
        price: matchedPrice(variant: "default") { min max }
    }
    representative { sku }
    images { url width height variants(types: "webp", minWidth: 500, maxWidth: 768) { width } }
    sizes: values(of: "size") { value sku matched inStock(location: "web") }
}
```

`filter` is a `VariantFilterInput` (exact operators only). Attribute names and values are case-sensitive. Every
group's images come back, so image selection is most of the payload: trim it per context. See [[query]].

### Product detail (PDP)

- [ ] One `search(filters: { path: { equals } })` returns the product, variants, trimmed images, relations
      (already in the request's language), breadcrumbs (which end with the item itself) and typed specs.
- [ ] One aliased query by `itemId` gives the item's path in every language, for hreflang and the language
      switcher ([references/i18n-routing.md](references/i18n-routing.md)).
- [ ] The buy box resolves the chosen options with `variant(selected: [{ attribute, value }])`, the first variant
      carrying every pair, and passes its SKU to the cart. Stock comes from that variant's `<location>Stock`.
- [ ] List price from Discovery for everyone; the contract price from a cached server-side read for a signed-in
      buyer (below); booking availability from the Shop API, loaded after the product.
- [ ] JSON-LD and the Markdown twin come from the same typed rows. An unset boolean reads `false`: treat it as
      "not stated". See [[seo-geo]].

### Search results

`browse.<shape>(language, term: $term, options: { fuzzy: { fuzziness: SINGLE } }, sorting: { score: desc })`.
Drop hits with `score` 0 (they matched only through a filter), and widen to `DOUBLE` when nothing is left. When
the query also uses `rankBy`, add `{ signal: relevance }` or the term stops mattering ([[vector-ranking]]). The
search page is `noindex, follow`.

### Cart and checkout

The cart is a server action over Shop `hydrate`; checkout is `setCustomer` → `setMeta` → `place` → payment →
`createFromCart` in the payment webhook. Outline below; full flow in
[references/cart-checkout.md](references/cart-checkout.md).

## Caching and revalidation on publish

- Cache Discovery reads on the server, keyed on query + variables, tagged `discovery`.
- On publish, a Core webhook (`concern: "items"`, events `publish` and `unpublish`) calls a route that clears the
  tag. Page, JSON-LD, sitemap, Markdown twins and llms.txt then follow in one step. `concern: "item"` is
  accepted by `createWebhook` and never fires.
- Cached functions never throw a transient error into the cache: retry inside, and fall back to empty.
- Per-customer data (order history, taste, contract prices) is cached per customer or organisation and tagged so
  checkout can expire it (`updateTag`).
- Draft reads are never cached.
- Revalidation is billed on some hosts: one build found cache writes were most of its Vercel bill, and fixed it
  with `cacheLife('hours')` plus the webhook, and hover-only prefetch.

Code for the webhook route and its setup: [references/caching-and-revalidation.md](references/caching-and-revalidation.md).

## Translated paths and i18n routing

- Every URL starts with the language (`/en`, `/no`); the proxy redirects `/` from a cookie, then
  `Accept-Language`, then the default.
- Paths are translated per language, so match items across languages by `itemId`, never by slug.
- `<html lang>`, hreflang and schema.org use BCP 47 (`nb`), not the tenant's language code (`no`). Add
  `x-default`.

Details and code: [references/i18n-routing.md](references/i18n-routing.md).

## Cart and checkout UI

- **`hydrate` replaces the whole cart.** Send every line, every time; a booked line must come back with its
  `lineId`, `meta` and `booking`, or the reservation is released.
- The hydrate answer is the source of truth for the drawer. On a cart line, `price.net` is the **line total**;
  `variant.price.net` is the unit price.
- Price context on every hydrate: `currency`, `selectedVariantIdentifier`, `taxRate` as a fraction (`0.25`),
  `decimals: 4` (round for display only), `markets` for price lists, and the customer.
- Re-hydrate a stored cart when it is stale, was built in another language, or for another customer.
- Optimistic UI on top: show the line at once; the hydrate takes 200–400 ms.
- After `place` the cart is locked. If order creation then fails, the shopper needs a new cart.
- `createFromCart` moves the cart to `ordered`; there is no `fulfill` afterwards.
- New orders take seconds to minutes to appear in `orders(customerIdentifier)`: the confirmation page shows the
  order `createFromCart` returned, and says so.

## B2B prices against a public Discovery

An open Discovery serves every price variant and every market price list to anyone who knows the field name.
**Confidential terms never go there.**

| Need                                    | Where                                                                                                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List, sale, "from" price                | Discovery `<variant>Price`, `variantGroups.summary.price`                                                                                                                                     |
| Public market price                     | Discovery `<variant>PriceFor(marketIdentifiers)`, only for the SKUs on screen (about 1.4 s per 100 products per market)                                                                       |
| The buyer's contract price, in the cart | Shop `hydrate` with the organisation as customer and its price-list `markets` in the price context. Re-hydrate when the customer changes: price lists apply only to a cart hydrated with them |
| The buyer's contract price, on the page | Server-side, cached per organisation: a throw-away `hydrate` with the customer, or Catalogue `priceFor(customerIdentifiers)`                                                                  |

- The customer on a B2B cart is the **organisation** (orders belong to it); the person who ordered goes in cart
  meta.
- Target organisations by `customerIdentifiers` or markets. Customer-group price lists were reported failing
  with `CustomerGroupNotFoundError` on several tenants; see [[pricing]].
- Show incl. or excl. VAT per segment. Prices in Crystallize are usually net; the market decides currency,
  price variant and VAT rate.

## Draft preview

Draft preview is a Discovery read with `publicationState: draft`, done server-side behind the editor's preview
mode, and never cached. Editors open it from a **custom view** in the Crystallize App, which frames the storefront
next to the item. Setup, code and verification: [references/preview.md](references/preview.md).

- [ ] **Custom view** (Settings → Custom views): a URL template such as
      `https://shop.example.com/api/preview?secret=…&language={{language}}&itemId={{itemId}}&path={{itemPath}}`.
      Placeholders: `{{language}}`, `{{itemId}}`, `{{itemPath}}`, `{{itemExternalReference}}`, `{{variantSku}}`.
      See the [Custom views](https://crystallize.com/docs/pim/catalogue/custom-views) doc.
- [ ] **Always turn on "Show responsive device toolbar in preview".** The editor switches between mobile and
      desktop in the App's toolbar; the storefront only has to be responsive and adds no device buttons or
      preview chrome of its own.
- [ ] **A preview route** checks a secret, resolves the item's storefront URL from its **draft**, by item id and
      per language (paths are translated and have no `/{lang}` prefix), turns on preview mode (Next's
      `draftMode().enable()`) and redirects. Redirect only to a path Discovery returned.
- [ ] **Every Discovery read in preview mode adds `publicationState: draft`** (every field that takes `language`
      accepts it, nested `items`/`variants` included). In Next.js, read `draftMode().isEnabled` inside the
      `'use cache'` client: off while prerendering, so normal traffic stays cached; with the cookie nothing is
      saved.
- [ ] **No caching, `noindex`**, and the App's `frontend-preview-listener.js` loaded in preview mode only, so the
      view reloads when the editor saves.
- [ ] **Framing:** `frame-ancestors 'self' https://app.crystallize.com` on the preview route and preview-mode
      responses only; every other page keeps `X-Frame-Options: SAMEORIGIN`.
- [ ] **The preview cookie is `SameSite=None; Secure`** (it is set and read inside a third-party iframe), and
      `Partitioned`. Next's draft cookie is `Lax` in `next dev`: test the framed preview on a production build.
- **On an open Discovery every draft is public.** Anyone who sends `publicationState: draft` gets it, no
  credentials needed (verified 2026-11-12 on two tenants, including unpublished drafts read anonymously). The
  preview secret guards the preview mode, not the data. Don't keep confidential or embargoed content in drafts on
  an open tenant; if drafts must stay private, restrict Discovery and send the static token from the server.
- **Never render drafts to crawlers or the public.** Preview responses are `noindex` and uncached, the preview
  route is under a `Disallow`ed path and not in the sitemap, and nothing in the store links to it.

## Consistency the storefront has to live with

- **Discovery is eventually consistent.** `publishItem` answers before anything is indexed. New shapes and
  components need an ignite, and the new schema reaches the nodes over minutes; an error answered in that window
  can be cached per query body.
- **Discovery under load** answered HTTP 200 with `errors: [{ message: "Response Error" }]` after about 900
  prerendered pages in one build. Retry on that message, cap prerender concurrency, or render on demand.
- **The Shop order list is a second store.** Orders appear in `orders(customerIdentifier)` after seconds to
  minutes. Read by id for anything you just wrote; never use the listing for idempotency.
- **Explicit `null` in Discovery variables is rejected.** Leave the key out instead.

## Pitfalls

| Symptom                                     | Cause                                                                     | Fix                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Pages slow, 429s in logs                    | Core or PIM in the request path                                           | Discovery for reads, Shop API for the shopper                                                       |
| Contract prices visible to anyone           | Negotiated prices in a price variant or market list on an open Discovery  | Shop hydrate or Catalogue `priceFor`, server-side                                                   |
| Cart loses lines                            | `hydrate` sent only the changed line                                      | Send the whole cart every time                                                                      |
| Line total multiplied by the quantity again | `price.net` on a cart line is the line total                              | Use `variant.price.net` for the unit price                                                          |
| Order missing from the account page         | Order listing lag                                                         | Show the returned order; say history updates shortly                                                |
| Page stale after publish                    | No webhook, or `concern: "item"`                                          | `concern: "items"` → route that clears the `discovery` tag                                          |
| Page broke after a model change             | Schema not propagated; an error cached per query body                     | Ignite, wait for ten good answers, then ship                                                        |
| Embargoed product readable before launch    | Drafts on an open Discovery are public                                    | Restrict Discovery and use the static token, or keep it out of drafts                               |
| Crawlers see only the default market        | Market chosen by cookie                                                   | Language and market in the path                                                                     |
| Googlebot gets no `<title>` or canonical    | Dynamic metadata streamed into `<body>`; cached shell served to Googlebot | Cacheable metadata in the shell's `<head>` ([references/performance.md](references/performance.md)) |
| Search page fails for everyone              | An explicit `null` in Discovery variables                                 | Omit the key                                                                                        |
| `og:image` blank in link previews           | AVIF share image                                                          | Original format (JPEG/PNG) or WebP, never AVIF ([[responsive-images]])                              |

## Images

Use [[responsive-images]]: plain `<picture>`/`<img>` straight from `media.crystallize.com`, `srcset` from the
returned variants, `sizes` that match the CSS, WebP rather than AVIF, `size` selected. Preconnect to the media host
without `crossOrigin`. `og:image` and JSON-LD `image` use an absolute URL to the **original format**, never AVIF.

## Reference implementations

[superfast.shop](https://superfast.shop) lists live demo stores, one per industry, each on its own tenant with a
storefront on Discovery and the Shop API, built agentically with the Crystallize MCP. Before designing a
storefront, find one with the capabilities the user needs and read how it does it:

- `https://superfast.shop/demos.json`: every store, its capabilities, live URL and build prompt, as JSON.
- `https://superfast.shop/start.md`: interviews the user and hands back a build prompt.
- `https://superfast.shop/llms.txt`; the list filters by URL, e.g. `?cap-model=subscriptions`, `?audience=b2b`.
- `https://superfast.shop/demos/<id>` and `https://superfast.shop/demos/<id>/prompt.md`: a store's page and its
  "build your own like it" prompt. Each live store has its own `/llms.txt`.

| Store              | Look at it for                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `photo-store`      | Typed specs as filters, vector ranking per shopper, an MCP server and an on-site assistant          |
| `tools-universe`   | Rentals and bookings, ETIM typed specs, battery platforms, quotes, stock per location, MCP, JSON-LD |
| `food-universe`    | B2B invoice and credit limits, GS1 and allergens, recipes to basket, draft preview                  |
| `fashion-universe` | Colourways and sizes with `variantGroups`, sale pricing, multi-market                               |
| `lab-universe`     | Approvals, budgets, contract and volume prices, standing orders                                     |
| `screen-universe`  | Subscriptions with trials, metered usage                                                            |

## References

| File                                                                             | Read it when                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [references/api-contract.md](references/api-contract.md)                         | Choosing the API, endpoint, token and place for any task                       |
| [references/caching-and-revalidation.md](references/caching-and-revalidation.md) | Caching Discovery, the publish webhook, per-customer caches                    |
| [references/i18n-routing.md](references/i18n-routing.md)                         | Language and market routing, translated paths, hreflang, the language switcher |
| [references/cart-checkout.md](references/cart-checkout.md)                       | Hydrate, place, order, bookings, quotes, the confirmation page                 |
| [references/performance.md](references/performance.md)                           | LCP, prefetch, function region, prerendering, metadata in `<head>`             |
| [references/accessibility.md](references/accessibility.md)                       | Drawers, skip link, focus, forms, live regions                                 |
| [references/security-headers.md](references/security-headers.md)                 | Companion headers, CSP, frame-ancestors, cookies                               |
| [references/preview.md](references/preview.md)                                   | Draft preview in a Crystallize custom view: route, draft reads, framing        |
| [references/nextjs-pitfalls.md](references/nextjs-pitfalls.md)                   | Next.js 16 Cache Components and PPR traps                                      |

## Related skills

[[query]] and [[mutation]] hold the API details. [[pricing]] covers price variants, price lists and the cart
price context; [[payments]] the provider session and webhook; [[bookable-resources]] and [[subscriptions]] their
flows. [[vector-ranking]] ranks rails and search per shopper. [[responsive-images]] covers images.
[[information-architecture]] covers paths. [[seo-geo]] makes the store findable and quotable;
[[agentic-commerce]] lets AI agents shop it on the same code.
