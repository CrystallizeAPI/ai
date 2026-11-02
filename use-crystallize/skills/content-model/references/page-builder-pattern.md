# Crystallize Page Builder Design Pattern

> Based on the Furnitut reference implementation — `landing-page` and `category` shapes in `content-model.json`

---

## Overview

The **Page Builder pattern** in Crystallize lets content editors compose flexible page layouts from a curated set of reusable section types — without needing developer involvement for every new page. It is built on three Crystallize primitives working together:

1. **`componentMultipleChoice`** — the "block slot" on a page shape that holds an ordered list of sections
2. **Pieces** — self-contained, reusable section definitions (the actual blocks)
3. **A shared `layout` piece** — a styling contract embedded in every block piece, giving editors per-block visual control

The pattern is intentionally editor-friendly: add blocks in any order, repeat the same block type multiple times, and control each block's theme and width independently.

---

## The Three Core Primitives

### 1. `componentMultipleChoice` — The Block Slot

This is the backbone of the page builder. A shape (e.g. `landing-page`, `category`) gets a single component named `blocks` of type `componentMultipleChoice`. Each choice in the config references a piece by identifier.

```json
{
    "id": "blocks",
    "type": "componentMultipleChoice",
    "name": "Blocks",
    "config": {
        "componentMultipleChoice": {
            "multilingual": true,
            "allowDuplicates": true,
            "choices": [
                {
                    "id": "banner",
                    "name": "Banner",
                    "type": "piece",
                    "config": { "piece": { "identifier": "banner" } }
                },
                {
                    "id": "feature-highlights",
                    "name": "Feature Highlights",
                    "type": "piece",
                    "config": { "piece": { "identifier": "feature-highlights" } }
                },
                {
                    "id": "product-slider",
                    "name": "Product Slider",
                    "type": "piece",
                    "config": { "piece": { "identifier": "product-slider" } }
                },
                {
                    "id": "story-slider",
                    "name": "Story Slider",
                    "type": "piece",
                    "config": { "piece": { "identifier": "story-slider" } }
                },
                {
                    "id": "picture-grid",
                    "name": "Picture Grid",
                    "type": "piece",
                    "config": { "piece": { "identifier": "picture-grid" } }
                },
                {
                    "id": "category-slider",
                    "name": "Category Slider",
                    "type": "piece",
                    "config": { "piece": { "identifier": "category-slider" } }
                }
            ]
        }
    }
}
```

Key flags:

- **`allowDuplicates: true`** — editors can use the same block type multiple times on the same page (e.g. two separate banners)
- **`multilingual: true`** (localized structure) — different languages/markets can have **completely different blocks selected**. See [Localized Structure](#localized-structure-multilingual) below.
- **`required: true`** — the page needs at least one section. `componentMultipleChoice` has no `min` or `max`, so the number of blocks cannot be capped

### 2. Block Pieces — The Reusable Sections

Each block is a `piece` shape with its own component set. Pieces are defined once and referenced by multiple shapes — both `landing-page` and `category` share the exact same set of blocks in Furnitut.

| Piece identifier     | What it renders                              | Key components                                         |
| -------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `banner`             | Full-width hero/promotional section          | title, description, image, call-to-action, layout      |
| `feature-highlights` | USP grid (repeatable icon + headline + copy) | usp (contentChunk, repeatable), layout                 |
| `product-slider`     | Curated horizontal product carousel          | title, description, itemRelations → products, layout   |
| `story-slider`       | Editorial story carousel                     | title, description, itemRelations → stories, layout    |
| `picture-grid`       | Fixed 4-image visual grid                    | title, description, images (min/max: 4), layout        |
| `category-slider`    | Category navigation carousel                 | title, description, itemRelations → categories, layout |

### 3. The `layout` Piece — Shared Styling Contract

Every block piece embeds the `layout` piece as a component. This gives editors per-block visual control without duplicating the config across pieces.

```json
{
    "identifier": "layout",
    "name": "Layout",
    "components": [
        {
            "id": "display-width",
            "name": "Display Width",
            "type": "selection",
            "config": {
                "selection": {
                    "options": [
                        { "key": "stretch", "value": "Stretch", "label": "Stretch" },
                        { "key": "contain", "value": "Contain", "label": "Contain" }
                    ]
                }
            }
        },
        {
            "id": "theme",
            "name": "Theme",
            "type": "selection",
            "config": {
                "selection": {
                    "options": [
                        { "key": "light", "value": "Light", "label": "Light" },
                        { "key": "dark", "value": "Dark", "label": "Dark" },
                        { "key": "muted", "value": "Muted", "label": "Muted" },
                        { "key": "pastel", "value": "Pastel", "label": "Pastel" },
                        { "key": "vivid", "value": "Vivid", "label": "Vivid" }
                    ]
                }
            }
        },
        {
            "id": "background-media",
            "name": "Background Media",
            "type": "componentChoice",
            "config": {
                "componentChoice": {
                    "choices": [
                        { "id": "image", "name": "Image", "type": "images" },
                        { "id": "video", "name": "Video", "type": "videos" }
                    ]
                }
            }
        }
    ]
}
```

- **`display-width`**: `stretch` (full bleed) or `contain` (max-width wrapper). Default: `contain`.
- **`theme`**: Controls colour palette of the block. Default: `light`.
- **`background-media`**: Optional image or video background — uses `componentChoice` for mutual exclusivity (one or the other, not both). Note: `componentChoice` is valid inside a piece; the nesting restriction only applies to direct children of structural components.

---

## Minimal Example

**Problem:** Editors need flexible page layouts with different section types.

**Solution:** componentMultipleChoice with piece references, each piece containing repeating chunks for items.

```json
// Folder Shape: Landing Page (folders can have children, documents cannot)
{
  "components": [
    {
      "id": "blocks",
      "name": "Page Sections",
      "type": "componentMultipleChoice",
      "config": {
        "componentMultipleChoice": {
          "allowDuplicates": true,
          "choices": [
            { "id": "banner", "name": "Banner", "type": "piece", "config": { "piece": { "identifier": "banner-section" } } },
            { "id": "usp", "name": "USP", "type": "piece", "config": { "piece": { "identifier": "usp-section" } } },
            { "id": "hero", "name": "Hero", "type": "piece", "config": { "piece": { "identifier": "hero-section" } } }
          ]
        }
      }
    }
  ]
}

// Piece: banner-section
{
  "identifier": "banner-section",
  "name": "Banner Section",
  "components": [
    { "id": "title", "name": "Title", "type": "singleLine" },
    { "id": "description", "name": "Description", "type": "richText" },
    { "id": "background", "name": "Background", "type": "images" },
    {
      "id": "ctas",
      "name": "Call to Actions",
      "type": "contentChunk",
      "config": {
        "contentChunk": {
          "repeatable": true,
          "components": [
            { "id": "text", "name": "Text", "type": "singleLine" },
            { "id": "url", "name": "URL", "type": "singleLine" }
          ]
        }
      }
    }
  ]
}

// Piece: usp-section
{
  "identifier": "usp-section",
  "name": "USP Section",
  "components": [
    { "id": "title", "name": "Title", "type": "singleLine" },
    {
      "id": "items",
      "name": "USP Items",
      "type": "contentChunk",
      "config": {
        "contentChunk": {
          "repeatable": true,
          "components": [
            { "id": "icon", "name": "Icon", "type": "images" },
            { "id": "title", "name": "Title", "type": "singleLine" },
            { "id": "description", "name": "Description", "type": "richText" }
          ]
        }
      }
    }
  ]
}
```

**Key points:**

- componentMultipleChoice contains pieces (banner-section, usp-section, hero-section)
- Each piece contains regular components and repeating chunks for items
- Chunks (CTAs, USP items) are inside pieces, not direct children of componentMultipleChoice
- This allows editors to build pages with flexible, reusable sections

---

## Localized Structure (`multilingual`)

The `multilingual: true` flag on `componentMultipleChoice` enables **localized structure** — called "Yes - choice varies per language" in the Crystallize PIM UI. This is the **default in the UI and the recommended setting** for page builder blocks. The API default is the opposite, so set it explicitly in mass operations and mutations.

### What it means

With localized structure enabled, each language/market gets its own **independent selection and ordering of blocks**. This is not just about translating text inside the same blocks — the entire page composition can differ:

| Market   | Blocks on landing page                                      |
| -------- | ----------------------------------------------------------- |
| English  | Hero Banner → Product Slider → Testimonials → CTA Banner    |
| German   | Hero Banner → Feature Highlights → Product Slider           |
| French   | Video Section → Category Slider → Story Slider → Banner     |
| Japanese | Banner → Picture Grid → Product Slider → Feature Highlights |

### Why this is the default recommendation

Experience shows that different markets rarely want identical page layouts. Common reasons:

- **Merchandising differences** — The German market may prioritize a product launch that isn't relevant in France
- **Seasonal campaigns** — Summer campaign blocks in the Northern Hemisphere while Southern Hemisphere markets show winter content
- **Regulatory content** — Some markets require specific disclosure sections
- **Cultural preferences** — Image-heavy layouts for some markets, text-heavy for others
- **Product availability** — Only show product sliders for categories available in that market

### When you might NOT want localized structure

In rare cases, you want all languages to share the same block selection (only translating content within blocks):

- A brand with strictly identical global page layouts enforced by HQ
- Technical/documentation pages where structure must be consistent across languages
- When the editorial team is small and manages all languages from one view

In these cases, leave `multilingual` out rather than setting it to `false`: an explicit `false` forces every component inside the blocks to be shared, so their text could no longer be translated. This is the exception, not the rule.

---

## Supporting Patterns Within Pieces

### `componentChoice` — Exclusive Alternatives

Used when a field should have one value from a set of _structurally different_ types. Examples:

- `layout.background-media`: image **or** video
- `story.media`: image, shoppable-image, **or** video
- `menu-item.link`: a raw URL **or** an item relation

```json
{
    "id": "background-media",
    "name": "Background Media",
    "type": "componentChoice",
    "config": {
        "componentChoice": {
            "choices": [
                { "id": "image", "name": "Image", "type": "images" },
                { "id": "video", "name": "Video", "type": "videos" }
            ]
        }
    }
}
```

Use `componentChoice` (not `componentMultipleChoice`) when only _one_ option should be active at a time.

### `contentChunk` — Repeatable Inline Groups

Used inside a piece when you need an editor-managed list of structured items that don't warrant their own shape. Examples:

- `feature-highlights.usp`: repeatable `{headline, description, icon}` group
- `product.details`: repeatable `{title, description}` tab/accordion content
- `call-to-action.action`: repeatable `{label, url}` button list

```json
{
    "id": "usp",
    "name": "USP",
    "type": "contentChunk",
    "config": {
        "contentChunk": {
            "repeatable": true,
            "components": [
                { "id": "headline", "name": "Headline", "type": "singleLine" },
                { "id": "description", "name": "Description", "type": "richText" },
                { "id": "icon", "name": "Icon", "type": "images" }
            ]
        }
    }
}
```

Use `contentChunk` for inline-repeated groups. Use `itemRelations` when those items need to exist as their own content items (e.g. products, stories, categories).

### Shared Utility Pieces

Beyond `layout`, other pieces serve as shared field groups embedded across shapes:

| Piece            | Used by                                        | Purpose                               |
| ---------------- | ---------------------------------------------- | ------------------------------------- |
| `call-to-action` | `banner`                                       | Repeatable `{label, url}` CTA buttons |
| `meta`           | `landing-page`, `category`, `product`, `story` | SEO title, description, image         |
| `dimensions`     | `product`, product variant                     | Physical measurements (W/H/D/weight)  |

---

## Pattern Architecture Diagram

```
landing-page (document shape)
└── blocks [componentMultipleChoice, allowDuplicates, multilingual]
    ├── banner (piece)
    │   ├── title, description
    │   ├── call-to-action (piece) → action [contentChunk, repeatable]
    │   ├── banner image
    │   └── layout (piece) → display-width, theme, background-media [componentChoice]
    ├── feature-highlights (piece)
    │   ├── usp [contentChunk, repeatable] → headline, description, icon
    │   └── layout (piece)
    ├── product-slider (piece)
    │   ├── title, description
    │   ├── products [itemRelations → product shape]
    │   └── layout (piece)
    ├── story-slider (piece)
    │   └── stories [itemRelations → story shape]
    ├── picture-grid (piece)
    │   └── images (fixed 4)
    └── category-slider (piece)
        └── categories [itemRelations → category shape]

category (folder shape)  ← same blocks component as landing-page
└── blocks [componentMultipleChoice]  (same 6 choices)
```

---

## Best Practices

### Modelling

**Keep block pieces focused.** Each piece should represent one distinct visual section type. Avoid adding optional fields that turn one piece into two different things — make two pieces instead.

**Always embed `layout` in every block piece.** This is the styling contract. Editors expect to be able to control width and theme per block. If a block genuinely can't vary (e.g. a fixed-dimension widget), document why `layout` is omitted rather than forgetting it.

**Use `allowDuplicates: true` on the `blocks` field.** Pages frequently need two banners (hero + mid-page CTA) or two product sliders (featured + related). Lock this down only if there is a real business reason to prevent it.

**Use `multilingual: true` (localized structure) on the `blocks` field.** This is the default in the Crystallize PIM UI and is the recommended setting. Different markets almost always need different page compositions for merchandising, campaigns, and cultural reasons. Only disable it when all languages must share identical block structure.

**Use `componentChoice` for media fields** (`background-media`, story `media`). It enforces the "image OR video" constraint at the data model level rather than relying on frontend logic.

**Use `contentChunk` with `repeatable: true` for inline lists** (USP items, CTA buttons, detail tabs). Use `itemRelations` when the items are independently managed content (products, stories, categories).

### Frontend Rendering

**Switch on block id to render.** In the Catalogue API the blocks are in `ComponentMultipleChoiceContent.selectedComponents`, and the discriminator is each entry's `id`, which is the `id` of the chosen option. `type` is `piece` for every block, so it tells you nothing. Map each id to its React/component.

```js
// Example pattern
selectedComponents.map((block) => {
    switch (block.id) {
        case "banner":
            return <Banner {...block} />;
        case "feature-highlights":
            return <FeatureHighlights {...block} />;
        case "product-slider":
            return <ProductSlider {...block} />;
        // ...
    }
});
```

**Apply `layout` values as wrapper props**, not inside the block component itself. This keeps block components pure and reusable outside of the page builder context.

```jsx
<BlockWrapper
    displayWidth={block.layout.displayWidth} // "stretch" | "contain"
    theme={block.layout.theme} // "light" | "dark" | ...
    backgroundMedia={block.layout.backgroundMedia}
>
    <Banner {...block} />
</BlockWrapper>
```

**Handle `allowDuplicates`.** The same piece type can appear more than once, and entries of the same type share their `id`. Use the array index as the React key, not the block type name.

### Schema Governance

**Centralise shared pieces** (`layout`, `meta`, `call-to-action`). If you need to add a new theme option (e.g. `"brand"`), you change it in one place and it propagates to all blocks automatically.

**Add blocks by extending `componentMultipleChoice` choices** — not by creating parallel block fields. A single `blocks` field keeps rendering logic, ordering, and multilingual handling unified.

**Reuse the same `blocks` definition across shapes** (`landing-page` and `category` in Furnitut are identical). Consider whether a category page and a landing page genuinely need different block sets, or whether shared blocks reduce maintenance.

---

## When to Use This Pattern

✅ Pages where editors need to compose sections freely (home page, campaign pages, category pages, editorial pages)
✅ When the same visual components should be reusable across multiple page types
✅ When per-block theming/layout control is required
✅ When the number of section types is bounded and known (not user-generated)
✅ When different markets/languages need different page compositions (localized structure)

⛔ Deep product detail pages with fixed, structured layouts (use explicit components instead)
⛔ When section order is always fixed by business rules (a simple flat component set is clearer)
⛔ When blocks need complex inter-block relationships (e.g. block A controls block B)
