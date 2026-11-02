# Responsive Crystallize Images Without React

The `@crystallize/reactjs-components` `Image` component is React-only. Everywhere else — Svelte, Vue,
Astro, Remix loaders emitting plain HTML, email templates, server-rendered templates — build the same
markup by hand. This page is the fallback, not the recommendation: if you are in React, use the
component.

## What you are reproducing

```html
<picture>
    <source type="image/webp" srcset="…400w, …800w, …1200w" sizes="…" />
    <source type="image/jpeg" srcset="…400w, …800w, …1200w" sizes="…" />
    <img src="…fallback.jpeg" alt="…" width="1200" height="800" loading="lazy" />
</picture>
```

Four things make it correct:

1. One `<source>` per format, **modern format first** — the browser takes the first it supports.
2. `srcset` entries carry `w` descriptors matching the file's real pixel width.
3. `sizes` is present on every `<source>` **and** describes the rendered width, not the file width.
4. `<img>` carries `src` (fallback), `alt`, `width`, `height`.

## Building it from the API response

```ts
type Variant = { url: string; width: number; height?: number; size?: number };

const extOf = (url: string) => url.split(".").pop()!.toLowerCase();

const srcsetFor = (variants: Variant[], ext: string) =>
    variants
        .filter((v) => extOf(v.url) === ext)
        .sort((a, b) => a.width - b.width)
        .map((v) => `${v.url} ${v.width}w`)
        .join(", ");
```

**Build from the variants the API returned.** The width ladder is capped at the source image's own
width, so it differs per image — a hardcoded list produces URLs that 404.

### Choosing the modern format

Ship **one** modern format. Two `<source>` elements do not make the page faster; the browser takes the
first it supports, and on Crystallize's current transcoder output that is usually the larger file.

```ts
/** Pick the smaller of webp/avif at a common width; default to webp. */
function pickModernFormat(variants: Variant[]): "webp" | "avif" {
    const at = (ext: string) =>
        variants.filter((v) => extOf(v.url) === ext && v.size).sort((a, b) => a.width - b.width);
    const [webp] = at("webp");
    const [avif] = at("avif");
    if (!webp?.size || !avif?.size) return "webp";
    return avif.size < webp.size ? "avif" : "webp";
}
```

This mirrors what the React component does. It needs `size` in the query — without it, default to
`webp`, which wins the large majority of the time.

Original-format variants exist only for `jpeg` and `png` sources, and a `.jpg` source gets `.jpeg`
variants. Derive the format rather than assuming:

```ts
const originalExt = (image: { url: string }) => {
    const ext = extOf(image.url);
    return ext === "jpg" ? "jpeg" : ext;
};
```

### Putting it together

```ts
function pictureHtml(
    image: { url: string; altText?: string; width?: number; height?: number; variants?: Variant[] | null },
    sizes: string,
) {
    const variants = image.variants ?? [];
    const modern = pickModernFormat(variants);
    const original = originalExt(image);
    const biggest = [...variants].sort((a, b) => b.width - a.width)[0];
    const sources = [...new Set([modern, original])]
        .map((ext) => ({ ext, srcset: srcsetFor(variants, ext) }))
        .filter(({ srcset }) => srcset)
        .map(({ ext, srcset }) => `<source type="image/${ext}" srcset="${srcset}" sizes="${sizes}">`)
        .join("\n  ");

    return `
<picture>
  ${sources}
  <img src="${image.url}" alt="${image.altText ?? ""}"
       width="${biggest?.width ?? image.width ?? ""}" height="${biggest?.height ?? image.height ?? ""}" loading="lazy">
</picture>`;
}
```

`variants` is `null` on Catalogue and `[]` on Discovery until they are generated, and for a source under
100px wide. A WebP, AVIF or TIFF source has no original-format variants. In those cases there is no
`<source>` to emit, and `<img src>` carries the image.

Escape `altText` for the target context — it is author-entered content, not a literal.

## Art direction: a different crop per breakpoint

`sizes` picks a _size_. When you need a different _image_ — a tall portrait crop on mobile, a wide one
on desktop — that is `media`, and it takes separate `<source>` elements:

```html
<picture>
    <source media="(max-width: 600px)" type="image/webp" srcset="…portrait srcset…" sizes="100vw" />
    <source type="image/webp" srcset="…landscape srcset…" sizes="(max-width: 1200px) 100vw, 1200px" />
    <img src="…" alt="…" width="1600" height="900" />
</picture>
```

Two different crops are two different images in the PIM. Do not try to fake art direction with
`object-fit` alone — see focal point below for the case where one image is genuinely enough.

## Focal point

`focalPoint` (`{ x, y }`, normalized 0–1) is authored in the PIM and tells you where the subject is.
It is what makes a single image survive being cropped to different aspect ratios. Select
`focalPoint { x y }` on Catalogue. On Discovery it is a scalar: select plain `focalPoint`, and an image
without one returns `{}`, not `null`, so test `x`, not the object:

```css
.card-image {
    aspect-ratio: 4 / 3;
    object-fit: cover;
    object-position: var(--focal-x, 50%) var(--focal-y, 50%);
}
```

```ts
const focal = image.focalPoint;
const style = focal?.x != null ? `--focal-x:${focal.x * 100}%;--focal-y:${focal.y * 100}%` : "";
```

Without it, `object-fit: cover` crops from the centre and decapitates people in portrait shots.

## Don't

- **Don't route these URLs through a framework image optimizer.** The variants are already static
  files on the CDN; re-optimizing yields no smaller file and bills you for the transform and the
  egress. See Rule 0 in SKILL.md.
- **Don't omit `sizes`.** The browser then assumes `100vw` and downloads the largest candidate for a
  200px thumbnail.
- **Don't put `sizes` only on the `<img>`.** Each `<source>` needs it too; `<img>`-only leaves the
  `<source>` elements defaulting to `100vw`.
- **Don't lazy-load the LCP image.** The hero gets `loading="eager"` and `fetchpriority="high"`.
- **Don't hardcode the width ladder.** It is capped per image at the source width.
