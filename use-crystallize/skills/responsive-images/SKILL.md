---
name: responsive-images
description: >
    Render Crystallize images efficiently on the web — srcset, sizes, picture, format choice, lazy
    loading, LCP and CLS. Use when building product galleries, hero images, thumbnails, grids or any
    page that displays Crystallize media; when images are too heavy, the page scores badly on
    Lighthouse or Core Web Vitals, or the wrong image size is being downloaded; when choosing between
    AVIF, WebP and the original format; when deciding whether to use next/image or another framework
    image component with Crystallize; or when querying image variants from the Catalogue or Discovery
    API. Trigger on "srcset", "sizes", "responsive images", "picture element", "image optimization",
    "image variants", "media.crystallize.com", "webp", "avif", "lazy loading", "fetchpriority",
    "layout shift", "CLS", "LCP", "next/image", "image component", "@crystallize/reactjs-components",
    "thumbnail", "image payload", "images too big".
metadata:
    author: Crystallize
    version: "1.0"
---

# Responsive Images with Crystallize

Crystallize pre-generates every image at a ladder of widths in three formats and serves them from its
own CDN at `media.crystallize.com`. **The optimization has already happened.** Your job on the frontend
is to pick the smallest file that still looks right — not to re-encode anything.

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
returns the `@{width}` URL — but at that point it is doing strictly less than the Crystallize `Image`
component, with more configuration.

## What the API actually returns

Each image carries a list of variants. Verified shape:

```
https://media.crystallize.com/{tenant}/{path}/@{width}/{filename}.{ext}
```

|             |                                                               |
| ----------- | ------------------------------------------------------------- |
| **Widths**  | drawn from `100, 200, 500, 768, 1024, 1366, 1600, 1920, 3200` |
| **Formats** | `avif` and `webp` always, plus the original (`jpeg` or `png`) |
| **Fields**  | `url`, `key`, `width`, `height`, `size`                       |

**The width ladder is capped at the source image's own width, so it differs per image.** A 1200px
original yields `100/200/500/768/1024`; a 500px original yields only `100/200/500`. In a sample of 80
images, eight distinct width sets appeared.

**Never hardcode the ladder.** Build `srcset` from the variants the API returned for _that_ image, or
you will emit URLs that 404 and a browser that picks them will show nothing.

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

On **Discovery** you can also trim the payload server-side — `variants` takes arguments:

```graphql
variants(types: "webp", minWidth: 400, maxWidth: 1600) {
    url
    width
    size
}
```

Useful for a listing page that will never render a 3200px hero. Catalogue's `variants` takes no
arguments — filter client-side there.

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
- sets `width`/`height` from the largest variant, which is what prevents layout shift
- resolves `alt` as `alt` → `altText` (from the API) → `fallbackAlt` → `""`

What it does **not** do, and you must:

- **pass `sizes`** — it has no default, see below
- pass `loading` and `fetchPriority` — they forward to the `<img>`, but nothing is set automatically

Two surprises worth knowing before you style it:

- It always renders `<figure>` wrapping `<picture>`, **plus a `<figcaption>` even when empty**. Budget
  for that in CSS, or use the render-prop escape hatch.
- `_availableSizes` / `_availableFormats` synthesize URLs from the `@{width}` scheme instead of using
  `variants`. Because the ladder is per-image, this can invent URLs that do not exist. Prefer passing
  real `variants`.

For full markup control, pass a function as `children` and receive
`{ srcSet, srcSetWebp, srcSetAvif, useAvif, useWebP, sizes, media, src, alt, width, height, originalFileExtension }`.

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
  from the largest variant; if you hand-roll, do it yourself. This is the entire fix for image-driven
  layout shift.
- **Do not lazy-load images already in the viewport** on first paint — the request starts later than
  it needs to.

## Failure modes

| Symptom                                  | Cause                                             | Fix                                         |
| ---------------------------------------- | ------------------------------------------------- | ------------------------------------------- |
| Thumbnails download 1024px files         | `sizes` missing — browser assumed `100vw`         | Write `sizes` to match the rendered width   |
| Both AVIF and WebP `<source>` emitted    | `size` not selected in the GraphQL query          | Add `size` to `variants`                    |
| Images heavier after "upgrading" to AVIF | AVIF is usually larger here                       | Ship WebP; keep the original as fallback    |
| Some `srcset` URLs 404                   | Width ladder hardcoded, or `_availableSizes` used | Build `srcset` from the returned `variants` |
| Page jumps as images load                | No `width`/`height` on the `<img>`                | Render both; they set the aspect ratio      |
| Poor LCP on the product page             | Hero is `loading="lazy"`                          | `eager` + `fetchPriority="high"`            |
| Image bill higher than expected          | Images routed through a framework optimizer       | Serve straight from `media.crystallize.com` |
| `alt` is empty everywhere                | `altText` not selected, or not authored           | Query `altText`; author it in the PIM       |

## Related skills

[[query]] covers the Catalogue and Discovery queries these fields come from, and
[[content-model]] covers the Images component itself — including that product variant images are
built-in rather than components. [[mutation]] covers uploading images and setting `altText`.
