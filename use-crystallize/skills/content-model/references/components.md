# Components Reference

Components are the **dynamic** fields you add to a Shape. They sit on top of built-in fields that every item already has (`name`, `id`, `language`, `tree`, `topics`, `createdAt`, `updatedAt`). Product variants also have built-in fields for `sku`, `images`, `videos`, `price`, `stock`, and `attributes` — these are NOT components.

Choosing the right component for each piece of **additional** data determines how editors interact with it, how it renders on the frontend, and whether it can be filtered/searched via the Discovery API.

## Decision Guide: Which Component to Use

### "I need to store text"

| Scenario                                                       | Component                |
| -------------------------------------------------------------- | ------------------------ |
| Short, single-value text (subtitle, GTIN, EAN, MPN, ISBN, URL) | **Single Line**          |
| Formatted content with headings, links, lists, bold            | **Rich Text**            |
| Long-form editorial with mixed media sections                  | **Paragraph Collection** |

- **Single Line** → structured, unformatted, indexable. Ideal for labels, codes, and short metadata. Note: item `name` and variant `sku` are built-in fields, not Single Line components — but additional identifiers (GTIN, EAN, UPC, MPN) beyond the built-in SKU are valid Single Line components.
- **Rich Text** → formatted text block. Produces structured JSON (not HTML). Supports headings, lists, links, bold, italic, inline code. Use for product descriptions, marketing copy, specification text.
- **Paragraph Collection** → repeating sections, each with: title (single line) + body (rich text) + media (images/video). Use for blog posts, editorial storytelling, landing page content blocks, any content that alternates text and media.

### "I need to store numbers"

| Scenario                                               | Component            |
| ------------------------------------------------------ | -------------------- |
| A measurable value with a unit (weight, length, power) | **Numeric**          |
| Arbitrary key-value specs (varied, not fixed)          | **Properties Table** |

- **Numeric** → stores a number with one or more selectable units (e.g. g, mg, kg for weight; cm, m, in for length). Editors pick which unit applies when entering a value. Preferred when the metric is known and fixed — enables Discovery API filtering and sorting. Create one Numeric component per metric (e.g., `weight`, `length`, `power`).
  - **Units config**: define the list of valid unit options in `config.numeric.units` as a string array — e.g. `["g", "mg", "kg"]`, `["cm", "m", "in"]`, `["W", "kW"]`. Editors can then select from these units when entering values. Leave empty if the unit is fixed/implied.
  - **Example**: `{ "id": "weight", "name": "Weight", "type": "numeric", "config": { "numeric": { "units": ["g", "mg", "kg"] } } }`
- **Properties Table** → key-value pairs in table format. Use when keys are arbitrary or user-defined. Does NOT enable typed filtering in Discovery. Use for: technical specification sheets where keys vary per product.
  - **Fixed keys (configured in shape)**: Keys are predefined in the shape definition. Editors fill in values for preset keys. Useful when you know the specification names upfront but prefer a table layout over individual Numeric components.
  - **Fluid/Dynamic keys (defined at content entry)**: Editors define both keys AND values when adding content. Useful for flexible technical specifications where key names vary by product category or are unpredictable.

**Rule of thumb**: If you always know the key name upfront → use Numeric. If the keys vary per item → use Properties Table.

### "I need to store media"

| Scenario                               | Component  |
| -------------------------------------- | ---------- |
| Product photos, banners, galleries     | **Images** |
| Product demos, tutorials, promo videos | **Videos** |
| Downloadable files (PDFs, ZIPs, etc.)  | **Files**  |

- **Images** → auto-transcoded to responsive sizes (Avif, WebP), served via Crystallize CDN. Supports multiple images per component (galleries, carousels). Each image gets `url`, `variants` (with width/height/size), `altText`, `caption`. Note: product variant images are built-in — use an Images component for product-level lifestyle photos, document hero images, or other non-variant media.
- **Videos** → auto-transcoded for web/mobile streaming, CDN-delivered. Upload or embed.
- **Files** → upload files for download. Use for manuals, datasheets, certificates, whitepapers.

### "I need to link to other items"

| Scenario                                                   | Component         |
| ---------------------------------------------------------- | ----------------- |
| Link to another catalogue item (product, document, folder) | **Item Relation** |
| Link to a curated grid of items                            | **Grid Relation** |

- **Item Relation** → the backbone of all bridge design patterns. Links to one or more items. On product shapes, can link to specific variants (SKU-level). Use for: related products, brand references, ingredients, accessories, any semantic relationship.
  - **Configuration options** (like relational database constraints):
    - **Accepted shape identifiers**: restrict which shapes can be linked (e.g., only allow "Brand" documents, or only "Product" shapes)
    - **Min relations**: minimum number of items that must be linked (e.g., every product must have at least 1 brand)
    - **Max relations**: maximum number of items that can be linked (e.g., product can link to max 5 related products)
  - These constraints enforce data integrity and guide editors to create consistent relationships.
- **Grid Relation** → links to a curated grid. Use for: seasonal landing pages, campaign highlights, curated collections.

**When choosing between Item Relation and Topic Maps for classification:**

- Item Relation when the classification value needs its own rich content (description, images, metadata)
- Topic Maps when classification is just labels for navigation/filtering

### "I need a controlled set of options"

| Scenario                                                    | Component     |
| ----------------------------------------------------------- | ------------- |
| Predefined dropdown or multi-select (color, size, material) | **Selection** |
| Boolean flag (featured, in-stock, certified)                | **Switch**    |
| A date or timestamp                                         | **Datetime**  |
| Geographic coordinates                                      | **Location**  |

- **Selection** → dropdown, radio buttons, or checkboxes with predefined options. Each option has a `key` (API value) and `value` (display label). Configure min/max selections to control behavior:
  - **Radio/Enum pattern**: min=1, max=1, required → exactly one selection, renders as radio buttons or dropdown
  - **Checkboxes pattern**: min=0, max=N → optional multi-select, renders as checkboxes, can be null
    Use when the options are a fixed, small set that don't need their own content. If options need enrichment (images, descriptions), use Item Relations instead (Semantic Bridge pattern).
  - **API option structure**: `{ key: "red", value: "Red", isPreselected?: Boolean }` — `key` is used in queries/filters, `value` is what editors see
- **Switch** → true/false toggle. Use for: "Featured", "On Sale", "Available in store", "Organic certified".
- **Datetime** → date with optional time (type: `datetime`). Use for: launch date, preorder availability, expiration, event scheduling.
- **Location** → latitude/longitude. Use for: store locator, pickup points, product origin.

### "I need to group or structure fields"

| Scenario                                                                 | Component           |
| ------------------------------------------------------------------------ | ------------------- |
| Group related fields that repeat together (ingredient + quantity + unit) | **Chunk**           |
| One of N mutually exclusive field sets (image hero OR video hero)        | **Choice**          |
| Multiple of N field sets that can coexist (physical attrs AND digital)   | **Multiple Choice** |

These are **structural components** — they don't store data directly but organize other components:

- **Chunk (contentChunk)** → a group of components that belong together (repeatable OR single occurrence)
  - **Can be repeatable:** Enable `repeatable: true` to create lists (ingredients, specifications, addresses)
  - **Can be single:** Use `repeatable: false` (or omit) for one-time groups that only occur once in the model
  - **When to use chunk:** Fields are tightly coupled and specific to one location in your content model
  - **Examples (repeatable):** Ingredients list, multiple addresses, product specifications, USP items
  - **Examples (non-repeatable):** SEO metadata (title+description+keywords as one group), single shipping address, environment settings
  - **Decision rule:** If this exact group structure only appears once in the entire content model → use a non-repeatable chunk instead of creating a piece
  - Building block for all bridge patterns (semantic, quantised, conditional, composite)
  - **A chunk must always have at least 1 child component — empty chunks are invalid.**
- **Choice (choice, componentChoice)** → select exactly ONE structure from a set. The editor picks which form applies, and only sees fields for that choice. Implements the **Polymorphic Choice** pattern. Use when a concept has multiple valid but mutually exclusive representations.
- **Multiple Choice (componentMultipleChoice)** → select ONE OR MORE structures from a set. Similar to Choice but allows combining forms. Use when multiple structural forms can coexist on the same item.
  - **Common pattern**: Define each option as a **Piece** (reusable component group) for consistency across shapes
  - **Validation**: `allowDuplicates` (API field) — when `false`, each choice can only be selected once; when `true`, editors can add the same choice multiple times (e.g., two Banner sections on a page)
  - **Use cases**:
    - **Page builders**: Multiple Choice of section Pieces (Banner, Testimonials, Product Grid, Text Block) — editors add/remove/reorder sections
    - **Polymorphic products**: Products that are similar but details vary — add fragmented Pieces (Physical Attributes, Digital License, Subscription Terms) that editors select based on product type
    - **Flexible content**: Any scenario where an item can have multiple coexisting structural forms

### Critical Nesting Rule for Structural Components

**Structural components (contentChunk, componentChoice, componentMultipleChoice) can ONLY have pieces or regular components as direct children.**

They **CANNOT** have other structural components as direct children:

- ❌ componentChoice cannot contain componentChoice/componentMultipleChoice/contentChunk
- ❌ componentMultipleChoice cannot contain componentChoice/componentMultipleChoice/contentChunk
- ❌ contentChunk cannot contain componentChoice/componentMultipleChoice/contentChunk

**Valid direct children of componentChoice / componentMultipleChoice:**

- ✅ Regular components: `images`, `videos`, `singleLine`, `richText`, `numeric`, `files`, `boolean`, `selection`, `itemRelations`, etc.
- ✅ Piece references: `{ "type": "piece", "config": { "piece": { "identifier": "..." } } }` — the piece MUST exist as a separate `piece/create` operation

**Invalid direct children (NEVER allowed):**

- ❌ `contentChunk` — structural, cannot be a direct child
- ❌ `componentChoice` — nested structural, cannot be a direct child
- ❌ `componentMultipleChoice` — nested structural, cannot be a direct child

**Concrete examples — componentChoice with media options:**

```json
// ✅ CORRECT — choices are regular component types (images, videos)
{
  "id": "background-media",
  "name": "Background Media",
  "type": "componentChoice",
  "config": {
    "componentChoice": {
      "componentConfigs": [
        { "id": "image", "name": "Image", "type": "images" },
        { "id": "video", "name": "Video", "type": "videos" }
      ]
    }
  }
}

// ✅ CORRECT — choices are piece references (pieces MUST be created separately)
{
  "id": "product-type",
  "name": "Product Type",
  "type": "componentChoice",
  "config": {
    "componentChoice": {
      "componentConfigs": [
        { "id": "smartphone", "type": "piece", "config": { "piece": { "identifier": "smartphone-spec" } } },
        { "id": "laptop", "type": "piece", "config": { "piece": { "identifier": "laptop-spec" } } }
      ]
    }
  }
}
// + separate piece/create operations for "smartphone-spec" and "laptop-spec" MUST also be in the operations array

// ❌ WRONG — contentChunk as a direct choice option
{
  "id": "product-type",
  "type": "componentChoice",
  "config": {
    "componentChoice": {
      "componentConfigs": [
        { "id": "smartphone", "name": "Smartphone", "type": "contentChunk", "components": [...] }
      ]
    }
  }
}

// ❌ WRONG — anonymous inline component group (no `type` field, `components` array directly on choice)
// THIS IS THE MOST COMMON MISTAKE. The `components` key does not exist on a choice item.
// Every choice item MUST have a `type` field — there is no such thing as an "anonymous group" choice.
{
  "id": "product-type",
  "type": "componentChoice",
  "config": {
    "componentChoice": {
      "choices": [
        {
          "id": "smartphone",
          "name": "Smartphone",
          "components": [
            { "id": "screen-size", "type": "numeric" },
            { "id": "storage", "type": "numeric" }
          ]
          // ❌ Missing "type" field — this is INVALID. `components` is not a valid key on a choice item.
        }
      ]
    }
  }
}
```

**Rule: if each choice needs multiple fields grouped together, create a separate `piece/create` operation for each choice and reference it. NEVER use contentChunk as a choice option. NEVER put a `components` array directly on a choice item.**

**Polymorphic Choice with per-variant fields (CORRECT approach):**

When building a "Product Type" selector where each type (Smartphone, Laptop, Headphones) has its OWN set of fields, you MUST:

1. Create a `piece/create` operation for each variant
2. Reference those pieces in the componentChoice

```json
// ✅ CORRECT — each choice variant has its own piece with the right fields
// Step 1: Create pieces for each variant
{ "intent": "piece/create", "identifier": "smartphone-spec", "name": "Smartphone Spec", "components": [
    { "id": "screen-size", "name": "Screen Size", "type": "numeric", "config": { "numeric": { "units": ["inch"] } } },
    { "id": "storage", "name": "Storage", "type": "numeric", "config": { "numeric": { "units": ["GB", "TB"] } } },
    { "id": "os", "name": "Operating System", "type": "selection", "config": { "selection": { "options": [{ "key": "ios", "value": "iOS" }, { "key": "android", "value": "Android" }] } } }
] }
{ "intent": "piece/create", "identifier": "laptop-spec", "name": "Laptop Spec", "components": [
    { "id": "screen-size", "name": "Screen Size", "type": "numeric", "config": { "numeric": { "units": ["inch"] } } },
    { "id": "ram", "name": "RAM", "type": "numeric", "config": { "numeric": { "units": ["GB"] } } },
    { "id": "processor", "name": "Processor", "type": "singleLine" }
] }

// Step 2: Reference them in componentChoice
{
  "id": "product-type",
  "name": "Product Type",
  "type": "componentChoice",
  "config": {
    "componentChoice": {
      "choices": [
        { "id": "smartphone", "name": "Smartphone", "type": "piece", "config": { "piece": { "identifier": "smartphone-spec" } } },
        { "id": "laptop", "name": "Laptop", "type": "piece", "config": { "piece": { "identifier": "laptop-spec" } } }
      ]
    }
  }
}
```

**To nest structural components inside choices, use pieces as intermediaries:**

```json
// The piece itself can then contain contentChunk
{
  "intent": "piece/create",
  "identifier": "smartphone-spec",
  "name": "Smartphone Spec",
  "components": [
    {
      "type": "contentChunk",  // ✓ allowed inside a piece
      "components": [...]
    }
  ]
}
```

### Nesting Depth Limits for Structural Components

Structural components (Chunk, Piece, Choice, Multiple Choice) can be nested, but **only up to 4 levels deep**. At level 4, you can only use non-structural components (Single Line, Rich Text, Numeric, etc.).

**Valid nesting patterns:**

```
Level 1: Chunk OR Choice/Multiple Choice
  └─ Level 2: Piece
       └─ Level 3: Choice/Multiple Choice OR Piece OR Chunk
            └─ Level 4: Piece OR Choice/Multiple Choice OR Chunk
                 └─ Level 5: Only non-structural components allowed
                       (Single Line, Rich Text, Numeric, Images, etc.)
```

**Example — Maximum nesting depth:**

```
Product Shape
  └─ Level 1: page-sections (Chunk[], repeating)
       └─ Level 2: section (Piece - e.g., "Hero Section")
            └─ Level 3: hero-variant (Choice)
                 ├─ Image Hero
                 │    └─ Level 4: cta-group (Piece)
                 │         └─ Level 5: headline (Single Line) ✓
                 │         └─ Level 5: button-url (Single Line) ✓
                 └─ Video Hero
                      └─ Level 4: video-options (Chunk)
                           └─ Level 5: video (Videos) ✓
                           └─ Level 5: autoplay (Switch) ✓
```

**Why this limit exists:**

1. **Performance** — Deep nesting impacts query performance and API response times
2. **Complexity** — Beyond 4 levels, content structures become hard to maintain and understand
3. **Editor UX** — Deeply nested structures create confusing editing interfaces

**Best practices:**

- Most use cases need only 2-3 levels (e.g., Multiple Choice → Piece → components)
- If you hit the 4-level limit, consider flattening your structure or using Item Relations instead of nested components
- Level 4 is for final structural organization before actual data fields

## Multilingual & Localization

Every component has an **isTranslatable** flag that determines whether content can vary by language or is shared across all languages. This is critical for multi-market catalogues where some data is universal (GTINs, dimensions) while other data needs localization (descriptions, marketing copy).

### How Localization Works

- **Languages** are configured at tenant level (Settings → Languages) with unique codes (ISO 639-1 recommended: `en`, `de`, `fr`, `no-nb`, `se`, but not required)
- **Each component** has an `isTranslatable` configuration you set when designing shapes
- **Editors** switch between languages in the item edit view to add translated content
- **isTranslatable = true** → component content can vary per language (localized)
- **isTranslatable = false** → component content is shared across all languages (universal)
- **Built-in name field** is translatable and creates the path leaf in the catalogue tree — if not defined for a language, you'll see `MISSING_NAME_FOR_ITEM` as placeholder
- **Query language** is specified at the top level of Catalogue API and Discovery API queries

### Default Localization Settings by Component

Different components have different default `isTranslatable` values based on their typical use cases:

| Component                | Default isTranslatable | Typical use case                                              |
| ------------------------ | ---------------------- | ------------------------------------------------------------- |
| **Single Line**          | ✓ True                 | Titles, subtitles, slogans, taglines                          |
| **Rich Text**            | ✓ True                 | Descriptions, marketing copy, specifications                  |
| **Paragraph Collection** | ✓ True                 | Blog posts, landing pages, editorial content                  |
| **Numeric**              | ✗ False                | Dimensions, weights, ratings (universal values)               |
| **Properties Table**     | ✗ False                | Technical specs with shared keys/values                       |
| **Images**               | ✗ False                | Product photos (same images, translate captions)              |
| **Videos**               | ✗ False                | Product videos (same videos, translate captions)              |
| **Files**                | ✗ False                | Shared downloads (or create separate per-market)              |
| **Selection**            | ✗ False                | Shared options (size, color codes)                            |
| **Switch**               | ✗ False                | Boolean flags (universal true/false)                          |
| **Datetime**             | ✗ False                | Universal dates (launch, expiration)                          |
| **Location**             | ✗ False                | Geographic coordinates (universal)                            |
| **Item Relation**        | ✗ False                | Relationships are shared, but related items can be translated |
| **Grid Relation**        | ✗ False                | Grid references shared, grid content can be translated        |

**Important**: These are defaults when adding components. You can override them based on your specific use case.

### Structural Components (Choice & Multiple Choice)

Choice and Multiple Choice components have special translation behavior:

**When the structural component is NOT translatable:**

- The same choices are used across all languages (universal structure)
- Components and Pieces INSIDE each choice CAN be translatable
- Editors see the same choice options in all languages, but content within choices can vary

**Example:**

```
Product Shape
  └── product-type (Multiple Choice, NOT translatable)
        ├── Physical Product (Piece)
        │     ├── weight (Numeric, NOT translatable) → 1.2 kg (universal)
        │     └── description (Rich Text, translatable) → Localized per language
        └── Digital Product (Piece)
              ├── file-size (Numeric, NOT translatable) → 250 MB (universal)
              └── description (Rich Text, translatable) → Localized per language
```

In this example, the choice between "Physical Product" and "Digital Product" is the same across all languages, but the descriptions inside can be translated.

**When the structural component IS translatable:**

- The choices themselves become translatable (different choice options per language)
- All components inside are ALWAYS translatable (cannot be shared)
- This is uncommon — only use when the structure itself varies by market

**Best practice**: Keep Choice/Multiple Choice NOT translatable. Translate the content inside the choices instead. This maintains consistent structure across markets while allowing localized content.

### Paragraph Collection Granular Control

Paragraph Collection allows **per-field** localization control. You can configure which parts should be translatable:

- **Title** → typically translatable (headlines vary by market)
- **Body** → typically translatable (content varies by market)
- **Images** → typically shared (same image, maybe translate alt text)
- **Videos** → typically shared (same video, maybe translate captions)

This granularity is useful for blog posts or editorial content where media is universal but text is localized.

#### Operations Config for paragraphCollection

**CRITICAL**: The `multilingual` property is **REQUIRED** (not optional) for paragraphCollection. It must be an array of **paragraph part names** that should support translations (lowercase), NOT language codes.

Valid values: `"body"`, `"title"`, `"images"`, `"videos"`, `"structure"`

**Examples:**

- Everything localized: `["title", "body", "videos", "images"]`
- Only text localized: `["title", "body"]`
- Nothing localized (universal): `[]`

```json
{
  "id": "body",
  "name": "Body Content",
  "type": "paragraphCollection",
  "config": {
    "paragraphCollection": {
      "multilingual": ["title", "body", "images", "videos"]
    }
  }
}
```

**Common mistakes**:

- Omitting `multilingual` entirely → Error: "expected array, received undefined"
- Using language codes like `["en"]` → Error: `Invalid option: expected one of "body"|"images"|"title"|"videos"|"structure"`
- Using capitalized names like `["Title", "Body"]` → Must use lowercase: `["title", "body"]`

### Localized vs Shared Content Patterns

**When to use localized (isTranslatable = true):**

- Marketing copy and storytelling (titles, descriptions, taglines)
- Editorial content (blog posts, articles, guides)
- Customer-facing text that varies by culture or market
- Legal disclaimers that must be in local language
- SEO metadata (meta descriptions, page titles)

**When to use shared (isTranslatable = false):**

- Universal product identifiers (GTIN, EAN, MPN, internal SKUs)
- Technical specifications with numeric values (weight, dimensions, voltage)
- Product codes and reference numbers
- Structural/classification properties (material codes, category IDs)
- Universal dates (product launch date, manufacturing date)
- Geographic data (coordinates, store locations)

**Mixed pattern example** (common for products):

```
Product Shape
  ├── title (Single Line, translatable) → "Leather Jacket" / "Veste en Cuir"
  ├── description (Rich Text, translatable) → Localized marketing copy
  ├── gtin (Single Line, NOT translatable) → "1234567890123" (universal)
  ├── weight (Numeric, NOT translatable) → 1.2 kg (universal)
  ├── material (Item Relation → Material doc, NOT translatable)
  │     └── Material document itself HAS translatable fields
  │           ├── name (translatable) → "Leather" / "Cuir"
  │           └── description (translatable) → Care instructions in each language
  └── care-instructions (Rich Text, translatable) → Localized guidance
```

### Semantic Bridge Pattern with Translations

The **Semantic Classification Bridge** pattern becomes extremely powerful with translations:

- The **Item Relation component** itself is NOT translatable (relationship is universal)
- The **related document** (Brand, Material, Certification) CAN have translatable components
- Result: One relationship, many translated classification values

**Example — Material classification:**

```
Product Shape
  └── materials (Chunk[], repeating, NOT translatable)
        └── material (Item Relation → Material documents, NOT translatable)

Material Document Shape
  ├── name (Single Line, translatable)
  │     └── en: "Organic Cotton" / fr: "Coton Biologique" / de: "Bio-Baumwolle"
  ├── description (Rich Text, translatable)
  │     └── Localized care instructions, sustainability story
  ├── certification-logo (Images, NOT translatable)
  │     └── Same logo image across all languages
  └── material-code (Single Line, NOT translatable)
        └── "MAT-001" (universal internal code)
```

**Why this works:**

- Product links to Material once (universal relationship)
- Material renders in customer's language automatically
- Update Material translation once, affects all products using it
- Structural integrity maintained (same relationships across languages)

### API Query Behavior

When querying the Catalogue API or Discovery API, you specify the desired language using the `language` parameter. This parameter can be passed:

1. **At the top level** of queries (most common):
   - `catalogue(path: "/shop/chair", language: "en")`
   - `grid(id: "...", language: "en")`
   - `topics(name: "Brands", language: "en")`
   - `productVariants(skus: [...], language: "en")`

2. **On specific relationship fields** (for nested language queries):
   - `Image.topics(language: "en")` — get topic associations in a specific language
   - `ImageShowcase.items(language: "en")` — get showcase items in a specific language
   - `PriceList.products(language: "en")` — get products from price list in a specific language

**Example query with language parameter:**

```graphql
query GetProduct($path: String!, $language: String!) {
  catalogue(path: $path, language: $language) {
    name
    ... on Product {
      variants {
        sku
        name
        price
      }
      # Component fields
      description {
        plainText
      }
      # Relationship components can specify language
      brand {
        name # Automatically uses parent query language
      }
    }
  }
}
```

**For non-translatable components:**

- The default language's content is returned for all queries
- Ensures universal data (GTINs, dimensions, dates) is consistent across markets

**For translatable components:**

- If translation exists for the requested language → returns that translation
- If translation does NOT exist for the requested language → **returns empty** (null/empty string)
- **No automatic fallback** to default language — Crystallize does not implement fallback logic
- Fallback strategy is the **storefront's responsibility** during development

**Common storefront fallback strategies:**

```javascript
// Frontend decides how to handle missing translations
const title = product.title || product.defaultLanguageTitle || "Untitled";
const description =
  product.description || product.defaultLanguageDescription || "";
```

This gives you full control over fallback behavior based on your business rules (show default language? show "translation missing"? hide the field?).

### Planning for Production

**Critical**: Changing `isTranslatable` settings after content is created has side effects.

**When switching from localized to shared:**

- All language variations are discarded
- Content defaults back to the default language value
- All markets will see the same content (from default language)
- **This is irreversible** — translations are permanently lost

**When switching from shared to localized:**

- Existing shared content becomes the default language value
- All non-default languages start empty (need new translations)
- Editors must add translations for each market

**Best practices:**

1. **Plan translation strategy during shape design** — decide which components need localization before creating content
2. **Structural components rarely need translation** — properties, classifications, technical specs usually shared
3. **Test with 2-3 languages early** — verify your translation strategy works before scaling to many markets
4. **Document your decisions** — explain why certain components are/aren't translatable for future maintainers
5. **Use Semantic Bridges for reusable translations** — translate classification documents once, reuse everywhere
6. **Avoid changing isTranslatable in production** — if needed, create new components and migrate content gradually

### Localization Examples by Use Case

**Blog post (maximum localization):**

```
Blog Post Document
  ├── hero-image (Images, NOT translatable) → Same hero across languages
  ├── title (Single Line, translatable) → Localized headlines
  ├── author (Item Relation, NOT translatable) → Same author
  │     └── Author document HAS translatable bio
  ├── publish-date (Date, NOT translatable) → Universal date
  ├── content (Paragraph Collection, translatable)
  │     ├── title: translatable
  │     ├── body: translatable
  │     ├── images: shared
  │     └── videos: shared
  └── topic (Item Relation → Topic docs, NOT translatable)
        └── Topic docs HAVE translatable names/descriptions
```

**Technical product (minimal localization):**

```
Industrial Equipment Product
  ├── model-number (Single Line, NOT translatable) → "XJ-3000"
  ├── marketing-name (Single Line, translatable) → "PowerFlow Pro" / "PowerFlow Pro"
  ├── dimensions (Chunk, NOT translatable)
  │     ├── width (Numeric, NOT translatable) → 50 cm
  │     ├── height (Numeric, NOT translatable) → 100 cm
  │     └── depth (Numeric, NOT translatable) → 30 cm
  ├── voltage (Selection, NOT translatable) → "220V" (universal)
  ├── safety-certification (Item Relation, NOT translatable)
  │     └── Certification doc HAS translatable descriptions
  ├── description (Rich Text, translatable) → Localized marketing copy
  └── manual (Files, NOT translatable OR create separate per language)
```

## Component Selection Flowchart

```
Is the field already built-in (name, SKU, price, stock, images, videos, attributes)?
  → Yes → No component needed — these are built-in on items/variants

Is the data a short text value?
  → Yes → Single Line

Is the data formatted/styled text?
  → Yes, single block → Rich Text
  → Yes, multi-section with media → Paragraph Collection

Is the data a number with a known metric?
  → Yes → Numeric (with unit)

Is the data arbitrary key-value pairs?
  → Yes → Properties Table

Is the data media (images, video, files)?
  → Images → Images
  → Video → Videos
  → Downloads → Files

Is the data a reference to another item?
  → Yes, to catalogue items → Item Relation
  → Yes, to a curated grid → Grid Relation

Is the data a choice from fixed options?
  → Yes, string labels → Selection
  → Yes, true/false → Switch
  → Yes, a date → Date
  → Yes, a location → Location

Does the data need grouping/structure?
  → Repeating group of fields → Chunk
  → One-of-many exclusive forms → Choice
  → Mix-and-match forms → Multiple Choice
```

## Discoverability Rules

The **discoverable** flag determines whether a component is **indexed in the Discovery API at all**. This is not just about filtering — if a component is NOT marked discoverable, it will be completely absent from Discovery API responses.

**Discoverable = true:**

- Component data is indexed and returned in Discovery API queries
- Component becomes available as a filter/sort/facet field
- Generated field name follows the convention: `{componentId}_{subfield}_{type}`

**Discoverable = false:**

- Component data is NOT indexed in Discovery API
- Component will NOT appear in Discovery API responses at all
- Data is still available via Catalogue API and other APIs

### When to Mark Components as Discoverable

**Mark as discoverable when:**

- Customers need to filter/search by this field (color, size, brand, price range)
- You want to sort results by this field (weight, rating, date)
- You need faceted navigation on this field (categories, materials, features)
- The component contains structured data relevant to product discovery

**Examples:**

- Numeric components (price, weight, dimensions) → enables range filters
- Selection components (color, size, material) → enables faceted filtering
- Single Line (model number, GTIN) → enables exact-match filtering
- Switch (featured, on-sale) → enables boolean filtering
- Item Relations (brand, category) → enables filtering by related items

**Do NOT mark as discoverable when:**

- Data is for internal use only and should not be exposed in public APIs (external system IDs, integration keys, internal workflow flags)
- Content contains sensitive organizational information not meant to be shared outside the organization
- Fields are used purely for backend integrations and should never appear on websites or customer-facing applications
- Data is temporary or administrative (import status, internal notes, migration flags)

**Common examples of non-discoverable fields:**

- `external-system-id` (Single Line) — ERP/CRM reference, internal only
- `internal-notes` (Rich Text) — admin comments, not for public display
- `migration-status` (Selection) — data migration tracking
- `integration-key` (Single Line) — third-party system reference
- `internal-workflow-stage` (Selection) — editorial workflow state
- `erp-product-code` (Single Line) — back-office system integration
- `warehouse-location` (Single Line) — internal logistics data

**Typical use case**: System integrations. When you integrate with ERP, CRM, WMS, or other backend systems, you often need to store reference IDs and integration metadata on catalogue items. Mark these fields as non-discoverable so they're available in Core/PIM/Catalogue APIs for your integrations, but never exposed in the customer-facing Discovery API used by your website.

Remember: **non-discoverable does NOT mean "hidden"** — the data is still available in Core API, PIM API, and Catalogue API for authenticated backend use. Use permissions and access control for true security. The discoverable flag only controls whether data appears in the Discovery API (which is typically the public-facing search/filter API used on websites).

### Discovery vs Catalogue API

- **Discovery API** = fast search/filter engine with async indexing. Only includes discoverable component data. **Eventually consistent** — disconnected from database, updates propagate after a short delay.
- **Catalogue API** = full content retrieval with direct database connection. Includes ALL component data regardless of discoverable flag. **Always in sync** — reflects changes immediately.

**When to use each:**

- **Discovery API** — when you need fast search/filter/faceting and can tolerate eventual consistency (typically seconds to minutes). Works for listing pages AND product detail pages if real-time accuracy isn't critical.
- **Catalogue API** — when you need complete data or real-time accuracy. Essential for: admin interfaces, real-time inventory checks, editorial previews, integrations requiring guaranteed up-to-date data.

**Important**: Adding or removing discoverable components requires **re-igniting** the Discovery API for the schema changes to take effect. Plan discoverability at shape design time to minimize re-ignitions.

## Component Validations

Every component type supports validation rules to enforce data integrity and guide editors. These act like database constraints, ensuring content quality and consistency.

### Text Components

| Component                | Available validations                                      |
| ------------------------ | ---------------------------------------------------------- |
| **Single Line**          | Min/max character length, regex pattern, required/optional |
| **Rich Text**            | Min/max character length, required/optional                |
| **Paragraph Collection** | Min/max number of paragraphs, required/optional            |

**Example use cases:**

- Single Line with regex: enforce URL format, validate email addresses, require specific SKU patterns
- Rich Text min length: ensure product descriptions are at least 100 characters
- Paragraph Collection min: require at least 3 sections for blog posts

### Numeric Components

| Component            | Available validations                            |
| -------------------- | ------------------------------------------------ |
| **Numeric**          | Min/max value, decimal places, required/optional |
| **Properties Table** | Min/max number of rows, required/optional        |

**Example use cases:**

- Numeric min/max: weight must be between 0.1kg and 500kg, rating 1-5
- Numeric decimal places: price to 2 decimals, weight to 3 decimals
- Properties Table min rows: require at least 5 specifications per product

### Media Components

| Component  | Available validations                                      |
| ---------- | ---------------------------------------------------------- |
| **Images** | Min/max count, max file size, min/max dimensions, required |
| **Videos** | Min/max count, max file size, max duration, required       |
| **Files**  | Min/max count, max file size, allowed file types, required |

**Example use cases:**

- Images: require at least 3 product photos, max 10, each under 5MB, min 800px wide
- Videos: max 1 demo video, under 100MB, under 3 minutes
- Files: allow only PDF/DOCX for datasheets, max 10MB per file

### Selection Components

| Component     | Available validations                      |
| ------------- | ------------------------------------------ |
| **Selection** | Min/max selections, required/optional      |
| **Switch**    | No validations (always boolean true/false) |
| **Datetime**  | Min/max date range, required/optional      |
| **Location**  | Required/optional                          |

**Example use cases:**

- **Radio/Enum pattern**: min=1, max=1, required → "Select a size" (S, M, L, XL) — exactly one required
- **Checkboxes pattern**: min=0, max=5 → "Select up to 5 dietary preferences" — optional multi-select, can be null
- **Required multi-select**: min=1, max=3 → "Select 1-3 colors" — at least one required, up to 3 allowed
- **Preselected defaults**: Set `isPreselected: true` on commonly chosen options to prefill the selection for editors. Useful for default sizes, standard shipping modes, or common categories. Multiple options can be preselected.
- Date range: launch date must be in the future, expiration within 2 years

### Relationship Components

| Component         | Available validations                                   |
| ----------------- | ------------------------------------------------------- |
| **Item Relation** | Min/max relations, accepted shape identifiers, required |
| **Grid Relation** | Min/max grids, required/optional                        |

**Example use cases:**

- Item Relation: every product must link to exactly 1 brand (min=1, max=1, shapes=["Brand"])
- Item Relation: product can have 0-5 related products (min=0, max=5, shapes=["Product"])
- Grid Relation: landing page must feature at least 2 curated collections

### Structural Components

| Component           | Available validations                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| **Chunk**           | Min/max items (for repeating chunks), required                                                    |
| **Choice**          | Required/optional                                                                                 |
| **Multiple Choice** | Min/max choices selected, `allowDuplicates` (allow same choice multiple times), required/optional |

**Example use cases:**

- Chunk repeating: recipe must have at least 3 ingredients, kit must have 1-10 components
- Multiple Choice for page builder: min=1 (at least one section), `allowDuplicates: true` (can repeat Banner section multiple times)
- Multiple Choice for polymorphic product: min=1, max=3, `allowDuplicates: false` (product must have 1-3 detail Pieces, each unique)

### Validation Best Practices

1. **Start lenient, tighten later** — it's easier to add validations than remove them after content is created
2. **Use validations to prevent common errors** — regex for SKU format, min/max for ratings, required for critical fields
3. **Guide editors with clear validation messages** — "Product description must be at least 100 characters to ensure quality"
4. **Combine with discoverability** — fields used for filtering should have validations ensuring data consistency
5. **Test validations during shape design** — create test items to verify validation rules work as intended

## Pieces vs Chunks: When to Use Each

### Decision Flowchart

**Do you need to group fields together?**

1. **Will this exact group be used in 2+ locations?** (multiple shapes OR multiple pieces)
   - YES → Use a **Piece** (reusable)
   - NO → Continue to step 2

2. **Will this group repeat multiple times in the same location?** (like a list)
   - YES → Use a **Chunk with `repeatable: true`**
   - NO → Use a **Chunk with `repeatable: false`** (or omit repeatable property)

### Examples

| Scenario                                                                  | Solution                   | Reasoning                                 |
| ------------------------------------------------------------------------- | -------------------------- | ----------------------------------------- |
| SEO fields needed on products, articles, and landing pages                | **Piece**                  | Used in 3+ shapes                         |
| Banner section used on landing pages and category pages                   | **Piece**                  | Used in 2+ shapes                         |
| Product ingredients (flour, sugar, eggs)                                  | **Chunk (repeatable)**     | List of items                             |
| Multiple shipping addresses                                               | **Chunk (repeatable)**     | List of addresses                         |
| One-time metadata group (creation date + author + tags) on a single shape | **Chunk (non-repeatable)** | Only used once, not repeating             |
| Contact info (email + phone + address) appearing only on About page       | **Chunk (non-repeatable)** | Only used in one place, single occurrence |
| Video settings (autoplay + muted + loop) for a video component            | **Chunk (non-repeatable)** | Single configuration group                |

### Key Principles

- **Pieces are for reuse** — same structure, multiple locations
- **Chunks are for grouping** — related fields that belong together, whether repeating or not
- **Avoid unnecessary pieces** — if a group only appears once, use a chunk (even non-repeatable)
- **Repeatable is optional** — chunks don't have to repeat; use `repeatable: false` for single-occurrence groups

## Pieces: Reusable Component Groups

A **Piece** is a named collection of components that can be embedded into any shape. Use pieces when the same group of fields appears in multiple shapes.

### When to create a Piece

- The same 3+ components appear in **2 or more shapes OR pieces**
- You want to update the structure once and have it reflect everywhere
- The group represents a distinct concept that will be reused (SEO, CTA, environmental data)

### When NOT to create a Piece

- The group only appears once in your entire content model → use a non-repeatable chunk instead
- The fields don't form a cohesive unit → keep as separate components
- It's just for organization without reuse → use a chunk

### Common Piece patterns

| Piece name         | Components inside                                                                              | Used in                              |
| ------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------ |
| SEO Metadata       | meta-title (Single Line), meta-description (Rich Text), og-image (Images)                      | All product, document, folder shapes |
| CTA Block          | headline (Single Line), body (Rich Text), button-label (Single Line), button-url (Single Line) | Landing pages, category folders      |
| Environmental Data | carbon-footprint (Numeric, kg CO₂), recyclable (Switch), certifications (Item Relation)        | Product shapes                       |
| Social Links       | website (Single Line), instagram (Single Line), twitter (Single Line)                          | Author/brand document shapes         |

## Page Builder Pattern

For flexible page builders where editors can add/remove/reorder sections, use **Multiple Choice** with **Pieces**:

### Structure

```
Landing Page (Folder shape - folders can have children, documents cannot)
  └── sections (Multiple Choice)
        ├── Banner (Piece)
        │     ├── headline (Single Line)
        │     ├── subheadline (Rich Text)
        │     ├── background (Images)
        │     └── cta (Chunk: label + url)
        ├── Testimonials (Piece)
        │     ├── title (Single Line)
        │     └── quotes (Chunk[], repeating)
        │           ├── quote (Rich Text)
        │           ├── author (Single Line)
        │           └── photo (Images)
        ├── Product Grid (Piece)
        │     ├── title (Single Line)
        │     ├── products (Item Relation → Products)
        │     └── columns (Selection: 2, 3, 4)
        ├── Text Block (Piece)
        │     ├── title (Single Line)
        │     ├── content (Rich Text)
        │     └── alignment (Selection)
        └── Video Section (Piece)
              ├── title (Single Line)
              ├── video (Videos)
              └── caption (Rich Text)
```

### Configuration

- **Min choices**: 1 (page needs at least one section)
- **Max choices**: unlimited (or set a limit like 20)
- **Only allow unique**: false (editors can add multiple Banners or Text Blocks)
- **Required**: yes

### Why This Pattern Works

1. **Reusability** — Pieces can be used across multiple page shapes (Landing Page, Category Page, etc.)
2. **Maintainability** — Update a Piece once, changes reflect everywhere it's used
3. **Flexibility** — Editors compose pages by selecting which sections to include
4. **Repeatability** — Same section type can appear multiple times (3 banners, 2 product grids)
5. **Order control** — Frontend renders sections in the order editors selected them

### Alternative: Paragraph Collection

For simpler page builders where all sections follow the same "title + body + media" structure, use **Paragraph Collection** instead. Use Multiple Choice + Pieces when section types have fundamentally different fields.

> **📖 Deep Dive:** See [page-builder-pattern.md](page-builder-pattern.md) for the complete Page Builder pattern reference — including the shared `layout` piece (per-block theming/width), localized structure for per-market merchandising, frontend rendering patterns, and a full architecture diagram based on the Furnitut reference implementation.

## Polymorphic Product Pattern

For products that are similar but have varying details, use **Multiple Choice** with detail **Pieces**:

### Structure

```
Product Shape
  └── product-details (Multiple Choice)
        ├── Physical Attributes (Piece)
        │     ├── dimensions (Chunk: width + height + depth)
        │     ├── weight (Numeric, kg)
        │     └── material (Item Relation → Material documents)
        ├── Digital License (Piece)
        │     ├── license-type (Selection: Single-user, Multi-user, Enterprise)
        │     ├── duration (Numeric, months)
        │     └── download-link (Single Line)
        ├── Subscription Terms (Piece)
        │     ├── billing-cycle (Selection: Monthly, Yearly)
        │     ├── commitment (Numeric, months)
        │     └── cancellation-policy (Rich Text)
        └── Warranty Info (Piece)
              ├── duration (Numeric, years)
              ├── coverage (Rich Text)
              └── terms-pdf (Files)
```

### Configuration

- **Min choices**: 1 (product must have at least one detail type)
- **Max choices**: 3 (product can have multiple detail types but not all)
- **Only allow unique**: true (each detail type can only be selected once)
- **Required**: yes

### Why This Pattern Works

1. **Avoid shape explosion** — One product shape instead of separate shapes for Physical Product, Digital Product, Subscription Product
2. **Flexible combinations** — A product can be physical + subscription, or digital + warranty
3. **Consistent editing** — All products use the same shape, editors just select which details apply
4. **Type safety** — Each detail type has its own validated fields
