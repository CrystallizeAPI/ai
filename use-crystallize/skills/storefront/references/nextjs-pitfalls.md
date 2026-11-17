# Next.js 16 pitfalls on a Crystallize storefront

Most builds behind this skill used Next.js 16 (16.3–16.4) with `cacheComponents: true` on Vercel. These are the
traps they hit, with what worked. They are framework behaviour rather than Crystallize behaviour, so re-check
them on the version you run.

## Shape of the app

- **A static shell plus cached Discovery reads; per-shopper parts stream behind `<Suspense>`.** The layout reads
  no cookies. A layout that reads cookies makes every route dynamic, and then `staleTimes.dynamic` (for example
  20 s) is needed, or a prefetched payload is thrown away the moment it arrives.
- **A page that depends on `params` sits behind `<Suspense>`**, so the route's shell (layout and skeleton) is shared
  by every link to it. Next 16.4 with partial prefetching errors on `await params` outside a boundary.
- **Make the fallback real content where you can.** While a category's filters and personal ranking stream, the
  fallback is the same category in its default order (cached), not a skeleton.
- **Every internal link is a `next/link`**, prefetched on intent ([performance.md](performance.md)). Test
  prefetching in a production build in a visible browser: `next dev` doesn't prefetch, and a hidden or background
  tab prefetches nothing and doesn't reveal streamed Suspense content (it waits for `requestAnimationFrame`).

## Request data and the prerender

- **`await connection()` before Core or Shop API reads and before `new Date()`** in a request-time render. An
  uncached `fetch` does not mark the render dynamic by itself, and `new Date()` after it errors as an "unstable
  value during prerendering".
- **A read inside `'use cache'` must not call `connection()`.** Keep two entry points to the Shop API client: one
  that marks the render dynamic (carts) and a plain request for cached per-customer reads (order history).
- **Client components calling `usePathname()` in a layout** need a `<Suspense>` with a static fallback, or
  `next build` fails prerendering.
- **`'use server'` files may export only async functions.** Keep cookie names and constants in another module.

## Cache keys

- **Arguments to a cached function must be identical on every render.** Next renders a prerender twice (warm-up,
  then final). Build objects and arrays in a fixed order (sort SKU lists, sort keys); an order that depends on an
  API response misses the cache the second time ("Unexpected cache miss after cache warming phase") and the
  prefetch answers 503.
- **Keep the clock out of keys.** Day-bucket anything time-based.
- **Cached functions never throw.** A failed read during warming leaves no entry and becomes a miss; one build
  returns `{ error }` with `cacheLife('seconds')` instead. The same warning was still seen in Vercel logs with
  deterministic arguments and was benign (the part became a dynamic hole).
- **Large cached reads bloat `.meta`.** A 2.5 MB index read directly during prerender made each page's `.meta`
  526 KB (240 MB of the build). Reading it through a small keyed cache function brought it to 55 KB per page.

## 404s and redirects under a PPR shell

- **`notFound()` or `permanentRedirect()` inside `<Suspense>` streams HTTP 200**: the status is sent with the
  shell. The page still renders "not found" and carries `noindex`, so it doesn't get indexed, but crawlers and
  monitoring see a 200.
- What was tried: resolving the lookup in a cached function outside Suspense with `export const instant = false`
  worked in one round and not in a later one (still open). The pattern that worked: the proxy checks a cached index
  of valid paths and rewrites misses to a static route that calls `notFound()`.
- `dynamicParams` isn't available with Cache Components.

## Metadata for crawlers

A dynamic `generateMetadata` streams into `<body>`. With a cached shell on a CDN, Googlebot got pages with no
`<title>`, canonical or hreflang at all. Give every sitemap path its own prerendered shell
(`generateStaticParams`) and keep `generateMetadata` free of request APIs. Full write-up in
[performance.md](performance.md#pitfall-metadata-must-be-in-the-cached-shells-head); crawler side in
[[seo-geo]].

Bots in `htmlLimitedBots` that reached catch-all pages unknown at build hit "Expected the resume to render
<div>…" on Vercel. The same fix applies: `generateStaticParams` for every path.

## Loading states

- **`loading.tsx` on the segment that changes** replaces the visible page and hides optimistic UI. Moving it one
  level up kept sibling navigation instant in one build (a colour switch went from 813 ms to 26 ms).
- **Don't remove `<Suspense>` wrappers because streamed content "never appears"** in an automated browser: that is
  the hidden-tab behaviour above, not a bug.

## Prefetching

- With Cache Components, the default `<Link>` prefetch of a 16-card grid cost 136 KB on arrival. Intent prefetch
  outside the first row brought it to 37 KB.
- `partialPrefetching` (Next 16.3) gave intermittent 503s on shell-route prefetches in one build, and worked in
  others. Test it with your routes before relying on it.

## Deploying on Vercel

- **Set the function region** (`"regions": ["fra1"]` in `vercel.json`, and on the project) next to the tenant.
- **`vercel env add --force` does not overwrite sensitive variables**, and their values can't be read back. One
  site ran on fixtures without anyone noticing. Use `rm` then `add`, and expose a no-secrets status route (mode,
  tenant, a live probe).
- **`next start` locally differs from Vercel**: it doesn't send the font `Link: rel=preload` header Vercel sends,
  and it upgraded the App Shell after the first visit while production didn't. Compare local with local, and test
  crawler behaviour on the deployment.
