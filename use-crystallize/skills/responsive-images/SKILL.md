---
name: responsive-images
description: >
    Render Crystallize images efficiently on the web — srcset, sizes, picture, format choice, lazy
    loading, LCP and CLS. Use when building product galleries, hero images, thumbnails, grids or any
    page that displays Crystallize media; when images are too heavy, the page scores badly on
    Lighthouse or Core Web Vitals, or the wrong image size is being downloaded; when choosing between
    AVIF, WebP and the original format; when picking og:image, share-card or JSON-LD images; when
    deciding whether to use next/image or another framework image component with Crystallize; or when
    querying image variants from the Catalogue or Discovery API. Trigger on "srcset", "sizes", "responsive images", "picture element", "image optimization",
    "image variants", "media.crystallize.com", "webp", "avif", "lazy loading", "fetchpriority",
    "layout shift", "CLS", "LCP", "next/image", "image component", "@crystallize/reactjs-components",
    "thumbnail", "image payload", "images too big", "og:image", "share image", "JSON-LD image",
    "packshot", "preconnect".
metadata:
    author: Crystallize
    version: "1.0"
---

# Responsive Images with Crystallize

Crystallize pre-generates every image at a ladder of widths in up to three formats and serves them
from its own CDN at `media.crystallize.com`. **The optimization has already happened.** Your job on the
frontend is to pick the smallest file that still looks right — not to re-encode anything.

Almost all wasted image bandwidth on a Crystallize storefront comes from two mistakes, both covered
below: shipping AVIF because it is newer, and omitting `sizes`.

> Measured on 2026-09-15 against two unrelated production tenants (347 format comparisons, 80 images),
> and read from `@crystallize/reactjs-components` v5.0.0. The width ladder and the AVIF/WebP result are
> observations about today's transcoder output, not contractual guarantees — re-measure before betting
> something load-bearing on them.

## Rule 0: do not put another image optimizer in front of the CDN

**Do not serve Crystallize images through `next/image`, or any other framework image pipeline, in its
default configuration.** It is the single most expensive mistake available here.

The variants already exist as static files on Crystallize's CDN. Routing them through a hosting
platform's image optimizer:

- produces **no smaller file** — it re-encodes an already-encoded derivative
- adds a proxy hop, and a transform on the first request for every unseen size
- bills you for image-optimization units and platform egress for bytes the Crystallize CDN already
  serves

Use a plain `<picture>` / `<img>` pointing straight at `media.crystallize.com`. That is what the
component below emits.

If a project is already committed to `next/image`, pass `unoptimized`, or give it a custom loader that
snaps the requested width to one in that image's `variants` and returns that variant's `url`, because
any other `@{width}` has no file behind it — but at that point it is doing strictly less than the
Crystallize `Image` component, with more configuration.

## What the API actually returns

Each image carries a list of variants. Verified shape:

```
https://media.crystallize.com/{tenant}/{path}/@{width}/{filename}.{ext}
```

|             |                                                               |
| ----------- | ------------------------------------------------------------- |
| **Widths**  | drawn from `100, 200, 500, 768, 1024, 1366, 1600, 1920, 3200` |
| **Formats** | `avif` and `webp` always, plus original if `jpeg` or `png`    |
| **Fields**  | `url`, `key`, `width`, `height`, `size` (bytes)               |

**Read URLs from the API, never compose them from scratch.** On a tenant with a custom media domain,
Catalogue and Discovery return that host and drop the `{tenant}` segment. What you may do is **derive** a
rendition from a URL the API returned for that same image, on the same host: replace `@{width}` with
another width the API listed. `{dir}/@{w}/{name}.webp` held for all 48,519 renditions on one tenant, so a
listing can ask for `variants(types: "webp", minWidth, maxWidth) { width }` only and build the URLs from
the first one; that cut a 16-card listing read from 345 to 108 KB. Only use widths that came back.

**Original-format variants exist only for JPEG and PNG sources, and a `.jpg` source gets `.jpeg`
variants.** A WebP, AVIF or TIFF source gets `webp` and `avif` only.

**The width ladder is capped at the source image's own width, so it differs per image.** A 1200px
original yields `100/200/500/768/1024`; a 500px original yields only `100/200/500`. A source under
100px wide gets no variants at all. In a sample of 80 images, eight distinct width sets appeared.

**Never hardcode the ladder.** Build `srcset` from the variants the API returned for _that_ image, or
you will emit URLs that 404 and a browser that picks them will show nothing.

**`variants` can be empty, so keep `url` as the fallback.** They are generated after upload: until then
Catalogue returns `null` and Discovery `[]`. Discovery captures them when the item is indexed and does
not pick them up by itself, so an item published too early keeps `[]` until it is published again. See
[[media]].

## Query the fields you need — including `size`

```graphql
firstImage {
    url
    altText
    width
    height
    variants {
        url
        width
        height
        size
    }
}
```

**Always select `size`.** It is not decoration: the React component uses it to decide whether AVIF is
worth emitting (see below). Omit it and the component silently ships both formats, which on measured
data is the more expensive outcome.

**After an image is replaced, Catalogue's image-level `width` and `height` still describe the first
upload**, while `url` and `variants` are the new file's. If a replacement can change the aspect ratio,
drop them from a Catalogue selection: the component then uses the largest variant.

On **Discovery** you can also trim the payload server-side — `variants` takes arguments:

```graphql
variants(types: "webp", minWidth: 400, maxWidth: 1600) {
    url
    width
    size
}
```

Useful for a listing page that will never render a 3200px hero. Ask per context — cards up to 1024,
a gallery or hero up to 1920, chat or MCP cards up to 500 — and one image drops from about 27 rendition URLs
to about 4. On a grid this removed every AVIF and original-format rendition from the payload. One build saw
`maxWidth` ignored, so check the answer on your tenant. `width` picks one exact width. `types`
matches the end of the variant key, so ask for `"jpeg"`, never `"jpg"`. An image with nothing in range
returns `[]`, not a smaller variant, so keep `url` selected. Catalogue's `variants` takes no arguments —
filter client-side there.

**Watch for repeated images.** `variants { images }` on a product with many sizes repeats the colourway's
images on every size variant: 24 cards of a 260-size style came to 8.2 MB and broke the hosting cache
("Single item size exceeds maxSize"), against 106 KB with `defaultVariant` only and card-sized WebP. Discovery's
`variantGroups { images }` takes no arguments and returns every group's images (355 images for 16 hits). Ask
for the default variant's images on a card and load the gallery on the product page. The query side is in
[[query]].

## Format: measure, do not assume AVIF

Conventional advice says prefer AVIF. **On Crystallize's current transcoder settings that is usually
wrong.**

|                                                           |             |
| --------------------------------------------------------- | ----------- |
| Comparisons (2 tenants, same width, both formats present) | **347**     |
| WebP produced the smaller file                            | **343**     |
| AVIF produced the smaller file                            | **4**       |
| Average advantage to WebP                                 | **~25–30%** |

AVIF generally wins at _equal visual quality_; what matters for payload is file size at the quality
the encoder actually targeted, and here WebP wins nearly every time. On one tenant AVIF averaged
larger than the original JPEG.

So: **ship one modern format, not both.** Two `<source>` elements do not make the page faster — the
browser takes the first it supports, and if that is the larger AVIF you have paid for the privilege.
Keep the original-format source as the compatibility fallback.

The component already does this for you, _if_ you queried `size`.

## Use the component

`@crystallize/reactjs-components` v5 implements the above. Spread the API image object into it:

```tsx
import { Image } from "@crystallize/reactjs-components";

<Image {...image} sizes="(max-width: 600px) 90vw, 700px" className="product-image" loading="lazy" />;
```

What it does for you:

- builds a `srcset` per format from `variants`, with `w` descriptors
- emits `<source type="image/avif">` **only when the first AVIF variant is smaller than the first WebP
  variant** — the comparison needs `size`, and falls back to emitting both when it is missing
- keeps a `<source>` for the original format and a plain `src` on the `<img>` as the fallback
- sets `width`/`height` from the props you pass (the spread image's own, when selected), else from the
  largest variant, which is what prevents layout shift
- resolves `alt` as `alt` → `altText` (from the API) → `fallbackAlt` → `""`

What it does **not** do, and you must:

- **pass `sizes`** — it has no default, see below
- pass `loading` and `fetchPriority` — they forward to the `<img>`, but nothing is set automatically.
  `fetchPriority` is missing from `ImageProps`, so as a JSX attribute it fails type-checking. In
  TypeScript, spread it instead: `{...{ fetchPriority: "high" }}`

Surprises worth knowing before you style it:

- It always renders `<figure>` wrapping `<picture>`, **plus a `<figcaption>` even when empty**. Budget
  for that in CSS, or use the render-prop escape hatch.
- `className` lands on the `<figure>`, not the `<img>`: target `.product-image img`. `style` and any prop
  the component does not know land on the `<img>`, so keep `focalPoint`, `meta` and the like out of the
  object you spread.
- `caption` needs the Catalogue shape, and only `caption { json }` renders as rich text: `html` prints
  its tags as text. Discovery's `caption` is a scalar, so the `<figcaption>` stays empty unless you pass
  the text as `captionPassed`.
- `_availableSizes` / `_availableFormats` synthesize URLs from the `@{width}` scheme instead of using
  `variants`. Because the ladder is per-image, this can invent URLs that do not exist. Prefer passing
  real `variants`.

For full markup control, pass a function as `children` and receive
`{ srcSet, srcSetWebp, srcSetAvif, useAvif, useWebP, className, sizes, media, src, alt, width, height, originalFileExtension }`,
plus any other prop you passed.

Not using React? See [references/without-react.md](references/without-react.md).

## `sizes` is the whole ballgame

This is the most common and most expensive mistake on the list.

`srcset` w-descriptors tell the browser **how wide each file is**. They say nothing about how big the
image will be on the page. `sizes` is what tells it that — and the browser must choose a file
_before_ it has laid the page out, so it cannot work this out on its own.

**Omit `sizes` and the browser assumes `100vw`** — full viewport width. A 180px thumbnail on a
1440px-wide laptop then downloads the 1024px file. Every time, on every thumbnail.

Write `sizes` to mirror the CSS that will actually size the element, gutters and column counts
included:

```html
<!-- Four-column grid at desktop, two at tablet, one at mobile -->
sizes="(max-width: 600px) calc(100vw - 32px), (max-width: 1024px) calc(50vw - 24px), calc(25vw - 32px)"

<!-- Full-bleed hero -->
sizes="100vw"

<!-- Fixed-width thumbnail — no media query needed -->
sizes="180px"
```

Checking it: open DevTools, find the `<img>`, compare `currentSrc` against the element's rendered
width times the device pixel ratio. If `currentSrc` is much wider, `sizes` is lying.

When `sizes` and the CSS disagree, the CSS wins visually and `sizes` wins on bandwidth — so a wrong
`sizes` costs you bytes with nothing to show for it.

## LCP and CLS

- **The hero is the LCP element.** Give it `loading="eager"` and `fetchPriority="high"`, and never
  `loading="lazy"` — lazy-loading the LCP image reliably makes the score worse.
- **Everything below the fold gets `loading="lazy"`.**
- **Always render `width` and `height`** so the browser can reserve the box. The component does this
  from the props you pass, else the largest variant; if you hand-roll, do it yourself. This is the
  entire fix for image-driven layout shift.
- **Do not lazy-load images already in the viewport** on first paint — the request starts later than
  it needs to.
- **At most one or two `fetchpriority="high"` per page.** Marking every card high is the same as marking
  none. Give images in a closed mega menu or drawer `fetchpriority="low"` (and `loading="lazy"`).
- **Get the LCP image into the first HTML.** Preload it, or render it in the static shell: in a Next.js
  partial prerender, a cached listing preview as the `<Suspense>` fallback put the LCP image into the shell,
  which was the biggest LCP win on listings in one build.
- **Preconnect to the media host without `crossOrigin`**:
  `<link rel="preconnect" href="https://media.crystallize.com">`. With `crossorigin` the browser opens a CORS
  connection that `<img>` requests do not reuse. Use the custom media domain if the tenant has one.
- **Placeholders are yours to make.** Discovery serves no dominant colour or blur hash (image `meta` holds
  only import provenance), so generate one at import and store it with the item if you want one.

## Share and structured-data images

`og:image`, `twitter:image`, schema.org `image` in JSON-LD and merchant feeds are read by crawlers and link
previewers, not by a browser that negotiates formats:

- **Use the original format, never AVIF.** Many preview bots and feed readers do not decode AVIF, and some
  not WebP. Pick the widest original-format variant (JPEG or PNG), else the widest WebP; skip AVIF. A
  `.jpg` source's variants are `.jpeg`.
- **At least 1200 px wide when the source allows.** The capped ladder means a 1200 px source tops out at
  1024, so use the image's `url` (the original file) then, provided it is not itself AVIF.
- **Absolute URLs, with dimensions.** Give `og:image` its `og:image:width` and `og:image:height`, from the
  variant you picked.
- **The packshot goes in Product JSON-LD and feeds.** Use the white-background product shot, the first image
  of the default variant if that is how the catalogue is authored; lifestyle shots belong on the page, not in
  the structured data. A manufacturer photo padded with white bars (3:2 letterboxed to 4:3 or square) reads
  as a small product in previews: crop it and import it as a new image, as in [[media]].
- **Generated share cards** (a Next `opengraph-image.tsx` with packshot, name and key specs) fetch the image
  at render time, so allow the media host in the image fetch and in any CSP.

```ts
const shareImage = (image: { url: string; variants?: { url: string; width: number; height: number }[] | null }) => {
    const rank = (url: string) => (/\.avif(\?|$)/i.test(url) ? 2 : /\.webp(\?|$)/i.test(url) ? 1 : 0);
    const best = (image.variants ?? [])
        .filter((v) => rank(v.url) < 2)
        .sort((a, b) => rank(a.url) - rank(b.url) || b.width - a.width)[0];
    return best && best.width >= 1200 ? best : { url: image.url }; // the original when the ladder is short
};
```

Where these tags and the JSON-LD are emitted, and how they are validated, is in [[seo-geo]].

## Failure modes

| Symptom                                  | Cause                                              | Fix                                                        |
| ---------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| Thumbnails download 1024px files         | `sizes` missing — browser assumed `100vw`          | Write `sizes` to match the rendered width                  |
| Both AVIF and WebP `<source>` emitted    | `size` not selected in the GraphQL query           | Add `size` to `variants`                                   |
| Images heavier after "upgrading" to AVIF | AVIF is usually larger here                        | Ship WebP; keep the original as fallback                   |
| Some `srcset` URLs 404                   | Width ladder hardcoded, or `_availableSizes` used  | Build `srcset` from the returned `variants`                |
| `variants` is `null` or `[]`             | Variants not generated yet, or source under 100px  | Use `url`; republish once they exist                       |
| Page jumps as images load                | No `width`/`height` on the `<img>`                 | Render both; they set the aspect ratio                     |
| Poor LCP on the product page             | Hero is `loading="lazy"`                           | `eager` + `fetchPriority="high"`                           |
| Image bill higher than expected          | Images routed through a framework optimizer        | Serve straight from `media.crystallize.com`                |
| `alt` is empty everywhere                | `altText` not selected, or not authored            | Query `altText`; author it in the PIM                      |
| Link previews show no image              | `og:image` points at an AVIF rendition             | Original format or WebP, never AVIF                        |
| A listing read is hundreds of KB         | Every rendition, or `variants { images }`, queried | `variants(types:, maxWidth:)`; default variant images only |
| `<img>` opens a second connection        | `preconnect` carries `crossorigin`                 | Preconnect without `crossOrigin`                           |

## Related skills

[[query]] covers the Catalogue and Discovery queries these fields come from, and
[[content-model]] covers the Images component itself — including that product variant images are
built-in rather than components. [[media]] covers importing images and setting `altText`, [[seo-geo]] the
share and structured-data tags, and [[storefront]] where image reads sit in the request path.
