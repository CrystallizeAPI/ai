---
name: content-model
description: Design content models in Crystallize using Shapes, Pieces, Components, Topic Maps, and Grids. Create product structures, define document types, build taxonomies, organize catalogue items, design relationships between items, implement classification bridges, configure item relations with shape restrictions, and architect scalable data models. Use when modeling content, creating shapes, defining components, building taxonomies, designing relationship patterns, implementing semantic bridges, configuring product variants, or structuring catalogue hierarchies.
metadata:
    author: Crystallize
    version: "3.0"
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

After generating the mass operations JSON, **always validate it** using the `build-mass-operation` MCP tool. This tool validates against the official `@crystallize/schema` and returns either valid JSON or detailed error feedback. Fix any validation errors before presenting the result.

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

Every item has built-in fields: `name`, `id`, `language`, `tree`, `topics`, `createdAt`, `updatedAt`.

Product variants have additional built-ins: `sku`, `images`, `videos`, `price`, `stock`, `attributes`.

**Components are the additional fields you define** beyond these built-ins. For product shapes, use `variantComponents` in the shape definition to add custom components directly to product variants (e.g., custom certifications, variant-level specs).

**`variantComponents` require the same type discipline as product-level components** — apply the Component Selection Guide below. Measurable values (weight, voltage, length) → `numeric` with units. Controlled options (connection type, material) → `selection`. Free-form identifiers → `singleLine`. Do not default everything to `singleLine`.

**IMPORTANT:** Do NOT add components for price or stock - these are native properties managed through the product variant's built-in fields. Only create custom price/stock components for specific edge cases (e.g., tiered pricing models, subscription pricing, price modifiers for configurators).

**Product Identification:** The built-in `sku` field on product variants is the primary product identifier — use it for GTIN, EAN, ISBN, or any single identifier. Do NOT add a separate `gtin` or `ean` single-line component on the variant. If a product needs **multiple identifiers** (e.g., both ISBN-10 and ISBN-13, or a GTIN plus a legacy system ID), add an **identifiers chunk** with named fields to the shape:

```
Product Shape: Book
  └── identifiers (contentChunk)
        ├── isbn-10 (Single Line)
        ├── isbn-13 (Single Line)
        └── legacy-id (Single Line)

Product Shape: Consumer Electronics
  └── identifiers (contentChunk)
        ├── gtin (Single Line)
        ├── ean (Single Line)
        ├── upc (Single Line)
        └── legacy-id (Single Line)
```

Each identifier gets its own named component — not a generic key/value pattern. This keeps the data typed, queryable, and self-documenting. Also useful during migrations to preserve old system identifiers alongside the new SKU.

See [Shapes Reference](references/shapes.md) and [Content Modelling Guide](references/content-modelling.md) for details.

## Component Selection Guide

### "I need to store text"

- **Single Line** → Short, unformatted (subtitle, GTIN, URL)
- **Rich Text** → Formatted content (descriptions, specifications)
- **Paragraph Collection** → Editorial sections with mixed media

### "I need to store numbers"

- **Numeric** → Measurable values with selectable units (e.g. `["g","mg","kg"]` for weight, `["cm","m","in"]` for dimensions). Configure units in `config.numeric.units`.
- **Properties Table** → Arbitrary key-value specs

### "I need to link to other items"

- **Item Relation** → Link to catalogue items (products, documents, folders)
    - **Always use `acceptedShapeIdentifiers`** to restrict which shapes can be linked
    - Set `minItems`/`maxItems` for cardinality constraints
- **Grid Relation** → Link to curated grids

### "I need controlled options"

- **Selection** → Dropdown/checkboxes with predefined options
- **Switch** → Boolean flag
- **Datetime** → Date/timestamp (type: `datetime`)
- **Location** → Geographic coordinates

### "I need to group fields"

- **Chunk (contentChunk)** → Group of related fields (can be repeatable or single)
    - **Use chunk when:** Fields are specific to one location and won't be reused elsewhere
    - **Repeatable chunk:** For lists (ingredients, specifications, USP items, CTA buttons)
        - Examples: Width/Height/Depth (repeating for multiple dimensions), Street/City/Zip (repeating addresses)
    - **Non-repeatable chunk:** For one-time field groups (metadata, settings, single address)
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
- **Choice** → One of N mutually exclusive forms (polymorphic)
    - **MUST have at least 2 choices** - Single option is invalid
- **Component Choice (componentChoice)** → Similar to choice but for component-level choices
    - **MUST have at least 2 choices** - Single option is invalid
    - **EVERY choice item MUST have a `type` field** - choices with no `type` or with a raw `components` array are invalid API structures
    - When each choice needs multiple fields → create a `piece/upsert` operation for each, then reference with `{ "type": "piece", "config": { "piece": { "identifier": "..." } } }`
- **Multiple Choice (componentMultipleChoice)** → Multiple coexisting forms (page builders)
    - **MUST have at least 2 choices** - Single option is invalid
    - Use when: Editors choose between different content types at the same location
    - **Valid children**: Piece references (`type: "piece"`) or single regular components (images, singleLine, etc.)
    - **NEVER as children**: contentChunk, choice, componentChoice, or nested componentMultipleChoice
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
    "id": "type",
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

### Quantised Classification Bridge

**Problem:** Relationships have measurable quantities (200g flour, 4 screws).

**Solution:** Repeating contentChunk with numeric + item relation.

```json
{
    "id": "ingredients",
    "type": "contentChunk",
    "config": {
        "contentChunk": {
            "repeatable": true,
            "components": [
                { "id": "quantity", "type": "numeric" },
                { "id": "unit", "type": "selection" },
                {
                    "id": "ingredient",
                    "type": "itemRelations",
                    "config": {
                        "itemRelations": {
                            "acceptedShapeIdentifiers": ["ingredient"],
                            "minItems": 1,
                            "maxItems": 1
                        }
                    }
                }
            ]
        }
    }
}
```

### Critical: Always Use acceptedShapeIdentifiers

**Without shape restrictions:**

```json
// ❌ Bad - editors can link ANY shape
{
    "type": "itemRelations",
    "config": { "itemRelations": {} }
}
```

**With shape restrictions:**

```json
// ✅ Good - enforces semantic meaning
{
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

This acts like foreign key constraints in relational databases, preventing data integrity issues.

### Page Builder Pattern (componentMultipleChoice with Pieces)

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
            { "type": "piece", "config": { "piece": { "identifier": "banner-section" } } },
            { "type": "piece", "config": { "piece": { "identifier": "usp-section" } } },
            { "type": "piece", "config": { "piece": { "identifier": "hero-section" } } }
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
    { "id": "title", "type": "singleLine" },
    { "id": "description", "type": "richText" },
    { "id": "background", "type": "images" },
    {
      "id": "ctas",
      "name": "Call to Actions",
      "type": "contentChunk",
      "config": {
        "contentChunk": {
          "repeatable": true,
          "components": [
            { "id": "text", "type": "singleLine" },
            { "id": "url", "type": "singleLine" }
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
    { "id": "title", "type": "singleLine" },
    {
      "id": "items",
      "name": "USP Items",
      "type": "contentChunk",
      "config": {
        "contentChunk": {
          "repeatable": true,
          "components": [
            { "id": "icon", "type": "images" },
            { "id": "title", "type": "singleLine" },
            { "id": "description", "type": "richText" }
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

For complete pattern details with examples, see [Design Patterns Reference](references/design-patterns.md).

## Shape Consolidation Strategy

### Minimizing Product and Folder Shapes

**Principle:** Keep the number of product and folder shapes to a minimum by using polymorphic patterns instead of creating separate shapes for similar items.

### When to Consolidate Shapes

**Use the polymorphic product/folder pattern when:**

1. **Similarity threshold**: Two or more product/folder shapes share 50%+ of their components
    - Example: Plant and Vase both have description and SEO components

2. **Common base components**: Shapes have the same foundational components but differ in specialized attributes
    - Common: description, SEO, images, pricing
    - Differ: plant-specific fields (care-level, light-requirement) vs vase-specific fields (material, dimensions)

3. **Semantic similarity**: Items represent variations of the same concept rather than fundamentally different entities
    - Example: Guitar, Amplifier, and Pedal are all music equipment (consolidate into "Music Product")
    - Example: Plant and Vase are both home decor items (consolidate into "Home Decor Product")

### When NOT to Consolidate

**Keep shapes separate when:**

1. **Fundamentally different purposes**: Items serve completely different business functions
    - Product vs Folder (different shape types)
    - Apparel vs Digital Download (different fulfillment, no pricing overlap)

2. **Low component overlap**: Less than 30% of components are shared
    - Consolidation would create a confusing, bloated shape

3. **Different business logic**: Items require distinct workflows, permissions, or integrations
    - Separate checkout flows
    - Different inventory systems
    - Distinct pricing models

4. **Editor clarity**: The consolidated shape would confuse content editors
    - Too many conditional fields make editing difficult

### Consolidation Approach

**Step 1: Identify common components**

- Extract all shared components (description, SEO, images, etc.)
- These become the base components of the consolidated shape

**Step 2: Create a type selector**

- Add a selection component to distinguish between variants
- Example: `product-type` with options "plant", "vase", "bundle"

**Step 3: Extract variant-specific attributes into pieces**

- Create separate pieces for each variant's unique components
- Example: `plant-attributes` piece, `vase-attributes` piece

**Step 4: Use choice component for polymorphic structure**

- Add a choice component that conditionally shows the appropriate piece based on the type selection

### Example: Consolidating Plant and Vase into Product

**Before consolidation (2 shapes):**

```
Shape: Plant (product)
  ├── description (richText)
  ├── care-level (itemRelations → care-level docs)
  ├── light-requirement (selection)
  ├── mature-size (selection)
  └── seo (piece)

Shape: Vase (product)
  ├── description (richText)
  ├── material (itemRelations → material docs)
  ├── dimensions (contentChunk)
  └── seo (piece)
```

**After consolidation (1 shape + 2 pieces):**

```json
{
    "intent": "shape/upsert",
    "identifier": "product",
    "name": "Product",
    "type": "product",
    "components": [
        {
            "id": "product-type",
            "name": "Product Type",
            "type": "selection",
            "config": {
                "selection": {
                    "options": [
                        { "key": "plant", "value": "Plant" },
                        { "key": "vase", "value": "Vase" }
                    ]
                }
            }
        },
        { "id": "description", "name": "Description", "type": "richText" },
        {
            "id": "variant-attributes",
            "name": "Product Details",
            "type": "choice",
            "config": {
                "choice": {
                    "choices": [
                        {
                            "id": "plant",
                            "name": "Plant Details",
                            "type": "piece",
                            "config": {
                                "piece": { "identifier": "plant-attributes" }
                            }
                        },
                        {
                            "id": "vase",
                            "name": "Vase Details",
                            "type": "piece",
                            "config": {
                                "piece": { "identifier": "vase-attributes" }
                            }
                        }
                    ]
                }
            }
        },
        {
            "id": "seo",
            "name": "SEO",
            "type": "piece",
            "config": { "piece": { "identifier": "seo" } }
        }
    ]
}
```

**Supporting pieces:**

```json
{
    "intent": "piece/upsert",
    "identifier": "plant-attributes",
    "name": "Plant Attributes",
    "components": [
        {
            "id": "care-level",
            "name": "Care Level",
            "type": "itemRelations",
            "config": {
                "itemRelations": {
                    "acceptedShapeIdentifiers": ["care-level"],
                    "minItems": 1,
                    "maxItems": 1
                }
            }
        },
        {
            "id": "light-requirement",
            "name": "Light Requirement",
            "type": "selection",
            "config": {
                "selection": {
                    "options": [
                        { "key": "low", "value": "Low Light" },
                        { "key": "medium", "value": "Medium Light" },
                        { "key": "bright", "value": "Bright Light" },
                        { "key": "direct", "value": "Direct Sunlight" }
                    ]
                }
            }
        },
        {
            "id": "mature-size",
            "name": "Mature Size",
            "type": "selection",
            "config": {
                "selection": {
                    "options": [
                        { "key": "small", "value": "Small (under 12\")" },
                        { "key": "medium", "value": "Medium (12-24\")" },
                        { "key": "large", "value": "Large (24-48\")" },
                        { "key": "xl", "value": "Extra Large (48\"+)" }
                    ]
                }
            }
        }
    ]
}
```

```json
{
    "intent": "piece/upsert",
    "identifier": "vase-attributes",
    "name": "Vase Attributes",
    "components": [
        {
            "id": "material",
            "name": "Material",
            "type": "itemRelations",
            "config": {
                "itemRelations": {
                    "acceptedShapeIdentifiers": ["material"],
                    "minItems": 1,
                    "maxItems": 3
                }
            }
        },
        {
            "id": "dimensions",
            "name": "Dimensions",
            "type": "contentChunk",
            "config": {
                "contentChunk": {
                    "components": [
                        {
                            "id": "height",
                            "name": "Height",
                            "type": "numeric",
                            "config": { "numeric": { "units": ["cm", "in"] } }
                        },
                        {
                            "id": "diameter",
                            "name": "Diameter",
                            "type": "numeric",
                            "config": { "numeric": { "units": ["cm", "in"] } }
                        }
                    ]
                }
            }
        }
    ]
}
```

**Benefits:**

- Single product shape instead of multiple
- Shared components (description, SEO) defined once
- Type-specific attributes cleanly separated into pieces
- Easier to maintain and extend
- Clearer information architecture

**Trade-offs:**

- Slightly more complex for editors (choice component requires selecting variant type)
- Frontend may need to handle polymorphic structure
- Only worthwhile when shapes share significant overlap

### Mass Operations Pattern for Consolidated Shapes

When using the 4-phase ordering with consolidated shapes:

1. **Phase 1**: Create variant-specific pieces (plant-attributes, vase-attributes)
2. **Phase 2**: Create consolidated shape container
3. **Phase 3**: Add components to variant pieces
4. **Phase 4**: Add components (including choice with piece references) to consolidated shape

This ensures all piece references in the choice component resolve correctly.

## Common Use Cases

### Standard SEO Piece

A reusable piece for SEO metadata, commonly added to products, folders (landing pages), and documents (articles):

```json
{
    "identifier": "seo",
    "name": "SEO",
    "components": [
        { "id": "title", "name": "Title", "type": "singleLine" },
        { "id": "description", "name": "Description", "type": "richText" },
        { "id": "image", "name": "Image", "type": "images" }
    ]
}
```

Usage in a shape:

```json
{
    "id": "seo",
    "name": "SEO",
    "type": "piece",
    "config": { "identifier": "seo" }
}
```

### E-commerce Product with Variants

```
Product Shape: Clothing
  ├── Description (Rich Text, translatable)
  ├── Material (Item Relations → material documents, acceptedShapeIdentifiers: ["material"])
  ├── Brand (Item Relations → brand document, acceptedShapeIdentifiers: ["brand"], min:1, max:1)
  └── Care Instructions (Rich Text, translatable)

Variant-level (built-in):
  ├── Size (attribute)
  ├── Color (attribute)
  ├── SKU (built-in)
  ├── Images (built-in)
  └── Price (built-in)
```

### Recipe with Ingredients

```
Document Shape: Recipe
  ├── Description (Rich Text)
  ├── Ingredients (contentChunk, repeating)
  │     ├── Quantity (Numeric)
  │     ├── Unit (Selection: g, ml, pcs)
  │     └── Ingredient (Item Relations → ingredient products, acceptedShapeIdentifiers: ["ingredient"])
  └── Allergens (Item Relations → allergen documents, acceptedShapeIdentifiers: ["allergen"])
```

### Blog Post with Topics

```
Document Shape: Blog Post
  ├── Hero Image (Images)
  ├── Content (Paragraph Collection)
  ├── Author (Item Relations → author document, acceptedShapeIdentifiers: ["author"])
  ├── SEO (Piece → seo-metadata)
  └── topics → Category topic map, Tags topic map
```

### Product Configurator

```
Product Shape: Configurable Product
  └── Options (contentChunk, repeating)
        ├── Option (Item Relations → option products, acceptedShapeIdentifiers: ["option"])
        └── Quantity (Numeric)

Document Shape: Configuration Rule
  ├── If Option (Item Relations → option, acceptedShapeIdentifiers: ["option"])
  ├── Rule Type (Selection: requires, excludes, optional)
  └── Then Option (Item Relations → option, acceptedShapeIdentifiers: ["option"])
```

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
9. **Plan localization early** - Enable `isTranslatable` from the start
10. **Mark fields discoverable** - Enable for filtering/search in Discovery API
11. **Apply design patterns** - Use established patterns for scalable models

## Anti-Patterns to Avoid

❌ **Item Relations without acceptedShapeIdentifiers** - Allows linking any shape, breaks semantic meaning

❌ **Using Item Relations for simple labels** - Use Topic Maps instead (better performance, simpler)

❌ **Flat component lists** - Group related fields with Chunks for better structure

❌ **Flat singleLine variant components** - `variantComponents` follow the same type rules as product-level components. Voltage, length, weight → `numeric` with units. Connection type, material, animal version → `selection` with options. Only use `singleLine` for genuinely free-form text (a color label, a custom code). A variant story full of `singleLine` is a modeling smell.

❌ **Mixing variant data with product data** - Use variant attributes (built-in) for size/color/sku

❌ **Adding GTIN/EAN/ISBN as a variant component** - The built-in `sku` field handles single product identifiers. For multiple identifiers, add a chunk with named single-line components (e.g., `isbn-10`, `isbn-13`, `gtin`, `ean`, `upc`, `legacy-id`) at the shape level, not on the variant.

❌ **Adding price or stock components to product shapes** - Products have native `price` and `stock` fields on variants. Only add custom pricing/stock components for specific edge cases (tiered pricing, subscription models, configurator price modifiers, bulk discounts)

❌ **Selection for expandable values** - Use documents + item relations for brands/categories that grow

❌ **Not planning for localization** - Adding multilingual support later requires migration

❌ **Using contentChunk as direct child of componentMultipleChoice** - Chunks should be inside pieces, not direct children

❌ **Using choice/componentChoice as direct children of componentMultipleChoice** - Choices cannot be nested directly

❌ **Nesting structural components directly** - componentChoice, componentMultipleChoice, and contentChunk can only have pieces or regular components as direct children, never other structural components. Use pieces as intermediaries.

❌ **Choice items without a `type` field** - Every item in a `choices` / `componentConfigs` array MUST have a `type` field. Objects like `{ "id": "smartphone", "name": "Smartphone", "components": [...] }` are INVALID — the `components` key does not exist on a choice item and `type` is missing. If a choice needs multiple fields, create a separate piece and reference it with `{ "type": "piece", "config": { "piece": { "identifier": "smartphone-spec" } } }`.

❌ **Polymorphic Choice with inline component groups** - When different choice variants (e.g. Smartphone, Laptop, Headphones) each need their own set of fields, **do NOT** embed a `components` array directly on the choice object. This is the most common componentChoice mistake. **Always** create a `piece/upsert` operation for each variant and reference the piece. Example: `{ "type": "piece", "config": { "piece": { "identifier": "smartphone-spec" } } }` where `smartphone-spec` is a separate piece containing Screen Size, Storage, OS fields.

❌ **CTA/USP items as componentMultipleChoice choices** - These should be repeating chunks inside a piece, not top-level choices

❌ **Single-choice configurations** - Choice components (choice, componentChoice, componentMultipleChoice) MUST have at least 2 options. Single option is invalid. If you only have one option, use a direct piece reference instead of wrapping it in a componentChoice.

❌ **Wrapping single piece in componentChoice** - If a component only needs one piece (e.g., CTA), add the piece directly. Don't use `componentChoice` with one option.

❌ **Empty contentChunk (no components)** - A `contentChunk` with zero child components is meaningless and invalid. Always define at least 1 component inside a chunk. If you find yourself creating an empty chunk, reconsider the design.

See [Content Modelling Guide](references/content-modelling.md) for detailed anti-patterns and migration strategies.

## Mass Operations — 4-Phase Ordering

When creating shapes and pieces via mass operations (Bulk Task API), use a **4-phase ordering** to handle cross-references and relations correctly.

### Phase Order

1. **Create empty pieces** → `intent: "piece/upsert"` (identifier + name, NO `components`)
2. **Create empty shapes** → `intent: "shape/upsert"` (identifier + name + type, NO `components`/`variantComponents`)
3. **Add components to pieces** → `intent: "piece/upsert"` (identifier + name + `components`)
4. **Add components to shapes** → `intent: "shape/upsert"` (identifier + name + type + `components`/`variantComponents`)

**REQUIRED FIELDS**:

- All upsert operations MUST include `identifier` and `name`
- Shape upserts MUST include `type`

**How upsert works:** Multiple operations with the same `identifier` will update the same resource. Phase 1-2 create containers, phase 3-4 populate them with components.

### Why This Order?

Components can reference pieces (via `type: "piece"`) and shapes (via `itemRelations` with `acceptedShapeIdentifiers`). By creating containers first (phases 1-2), then populating them with components that may contain references (phases 3-4), all references resolve correctly.

### Example Operations File

```json
{
    "version": "1.0.0",
    "operations": [
        // Phase 1: Create piece containers (no components)
        {
            "intent": "piece/upsert",
            "identifier": "seo",
            "name": "SEO"
        },
        {
            "intent": "piece/upsert",
            "identifier": "hero",
            "name": "Hero Section"
        },
        // Phase 2: Create shape containers (no components)
        {
            "intent": "shape/upsert",
            "identifier": "product",
            "name": "Product",
            "type": "product"
        },
        {
            "intent": "shape/upsert",
            "identifier": "brand",
            "name": "Brand",
            "type": "document"
        },
        // Phase 3: Update pieces with components (same identifier - upsert updates existing)
        {
            "intent": "piece/upsert",
            "identifier": "seo",
            "name": "SEO",
            "components": [
                { "id": "title", "name": "SEO Title", "type": "singleLine" },
                { "id": "description", "name": "SEO Description", "type": "singleLine" }
            ]
        },
        {
            "intent": "piece/upsert",
            "identifier": "hero",
            "name": "Hero Section",
            "components": [
                { "id": "headline", "name": "Headline", "type": "singleLine" },
                { "id": "image", "name": "Hero Image", "type": "images" }
            ]
        },
        // Phase 4: Update shapes with components (can now safely reference pieces)
        {
            "intent": "shape/upsert",
            "identifier": "product",
            "name": "Product",
            "type": "product",
            "components": [
                { "id": "description", "name": "Description", "type": "richText" },
                {
                    "id": "seo",
                    "name": "SEO",
                    "type": "piece",
                    "config": { "piece": { "identifier": "seo" } }
                },
                {
                    "id": "brand",
                    "name": "Brand",
                    "type": "itemRelations",
                    "config": {
                        "itemRelations": {
                            "maxItems": 1,
                            "acceptedShapeIdentifiers": ["brand"]
                        }
                    }
                }
            ],
            "variantComponents": [
                { "id": "weight", "name": "Weight", "type": "numeric", "config": { "numeric": { "units": ["g", "kg"], "discoverable": true } } },
                {
                    "id": "color",
                    "name": "Color",
                    "type": "selection",
                    "config": { "selection": { "options": [{ "key": "black", "value": "Black" }, { "key": "white", "value": "White" }] } }
                }
            ]
        },
        {
            "intent": "shape/upsert",
            "identifier": "brand",
            "name": "Brand",
            "type": "document",
            "components": [
                { "id": "description", "name": "Description", "type": "richText" },
                { "id": "logo", "name": "Logo", "type": "images" }
            ]
        }
    ]
}
```

**Note:** Using `piece/upsert` or `shape/upsert` in a single operation (without the 4-phase split) will work ONLY if there are no cross-references. When pieces reference other pieces or shapes reference pieces/other shapes, the 4-phase order is required.

## Validation Checklist

Before presenting the mass operations JSON, verify:

1. **Validate with `build-mass-operation` tool** — Run the operations array through the MCP tool and fix any schema errors. This is the source of truth.
2. **`acceptedShapeIdentifiers`** on every `itemRelations` component — no untyped relations
3. **No structural nesting violations** — `contentChunk`, `componentChoice`, `componentMultipleChoice` cannot be direct children of each other
4. **Every `contentChunk` has at least 1 component** — empty chunks are invalid
5. **Every `componentChoice`/`componentMultipleChoice` has at least 2 choices** — single-choice is invalid
6. **No custom price/stock components** on product shapes — these are built-in on variants
7. **`paragraphCollection` config always has `multilingual` array** — this is required, not optional (use `[]` for no localization, `["title", "body", "images", "videos"]` for full localization)
8. **`datetime` config uses only valid fields** — `required`, `discoverable`, `multilingual` only. There is no `format` field.
9. **`files` config**: if `acceptedContentTypes` is provided, each entry needs `contentType` (required). If `maxFileSize` is provided, both `size` and `unit` are required.
10. **Naming conventions** — all identifiers use lowercase-with-hyphens (no camelCase, no underscores)
11. **Reusable SEO piece** — create an SEO piece and reference it from multiple shapes
12. **Localization strategy** — translatable for marketing text, non-translatable for universal data (codes, dimensions)

## References

- [Create Shape API Reference](references/create-shape-api.md) - **Full mutation type reference with all required fields, config structures, and validation rules for `createShape`**
- [Content Modelling Guide](references/content-modelling.md) - Comprehensive design framework, industry patterns, validation
- [Components Reference](references/components.md) - All 15+ component types, nesting rules, localization
- [Design Patterns Reference](references/design-patterns.md) - 5 bridge patterns with complete JSON examples
- [Shapes Reference](references/shapes.md) - Shape types, variantComponents, and creation process
- [Pieces Reference](references/pieces.md) - Reusable field sets
- [Taxonomies Reference](references/taxonomies.md) - Topic Maps and Grids

## Examples by Industry

**Fashion:** Product with variants (size/color), material classifications, brand documents, care instructions

**Food/Recipe Domain:** Complete model using Quantised Bridge pattern:

```
Product Shape: Ingredient
  ├── Description (Rich Text)
  ├── Nutrition (Piece → nutrition)
  └── Allergens (Item Relations → allergen docs, acceptedShapeIdentifiers: ["allergen"])

Product Shape: Recipe
  ├── Description (Rich Text)
  ├── Prep Time (Numeric, unit: minutes)
  ├── Cook Time (Numeric, unit: minutes)
  ├── Servings (Numeric)
  ├── Ingredients (contentChunk, repeating) ← Quantised Bridge
  │     ├── Quantity (Numeric)
  │     ├── Unit (Selection: g, ml, pcs, tbsp, tsp, cup)
  │     └── Ingredient (Item Relations → ingredient, acceptedShapeIdentifiers: ["ingredient"])
  ├── Instructions (Paragraph Collection)
  └── Allergens (Item Relations → allergen docs, computed from ingredients)

Product Shape: Meal Kit
  ├── Description (Rich Text)
  ├── Recipes (contentChunk, repeating) ← Quantised Bridge
  │     ├── Servings (Numeric)
  │     └── Recipe (Item Relations → recipe, acceptedShapeIdentifiers: ["recipe"])
  └── Dietary Tags (Item Relations → dietary docs)

Document Shape: Allergen
  ├── Icon (Images)
  ├── Warning Text (Rich Text)
  └── Severity (Selection: mild, moderate, severe)

Piece: nutrition
  ├── Calories (Numeric, unit: kcal)
  ├── Protein (Numeric, unit: g)
  ├── Carbs (Numeric, unit: g)
  └── Fat (Numeric, unit: g)
```

This pattern enables: ingredient → recipe → meal kit composition with quantity tracking at each level, automatic allergen rollup, and nutrition calculation.

**Electronics:** Product with configuration options, compatibility rules, technical specs, brand classifications

**Music/Instruments:** Guitar store example using Semantic Bridge pattern:

```
Product Shape: Guitar
  ├── Description (Rich Text)
  ├── Body Type (Item Relations → body-type docs, acceptedShapeIdentifiers: ["body-type"])
  ├── Pickup Configuration (Item Relations → pickup docs, acceptedShapeIdentifiers: ["pickup"])
  ├── Wood Type (Item Relations → wood docs, acceptedShapeIdentifiers: ["wood"])
  ├── Brand (Item Relations → brand doc, acceptedShapeIdentifiers: ["brand"], min:1, max:1)
  └── SEO (Piece → seo)

Classification Documents:
  ├── body-type: Stratocaster, Les Paul, Telecaster, SG...
  ├── pickup: Single Coil, Humbucker, P90, Active...
  ├── wood: Alder, Mahogany, Maple, Rosewood...
  └── brand: Fender, Gibson, PRS, Ibanez...
```

This pattern allows rich content for each classification (e.g., brand logo, wood tone characteristics) while maintaining type safety through `acceptedShapeIdentifiers`.

**B2B:** Service packages with tiers, case studies, industry classifications, expertise levels

**Publishing:** Books with contributors (composite bridge), series, publishers, multi-format variants

See [Content Modelling Guide](references/content-modelling.md) for complete industry-specific patterns.
