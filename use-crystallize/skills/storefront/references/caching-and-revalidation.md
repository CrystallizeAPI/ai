# Caching Discovery and revalidating on publish

Discovery is fast, but a storefront that reads it on every request pays for it in latency and rate limits. Cache
every published read on the server, clear the cache when something is published, and never cache what is
per-shopper or a draft.

## Cache published reads, keyed on query and variables

In Next.js 16 with Cache Components, a `'use cache'` function is keyed on its arguments. Pass the query string and
variables, tag the entry, and pick a life:

```ts
async function cached<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    "use cache: remote";
    cacheLife("hours");
    cacheTag("discovery");
    return request<T>(query, variables, false);
}
```

- **`'use cache: remote'`** on serverless hosts. The default in-memory cache lives per instance, so a read paid
  for on one instance was paid again on the next. The remote handler is shared by every instance.
- **`cacheLife('hours')`, not minutes.** Every revalidation is a cache write, and on Vercel those are billed: one
  build found Runtime Cache writes were about $140 of a $226 cycle with a one-minute life. Hours plus the publish
  webhook keeps pages fresh without the bill.
- **Build variables in a fixed order.** The cache key is the serialised arguments; `{ a, b }` and `{ b, a }` are
  two entries, and a prerender then misses its own cache.
- **Keep clocks out of cache keys.** A taste vector whose decay used `Date.now()` made every render's keys
  differ ("unexpected cache miss after cache warming"). Round time to the day.
- **Cached reads never throw a transient error into the cache.** Retry inside the request (429 and 5xx, with
  backoff). A failing query inside `'use cache'` broke background revalidation in one build; another made
  cached reads return an empty result on failure rather than throw.
- **Rails and menus skip `facets`** (about 17 KB per read) and select only the image widths they render.

## Revalidate on publish with a webhook

Crystallize calls a URL when an item is published or unpublished. Register the webhook once, from a setup script on
the Core API (trimmed from a working seed step):

```js
// The default payload is { id, type, tenantId, language, userId, webhookId }; the query adds the item's path.
const ITEM_QUERY = `query ($id: ID!, $language: String!) {
  item(id: $id, language: $language) { ... on Item { id shapeIdentifier tree { path } } }
}`;

// concern is `items` (plural): `item` is accepted by createWebhook but never fires.
const WEBHOOKS = [
    { name: "storefront-revalidate-publish", concern: "items", event: "publish" },
    { name: "storefront-revalidate-unpublish", concern: "items", event: "unpublish" },
];

for (const w of WEBHOOKS) {
    const input = {
        ...w,
        url: "https://shop.example/api/revalidate",
        method: "POST",
        headers: [
            { name: "x-revalidate-secret", value: process.env.REVALIDATE_SECRET },
            { name: "content-type", value: "application/json" },
        ],
        preserveDefaultPayload: true,
        graphqlQuery: ITEM_QUERY,
        graphqlQueryTarget: "next",
    };
    await core(
        `mutation ($input: CreateWebhookInput!) {
            createWebhook(input: $input) { ... on Webhook { id } ... on BasicError { errorName message } }
        }`,
        { input },
    );
}
```

Make the script idempotent: list `webhooks(first: 100)` first, and `updateWebhook` the ones that exist by name.
Keep the secret in a header, never in the URL.

The receiving route checks the secret and clears tags. With one `discovery` tag, everything follows at once:

```ts
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(req: NextRequest) {
    const secret = process.env.REVALIDATE_SECRET;
    if (!secret || req.headers.get("x-revalidate-secret") !== secret)
        return NextResponse.json({ ok: false }, { status: 401 });
    revalidateTag("discovery", "max");
    return NextResponse.json({ ok: true });
}
```

Finer tags are possible: the payload carries `item.tree.path` from the webhook's query, so a route can clear
`product:<slug>` and `categories` instead of everything. One build measured a summary edit showing on production
21 seconds after publish, with stale-while-revalidate (`'max'`).

Publishing is asynchronous (`publishItem` answers before anything is indexed), so in principle the webhook can
arrive before Discovery serves the new version. The builds did not measure this; if a page re-renders with old
content, delay the revalidation a few seconds.

Pages, JSON-LD, the sitemap, Markdown twins and llms.txt all read through the same cached client, so one tag
clears them all. See [[seo-geo]].

## Per-customer caches

Order history, the taste vector built from it, and contract prices change rarely and are slow to read. Cache them
per customer or per organisation, with a tag the checkout can expire:

```ts
export const historyTag = (buyer: string) => `orders:${buyer}`;

export async function tasteForBuyer(buyer: string) {
    "use cache: remote";
    cacheLife("hours");
    cacheTag(historyTag(buyer));
    const orders = await orderHistory(buyer); // Shop API orders(customerIdentifier)
    const today = Math.floor(Date.now() / 86_400_000) * 86_400_000; // stable all day
    return tasteOf(orders, today);
}

// In the checkout server action, after createFromCart:
updateTag(historyTag(buyer));
```

A read inside `'use cache'` must not call `connection()` or other request APIs: split the Shop client into a
request-only function for these and a `connection()`-marked one for cart calls.

## Never cache

- **Draft reads.** Preview reads (`publicationState: draft`) go straight to Discovery. In Next.js, switch on
  `draftMode()` inside the cached client: see [preview.md](preview.md).
- **Carts.** Every cart read and write is request data.
- **Anything keyed on a cookie** that is not part of the cache key.

## Prefetch is a cost, too

Prefetching every link in view multiplies cached reads and, on hosts that bill cache reads and writes, the bill.
Prefetch on intent (hover, focus, touch) instead. See [performance.md](performance.md).
