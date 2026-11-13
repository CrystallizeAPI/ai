# Language and market routing, translated paths, hreflang

Crystallize translates item paths per language, so `/en/sawing/circular-saw-x` and `/no/sager/sirkelsag-x` are
the same item. A storefront routes on the language in the path, resolves the item by its path in that language,
and finds the same item in other languages by `itemId`.

## Language (and market) in the path

Put the language, and the market when it differs from the language, in the first path segment. Do not choose the
market by cookie: crawlers carry no cookies, so they only ever see the default market's prices, and the JSON-LD
then has to say so.

A proxy (Next.js 16 `proxy.ts`, formerly `middleware.ts`) sends a bare URL to a language: the cookie, then
`Accept-Language`, then the default. Trimmed from a working storefront:

```ts
import { NextResponse, type NextRequest } from "next/server";

const LANGS = ["en", "no", "sv", "nl"];

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    if (LANGS.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) return NextResponse.next();
    const cookie = request.cookies.get("lang")?.value;
    const accepted = (request.headers.get("accept-language") ?? "").toLowerCase();
    const fromHeader = LANGS.find((l) => accepted.startsWith(l) || (l === "no" && /^(nb|nn)/.test(accepted)));
    const lang = LANGS.includes(cookie ?? "") ? cookie : (fromHeader ?? "en");
    request.nextUrl.pathname = `/${lang}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(request.nextUrl);
}

// Keep Next internals, API routes and files (robots.txt, sitemap.xml, icons) out of the language redirect.
export const config = { matcher: ["/((?!_next|api|favicon.ico|icon|apple-icon|.*\\..*).*)"] };
```

- Icon routes (`icon`, `apple-icon`), `/.well-known/*`, OAuth and webhook routes stay outside the language proxy.
- The proxy also serves Markdown twins (`.md`, `Accept: text/markdown`); see [[seo-geo]].
- Map each language to its market in one place: currency, price variant identifier, VAT rate, locale.

```ts
export const MARKET = {
    en: { currency: "EUR", priceVariant: "default", vat: 0.21, locale: "en-IE" },
    no: { currency: "NOK", priceVariant: "nok", vat: 0.25, locale: "nb-NO" },
    sv: { currency: "SEK", priceVariant: "sek", vat: 0.25, locale: "sv-SE" },
} as const;
```

## Tenant language codes vs BCP 47

Use BCP 47 for `<html lang>`, hreflang, `og:locale` and schema.org `inLanguage`. A tenant's language code is not
always one: Norwegian content in a tenant language `no` is Bokmål, `nb`.

```ts
export const HREFLANG = { en: "en", no: "nb", sv: "sv", nl: "nl" };
export const OG_LOCALE = { en: "en_IE", no: "nb_NO", sv: "sv_SE", nl: "nl_NL" };
```

In Discovery, a tenant language with a hyphen becomes camelCase in the `TenantLanguage` enum (`nb-no` is `nbNo`).

## The same item in every language

Paths are translated and can be re-slugged, so never match by slug. One aliased query by `itemId` returns the
item's path in every language:

```ts
export async function pathsForItem(itemId: string) {
    const q = LANGS.map(
        (l) =>
            `${l}: search(language: ${l}, filters: { itemId: { equals: $id } }, pagination: { limit: 1 }) { hits { path } }`,
    ).join("\n");
    const data = await discovery<Record<string, { hits: { path: string }[] }>>(`query Paths($id: String!) { ${q} }`, {
        id: itemId,
    });
    return Object.fromEntries(LANGS.flatMap((l) => (data[l].hits[0] ? [[l, `/${l}${data[l].hits[0].path}`]] : [])));
}

/** Next.js `alternates`: canonical for this language, hreflang for every language, x-default. */
export function alternates(paths: Record<string, string>, lang: string) {
    return {
        canonical: absolute(paths[lang]),
        languages: {
            ...Object.fromEntries(LANGS.flatMap((l) => (paths[l] ? [[HREFLANG[l], absolute(paths[l])]] : []))),
            "x-default": absolute(paths.en ?? paths[lang]),
        },
    };
}
```

- A language without the item has no hit: leave it out of hreflang rather than pointing at a 404.
- For a sitemap, one `browse` per language, joined on `itemId` (see [[seo-geo]]).
- Folders map across languages the same way. A folder's topic path is a usable cross-language key when folders
  mirror a taxonomy.
- A renamed path goes to the item's path history: 301 old URLs to the current path, and keep them out of the
  sitemap. See [[information-architecture]].

## The language switcher

Link each language to its front page (so it works without JavaScript), and on click ask a route for the current
page's path in the target language:

```ts
// GET /api/language?to=no&path=/en/sawing/x → { href: "/no/sager/x" }
const APP_PAGES = new Set(["", "cart", "account", "search"]);

export async function GET(req: NextRequest) {
    const to = req.nextUrl.searchParams.get("to") ?? "";
    const [pathname, query = ""] = (req.nextUrl.searchParams.get("path") ?? "/").split("?");
    const [, from, ...rest] = pathname.split("/");
    const target = (path: string) => NextResponse.json({ href: `/${to}${path}${query ? `?${query}` : ""}` });
    if (APP_PAGES.has(rest[0] ?? "")) return target(rest.length ? `/${rest.join("/")}` : "");
    const item = await resolveItem(`/${rest.join("/")}`, from); // Discovery: path → itemId
    const path = item ? await pathInLanguage(item.itemId, to) : null; // Discovery: itemId → path
    return target(path ?? "");
}
```

Facet values that are topic paths are language-independent, so a filtered category keeps its filters across the
switch. Prefetching the target language's page on hover makes the switch feel instant.

## Content that is missing in a language

An item exists per language, but its text components may be empty in one. Test for content, not for a hit: a
product with no name or description in a language is a fallback case (show the default language's text, or leave
the item out of that language's listings and sitemap), not a page to render empty.
