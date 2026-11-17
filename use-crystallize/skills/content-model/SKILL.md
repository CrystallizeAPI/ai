---
name: content-model
description: Design content models in Crystallize using Shapes, Pieces, Components, and Grids, and decide when a classification is a Topic Map, a Selection or a document. Create product structures, define document types, design relationships between items, implement classification bridges, configure item relations with shape restrictions, model brand and product colours with the Colors component (hex, RGB, HSL, CMYK, Pantone, RAL, colour presets, swatches), and architect scalable data models. Use when modeling content, creating shapes or pieces, defining components, designing relationship patterns, implementing semantic bridges, configuring variant components, building a page builder, setting component validation, localization or Discovery flags, modelling typed technical specs with units, product identifiers (SKU, GTIN, MPN) or the SEO piece, or choosing between a Colors component and a Selection for colour. For the topic tree itself use taxonomy, and for folder hierarchies use information-architecture.
metadata:
    author: Crystallize
    version: "3.1"
---

# Crystallize Content Model Skill

Design and implement content structures in Crystallize using a flexible modeling system for products, documents, and taxonomies.

## Consultation Approach

Before designing shapes, understand the business. Ask clarifying questions:

1. **What are you selling or publishing?** Products, articles, courses, services?
2. **How will customers discover items?** Browse categories, search, filter by attributes?
3. **What makes each item unique?** Specs, features, editorial content, variants?
4. **What's shared across items?** Brands, materials, certifications, authors?
5. **Do you need multiple languages/markets?** Which fields vary by language?
6. **What's the scale?** Number of products, categories, content pages?
7. **Do items have relationships?** Bundles, kits, compatibility, recommendations?

Use the answers to choose shape types, decide on classification patterns (topics vs documents), and plan the component structure. A content model that reflects the business intent is more valuable than one that's technically impressive.

## Output Format

The output of this skill is a **mass operations JSON file** — a structured document that creates all shapes and pieces in the correct order.

After generating the mass operations JSON, **always validate it** using the `build-mass-operation` MCP tool. This tool validates against the official `@crystallize/schema` and returns either valid JSON or detailed error feedback. Fix any validation errors before presenting the result. It checks structure only: the rules marked in the [Validation Checklist](#validation-checklist) fail later, when the operation runs.

The mass operations file follows the **4-phase ordering** described in the [Mass Operations section](#mass-operations--4-phase-ordering) below.

## Quick Start Decision Tree

**When designing shapes:**

1. What is the item? → Choose shape type (Product, Document, Folder)
2. What data does it need? → Add components (see [Component Decision Guide](references/components.md))
3. How does it relate to others? → Use Item Relations with `acceptedShapeIdentifiers`
4. Is it part of a classification? → Consider design patterns (see below)

## Core Concepts

### The Five Building Blocks

1. **Shapes** - Blueprints defining item structure (product/document/folder)
2. **Components** - Atomic fields added to shapes (text, numbers, media, relations)
3. **Pieces** - Reusable field sets embedded across shapes
4. **Topic Maps** - Hierarchical taxonomies for classification
5. **Grids** - Curated editorial collections

### Shape Types

| Type     | Purpose                          | Has Variants | Can Have Children | Example                            |
| -------- | -------------------------------- | ------------ | ----------------- | ---------------------------------- |
| Product  | Sellable items with pricing      | Yes          | No                | Shoes, Subscription                |
| Document | Editorial content (leaf nodes)   | No           | No                | Article, Brand, FAQ                |
| Folder   | Catalogue hierarchy organization | No           | Yes               | Category, Landing Page, Collection |

### Built-in vs Custom Fields

Every item has built-in fields: `name`, `id`, `language`, `tree`, `topics`, `externalReference`, `createdAt`, `updatedAt`.

Product variants have additional built-ins: `sku`, `images`, `videos`, `price`, `stock`, `attributes`, `externalReference`.

**Components are the additional fields you define** beyond these built-ins. For product shapes, use `variantComponents` in the shape definition to add custom components directly to product variants (e.g., custom certifications, variant-level specs).

**`variantComponents` supports all component types**, including structured components: `contentChunk`, `componentChoice`, `componentMultipleChoice`, and `piece` references. This means you can add repeating field groups, polymorphic choices, or reusable pieces directly on variants — not just simple fields like `singleLine` or `numeric`. For example, a product variant can have a `contentChunk` for packaging dimensions, or a `componentChoice` for variant-specific technical specs.

**`variantComponents` require the same type discipline as product-level components** — apply the Component Selection Guide below. Measurable values (weight, voltage, length) → `numeric` with units. Controlled options (connection type, material) → `selection`. Free-form identifiers → `singleLine`. Do not default everything to `singleLine`.

**Typed specs are what the storefront, search engines and agents read.** A model with numerics, selections and switches (shared `power` and `physical` pieces, plus one family piece behind a `specs` choice) gets Discovery range and option filters, facets and `rankBy` fields, schema.org `additionalProperty` with UN/CEFACT unit codes, Markdown twins and agent filters from the same values. A label/value table gets none of them. Keep **one unit per numeric**, because range filters ignore the unit, and remember that an **unset switch reads `false`** in Discovery. See [Typed Specs, Units and Identifiers](references/typed-specs.md), and [[seo-geo]] for the JSON-LD.

**Chunks on variants:** observed both ways. One build's variant chunks never published, another's published and were served by Discovery. Read one item back from Discovery before you rely on them.

**IMPORTANT:** Do NOT add components for price or stock - these are native properties managed through the product variant's built-in fields. Only create custom price/stock components for specific edge cases (e.g., tiered pricing models, subscription pricing, price modifiers for configurators).

**Product Identification:** the merchant's SKU, the GTIN and the manufacturer part number are **separate facts** (schema.org, Google Merchant Center and GS1 ask for each). A SKU used as the GTIN loses the merchant's own SKU, and a kit and the bare tool have different GTINs.

- **Built-in `sku`** on the variant: the merchant's SKU.
- **`gtin` Single Line in `variantComponents`**: not translatable, discoverable, validated with a `pattern` for 8, 12, 13 or 14 digits.
- **`mpn` Single Line**: on the variant when it differs per variant.
- **National trade numbers** (NOBB, NRF, ISBN): one named Single Line each, never a key/value list. On the product, several can be grouped in a non-repeatable `identifiers` chunk; on variants keep them as plain Single Lines (chunks on variants are contested, see above).
- **One external system id**: the built-in `externalReference` on the item or variant.

```
Product Shape: Power Tool
  └── variantComponents
        ├── gtin (Single Line, not translatable)
        ├── mpn (Single Line, not translatable)
        └── nobb-number (Single Line, not translatable)
```

See [Shapes Reference](references/shapes.md) and [Content Modelling Guide](references/content-modelling.md) for details.

## Component Selection Guide

### "I need to store text"

- **Single Line** → Short, unformatted (subtitle, GTIN, URL)
- **Rich Text** → Formatted content (descriptions, specifications)
- **Paragraph Collection** → Editorial sections with mixed media

### "I need to store numbers"

- **Numeric** → Measurable values with a unit (`["kg"]`, `["mm"]`, `["V"]`). Configure units in `config.numeric.units`, one per component where you can: range filters ignore the unit. A unit list makes every empty value fail create, update and publish unless the component has `required: false` (see [Typed Specs](references/typed-specs.md#a-unit-list-makes-empty-values-fail))
- **Properties Table** → Arbitrary key-value specs whose keys can't be known in advance. Not for known specs: it gives no filters, facets or structured data

### "I need to link to other items"

- **Item Relation** → Link to catalogue items (products, documents, folders)
    - **Always use `acceptedShapeIdentifiers`** to restrict which shapes can be linked
    - Set `minItems`/`maxItems` for cardinality constraints
- **Grid Relation** → Link to curated grids

### "I need controlled options"

- **Selection** → Dropdown/checkboxes with predefined options. Every option needs `key` and `value`; also set `label` (optional, but good practice — the App UI displays it; default: same text as `value`)
- **Switch** → Boolean flag (type: `boolean`). Unset reads `false` in Discovery, so write only what is true
- **Datetime** → Date/timestamp (type: `datetime`)
- **Location** → Geographic coordinates

### "I need to group fields"

- **Chunk (contentChunk)** → Group of related fields (can be repeatable or single)
    - **Use chunk when:** Fields are specific to one location and won't be reused elsewhere
    - **Repeatable chunk:** For lists (ingredients, specifications, USP items, CTA buttons)
        - Examples: Width/Height/Depth (repeating for multiple dimensions), Street/City/Zip (repeating addresses)
    - **Non-repeatable chunk:** For one-time field groups (metadata, settings, single address). **Set `repeatable: false` explicitly** — a chunk that omits `repeatable` is repeatable.
        - Examples: SEO fields (title/description/keywords as one group), single shipping address, contact info block
    - **Decision:** If the group only occurs once in the entire content model → use non-repeatable chunk
    - Can be used inside pieces for nested grouping
    - NOT a direct child of componentMultipleChoice
- **Piece** → Reusable component groups needed in multiple places
    - **Use piece when:** The exact same structure will be used in multiple shapes OR multiple pieces
    - Examples: Banner sections (used across landing pages, products, articles), Hero blocks (reused), Author bios (appears in articles and testimonials)
    - Think: "Will this exact structure be used in 2+ locations?"
    - **Rule:** If only used once → use chunk instead of piece
    - Perfect for componentMultipleChoice options (page builder pattern)
- **Choice (componentChoice)** → One of N mutually exclusive forms (polymorphic). The API type is `componentChoice`, and its options go in `config.componentChoice.choices`. There is no `choice` type.
    - **MUST have at least 2 choices** - Single option is invalid
    - **EVERY choice item MUST have a `type` field** - choices with no `type` or with a raw `components` array are invalid API structures
    - When each choice needs multiple fields → create a `piece/upsert` operation for each, then reference with `{ "type": "piece", "config": { "piece": { "identifier": "..." } } }`
- **Multiple Choice (componentMultipleChoice)** → Multiple coexisting forms (page builders)
    - **MUST have at least 1 choice** - One choice with `allowDuplicates` is a valid way to repeat a single piece
    - Use when: Editors choose between different content types at the same location
    - **Valid children**: Piece references (`type: "piece"`) or single regular components (images, singleLine, etc.)
    - **NEVER as children**: contentChunk, componentChoice, or nested componentMultipleChoice
    - **NEVER**: anonymous objects with only a `components` array and no `type` field — these are not valid API structures
    - Common pattern: Page sections where each option is a piece (Banner, Hero, USP, Gallery)
    - Examples: Blocks (banner piece, hero piece, usp piece), Content areas (text piece, video piece)

### Structural Component Nesting Rules

**Structural components** = contentChunk, componentChoice, componentMultipleChoice

**Critical Rule**: Structural components can only contain **pieces** or **regular components** (singleLine, richText, numeric, images, etc.) as direct children.

**NEVER nest structural components directly within each other:**

- ❌ componentChoice cannot have componentChoice/componentMultipleChoice/contentChunk as direct children
- ❌ componentMultipleChoice cannot have componentChoice/componentMultipleChoice/contentChunk as direct children
- ❌ contentChunk cannot have componentChoice/componentMultipleChoice/contentChunk as direct children

**Correct pattern for complex structures:**

```
componentChoice/componentMultipleChoice
  └─ Piece (reusable component group)
       └─ contentChunk/componentChoice (now allowed inside piece)
            └─ Regular components
```

**Example - Product Type Selector (CORRECT):**

```json
{
    "id": "product-type",
    "name": "Product Type",
    "type": "componentChoice",
    "config": {
        "componentChoice": {
            "choices": [
                {
                    "id": "fresh-flowers",
                    "name": "Fresh Flowers",
                    "type": "piece",
                    "config": { "piece": { "identifier": "fresh-flowers-details" } }
                },
                {
                    "id": "arrangement",
                    "name": "Flower Arrangement",
                    "type": "piece",
                    "config": { "piece": { "identifier": "arrangement-details" } }
                }
            ]
        }
    }
}
```

For complete component reference with nesting rules, validation, and localization, see [Components Reference](references/components.md).

### Defaults That Surprise

Leaving a config key out is a decision. This is what you get:

| Key                                                  | Left out                                                                                        | Set it when                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `repeatable` on `contentChunk`                       | `true`: the chunk repeats                                                                       | `false` for a group that occurs once                                                               |
| `allowDuplicates` on `componentMultipleChoice`       | `true`: a choice can be picked several times                                                    | `false` when each choice may be picked once                                                        |
| `discoverable`                                       | `true` in the API, but builds found rich text, images and config-less components absent: set it | `true` explicitly on everything a storefront renders, `false` for internal data (ERP ids, notes)   |
| `required`                                           | Not the same as `false`: an empty component is still held to its `min`, `pattern` and `units`   | `false` on an optional field that has one of those rules                                           |
| `multilingual` on a field                            | `singleLine`, `richText` and `colors` are stored per language; every other component is shared  | `false` on `colors` that are universal, `true` on other fields that translate                      |
| `multilingual` on a chunk, choice or multiple choice | Structure is shared; each component inside follows its own setting                              | `true` to vary the structure per language. `false` forces everything inside to shared, so avoid it |

Details and the App's own defaults are in [Components Reference](references/components.md#multilingual--localization).

## Design Patterns for Relationships

### When to use each pattern?

| Need                                          | Pattern            | Structure                        |
| --------------------------------------------- | ------------------ | -------------------------------- |
| Rich classification (brand, allergen, cert)   | Semantic Bridge    | Item Relation → Document         |
| Relationship with quantity (recipe, BOM, kit) | Quantised Bridge   | Chunk(Numeric + Item Relation)   |
| Relationship with role (contributor, usage)   | Composite Bridge   | Chunk(Item Relation + Selection) |
| Relationship with rules (configurator)        | Conditional Bridge | Chunk(Item Relation + Rule Type) |
| Single concept, multiple forms (instrument)   | Polymorphic Choice | Choice/Multiple Choice → Pieces  |

### Semantic Classification Bridge

**Problem:** Attributes need more than just labels (brands need logos, allergens need warnings).

**Solution:** Create classification document shapes, link via Item Relations.

```json
{
    "id": "brand",
    "name": "Brand",
    "type": "itemRelations",
    "config": {
        "itemRelations": {
            "acceptedShapeIdentifiers": ["brand"],
            "minItems": 1,
            "maxItems": 1
        }
    }
}
```

**Key point:** `acceptedShapeIdentifiers` enforces type safety - only "brand" documents can be linked.

Quantised, Composite and Conditional bridges all use a repeating `contentChunk` that holds the Item Relation next to a Numeric, a role Selection or a rule Selection.

### Critical: Always Use acceptedShapeIdentifiers

Without shape restrictions, editors can link ANY shape. With them, a link to any other shape is rejected, for items and for SKUs alike. This acts like foreign key constraints in relational databases, preventing data integrity issues.

### Page Builder Pattern (componentMultipleChoice with Pieces)

**Problem:** Editors need flexible page layouts with different section types.

**Solution:** componentMultipleChoice with piece references, each piece containing repeating chunks for items. Chunks (CTAs, USP items) are inside pieces, not direct children of componentMultipleChoice.

See [Page Builder Pattern](references/page-builder-pattern.md) for the complete example, the shared `layout` piece and localized structure.

For complete pattern details with examples, see [Design Patterns Reference](references/design-patterns.md).

## Shape Consolidation Strategy

**Principle:** Keep the number of product and folder shapes to a minimum by using polymorphic patterns instead of creating separate shapes for similar items.

- **Consolidate** when shapes share 50%+ of their components, have the same foundational components but differ in specialized attributes, or represent variations of the same concept.
- **Keep separate** when items serve different business functions, share less than 30% of their components, need distinct workflows, permissions or integrations, or when the merged shape would confuse editors.

See [Shape Consolidation](references/shape-consolidation.md) for the approach, a worked example with the shape and pieces in JSON, the trade-offs, and how it fits the 4-phase ordering.

## Common Use Cases

Ready-made outlines live in the references: the standard SEO piece in [Pieces Reference](references/pieces.md), and the e-commerce product, recipe, blog post, configurator and per-industry models in [Content Modelling Guide](references/content-modelling.md).

## Best Practices

### Naming Conventions

1. **Use normalcase for identifiers** - Shape and component identifiers should be lowercase with hyphens (e.g., `product-page`, `hero-section`)
2. **Be concise, use hierarchy** - Let the structure provide context. Use `title` not `product-page-hero-section-title`
3. **Don't repeat container names** - Within a piece called `seo`, use `title` not `seo-title`. The piece name provides context.
4. **Use semantic names** - Name components for what they represent, not how they're displayed
5. **Avoid redundant prefixes** - Bad: "Meta Title", "Meta Description". Good: "Title", "Description" (when inside SEO piece)
6. **Keep names simple and direct** - Bad: "Social Share Image". Good: "Image" (context is clear from parent)

**Example - SEO Piece Naming:**

```
Piece: "SEO"  (not "SEO Metadata")
  ├─ title  (not "meta-title" or "Meta Title")
  ├─ description  (not "meta-description")
  └─ image  (not "social-share-image" or "og-image")
```

### Design Principles

1. **Start with intent, not structure** - Understand what you're modeling before creating shapes
2. **Use pieces for shared fields** - SEO, environmental data, common metadata
3. **Always restrict item relations** - Use `acceptedShapeIdentifiers` to enforce type safety
4. **Set min/max constraints** - Guide editors with cardinality rules (minItems, maxItems)
5. **Keep shapes focused** - One shape per logical content type
6. **Consolidate similar shapes** - When classification documents share the same structure (e.g., "Coffee Origin" and "Tea Origin" both need name, description, image), combine them into a single shape ("Origin") and differentiate via folder placement or topic tags
7. **Use chunks for grouping** - Related fields that repeat together
8. **Choose topics vs documents wisely** - Simple labels → topics, rich content → documents
9. **Plan localization early** - Set `multilingual` from the start
10. **Decide what Discovery sees** - Set `discoverable: true` explicitly on everything the storefront renders and `false` on internal fields. A component made discoverable after publishing stays empty in Discovery until the items are published again. Give every shape at least one discoverable component
11. **Apply design patterns** - Use established patterns for scalable models

## Anti-Patterns to Avoid

❌ **Item Relations without acceptedShapeIdentifiers** - Allows linking any shape, breaks semantic meaning

❌ **Using Item Relations for simple labels** - Use Topic Maps instead (better performance, simpler)

❌ **Flat component lists** - Group related fields with Chunks for better structure

❌ **Flat singleLine variant components** - `variantComponents` follow the same type rules as product-level components. Voltage, length, weight → `numeric` with units. Connection type, material, animal version → `selection` with options. Only use `singleLine` for genuinely free-form text (a color label, a custom code). A variant story full of `singleLine` is a modeling smell.

❌ **Mixing variant data with product data** - Use variant attributes (built-in) for size/color/sku

❌ **Using the `sku` as the GTIN** - The built-in `sku` is the merchant's SKU. Put the GTIN in its own non-translatable `gtin` Single Line on the variant, and the MPN in an `mpn` Single Line, so structured data and merchant feeds get three separate facts.

❌ **A hand-typed canonical URL field** - Canonicals and hreflang come from the item's generated paths (see [[information-architecture]]). A typed canonical goes stale on the first rename.

❌ **Rich text for the SEO description** - It goes into `<meta>`, Open Graph and JSON-LD, which take plain text. Use a Single Line.

❌ **Several units on one numeric** - Range filters compare the raw number, so `["m³/h", "l/s"]` mixes units in one filter. One unit per component, converted at import.

❌ **Writing `false` for "unknown"** - An unset switch already reads `false`; a written `false` is a wrong fact. Write `true` for what an item has, and use a yes/no Selection when "no" must be stated.

❌ **Adding price or stock components to product shapes** - Products have native `price` and `stock` fields on variants. Only add custom pricing/stock components for specific edge cases (tiered pricing, subscription models, configurator price modifiers, bulk discounts)

❌ **Selection for expandable values** - Use documents + item relations for brands/categories that grow

❌ **Not planning for localization** - Adding multilingual support later requires migration

❌ **Using contentChunk as direct child of componentMultipleChoice** - Chunks should be inside pieces, not direct children

❌ **Using componentChoice as a direct child of componentMultipleChoice** - Choices cannot be nested directly

❌ **Nesting structural components directly** - componentChoice, componentMultipleChoice, and contentChunk can only have pieces or regular components as direct children, never other structural components. Use pieces as intermediaries.

❌ **Choice items without a `type` field** - Every item in a `choices` array MUST have a `type` field. Objects like `{ "id": "smartphone", "name": "Smartphone", "components": [...] }` are INVALID — the `components` key does not exist on a choice item and `type` is missing. If a choice needs multiple fields, create a separate piece and reference it with `{ "type": "piece", "config": { "piece": { "identifier": "smartphone-spec" } } }`.

❌ **Polymorphic Choice with inline component groups** - When different choice variants (e.g. Smartphone, Laptop, Headphones) each need their own set of fields, **do NOT** embed a `components` array directly on the choice object. This is the most common componentChoice mistake. **Always** create a `piece/upsert` operation for each variant and reference the piece. Example: `{ "type": "piece", "config": { "piece": { "identifier": "smartphone-spec" } } }` where `smartphone-spec` is a separate piece containing Screen Size, Storage, OS fields.

❌ **CTA/USP items as componentMultipleChoice choices** - These should be repeating chunks inside a piece, not top-level choices

❌ **Single-choice configurations** - `componentChoice` MUST have at least 2 options. Single option is invalid. If you only have one option, use a direct piece reference instead of wrapping it in a componentChoice. `componentMultipleChoice` needs at least 1.

❌ **Wrapping single piece in componentChoice** - If a component only needs one piece (e.g., CTA), add the piece directly. Don't use `componentChoice` with one option.

❌ **Empty contentChunk (no components)** - A `contentChunk` with zero child components is meaningless and invalid. Always define at least 1 component inside a chunk. If you find yourself creating an empty chunk, reconsider the design.

❌ **`maxItems` as "unlimited"** - An Item Relation component holds at most 75 items and 75 SKUs. The limit is per component, not per item: an item can hold more relations spread over components or chunk rows. A `maxItems` or `maxSkus` above 75 is rejected, so a high number like 999 fails. Leave it out for "as many as allowed". For more than 75, invert the relation or use a topic (at most 250 topics per item).

❌ **Internal fields left discoverable** - Discovery indexes every component unless it says `discoverable: false`, and the Discovery API is open by default: when open, everything it serves is public.

See [Content Modelling Guide](references/content-modelling.md) for detailed anti-patterns and migration strategies.

## Mass Operations — 4-Phase Ordering

When creating shapes and pieces via mass operations (Bulk Task API), use a **4-phase ordering** to handle cross-references and relations correctly.

### Phase Order

1. **Create empty pieces** → `intent: "piece/upsert"` (identifier + name, NO `components`)
2. **Create empty shapes** → `intent: "shape/upsert"` (identifier + name + type, NO `components`/`variantComponents`)
3. **Add components to pieces** → `intent: "piece/upsert"` (identifier + name + `components`)
4. **Add components to shapes** → `intent: "shape/upsert"` (identifier + name + type + `components`/`variantComponents`)

**REQUIRED FIELDS**:

- All upsert operations MUST include `identifier` (2 to 64 characters) and `name`
- Shape upserts MUST include `type`
- Every component definition, including each entry of `choices`, MUST include `id` and `name`

**How upsert works:** Multiple operations with the same `identifier` will update the same resource. Phase 1-2 create containers, phase 3-4 populate them with components.

**An upsert replaces the whole definition.** On a shape or piece that already exists, `shape/upsert`, `shape/update`, `piece/upsert` and `piece/update` set `components` to exactly what you send, and leaving it out empties it. On a product shape the same goes for `variantComponents`, so an upsert that sends only `components` deletes them. When the tenant already has the shape or piece, skip phases 1-2 for it and send the complete definition in phases 3-4. Otherwise a run that stops between phases leaves it empty.

### Why This Order?

Components can reference pieces (via `type: "piece"`) and shapes (via `itemRelations` with `acceptedShapeIdentifiers`). A reference to a piece or shape that does not exist yet fails the operation. By creating containers first (phases 1-2), then populating them with components that may contain references (phases 3-4), all references resolve correctly.

See [Mass Operation Example](references/mass-operation-example.md) for a complete operations file.

**Note:** Using `piece/upsert` or `shape/upsert` in a single operation (without the 4-phase split) will work ONLY if there are no cross-references. When pieces reference other pieces or shapes reference pieces/other shapes, the 4-phase order is required.

## Validation Checklist

Before presenting the mass operations JSON, verify:

1. **Validate with `build-mass-operation` tool** — Run the operations array through the MCP tool and fix any schema errors. It settles field names and types. It does not check the rules marked _(run time)_ below: those pass validation and fail in the operation logs.
2. **`acceptedShapeIdentifiers`** on every `itemRelations` component — no untyped relations. `maxItems` and `maxSkus` stay at 75 or below _(run time)_
3. **No structural nesting violations** — `contentChunk`, `componentChoice`, `componentMultipleChoice` cannot be direct children of each other, and nesting stops at 4 structural levels _(run time)_
4. **Every `contentChunk` has at least 1 component** — empty chunks are invalid _(run time)_. Set `repeatable: false` on a group that occurs once
5. **Every `componentChoice` has at least 2 choices, every `componentMultipleChoice` at least 1** _(run time)_
6. **No custom price/stock components** on product shapes — these are built-in on variants
7. **`paragraphCollection` config always has `multilingual` array** — this is required, not optional (use `[]` for no localization, `["title", "body", "images", "videos"]` for full localization)
8. **`datetime` config has no `format` field in mass operations** — the schema rejects it. A datetime created this way uses the default `date` format. `format` is only accepted by the `createShape` and `updateShape` mutations.
9. **`files` config**: if `acceptedContentTypes` is provided, each entry needs `contentType` (required). In mass operations, any `files` config must include `maxFileSize` with both `size` and `unit`.
10. **Naming conventions** — all identifiers use lowercase-with-hyphens (no camelCase, no underscores)
11. **Reusable SEO piece** — one `seo` piece (`title` and `description` as Single Lines, `image`), discoverable, with no canonical URL field, referenced from every shape with a page. See [Pieces Reference](references/pieces.md#standard-seo-piece)
12. **Localization strategy** — translatable for marketing text, non-translatable for universal data (codes, dimensions)
13. **Colors components** — set `customColorSpaces` or `colorPresets`, or editors have nothing to enter in the App. Set `multilingual: false` when the values are universal
14. **`discoverable`** set explicitly: `true` on everything the storefront renders, `false` on internal fields
15. **Typed specs** — one unit per numeric, `required: false` or no unit list on optional numerics, `sku`, `gtin` and `mpn` as separate fields. See [Typed Specs](references/typed-specs.md#checklist)

## References

- [Create Shape API Reference](references/create-shape-api.md) - **Full mutation type reference with all required fields, config structures, and validation rules for `createShape`**
- [Mass Operation Example](references/mass-operation-example.md) - Complete operations file following the 4-phase ordering
- [Content Modelling Guide](references/content-modelling.md) - Comprehensive design framework, use cases, industry patterns, validation
- [Components Reference](references/components.md) - All 15+ component types, nesting rules, localization
- [Design Patterns Reference](references/design-patterns.md) - 5 bridge patterns with complete JSON examples
- [Page Builder Pattern](references/page-builder-pattern.md) - Block slot, block pieces, shared `layout` piece, localized structure
- [Shape Consolidation](references/shape-consolidation.md) - When and how to merge similar shapes
- [Shapes Reference](references/shapes.md) - Shape types, variantComponents, and creation process
- [Pieces Reference](references/pieces.md) - Reusable field sets, standard SEO piece
- [Typed Specs, Units and Identifiers](references/typed-specs.md) - Why typed specs, units and UN/CEFACT codes, unit lists that break writes, booleans, SKU/GTIN/MPN
- [Taxonomies Reference](references/taxonomies.md) - Topic Maps and Grids
- [[taxonomy]] — Use this skill to design topic maps (hierarchical taxonomies with `displayColor`, `pathIdentifier`, nesting). Topics are a built-in field on every item, so a shape does not reference them.
