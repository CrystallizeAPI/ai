---
name: taxonomy
description: Design topic maps (taxonomies) for Crystallize PIM. Plan hierarchical classification systems used to tag and categorize products, documents, and media; enable faceted navigation and filtering; power search and discovery; and create cross-category collections. Use when the user wants to design a topic map, build a taxonomy, plan filters/facets for a storefront, model attributes like color/size/material/style/season, classify content (categories, difficulty, content type), organize brands/origins/certifications, design temporal tags (seasons, collections, events), generate the `topicTree` JSON for topics, or ship a topic tree to a tenant with `createTopic`. Also use when the user mentions classification, tagging, facets, filters, attribute taxonomies, or cross-cutting tags for items in Crystallize — even if they don't explicitly say "topic map" or "taxonomy".
metadata:
    author: Crystallize
    version: "1.0"
---

# Crystallize Taxonomy Skill

Design and generate topic maps (taxonomies) for Crystallize PIM. This skill produces the `topicTree` JSON used to create hierarchical classification systems that tag and categorize catalogue items, power faceted navigation, and drive search and discovery.

Topic maps are one of the three organization systems in Crystallize. Folders define **where** an item lives (single hierarchy) — see [[information-architecture]] for that. Topics define **what** an item is about (multi-dimensional, multiple tags per item). `topics` is a built-in field on items and variants, so a shape needs no component to carry them: there is no topic component type. Shape design is covered in [[content-model]]. To write topics to a tenant, see Shipping a Topic Tree below.

## Consultation Approach

Before generating a topic map, understand how customers will filter and browse. Ask clarifying questions, then propose a concrete tree and iterate.

### Key Discovery Questions

1. **What will users filter or browse by?**
    - "Which attributes do customers care about when filtering — color, size, material, brand, price tier, season?"
    - "Are there filters specific to your category (e.g., fragrance family for perfume, allergens for food, body type for guitars)?"

2. **One tag or many per item?**
    - "Can an item belong to multiple topics in this map, or should they be mutually exclusive?"
    - Example: a t-shirt has one Size but can have multiple Materials.

3. **How deep should the hierarchy go?**
    - "Are these flat labels, or do they roll up into parent groups (e.g., Reds → Light Red, Crimson)?"

4. **Content classification or product attributes?**
    - "Are we tagging products, content (articles, guides), or both?"

5. **Temporal or stable?**
    - "Will these topics evolve over time (seasonal collections, sale events) or stay stable (sizes, colors)?"

After 2–3 answers, propose an initial tree with colors assigned. Concrete proposals get better feedback than abstract questions.

## Core Concepts

### What is a Topic Map?

A topic map is a hierarchical classification system used to:

- **Tag and categorize** products, variants, documents, folders, and media
- **Enable faceted navigation** and filtering on the storefront
- **Power search and discovery** via the Discovery API
- **Create cross-category collections** ("all red items", "all summer items")
- **Organize images** and other media

Each tenant can have **many topic maps** — one per facet (Colors, Sizes, Materials, Styles, etc.). An item can carry topics from multiple maps simultaneously. A topic map is not a separate object in the API: it is a root topic, one with no `parentId`.

### Topic Properties

| Property         | Description                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`           | Display name shown to editors and (optionally) on the storefront                                                                             |
| `pathIdentifier` | URL-safe identifier (lowercase, hyphens) — becomes the last segment of the topic's `path` (`/colors/reds`). Derived from `name` when omitted |
| `displayColor`   | Hex color (`#rrggbb`; the API also takes `#rgb` and `#rrggbbaa`) for visual distinction in the editor and UI                                 |
| `parentId`       | Reference to a parent topic (for nesting)                                                                                                    |
| `children`       | Array of child topics                                                                                                                        |
| `meta`           | Key/value pairs for short machine data (e.g. an ERP code), readable from the Core API and Discovery                                          |

`displayColor` is optional in the API: the Crystallize app then shows the nearest ancestor's color, but the APIs return only the topic's own value. It is **required** in every topic generated by this skill — see Color Guidelines below.

## Color Guidelines

Every topic gets a `displayColor`. The right color depends on what the topic represents.

### 1. Color-Named Topics → use the actual color

When a topic represents a literal color, the `displayColor` is that color. Don't use a hierarchy gradient here — match the name.

| Family   | Default                          | Lighter             | Darker              |
| -------- | -------------------------------- | ------------------- | ------------------- |
| Red      | `#e53935`                        | Light Red `#ef9a9a` | Deep Red `#b71c1c`  |
| Blue     | `#1e88e5`                        | Sky Blue `#90caf9`  | Navy `#0d47a1`      |
| Green    | `#43a047`                        | Emerald `#00c853`   | Forest `#1b5e20`    |
| Yellow   | `#fdd835`                        | Gold `#ffc107`      | Amber `#ff8f00`     |
| Purple   | `#8e24aa`                        | Lavender `#e1bee7`  | Violet `#7c4dff`    |
| Orange   | `#fb8c00`                        | Peach `#ffab91`     | Coral `#ff7043`     |
| Pink     | `#ec407a`                        | Blush `#f8bbd9`     | Rose `#f06292`      |
| Brown    | `#795548`                        | Tan `#d7ccc8`       | Chocolate `#4e342e` |
| Neutrals | Black `#212121`, Gray `#757575`  | White `#fafafa`     | —                   |
| Cream    | Beige `#f5f5dc`, Cream `#fffdd0` | Ivory `#fffff0`     | —                   |

### 2. Non-Color Topics → use a hierarchy gradient

For topics that aren't colors (Materials, Sizes, Seasons, etc.), use a color **family** for the root and progressively lighter/less saturated shades as you go deeper.

| Level    | Saturation         | Example tones        |
| -------- | ------------------ | -------------------- |
| Root     | Saturated, vibrant | `#f59e0b`, `#3b82f6` |
| Level 1  | Slightly lighter   | `#fbbf24`, `#60a5fa` |
| Level 2+ | More muted         | `#fcd34d`, `#93c5fd` |

### 3. Category Color Families

Each root topic map gets its own thematic color family so the maps are visually distinct in the editor:

| Topic Map | Family             | Root tone                                                            |
| --------- | ------------------ | -------------------------------------------------------------------- |
| Materials | Browns/earth tones | `#795548`                                                            |
| Sizes     | Blues              | `#3b82f6`                                                            |
| Styles    | Purples            | `#8e24aa`                                                            |
| Seasons   | Seasonal tones     | Spring `#43a047`, Summer `#fdd835`, Fall `#fb8c00`, Winter `#90caf9` |
| Brands    | Neutrals/grays     | `#757575`                                                            |

### Color Quick Reference

- **Color topic?** → use that color.
- **Not a color topic?** → pick a family for the root, then lighten as you descend.
- **Always set `displayColor`** — never leave it unset.

## Topic Map Design Principles

1. **Flat vs. Deep** — Flat works for stable, exclusive attributes (Size: S/M/L/XL). Deep works for layered classifications (Fragrance → Fresh → Citrus → Bergamot).
2. **Mutually Exclusive vs. Overlapping** — Decide up front whether items can carry multiple topics from this map. Sizes typically exclusive; Materials often overlapping. Crystallize does not enforce this: an item can carry any topics from any map, up to 250 per item.
3. **User-Centric** — Design for how customers think when filtering, not how the internal team categorizes inventory.
4. **Consistent Depth** — Within a single topic map, keep branches at similar depth. Don't put `Reds → Light Red` next to `Blues` (no children) without a reason.
5. **5–10 topics per level** — Beyond that, filters become overwhelming. Group or split into sub-topics.
6. **Plan for Growth** — Leave headroom for new entries. A flat list of 4 colors becomes painful at 40; nest early if you expect growth.
7. **Multiple maps = multiple facets** — One topic map per filter axis. Colors, Sizes, Materials = three maps, three facets in the storefront. Discovery returns all maps in one `topics` facet, so the storefront splits it by root path — see Topics in Discovery.

## Common Topic Map Types

**Product Attributes** — Colors, Sizes, Materials, Styles, Fit
**Content Classification** — Categories, Difficulty (Beginner/Intermediate/Advanced), Content Type (Video/Article/Guide)
**Brand & Origin** — Brands (by tier or alphabetical), Countries/Regions, Certifications (Organic, Fair Trade)
**Temporal** — Seasons, Collections (2024, 2025), Events (Sale, New Arrival, Limited Edition)

If the classification needs **rich content** (a brand logo, an allergen warning, a wood-type description) rather than just a label, model it as a Document shape with Item Relations instead — see the Semantic Bridge pattern in [[content-model]]. Topic maps are for labels; documents are for content.

## Example Topic Structures

### Fashion Colors (2 levels, color-named topics)

```
Colors (displayColor: "#f59e0b")
├── Reds (displayColor: "#e53935")
│   ├── Light Red (displayColor: "#ef9a9a")
│   ├── Deep Red (displayColor: "#b71c1c")
│   └── Crimson (displayColor: "#dc143c")
├── Blues (displayColor: "#1e88e5")
│   ├── Sky Blue (displayColor: "#90caf9")
│   ├── Navy (displayColor: "#0d47a1")
│   └── Royal Blue (displayColor: "#4169e1")
├── Greens (displayColor: "#43a047")
│   ├── Emerald (displayColor: "#50c878")
│   ├── Forest (displayColor: "#228b22")
│   └── Olive (displayColor: "#808000")
└── Neutrals (displayColor: "#9e9e9e")
    ├── White (displayColor: "#fafafa")
    ├── Gray (displayColor: "#757575")
    ├── Black (displayColor: "#212121")
    └── Beige (displayColor: "#f5f5dc")
```

### Materials (3 levels, hierarchy gradient)

```
Materials (displayColor: "#795548")
├── Metals (displayColor: "#9e9e9e")
│   ├── Precious (displayColor: "#ffd700")
│   │   ├── Gold (displayColor: "#ffd700")
│   │   ├── Silver (displayColor: "#c0c0c0")
│   │   └── Platinum (displayColor: "#e5e4e2")
│   └── Common (displayColor: "#b0bec5")
├── Textiles (displayColor: "#8d6e63")
│   ├── Natural (displayColor: "#a1887f")
│   └── Synthetic (displayColor: "#90a4ae")
└── Wood (displayColor: "#6d4c41")
    ├── Hardwood (displayColor: "#5d4037")
    └── Softwood (displayColor: "#a1887f")
```

### Fragrances (4 levels, perfume classification)

```
Fragrances (displayColor: "#9c27b0")
├── Fresh (displayColor: "#4caf50")
│   ├── Citrus (displayColor: "#ffc107")
│   │   ├── Lemon (displayColor: "#fff176")
│   │   ├── Orange (displayColor: "#ff9800")
│   │   └── Bergamot (displayColor: "#aed581")
│   ├── Green (displayColor: "#8bc34a")
│   │   ├── Herbal (displayColor: "#c5e1a5")
│   │   └── Mint (displayColor: "#a5d6a7")
│   └── Fruity (displayColor: "#e91e63")
│       ├── Apple (displayColor: "#c8e6c9")
│       ├── Peach (displayColor: "#ffccbc")
│       └── Berries (displayColor: "#ce93d8")
├── Floral (displayColor: "#f06292")
│   ├── White Floral (displayColor: "#fff9c4")
│   └── Rose (displayColor: "#f48fb1")
├── Oriental (displayColor: "#ff5722")
│   ├── Amber (displayColor: "#ffb74d")
│   └── Soft Oriental (displayColor: "#ffccbc")
└── Woody (displayColor: "#795548")
    ├── Dry Woods (displayColor: "#a1887f")
    └── Aromatic Woods (displayColor: "#d7ccc8")
```

## Output Format

Generate topic maps as a `topicTree` JSON document. `displayColor` is required on every topic. `topicTree` is this skill's design format, not an API payload: see Shipping a Topic Tree before writing it to a tenant.

```json
{
    "topicTree": [
        {
            "id": "colors",
            "name": "Colors",
            "pathIdentifier": "colors",
            "displayColor": "#f59e0b",
            "children": [
                {
                    "id": "reds",
                    "name": "Reds",
                    "pathIdentifier": "reds",
                    "displayColor": "#e53935",
                    "children": [
                        {
                            "id": "light-red",
                            "name": "Light Red",
                            "pathIdentifier": "light-red",
                            "displayColor": "#ef9a9a",
                            "children": []
                        },
                        {
                            "id": "crimson",
                            "name": "Crimson",
                            "pathIdentifier": "crimson",
                            "displayColor": "#dc143c",
                            "children": []
                        }
                    ]
                },
                {
                    "id": "blues",
                    "name": "Blues",
                    "pathIdentifier": "blues",
                    "displayColor": "#1e88e5",
                    "children": [
                        {
                            "id": "navy",
                            "name": "Navy",
                            "pathIdentifier": "navy",
                            "displayColor": "#0d47a1",
                            "children": []
                        }
                    ]
                }
            ]
        }
    ]
}
```

### Rules

1. `id` is URL-friendly — lowercase, hyphens, no spaces or special characters. It is a key local to this document: the API generates the real topic id.
2. `pathIdentifier` matches the `id`.
3. `displayColor` is **required** on every topic. Follow the Color Guidelines above.
4. `children` is always an array — use `[]` for leaf nodes.
5. Names are clear, consistent, and use the same casing/style across siblings.
6. Color-named topics use the actual color as `displayColor`.
7. Non-color topics use a hierarchy gradient (root saturated, descendants lighter).

## Shipping a Topic Tree

No API accepts a `topicTree` document as it stands. Each root is one write: `createTopic` on the Core API, or `topic/create` in a [[mass-operations]] file.

```graphql
mutation {
    createTopic(
        language: "en"
        input: {
            name: "Colors"
            pathIdentifier: "colors"
            displayColor: "#f59e0b"
            children: [
                { name: "Reds", pathIdentifier: "reds", children: [{ name: "Crimson", pathIdentifier: "crimson" }] }
            ]
        }
    ) {
        ... on Topic {
            id
            path
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

A write takes less than the design holds:

- **No `id`.** The API generates topic ids. `createTopic` rejects an `id` field and `topic/create` silently drops it.
- **No `displayColor` on nested `children`.** They take `name`, `pathIdentifier` and `children`, plus `meta` on `createTopic`. `createTopic` rejects a nested color and `topic/create` silently drops it. To color every topic, write one topic at a time, top-down, with the parent's id as `parentId`, or set the colors afterwards with `updateTopic(id:, language:, input: { displayColor: "#e53935" })`. [[mass-operations]] documents the `_ref` output to take that id from.
- **30 topics per write**, counting the root and all its descendants. Split a larger tree and attach each part with `parentId`.
- **One language per write.** Translate with `updateTopic(id:, language:, input: { name: "Farger" })`, parents first: a topic cannot be created or translated in a language its parent lacks.

After the first write:

- **A second write does not merge.** Sibling names (case-insensitive) and path identifiers are unique per language, so running the same `createTopic` twice fails. For a re-runnable import, use `topic/upsert` with a `resourceIdentifier` — see [[mass-operations]].
- **Renaming moves the path.** `updateTopic` with a `name` and no `pathIdentifier` regenerates the path segment, for the topic and its descendants. Send the current `pathIdentifier` with the new name to keep the paths storefront filters rely on.
- **`deleteTopic` also deletes every descendant.** To restructure, move the branch with `updateTopic(id:, language:, input: { parentId: "..." })`.

## Topics in Discovery

`topics` is a built-in index field on every shape, so a topic map needs no index setup. Variants have their own `variants_topics` field.

- **Filter by path.** An item is indexed with the path of each of its topics and of their ancestors, so `filters: { topics: { equals: "/colors/reds" } }` also matches an item tagged only `/colors/reds/crimson`.
- **One facet, whatever the number of maps.** `facets: { topics: { limit: 50 } }` returns a single `topics` facet in `summary.facets`, keyed by path, with labels like `Colors > Reds`. `limit` defaults to 10 and caps the buckets across all maps, ancestors included, keeping the most frequent. Set it high enough for every map, then group the buckets by root path to draw one filter per map.
- **Paths are per language.** Filter with the path of the language you query. A topic with no translation in that language is not indexed for it.

## Best Practices

1. **Start with use cases** — Which filters do customers need on the storefront? Build maps backward from those facets.
2. **Plan for growth** — A flat list of 4 entries becomes painful at 40. Group early if you expect growth.
3. **5–10 per level** — Beyond that, navigation and filtering get overwhelming.
4. **Be consistent** — Same depth and naming style within each branch.
5. **Think in facets** — Multiple topic maps = multiple filter facets. Don't cram everything into one giant map.
6. **Meaningful colors** — Color topics use real colors; hierarchy uses gradients; categories use thematic families.
7. **Every topic gets a `displayColor`** — Never leave it blank.
8. **Topics for labels, documents for content** — If a classification needs rich content (brand logo, allergen icon, wood description), use a Document shape via Semantic Bridge in [[content-model]], not a topic.
9. **One axis per map** — Colors, Sizes, Materials should be three separate maps, not one mixed "Attributes" map.

## Anti-Patterns

❌ **Missing `displayColor`** — Every topic must have one. Visual consistency in the editor matters.

❌ **Color-named topic with a gradient color** — "Red" must have `displayColor: "#e53935"` (or a red shade), not a generic warm tone.

❌ **Inconsistent depth within a map** — Don't mix `Reds → Light Red, Crimson` (2 levels) next to `Blues` (1 level) without intent. Either nest both or neither.

❌ **One giant topic map for everything** — Colors + Sizes + Materials in one map defeats faceted filtering. Use one map per axis.

❌ **Using topics for items that need rich content** — Brands with logos, allergens with icons, wood types with descriptions belong as Documents linked via Item Relations (see Semantic Bridge in [[content-model]]).

❌ **`id` with spaces, uppercase, or special characters** — `Light Red` or `light_red` is wrong; `light-red` is right.

❌ **`pathIdentifier` ≠ `id`** — Keep them in sync, so the `id` in the design reads as the path segment the topic gets.

❌ **Flat list of 40+ topics** — Nest them. `Colors → Reds → Light Red, Crimson, …` scales; a flat list of 40 colors does not.

## Integration with Other Skills

- **[[information-architecture]]** — Folders define where an item lives (single hierarchy). Topics define what it is about (multi-dimensional). Design folders and topic maps together.
- **[[content-model]]** — Items and variants carry topics through the built-in `topics` field; there is no topic component. If a classification needs rich content (logo, description, icon), model it as a Document via the Semantic Bridge pattern instead of a topic map.
- **[[mutation]]** — Core API conventions. Write the tree as described in Shipping a Topic Tree, then tag items and variants with `topicIds`.
- **[[mass-operations]]** — The `topic/*` intents, for bulk or re-runnable imports.
- **[[query]]** — Use the Discovery API to filter and aggregate by topic on the storefront — see Topics in Discovery above.

## Related Links

- [Crystallize Topic Maps Documentation](https://crystallize.com/docs/pim/topic-maps)
- See [[content-model]] references/taxonomies.md for the underlying topics-and-grids reference.
