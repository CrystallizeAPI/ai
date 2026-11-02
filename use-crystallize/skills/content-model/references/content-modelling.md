# Content Modelling Guide

This guide provides comprehensive information on designing effective content models in Crystallize.

## Understanding Built-in Fields vs Components

Every item in Crystallize has built-in fields that exist automatically:

**Universal built-in fields (all items):**

- `name` - Item name (translatable, creates path in catalogue tree)
- `id` - Unique identifier
- `language` - Language code
- `tree` - Catalogue tree position
- `topics` - Topic classifications
- `externalReference` - ID of the item in an external system
- `createdAt` - Creation timestamp
- `updatedAt` - Last modification timestamp

**Product variant built-in fields:**

- `sku` - Stock keeping unit (unique identifier)
- `images` - Product photos
- `videos` - Product videos
- `price` - Pricing information
- `stock` - Inventory levels
- `attributes` - Additional variant attributes
- `externalReference` - ID of the variant in an external system

**Components** are the additional, dynamic fields you add to shapes beyond these built-in fields. When designing shapes, you're defining what extra information is needed beyond what Crystallize provides automatically.

## Thinking Framework for Content Model Design

### Start with Intent, Not Structure

Before creating shapes, ask:

1. **What are you selling/publishing?** (products, articles, courses, etc.)
2. **How will customers discover it?** (search, browse categories, filters)
3. **What makes each item unique?** (specs, features, content)
4. **What's shared across items?** (brands, materials, classifications)
5. **How will it be presented?** (product pages, grids, recommendations)

### The Three-Layer Approach

**Layer 1: Core Content (Shapes)**
The fundamental item types in your catalogue.

```
Products → Physical goods that can be purchased
Documents → Editorial content, marketing pages
Folders → Categories, collections, organizational structure
```

**Layer 2: Classification (Topic Maps + Documents)**
How items are categorized and filtered.

```
Topic Maps → Simple, hierarchical classifications (flavor, color, size)
Classification Documents → Rich classifications that need content (brands, certifications, allergens)
```

**Layer 3: Curation (Grids)**
Editorial selections independent of catalogue structure.

```
Grids → Homepage features, campaigns, seasonal collections
```

### Decision Tree: Shape or Document?

**Use a Product shape when:**

- Item can be purchased
- Needs variants (size, color, subscription period)
- Requires pricing, stock, SKUs
- Needs cart/checkout integration

**Use a Document shape when:**

- Content is editorial/informational
- No purchasing required
- Needs rich content with media
- Part of classification system (brands, ingredients)

**Use a Folder shape when:**

- Organizing other items hierarchically
- Creating categories or collections
- Building navigation structure

## Industry-Specific Patterns

### Fashion & Apparel

**Shapes:**

- Product: Clothing Item
    - Variants: Size (XS-XXL), Color
    - Components: Material composition, care instructions, fit guide
    - Relations: Brand (document), Collection (document), Materials (documents)

**Topic Maps:**

- Category: Tops, Bottoms, Shoes, Accessories
- Season: Spring/Summer, Fall/Winter
- Style: Casual, Formal, Sporty, Vintage

**Classification Documents:**

- Brand: Logo, story, values, country of origin
- Material: Description, care instructions, sustainability info
- Collection: Theme, season, lookbook images

### Food & Beverage

**Shapes:**

- Product: Food Item
    - Variants: Size/Weight
    - Components: Nutrition facts, storage instructions, preparation
    - Relations: Allergens (documents), Ingredients (products), Certifications (documents)

**Topic Maps:**

- Dietary: Vegan, Vegetarian, Gluten-Free, Organic
- Meal Type: Breakfast, Lunch, Dinner, Snack
- Cuisine: Italian, Asian, Mexican, Mediterranean

**Classification Documents:**

- Allergen: Icon, severity level, regulatory info
- Certification: Logo, issuing body, validity period
- Ingredient: Nutrition data, origin, properties

### Electronics & Technology

**Shapes:**

- Product: Electronic Device
    - Variants: Configuration (storage, RAM, color)
    - Components: Technical specs (table), connectivity, dimensions
    - Relations: Compatible Accessories (products), Brand (document)

**Topic Maps:**

- Category: Smartphones, Laptops, Tablets, Wearables
- Operating System: iOS, Android, Windows, macOS
- Connectivity: WiFi, Bluetooth, 5G, NFC

**Classification Documents:**

- Brand: Logo, support info, warranty terms
- Technology: Explanation, benefits, compatibility
- Specification Standard: Definition, certification, compliance

### B2B / Professional Services

**Shapes:**

- Product: Service Package
    - Variants: Tier (Basic, Professional, Enterprise)
    - Components: Features list, deliverables, terms
    - Relations: Case Studies (documents), Industries (documents)

**Topic Maps:**

- Industry: Healthcare, Finance, Retail, Manufacturing
- Service Type: Consulting, Implementation, Support, Training
- Expertise Level: Junior, Mid, Senior, Expert

**Classification Documents:**

- Industry Vertical: Overview, challenges, solutions
- Case Study: Client, challenge, solution, results
- Certification: Credential, issuing body, validity

### Publishing & Media

**Shapes:**

- Product: Book/Course
    - Variants: Format (Hardcover, Paperback, eBook, Audio)
    - Components: Table of contents, sample chapter, reviews
    - Relations: Authors (documents), Publishers (documents), Series (documents)

**Document:** Article/Post

- Components: Content blocks, author bio, related articles
- Relations: Topics, Authors, Categories

**Topic Maps:**

- Genre: Fiction, Non-Fiction, Biography, Technical
- Difficulty: Beginner, Intermediate, Advanced, Expert
- Language: English, Spanish, French, German

**Classification Documents:**

- Author: Bio, photo, social links, bibliography
- Publisher: Logo, description, catalogue
- Series: Description, reading order, theme

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
  └── Allergens (Item Relations → allergen docs, derived from the ingredients by your own integration)

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

This pattern enables: ingredient → recipe → meal kit composition with quantity tracking at each level. The data supports allergen rollup and nutrition calculation, but Crystallize does not compute them: your application or integration does.

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

## Common Patterns by Use Case

### E-commerce Fundamentals

**Product with Variants (Size, Color)**

```
Product Shape: Clothing
  ├── Description (Rich Text)
  ├── Material (Item Relation → Material documents)
  ├── Care Instructions (Rich Text)
  ├── Fit Guide (Piece)
  └── Brand (Item Relation → Brand document)

Variant Components:
  ├── Size (built-in attribute)
  ├── Color (built-in attribute)
  ├── SKU (built-in)
  └── Images (built-in)
```

**Product Kits/Bundles**

```
Product Shape: Gift Set
  ├── Description (Rich Text)
  └── Contents (Chunk, repeating)
        ├── Product (Item Relation → Product)
        ├── Quantity (Numeric)
        └── Customization Notes (Single Line)
```

### Content-Heavy Sites

**Blog with Categories and Tags**

```
Document Shape: Blog Post
  ├── Hero Image (Images)
  ├── Content (Paragraph Collection)
  ├── Author (Item Relation → Author document)
  ├── SEO (Piece)
  └── Related Posts (Item Relation → Blog Post)

Topic Maps:
  - Category (hierarchical)
  - Tags (flat)
```

**Landing Pages with Sections**

```
Folder Shape: Landing Page (folders can have children, documents cannot)
  ├── SEO (Piece)
  └── Sections (Multiple Choice, repeating)
        ├── Hero Banner (Piece)
        ├── Feature Grid (Piece)
        ├── Testimonials (Piece)
        ├── CTA Block (Piece)
        └── Product Showcase (Piece)
```

### Product Configurators

**Custom Furniture Builder**

```
Product Shape: Configurable Furniture
  ├── Base Model (Item Relation → Base Product)
  └── Options (Chunk, repeating)
        ├── Category (Selection: Material, Color, Hardware)
        ├── Choice (Item Relation → Option Product)
        └── Price Modifier (Numeric)

Document Shape: Configuration Rule
  ├── Condition (Selection: requires, excludes, optional)
  ├── If Option (Item Relation → Option)
  └── Then Option (Item Relation → Option)
```

### Subscription Services

**Tiered Subscription Plans**

```
Product Shape: Subscription

Variants:
  ├── Plan Tier (attribute: Basic, Pro, Enterprise)
  ├── Billing Period (attribute: Monthly, Annual)

Components:
  ├── Features (Chunk, repeating)
  │     ├── Feature Name (Single Line)
  │     ├── Included (Boolean)
  │     └── Limit (Numeric, optional)
  └── Price Tiers (Paragraph Collection)
```

### Multi-Language / Multi-Market

**Global Product Catalogue**

```
Product Shape: Global Product
  ├── Name (Single Line, translatable)
  ├── Description (Rich Text, translatable)
  ├── GTIN (Single Line, NOT translatable)
  ├── Dimensions (Numeric, NOT translatable)
  ├── Region Info (Chunk, repeating)
  │     ├── Region (Selection)
  │     ├── Availability (Boolean)
  │     └── Regulatory Notes (Rich Text, translatable)
  └── Market-Specific Content (Multiple Choice)
        ├── EU Piece (translated descriptions, certifications)
        ├── US Piece (FDA info, warnings)
        └── APAC Piece (local certifications)
```

## Common Use Cases

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

## Anti-Patterns to Avoid

### ❌ Over-Structuring

**Problem:** Creating too many components when one would do.

```
Bad:
├── Street Name (Single Line)
├── Street Number (Single Line)
├── Apartment (Single Line)
├── City (Single Line)
├── State (Single Line)
├── ZIP (Single Line)
├── Country (Single Line)

Good:
└── Address (Rich Text or Chunk)
      ├── Street Address (Single Line)
      ├── City (Single Line)
      ├── Postal Code (Single Line)
      └── Country (Selection)
```

### ❌ Using Item Relations When Topics Suffice

**Problem:** Creating classification documents when simple topics work.

```
Bad:
Document Shape: Color
  ├── Color Name
  └── HEX Code

Product:
  └── Colors (Item Relation → Color documents)

Good:
Topic Map: Colors
  ├── Red
  ├── Blue
  └── Green

Product:
  └── topics → Colors
```

**When to use Item Relations over Topics:**

- Classification needs description, images, or rich content
- Classification is multilingual with different translations
- Classification itself needs metadata or attributes

### ❌ Hardcoding Enums as Selection Options

**Problem:** Using Selection components for values that may expand.

```
Bad (rigid):
Product:
  └── Brand (Selection: Nike, Adidas, Puma)

Good (scalable):
Document Shape: Brand
  ├── Logo (Images)
  ├── Description (Rich Text)
  └── Website (Single Line)

Product:
  └── Brand (Item Relation → Brand document)
```

### ❌ Flat Component Lists

**Problem:** Not grouping related fields with Chunks.

```
Bad:
Product:
  ├── Ingredient 1 Name
  ├── Ingredient 1 Quantity
  ├── Ingredient 1 Unit
  ├── Ingredient 2 Name
  ├── Ingredient 2 Quantity
  ├── Ingredient 2 Unit
  ...

Good:
Product:
  └── Ingredients (Chunk, repeating)
        ├── Name (Single Line)
        ├── Quantity (Numeric)
        └── Unit (Selection)
```

### ❌ Mixing Variant Data with Product Data

**Problem:** Adding variant-specific fields to product shape.

```
Bad:
Product Shape:
  ├── Size (Selection) ← Should be variant attribute
  ├── Color (Selection) ← Should be variant attribute
  └── SKU (Single Line) ← Built-in on variants

Good:
Product Shape:
  └── Fit Guide (Rich Text) ← Product-level

Variant Attributes (built-in):
  ├── Size
  ├── Color
  ├── SKU
  └── Images
```

### ❌ Not Planning for Localization Early

**Problem:** Adding multilingual support later requires data migration.

```
Bad (then needs fixing):
Product:
  └── Description (Rich Text, NOT translatable)

Then need to migrate all content when expanding to new markets.

Good (planned):
Product:
  └── Description (Rich Text, translatable from the start)
```

## Validation Best Practices

### Use Min/Max Constraints

Item Relations, Selection components, and numeric fields support validation:

```json
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

This enforces:

- Editors must select at least 1 brand
- Editors cannot select more than 1 brand
- Only items with shape "brand" can be selected

### Required vs Optional Fields

Every component config takes `required`, and leaving it out is not the same as `false`:

| `required` | Empty component                                                         | Component with content |
| ---------- | ----------------------------------------------------------------------- | ---------------------- |
| `true`     | Rejected                                                                | Fully validated        |
| `false`    | Accepted. Every other rule is skipped                                   | Fully validated        |
| left out   | Still held to its rules, so a `min`, `pattern` or `units` makes it fail | Fully validated        |

This is why a new component in the App starts with `required: false`, and why a shape created through the API often needs it set explicitly. These checks run when an item is created or its components are updated.

You can also enforce requirements through:

1. **Item Relations**: `minItems: 1` makes the field required
2. **Selection**: `min: 1, max: 1` for required single selection
3. **Business logic**: Validate in your application layer
4. **Editorial guidelines**: Document required fields in shape descriptions

### Accepted Shape Identifiers

Always restrict Item Relation components to specific shapes:

```json
{
    "id": "ingredients",
    "name": "Ingredients",
    "type": "itemRelations",
    "config": {
        "itemRelations": {
            "acceptedShapeIdentifiers": ["ingredient"],
            "minItems": 1
        }
    }
}
```

Without `acceptedShapeIdentifiers`, editors could link any shape type, breaking your data model's semantic meaning.

## Performance Considerations

### Component Count

- Crystallize supports hundreds of components per shape
- Keep shapes focused for better editor UX
- Use pieces to share common field sets across shapes

### Nesting Depth

- Maximum 4 levels of nesting for structural components
- Beyond 4 levels, use Item Relations instead
- Deep nesting impacts query performance

### Discovery API Optimization

- Discovery indexes every component unless it sets `discoverable: false`, so turn it off on fields nobody searches
- Numeric fields with discovery enabled can be sorted/filtered
- Rich Text discovery enables full-text search on that content

## Migration Patterns

### Adding New Components

Safe - existing items get null/empty values for new components. The next update to one of those items is validated against the new definition, though: a new component with `required: true`, or with a `min`, `pattern` or `units` and `required` left out, makes that update fail until it is filled.

### Removing Components

Dangerous - data loss. Consider:

1. Export data first
2. Create new shape with migration path
3. Gradually migrate content
4. Delete the old shape when complete. A shape cannot be deleted while it has items or a role refers to it, and a piece cannot be deleted while a shape or another piece uses it

### Changing Component Types

Not supported directly. Pattern:

1. Add new component with different ID
2. Migrate data via API
3. Remove old component

### Renaming Components

Use the identifier field:

- Display name can change freely (editor-facing)
- Identifier change requires data migration (API-facing)

## References

- [Components Reference](./components.md) - All component types and configuration
- [Design Patterns Reference](./design-patterns.md) - Bridge patterns and advanced modeling
- [Shapes Reference](./shapes.md) - Shape types and creation
- [Pieces Reference](./pieces.md) - Reusable field sets
- [Taxonomies Reference](./taxonomies.md) - Topic Maps and Grids
