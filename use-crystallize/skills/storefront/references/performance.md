# Performance

What made Crystallize storefronts fast or slow in practice, plus the gaps a Modern Web Guidance (MWG v1.0)
audit found on a live store. Images are covered by [[responsive-images]]; read it rather than repeating it here.

## Run next to the API

Put server functions in the region nearest the tenant's API and media (`fra1` on Vercel for EU tenants):

```json
{ "regions": ["fra1"] }
```

Every page makes several Discovery reads; a transatlantic hop on each one adds up to hundreds of milliseconds.

## Prefetch on intent, not on view

A framework link that prefetches every card in view renders every linked page on the server. On a category page
with a mega menu, that was most of one demo's hosting bill. Prefetch on hover, focus or touch:

```tsx
"use client";
import Link from "next/link";
import { useState, type ComponentProps } from "react";

export function IntentLink(props: Omit<ComponentProps<typeof Link>, "prefetch">) {
    const [intent, setIntent] = useState(false);
    const show = () => setIntent(true);
    return <Link {...props} prefetch={intent} onMouseEnter={show} onTouchStart={show} onFocus={show} />;
}
```

Only the hovered link counts: opening a menu must not count as intent for all its links. Speculation rules do
not apply to an App Router site, which navigates client-side.

## Prerender, or render on demand

Prerendering every product page puts the whole catalogue through Discovery during the build. One build got
HTTP 200 with `errors: [{ message: "Response Error" }]` after about 900 pages. Options:

- Prerender what the sitemap lists, with capped concurrency and a retry on "Response Error".
- Render on demand and cache, for very large catalogues.

Either way, every URL served must have its own metadata in `<head>` (below).

## The LCP image

- **Get the LCP resource into the early HTML.** On one store, product and category pages had the LCP image's
  `<link rel="preload">` at byte 282,186 of the HTML, after a 60 KB header and mega menu. Stream above-the-fold
  content first, and keep the hero out of a late Suspense boundary. Putting the LCP image in the PPR shell was the
  biggest listing LCP win in another build.
- **Preconnect to the media host, without `crossOrigin`**: `<img>` requests are no-cors and won't reuse a CORS
  connection. In React: `preconnect('https://media.crystallize.com')` from `react-dom` in the root layout.
- **At most one or two `fetchpriority="high"`** images and preloads per page. One home page had 5 image preloads
  and 9 high-priority images.
- **Hidden mega-menu images get `fetchpriority="low"`**, or are not rendered until the menu opens. One store
  rendered about 62 menu images into every page's HTML.
- Discovery has no dominant colour or blur hash; generate placeholders at import if you need them.

## Payload

- Ask Discovery only for the image widths a slot uses (`variants(types: "webp", minWidth, maxWidth)`). Cards up to
  about 1024 px, gallery 1920, chat cards 500. One build cut a listing read from 345 KB to 108 KB by selecting
  widths only. Repeated `variants { images }` on a product with 260 sizes made 24 cards 8.2 MB and broke the
  cache.
- Skip `facets` on rails and menus.
- Large cached reads bloat the RSC payload of every page that uses them.
- `content-visibility: auto` on long below-the-fold sections.

## Fonts

Self-host with `next/font` (`display: swap`, size-adjust fallbacks); preload only the one or two faces used above
the fold.

## Field data

Measure in the field: `web-vitals` (attribution build) beaconed to your own route. Without it, INP, LCP and CLS
from real shoppers are unknown.

## Pitfall: metadata must be in the cached shell's `<head>`

Found in the MWG audit and confirmed on a live store.

- With Next.js Cache Components and PPR, a dynamic `generateMetadata` is **streamed into `<body>`** instead of the
  static shell's `<head>`.
- On Vercel, real Googlebot user agents were served the cached shell (`x-vercel-cache: HIT`) with **no `<title>`,
  description, canonical or hreflang** on product and category pages. bingbot and AI crawlers got `BYPASS` and a
  full `<head>`. Browsers got the title about 300 KB into the HTML. Google ignores canonical and hreflang outside
  `<head>`.
- `htmlLimitedBots` doesn't help when the cached shell wins.
- A catch-all route without `generateStaticParams` serves one App Shell for every URL, and that shell can't hold
  metadata that depends on the path.

**The rule: keep metadata cacheable.**

- Build `generateMetadata` only from cached Discovery reads, with no request-time APIs (`cookies()`,
  `headers()`, `searchParams`), so it lands in the shell's `<head>` for every user agent.
- Give every sitemap path its own prerendered shell with `generateStaticParams`. Items published after the build
  get the App Shell on their first visit and are prerendered then.
- A search page's metadata must not read `searchParams`: make it static (the page is `noindex` anyway).

```tsx
// app/[lang]/[...path]/page.tsx
export async function generateStaticParams({ params }: { params: { lang: string } }) {
    return (await catalogPaths(params.lang)).map((p) => ({ path: p.split("/").filter(Boolean) }));
}

export async function generateMetadata({ params }: PageProps<"/[lang]/[...path]">): Promise<Metadata> {
    const { lang, path } = await params; // params only: no cookies, headers or searchParams
    return itemMetadata("/" + path.map(decodeURIComponent).join("/"), lang); // cached Discovery reads
}
```

**Verify with the real Googlebot strings**, desktop and smartphone, not a shortened UA, and look at
`x-vercel-cache` and where `<title>` sits. A local `next start` upgraded the App Shell after the first visit while
production did not, so test the deployment:

```bash
UA='Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/138.0.0.0 Safari/537.36'
curl -sI -A "$UA" https://shop.example/en/some/product | grep -i x-vercel-cache
curl -s -A "$UA" https://shop.example/en/some/product | head -c 4000 | grep -o '<title>[^<]*</title>\|rel="canonical"[^>]*\|hreflang="[^"]*"'
```

Repeat with the smartphone Googlebot UA, bingbot and an AI crawler. The same rule, from the crawler's side, is in
[[seo-geo]].

## Low-priority items from the audit

- Declare `color-scheme` (`<meta name="color-scheme" content="light">` for a light-only design) and
  `theme-color`.
- A web app manifest (`app/manifest.ts`).
- `Cache-Control: public, max-age=0, must-revalidate` rather than `no-store`, so nothing blocks the back/forward
  cache.
