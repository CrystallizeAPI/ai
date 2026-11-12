# Frontend preview with custom views

Editors preview a draft inside the Crystallize App: a **custom view** frames your storefront next to the item
they are editing. The App supplies the frame, the device toolbar and the reload; the storefront supplies one route
that turns preview mode on, and pages that read drafts in that mode. From a working Next.js 16 storefront
(tools-universe, Cache Components, verified with a production build on 2026-11-12). Read the App side in the docs:
[Custom views](https://crystallize.com/docs/pim/catalogue/custom-views).

## 1. The custom view (in the App)

Settings → Custom views → **Add custom view**: a name and a URL template. The App fills these placeholders for
the item that is open:

| Placeholder                 | Value                                                                   |
| --------------------------- | ----------------------------------------------------------------------- |
| `{{language}}`              | The language the editor is working in (`en`, `no`, …)                   |
| `{{itemId}}`                | The item id: stable across languages and renames. Prefer it             |
| `{{itemPath}}`              | The Crystallize path: no language prefix, translated per language       |
| `{{itemExternalReference}}` | The external reference, if you route by it                              |
| `{{variantSku}}`            | The selected variant's SKU, if the product page selects variants by URL |

```text
https://shop.example.com/api/preview?secret=…&language={{language}}&itemId={{itemId}}&path={{itemPath}}
```

- **Always turn on "Show responsive device toolbar in preview".** The editor then switches between mobile and
  desktop widths in the App's toolbar.
- **The storefront adds no preview chrome.** No device buttons, no frame, no banner: it only has to be responsive,
  which it already is. The App draws the toolbar and the reload button.
- The secret ends up in the tenant's settings, readable by anyone who can open them. Use a value only for preview.

**By API:** custom views are tenant preferences. The legacy PIM API has
`tenant { setPreferences(tenantId, input: { frontends: [{ name, url }] }) }`; Core only reads them
(`tenant { preferences { frontends { name url responsive authentication { key } } } }`). The input has no
`responsive`, so the device toolbar is switched on in the App, and `setPreferences` replaces the whole list: read
`frontends` first and send every existing view back, knowing their `responsive` and `authentication` can't be
carried and will be reset. Adding a view in the App is safer.

## 2. The preview route

One `GET` route: check the secret, resolve the item's storefront URL **from its draft** in the requested
language, turn on preview mode, redirect. In Next.js:

```ts
// app/api/preview/route.ts
import { cookies, draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, timingSafeEqual } from "node:crypto";

const same = (a: string, b: string) =>
    timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

export async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const secret = params.get("secret");
    if (!process.env.PREVIEW_SECRET || !secret || !same(secret, process.env.PREVIEW_SECRET))
        return new Response("Invalid preview secret", { status: 401 });

    // Redirect only to a path Discovery returned, never to a parameter (no open redirect).
    const target = await previewTarget(params.get("language"), params.get("itemId"), params.get("path"));
    if (!target) return new Response("No storefront page for this item in this language", { status: 404 });

    (await draftMode()).enable();
    // Partitioned (CHIPS): kept by browsers that block third-party cookies, and scoped to the App's site.
    if (process.env.NODE_ENV !== "development") {
        const jar = await cookies();
        const value = jar.get("__prerender_bypass")?.value;
        if (value)
            jar.set({
                name: "__prerender_bypass",
                value,
                httpOnly: true,
                secure: true,
                sameSite: "none",
                partitioned: true,
                path: "/",
            });
    }
    redirect(target);
}
```

Resolve by item id, per language. The Crystallize path has no language prefix and is translated, so the
storefront URL is `/{lang}` plus the path **in that language**, and the item may map to a special route (the home
landing page to `/{lang}`):

```ts
async function previewTarget(language: string | null, itemId: string | null, path: string | null) {
    const lang = isLang(language) ? language : "en";
    const id = itemId ?? (path ? await itemIdForPath(path, lang) : null); // a path alone: try every language
    if (!id) return null;
    const data = await discovery<{ search: { hits: { path: string; externalReference?: string }[] } }>(
        `query PreviewTarget($id: String!) {
            search(language: ${lang}, filters: { itemId: { equals: $id } }, pagination: { limit: 1 }) {
                hits { path externalReference }
            }
        }`,
        { id },
        { draft: true },
    );
    const hit = data.search.hits[0];
    if (!hit) return null;
    return hit.externalReference === "page:home" ? `/${lang}` : `/${lang}${hit.path}`;
}
```

Resolve from the draft: a renamed or not-yet-published item has its new path only there. Look a bare path up in
every language: `{{itemPath}}` may be in another language than `{{language}}`.

Add an exit route (`/api/preview/exit`, `POST` for forms; with a `GET` link, `prefetch={false}`) that calls
`draftMode().disable()` and also deletes the partitioned cookie with `Partitioned`; a partitioned cookie is only
deleted by a `Set-Cookie` that carries the attribute. Next keeps one `Set-Cookie` per name, so set the partitioned
deletion only where the partitioned cookie was set (production).

Other frameworks: the same route sets your own signed, `httpOnly` preview cookie with the attributes in section 5,
and your loaders branch on it.

## 3. Draft reads through Discovery

In preview mode, every Discovery read asks for drafts: add `publicationState: draft` next to `language`. Every
Discovery field that takes `language` also takes it: `search`, `autocomplete`, every `browse` field, and the
nested relation fields `items(language:)` and `variants(language:)`. One rewrite covers a whole query:

```ts
export const draftQuery = (query: string) =>
    query.replace(/\((\s*language:\s*[^,)\s]+)(?![^)]*publicationState)/g, "($1, publicationState: draft");
```

With Next.js Cache Components, put the switch **inside** the cached client. `draftMode().isEnabled` is readable
in `'use cache'` (and `'use cache: remote'`); it is false while prerendering and for every request without the
cookie, so normal traffic stays cached and prerendered. With the cookie, Next re-runs every cached function on
each request and saves nothing:

```ts
async function cached<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    "use cache: remote";
    if ((await draftMode()).isEnabled) return request<T>(draftQuery(query), variables); // not saved
    cacheLife("hours");
    cacheTag("discovery");
    return request<T>(query, variables);
}
```

Then the storefront's own pages are the preview: same routes, same views, no `/preview` copy to keep in step.

**Drafts are public on an open Discovery.** `publicationState: draft` needs no credentials there (verified on two
tenants). The secret protects the preview **mode**: uncached rendering, `noindex`, framing by the App. It does
not protect the data. To keep drafts private, restrict Discovery and send the static token from the server.

## 4. Live reload

The custom-views doc asks preview pages to load the App's listener. Load it in preview mode only:

```tsx
async function PreviewListener() {
    const { isEnabled } = await draftMode();
    return isEnabled ? <script defer src="https://app.crystallize.com/static/frontend-preview-listener.js" /> : null;
}
```

It posts `{ frontendPreview: { loaded: true } }` to the parent and reloads the page on
`{ crystallize: { reloadDueToStaleItem: true } }`, which the App sends when the editor saves.

## 5. No cache, noindex, framing and cookies

- **No caching.** Next serves draft-mode responses `Cache-Control: private, no-cache, no-store` and skips every
  cache layer. Elsewhere, mark preview responses `no-store` yourself and never let a CDN key them without the
  cookie.
- **`noindex`.** In the root layout's `generateMetadata`, `robots: { index: false, follow: false }` when
  `draftMode().isEnabled` (false while prerendering, so the static shell keeps its robots), plus
  `X-Robots-Tag: noindex, nofollow` on preview responses. Keep `/api/` in `robots.txt`'s `Disallow`.
- **Framing.** The App runs on one origin, `https://app.crystallize.com` (`pim.crystallize.com` redirects there).
  Let it frame the preview route and preview-mode responses only; everything else keeps
  `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'`:

```ts
async headers() {
    const preview = "frame-ancestors 'self' https://app.crystallize.com";
    const draftCookie = [{ type: "cookie" as const, key: "__prerender_bypass" }];
    return [
        {
            source: "/:path((?!api/preview(?:/|$)).*)",
            missing: draftCookie,
            headers: [
                { key: "X-Frame-Options", value: "SAMEORIGIN" },
                { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
            ],
        },
        {
            source: "/:path*",
            has: draftCookie,
            headers: [
                { key: "Content-Security-Policy", value: preview },
                { key: "X-Robots-Tag", value: "noindex, nofollow" },
            ],
        },
        {
            source: "/api/preview/:path*",
            headers: [
                { key: "Content-Security-Policy", value: preview },
                { key: "X-Robots-Tag", value: "noindex, nofollow" },
            ],
        },
    ];
}
```

Matching on the cookie's presence is enough: a forged cookie only makes the page framable by the App, for the
browser that forged it. Add `http://localhost:*` only if you frame a local server.

- **Cookies.** The preview cookie is set and read inside a third-party iframe, so it must be
  `SameSite=None; Secure`; `Lax` or `Strict` is never sent there, and preview silently shows published content.
  Next's `__prerender_bypass` is `SameSite=None; Secure` in production builds but `Lax` in `next dev`, so test
  the framed preview against a production build over HTTPS. Add `Partitioned` for browsers that block
  third-party cookies (Chrome with third-party cookies off, incognito); Safari's tracking prevention may still
  refuse cookies in the frame, so tell editors which browsers you support.

## Verify

1. `/api/preview` with a wrong secret answers 401; with the right one, 307 to `/{lang}/…` and a
   `Set-Cookie: __prerender_bypass=…; Secure; HttpOnly; SameSite=none; Partitioned`.
2. A page with the cookie has `frame-ancestors 'self' https://app.crystallize.com`, no `X-Frame-Options`,
   `X-Robots-Tag: noindex`, `<meta name="robots" content="noindex, nofollow">` and the listener script; without it,
   `X-Frame-Options: SAMEORIGIN` and `index, follow`.
3. Log the outgoing Discovery bodies: with the cookie every query carries `publicationState: draft` and is sent on
   every request; a normal visit afterwards makes no Discovery request (the published cache was not touched).
4. In the App, open an item, pick the custom view, switch device widths, save a change and watch it reload.

## Pitfalls

| Symptom                                               | Cause                                                                  | Fix                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| The view is blank or "refused to connect"             | `X-Frame-Options`/`frame-ancestors 'self'` on the preview responses    | Allow `https://app.crystallize.com`, on preview responses only           |
| Preview shows published content inside the App only   | The preview cookie is `SameSite=Lax` (or blocked as third-party)       | `SameSite=None; Secure; Partitioned`; test a production build over HTTPS |
| Preview works in English, 404s in other languages     | Redirected to `{{itemPath}}` as-is: paths are translated, no `/{lang}` | Resolve `{{itemId}}` per language from the draft                         |
| A renamed or new item 404s in preview                 | The target was resolved from published data                            | Resolve with `publicationState: draft`                                   |
| Shoppers saw a draft                                  | Draft reads cached, or a cache keyed without the cookie                | Switch inside the cached client on `draftMode()`; `no-store` on preview  |
| Every page became dynamic                             | Preview checked with `cookies()`/`headers()` in a shared layout        | `draftMode()`: off during prerender, so the static shell is unchanged    |
| Preview pages indexed                                 | No `noindex` in preview mode                                           | `robots` from `draftMode()`, `X-Robots-Tag` on preview responses         |
| "Exit preview" link ends preview before it is clicked | A prefetched `<Link>` to a `GET` exit route                            | `POST`, or `prefetch={false}`                                            |
| The view doesn't follow the editor's saves            | The App's listener isn't loaded                                        | `frontend-preview-listener.js` in preview mode                           |
| Device buttons inside the preview                     | Preview chrome built into the storefront                               | Remove it; turn on the App's responsive device toolbar                   |
| Treating the secret as access control for drafts      | Drafts are public on an open Discovery                                 | Restrict Discovery and use the static token if drafts must stay private  |
