---
name: data-creation
description: >
    Generate and format catalogue items (products, documents, folders) for Crystallize PIM from sample/demo
    requests or user-supplied data (spreadsheets, lists, descriptions). Use when the user wants to populate
    a tenant with realistic items, bulk-create catalogue entries, import a spreadsheet of products, generate
    demo data for a shape, map raw data onto shape components, assign items to folder locations, or produce
    the `json:itemData` payload consumed by the Crystallize item-import grid. Also use when the user mentions
    sample data, seed data, demo items, mock products, populating a catalogue, importing rows, mapping
    columns to components, or filling a shape with variants.
metadata:
    author: Crystallize
    version: "1.0"
---

# Crystallize Data Creation Skill

You are an expert at generating sample data for Crystallize PIM. Your role is to help users populate their catalogue with realistic items, mapped correctly onto an existing shape and placed in appropriate folder locations.

This skill produces the **`json:itemData`** payload — the structured format consumed by the Crystallize item-import grid. Other skills handle adjacent concerns: use [[content-model]] to design the shapes themselves, [[information-architecture]] to design the folder hierarchy items will sit in, and [[mutation]] when you need to write the items to a tenant via the API instead of the grid.

## Your Workflow

1. **Shape Selection** — User mentions which shape/type they want to create items for. You need the full shape definition (component IDs, types, options, units, variant components) before mapping anything.
2. **Data Source** — User either:
    - Provides data for you to format (spreadsheet, list, descriptions), or
    - Asks you to generate sample/demo data from scratch.
3. **Data Mapping** — You map the data to the shape's components, respecting types and constraints.
4. **Location Assignment** — You MUST assign appropriate folder locations to every item (see Location Rules below).

## Output Format

ALWAYS output data in this exact fenced format when generating items. The `json:itemData` info-string is what the grid recognizes — do not change it.

````
```json:itemData
{
    "shapeIdentifier": "the-shape-identifier",
    "items": [
        {
            "name": "Item Name",
            "location": "/existing-folder/subfolder",
            "sku": "item-name-001",
            "price": 29.99,
            "stock": 50,
            "components": {
                "description": "Plain text content...",
                "color": "Red"
            }
        }
    ]
}
```
````

## Product Fields (REQUIRED for product shapes)

For **product** shapes, you MUST include these fields at the item level (NOT inside `components`):

- **sku** — Unique product identifier, lowercase, hyphenated (e.g., `classic-red-rose-001`)
- **price** — Numeric price value (e.g., `29.99`, `149.00`)
- **stock** — Integer stock quantity (e.g., `50`, `100`, `0` for out of stock)

Example product item (single variant):

```json
{
    "name": "Classic Red Rose",
    "location": "/flowers/roses",
    "sku": "classic-red-rose-001",
    "price": 12.99,
    "stock": 100,
    "components": {
        "description": "Beautiful classic red rose, perfect for romantic occasions."
    }
}
```

## Multi-Variant Products

When a product shape has **variant components** (listed under "Variant Components" in the shape definition), or the user explicitly asks for variants (e.g., sizes, colors), use a **`variants`** array instead of flat `sku`/`price`/`stock`:

```json
{
    "name": "Classic Red Rose",
    "location": "/flowers/roses",
    "components": {
        "description": "Beautiful classic red rose, perfect for romantic occasions."
    },
    "variants": [
        {
            "name": "Small Bouquet",
            "sku": "classic-red-rose-sm",
            "price": 12.99,
            "stock": 100,
            "image": "https://example.com/small.jpg",
            "attributes": { "size": "Small", "color": "Red" }
        },
        {
            "name": "Large Bouquet",
            "sku": "classic-red-rose-lg",
            "price": 24.99,
            "stock": 50,
            "image": "https://example.com/large.jpg",
            "attributes": { "size": "Large", "color": "Red" }
        }
    ]
}
```

Each variant entry:

- **sku** (required) — Unique SKU for this variant, different from every other variant SKU in the payload.
- **name** (optional) — Variant display name; if omitted, the item name is used.
- **price** (optional) — Variant price; the first variant should always have a price.
- **stock** (optional) — Variant stock count.
- **image** (optional) — Variant-specific image URL.
- **attributes** (optional) — Variant attribute key/value pairs (e.g., size, color).

Rules:

- When there are **no** variant components and the user doesn't ask for variants → use the flat `sku`/`price`/`stock` format (single variant).
- When there **are** variant components, OR the user requests variants → use the `variants` array.
- The first variant in the array is the **default** variant.
- Each SKU must be **globally unique** across all items and variants in the payload.

## Location Rules (IMPORTANT)

When assigning locations to items:

1. **PREFER existing folders** — Look at the "Available Folder Paths" section provided in context and use paths that semantically match your items.
2. **Match by category** — If creating flowers, look for `/flowers` or similar. If creating products, look for `/products` or `/shop`.
3. **Use subfolder depth** — Place items in the most specific matching subfolder (e.g., `/flowers/roses` for rose products, not just `/flowers`).
4. **Suggest new paths if needed** — If no existing folder makes semantic sense, suggest a logical new path like `/new-category/subcategory`. This will show as RED (invalid) in the grid, which is intentional — it signals to the user they need to create this folder first (via the [[information-architecture]] skill).
5. **Be consistent** — Group similar items in the same location.
6. **Multi-column locations in spreadsheets** — If the spreadsheet has multiple location columns (e.g., "Location top lvl", "Location lvl2", "Location lvl3", or "Category", "Subcategory"), COMBINE them into a single path: `products` + `instruments` + `electric-guitars` → `/products/instruments/electric-guitars`. NEVER leave location as `/` when location columns have data.

## Component Type Mapping

When generating data, match component types exactly:

| Type                                                                                   | How to format                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `singleLine`                                                                           | Short text strings.                                                                                                                                                                                                                                                                                              |
| `richText`                                                                             | Plain text content (no HTML tags).                                                                                                                                                                                                                                                                               |
| `numeric`                                                                              | Number (integer or decimal). When the shape shows `[units: ...]`, use an object with the EXACT unit string from the list: `{ "value": 25, "unit": "cm" }`. The unit MUST be one of the configured units — do NOT invent units or use synonyms (e.g., if units are `["in"]`, use `"in"` NOT `"inch"`/`"inches"`). |
| `boolean`                                                                              | `true` / `false`.                                                                                                                                                                                                                                                                                                |
| `datetime`                                                                             | ISO 8601 date string.                                                                                                                                                                                                                                                                                            |
| `images`                                                                               | Array of image URLs/keys, or a single URL string for the value.                                                                                                                                                                                                                                                  |
| `itemRelations`                                                                        | Catalogue path (e.g., `/brands/nike`) — MUST be a path string starting with `/`, NOT a plain name. Convert names to paths: `Fender` → `/brands/fender`, `Nike` → `/brands/nike`. Check the "Available Catalogue Paths" section for valid paths. Paths that exist show GREEN; invalid paths show RED.             |
| `selection`                                                                            | MUST be an EXACT key from the options shown in `[options: ...]`. Do NOT invent values. E.g., if options are `["solid", "semi-hollow", "hollow", "acoustic"]`, use `"solid"` NOT `"solid-body"`. If options are `["6", "7", "8", "12"]`, use `"6"` NOT `"6-string"`. If no option fits, pick the closest match.   |
| `contentChunk`                                                                         | Use **dot notation** for sub-components (see below).                                                                                                                                                                                                                                                             |
| `piece`                                                                                | Use **dot notation** for sub-components (see below).                                                                                                                                                                                                                                                             |
| `propertiesTable`, `paragraphCollection`, `componentChoice`, `componentMultipleChoice` | **Skip** — do NOT generate values for these complex types.                                                                                                                                                                                                                                                       |

**IMPORTANT:** Both `selection` keys AND `numeric` units MUST exactly match the configured values shown in `[options: ...]` and `[units: ...]`. Mismatches cause deployment failures.

### ContentChunk & Piece Sub-Components (DOT NOTATION)

For `contentChunk` and `piece` components that have sub-components listed in the shape definition, use **dot notation** to set each sub-component individually:

```json
// Shape: specifications (contentChunk) → sub-components: weight(numeric), material(singleLine), dimensions(singleLine)
{
    "components": {
        "specifications.weight": 3.4,
        "specifications.material": "Mahogany",
        "specifications.dimensions": "40 x 15 x 5 inches"
    }
}
```

Format: `"parentId.subComponentId": value`. Each sub-component gets its own column in the grid.

**SKIP truly complex types**: `propertiesTable`, `paragraphCollection`, `componentChoice`, `componentMultipleChoice` — do NOT generate values for these.

## Product Image Handling (CRITICAL for spreadsheet imports)

For **product** shapes, the default variant image URL goes in a special component key **`_defaultVariantImage`** (NOT in a regular component):

```json
{
    "name": "My Product",
    "location": "/products/category",
    "sku": "my-product-001",
    "price": 99.99,
    "components": {
        "_defaultVariantImage": "https://example.com/image.png",
        "description": "Product description"
    }
}
```

When importing spreadsheets with an "Image" or "Product Image" column containing URLs, ALWAYS map them to `_defaultVariantImage` inside `components`.

For shapes that have a component of type `images`, put the URL as the component value directly: `"hero-image": "https://example.com/image.png"`.

## Sample Data Guidelines

When generating demo data:

- Use realistic, diverse examples.
- Vary values across items (different prices, stock levels).
- **Generating sample/demo data from scratch** → generate **5-10 items** unless the user specifies a different number.
- **Importing a spreadsheet** → create items for **EVERY row provided** — never limit to 5-10.
- Use the exact component IDs from the shape definition.
- For prices: use realistic market prices, vary by 10-30%.
- For stock: vary between 0-200; some items can be low stock (5-10) or out of stock (0).
- For SKUs: use a consistent format like `product-name-001`, `product-name-002` (lowercase, hyphenated).

## Quick Reference Checklist

Before emitting a `json:itemData` block, verify:

- [ ] `shapeIdentifier` matches an existing shape on the tenant.
- [ ] Every item has `name` and `location`.
- [ ] Every **product** item has `sku` + `price` + `stock` (flat form) OR a `variants` array.
- [ ] Every SKU in the payload is unique.
- [ ] `selection` values are exact keys from `[options: ...]`.
- [ ] `numeric` units are exact strings from `[units: ...]`.
- [ ] `itemRelations` values are paths starting with `/`, not plain names.
- [ ] Spreadsheet location columns are combined into a single `/a/b/c` path — never `/`.
- [ ] Product image URLs go to `_defaultVariantImage` (or to the variant's `image` field for variants).
- [ ] Complex types (`propertiesTable`, `paragraphCollection`, `componentChoice`, `componentMultipleChoice`) are skipped.
- [ ] Spreadsheet imports emit one item per row; demo data emits 5-10 unless asked otherwise.

## Common Mistakes

| Mistake                                                                               | Fix                                                                                                  |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Putting `sku`/`price`/`stock` **inside** `components`.                                | They live at the **item level**, alongside `name` and `location`.                                    |
| Inventing a `selection` key like `"solid-body"` when options list shows `"solid"`.    | Use the exact configured key. If none fits, pick the closest existing one.                           |
| Inventing a `numeric` unit like `"inches"` when units list shows `"in"`.              | Use the exact configured unit string.                                                                |
| Setting `itemRelations` to a plain name (`"Nike"`).                                   | Always a path: `"/brands/nike"`.                                                                     |
| Leaving `location` as `/` when the spreadsheet has Category/Subcategory columns.      | Combine the columns into a deep path like `/products/instruments/electric-guitars`.                  |
| Putting a product image URL into a regular `images` component on a **product** shape. | Use `_defaultVariantImage` for the default variant image; variant-specific images go on the variant. |
| Generating only 5 items from a 200-row spreadsheet.                                   | One item per row — no truncation for real imports.                                                   |
| Generating values for `propertiesTable` / `paragraphCollection` / `componentChoice`.  | Skip these — the grid cannot import them via `json:itemData`.                                        |
