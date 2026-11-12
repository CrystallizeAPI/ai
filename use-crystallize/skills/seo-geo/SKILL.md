---
name: seo-geo
description: >
    Make a Crystallize storefront findable and quotable by search engines and AI answer engines (SEO and GEO,
    generative engine optimization): schema.org JSON-LD built from typed specs, prices, stock, topics and relations
    (Product, ProductGroup, Offer incl. and excl. VAT, QuantitativeValue with UN/CEFACT unitCode, PropertyValue,
    CategoryCode from ETIM or GS1 codes in topic meta, BreadcrumbList, ItemList, Organization, WebSite
    SearchAction), Open Graph, canonicals and hreflang from translated paths, Markdown twins of every page,
    llms.txt and llms-full.txt, robots.txt for AI crawlers with Content-Signal, htmlLimitedBots, sitemaps with
    hreflang and lastModified, and validation (a schema.org vocabulary check script and the Rich Results Test).
    Use when adding SEO or structured data to a Crystallize frontend, asking how ChatGPT, Claude, Perplexity,
    Gemini or Google read the store, emitting GTIN, units or classification codes, writing robots.txt or a
    sitemap, or auditing why a page lacks a title, canonical or rich result. Trigger on "SEO", "GEO", "AEO",
    "JSON-LD", "structured data", "schema.org", "rich results", "Merchant Center", "Open Graph", "og:image",
    "canonical", "hreflang", "sitemap", "robots.txt", "llms.txt", "llms-full.txt", "markdown for LLMs",
    "AI crawlers", "GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "Content-Signal",
    "htmlLimitedBots", "generateMetadata", "unitCode", "UN/CEFACT", "QuantitativeValue", "GTIN", "ETIM",
    "CategoryCode", "ProductGroup", "noindex".
metadata:
    author: Crystallize
    version: "1.0"
---

# SEO and GEO for Crystallize Storefronts

Search engines and AI answer engines read a store in three ways: the HTML `<head>` and its JSON-LD, plain-text
versions of the pages, and the crawl policy. A Crystallize catalogue with typed specs (numbers with units,
booleans, selections), topics and relations has every fact these readers need. This skill turns them into
structured data and text **from the same rows**, so the page, the JSON-LD and the Markdown never disagree.

The storefront side (Discovery reads, caching, routing) is in [[storefront]]. Letting agents act on the store
(MCP, WebMCP, an assistant) is in [[agentic-commerce]]; this skill is the passive half.

> Built and checked on three Crystallize storefronts (Tools Universe, Photo Store, Høiax), September–November
> 2026, and audited against Chrome's Modern Web Guidance v1.0 on 2026-11-12. The JSON-LD of the live Tools
> Universe pages passes the vocabulary check in [references/validation.md](references/validation.md).

## The principle: state only what the data holds

Every fact comes from Crystallize, and nothing is claimed that the data doesn't hold.

- **No `AggregateRating` without real reviews.** Demo or seeded ratings stay out.
- **No `availability` without stock.** `InStock`/`OutOfStock` and `inventoryLevel` come from the variant's stock.
- **No `false` for an unknown boolean.** Discovery returns an unset boolean component as `false`. Treat `false` as
  "not stated" and leave it out of JSON-LD, Markdown and agent answers, unless the model guarantees every
  boolean is set.
- **No shipping or return policy unless the store has one.** Google asks for them; don't invent them.
- **No guessed identifiers.** A GTIN or national trade number that isn't registered is "not registered", not a
  made-up value.
- **No drafts.** The storefront never renders drafts to crawlers or the public: only the preview route reads
  `publicationState: draft`, and it is `noindex` and unlinked. On an open Discovery every draft is readable by
  anyone, so embargoed content does not belong in drafts there ([[storefront]]).

```ts
/** Discovery returns an unset boolean as false; the catalogue states the features a product has. */
export const stated = (r: SpecRow) => r.value !== false;
```

## Checklist per page type

| Page                      | `<head>`                                                               | JSON-LD                                                                                             | Text twin                           |
| ------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Home                      | Title, description, canonical, hreflang, `og:*`                        | `Organization` (or `OnlineStore`), `WebSite` with `SearchAction`                                    | `/en.md`, linked from `/llms.txt`   |
| Category, brand, platform | Same; canonical **without** filter parameters                          | `CollectionPage` with an `ItemList` of the products on it; `BreadcrumbList`; the `Brand` or concept | `.md` with the product table        |
| Product                   | Same; `og:image` is the packshot in the original format                | `Product`, or `ProductGroup` with a `Product` per variant; `Offer` per variant; `BreadcrumbList`    | `.md` with the spec table and codes |
| Rental or service         | Same                                                                   | `Product` with `Offer`s that are `LeaseOut` with `leaseLength`, `availableAtOrFrom` places          | `.md`                               |
| Article, landing page     | Same                                                                   | `WebPage` (or `Article`) in the site graph; `FAQPage` only from a real FAQ block                    | `.md`                               |
| Search results            | **Static** title, `noindex, follow`, canonical to the bare search page | none                                                                                                | none                                |
| Cart, account, checkout   | `noindex`                                                              | none                                                                                                | none; disallowed in robots.txt      |
| Draft preview             | `noindex`; not linked, not in the sitemap                              | none                                                                                                | none                                |

Every page:

- [ ] `<title>`, description, canonical and hreflang are **in the `<head>` of the HTML that crawlers get**, not
      streamed into `<body>` ([references/crawlers.md](references/crawlers.md)).
- [ ] `<html lang>`, hreflang and `inLanguage` are BCP 47 (`nb`, not the tenant's `no`), with `x-default`.
- [ ] Canonical and hreflang come from the translated generated paths, looked up by `itemId`. No typed "canonical
      URL" component: it goes stale on the first rename.
- [ ] The description is plain text, at most about 155 characters, cut at a word. Rich text never goes into
      `<meta>`; ask Discovery for `format: plainText`.
- [ ] `<link rel="alternate" type="text/markdown">` points at the page's Markdown twin.

## Where each fact comes from

| Fact                    | Crystallize source                                                          | schema.org                                                                                    |
| ----------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Name, description       | Item name; an SEO piece or a plain-text summary                             | `name`, `description`                                                                         |
| SKU, GTIN               | Variant `sku`; a non-translatable `gtin` single line per variant            | `sku`, `gtin13` / `gtin12` / `gtin14` by length                                               |
| National trade numbers  | An identifiers chunk (NOBB, NRF, …)                                         | `identifier` as `PropertyValue` with `propertyID`                                             |
| Numeric spec with unit  | Numeric component (value + unit)                                            | `PropertyValue` / `QuantitativeValue` with `value`, `unitText`, `unitCode` (UN/CEFACT Rec 20) |
| Bound ("max. diameter") | The field id (`maxDrillingDiameter`)                                        | `maxValue` / `minValue`                                                                       |
| Selection option        | Selection component (option key + label)                                    | `valueReference` as `DefinedTerm` with `termCode`                                             |
| Classification code     | Topic `meta`, or a topic map mirroring the code set (ETIM, GS1 GPC, UNSPSC) | `category` as `CategoryCode` with `codeValue` and `inCodeSet`                                 |
| Product type            | The type topic's path                                                       | `category` as text ("Drilling > Combi drill"), what Google Merchant reads                     |
| Keywords                | Trade, material, feature topics                                             | `keywords`                                                                                    |
| Price                   | Discovery `<variant>Price` per market; volume tiers                         | `Offer.price` incl. VAT, `UnitPriceSpecification` incl. and excl. VAT, `eligibleQuantity`     |
| Stock                   | `<location>Stock` per variant                                               | `availability`, `inventoryLevel`                                                              |
| Accessory, consumable   | Item relations                                                              | `isAccessoryOrSparePartFor`, `isConsumableFor`, `isRelatedTo`                                 |
| What's in the box       | A paragraph or chunk with item relations                                    | `Offer.includesObject` as `TypeAndQuantityNode`                                               |
| Warranty                | Numeric component in years                                                  | `Offer.warranty` as `WarrantyPromise`                                                         |
| Breadcrumbs             | Discovery `breadcrumbs` (ends with the item itself)                         | `BreadcrumbList`                                                                              |
| Paths per language      | Discovery, one aliased query by `itemId`                                    | hreflang; `@id`s per language                                                                 |
| `lastModified`          | `updatedAt` on every Discovery hit                                          | sitemap `<lastmod>`                                                                           |

Code for all of it: [references/json-ld.md](references/json-ld.md). Modelling the specs so these facts exist is
in [[content-model]] and [[taxonomy]].

## Share images and JSON-LD images

`og:image` and schema.org `image` are read by link-preview bots and crawlers that don't all decode AVIF. Use an
absolute URL to the **original format** (JPEG or PNG), else WebP, **never AVIF**, at least 1200 px wide when the
source allows. The variant ladder is capped at the source width, so a 1200 px source tops out at 1024: use the
image's `url` then. Give `og:image` its width and height, and use the white-background packshot for Product
JSON-LD.

```ts
/** og:image and JSON-LD images: the original format first, then WebP, never AVIF; the largest rendition. */
const FORMAT_RANK = (url: string) => (/\.avif(\?|$)/i.test(url) ? 2 : /\.webp(\?|$)/i.test(url) ? 1 : 0);

export function bestImage(img?: { url: string; variants?: { url: string; width: number }[] | null } | null) {
    const v = [...(img?.variants ?? [])]
        .filter((x) => FORMAT_RANK(x.url) < 2)
        .sort((a, b) => FORMAT_RANK(a.url) - FORMAT_RANK(b.url) || b.width - a.width)[0];
    return v?.url ?? img?.url;
}
```

On-page images are a different question: see [[responsive-images]] (WebP over AVIF, `sizes`).

## Text for answer engines

- **`/llms.txt`** ([llmstxt.org](https://llmstxt.org)): what the store is, markets, currencies and VAT, how
  versions, platforms and specs work, the MCP endpoint, then links to the Markdown page of every category, brand
  and concept page.
- **`/llms-full.txt`**: the whole catalogue in one file, with prices incl. and excl. VAT, stock, classification
  and every typed spec with its codes.
- **A Markdown twin of every page**: `<url>.md`, and the same URL with `Accept: text/markdown` (`Vary: Accept`).
  The twin is `noindex` with a canonical `Link` header to the HTML page.

Code: [references/llms-and-markdown.md](references/llms-and-markdown.md).

## Crawl policy

- **robots.txt** allows everything that is the same for every visitor, disallows per-shopper routes (cart,
  account, API, OAuth, MCP hand-offs), names the AI crawlers in their own block, and adds
  `Content-Signal: search=yes, ai-input=yes` (training left unstated, or set as you decide).
- **A noindex page must stay crawlable.** Search results are `noindex, follow`; disallowing them hides the
  noindex and the links.
- **Sitemap**: every page in every language, hreflang alternates joined on `itemId`, `lastModified` from
  `updatedAt`, and a sitemap index above a few thousand URLs.
- **Metadata in `<head>`** for every user agent, including Googlebot behind a CDN.

Code and the curl checks: [references/crawlers.md](references/crawlers.md).

## Pitfalls

| Symptom                                               | Cause                                                                              | Fix                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Googlebot sees no `<title>`, canonical or hreflang    | Dynamic `generateMetadata` streamed into `<body>`; the CDN served the cached shell | Prerender each sitemap path; metadata from cached reads only; test with real Googlebot UAs |
| JSON-LD says a tool has no hammer mode                | Unset boolean read as `false`                                                      | Treat `false` as "not stated"                                                              |
| Description shows HTML or is cut mid-word             | Rich text in `<meta>`                                                              | Plain text, ≤ 155 characters, cut at a word                                                |
| Link previews show no image                           | AVIF `og:image`                                                                    | Original format or WebP                                                                    |
| Canonical points at an old URL                        | A typed canonical component                                                        | Canonical from the current translated path                                                 |
| hreflang rejected or ignored                          | Tenant code (`no`) instead of BCP 47 (`nb`); hreflang outside `<head>`             | `nb`, `x-default`, in `<head>`                                                             |
| Crawlers only see one market's prices                 | Market chosen by cookie                                                            | Market in the path                                                                         |
| Search results indexed, or their links never followed | Disallowed in robots.txt instead of `noindex, follow`                              | Allow crawling, `noindex`                                                                  |
| Search page title lacks the query, or streams late    | `generateMetadata` reads `searchParams`                                            | Static metadata on the search page                                                         |
| Filtered category views compete with the category     | Canonical carries filter parameters                                                | Canonical to the clean category                                                            |
| Merchant listing warnings                             | schema.org-valid but missing what Google asks for                                  | Rich Results Test; add only what the store really has                                      |
| Unit filters and codes wrong                          | Several units on one numeric; units without a Rec 20 code guessed                  | One unit per numeric; no code rather than a wrong one                                      |

## Live examples

- [tools-universe.superfast.shop](https://tools-universe.superfast.shop): Product/ProductGroup JSON-LD with ETIM
  `CategoryCode`, UN/CEFACT units, rentals as `LeaseOut` offers; `/llms.txt`, `/llms-full.txt`, `.md` twins; the
  robots.txt and sitemap described here. Its `/en/mcp` page explains the AI-ready setup.
- [photo-store-vector.superfast.shop/llms.txt](https://photo-store-vector.superfast.shop/llms.txt): llms.txt for a
  B2C and B2B store with typed lens and camera specs.
- More stores, by capability: [superfast.shop/demos.json](https://superfast.shop/demos.json); see [[storefront]].

## References

| File                                                               | Read it when                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [references/json-ld.md](references/json-ld.md)                     | Emitting JSON-LD for products, variants, offers, specs, listings, brands    |
| [references/llms-and-markdown.md](references/llms-and-markdown.md) | Publishing llms.txt, llms-full.txt and Markdown twins                       |
| [references/crawlers.md](references/crawlers.md)                   | robots.txt, AI crawlers, htmlLimitedBots, metadata in `<head>`, sitemaps    |
| [references/validation.md](references/validation.md)               | Checking JSON-LD against schema.org and Google, and crawler-eye curl checks |

## Related skills

[[storefront]] for the Discovery reads, caching and routing this builds on; [[content-model]] for typed specs,
units and identifiers; [[taxonomy]] for classification codes in topic meta; [[information-architecture]] for
paths and redirects; [[responsive-images]] for images; [[agentic-commerce]] for agents that act on the store.
