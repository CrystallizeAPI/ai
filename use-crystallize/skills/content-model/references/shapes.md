# Shapes Reference

Shapes in Crystallize are blueprints that define how content and products are structured. They specify which fields (components) are available when editors create items in the catalogue.

## Shape Types

### Product Shape

Used for sellable items with variants, pricing, and stock.

**Built-in capabilities:**

- Product variants with SKUs
- Pricing per variant
- Stock management
- Variant attributes (size, color, etc.)

**Example use cases:**

- Physical products (clothing, furniture)
- Digital products (software, downloads)
- Subscription products
- Configurable products

#### variantComponents — Custom Fields on Variants

Product shapes support `variantComponents` in addition to `components`. These are custom component definitions that appear on each product **variant** rather than on the product itself.

Use `variantComponents` when you need variant-level data beyond the built-in SKU, images, videos, price, stock, and attributes — for example:

- Variant-specific certifications (e.g., per-color safety certification)
- Variant-level specs that differ per variant (e.g., battery capacity per size)
- Custom variant identifiers (e.g., manufacturer variant codes)

```graphql
mutation {
    createShape(
        input: {
            name: "Phone"
            type: product
            components: [
                # Product-level components
                { id: "description", name: "Description", type: richText }
                {
                    id: "brand"
                    name: "Brand"
                    type: itemRelations
                    config: { itemRelations: { acceptedShapeIdentifiers: ["brand"], maxItems: 1 } }
                }
            ]
            variantComponents: [
                # Variant-level custom components
                {
                    id: "battery-capacity"
                    name: "Battery Capacity"
                    type: numeric
                    config: { numeric: { units: ["mAh"], discoverable: true } }
                }
                {
                    id: "color-name"
                    name: "Color Name"
                    type: singleLine
                    config: { singleLine: { multilingual: true } }
                }
            ]
        }
    ) {
        ... on Shape {
            identifier
        }
    }
}
```

> **Note:** Do not use `variantComponents` for fields that are the same across all variants — those belong in `components` (product level).

### Document Shape

Used for editorial and marketing content. **Documents are leaf nodes and cannot have children.**

**Example use cases:**

- Blog posts / Articles
- About pages
- FAQ sections
- News articles
- Brand pages

**Important:** Documents cannot have children in the catalogue tree. If you need structure (e.g., landing pages with sub-pages), use a Folder shape instead.

### Folder Shape

Used to organize the catalogue hierarchy. **Folders can have children.**

**Example use cases:**

- Categories
- Collections
- Landing pages (when structure/children needed)
- Campaigns
- Sections

Folders can be nested to create hierarchical navigation.

## Components

Components are the atomic fields that make up shapes.

### Basic Components

| Component   | Description                 | API Type     |
| ----------- | --------------------------- | ------------ |
| Single Line | Short text (max ~256 chars) | `singleLine` |
| Rich Text   | Formatted HTML content      | `richText`   |
| Numeric     | Numbers with optional units | `numeric`    |
| Boolean     | True/false values           | `boolean`    |
| Datetime    | Date and time picker        | `datetime`   |
| Location    | GPS coordinates             | `location`   |

### Media Components

| Component | Description                 | API Type |
| --------- | --------------------------- | -------- |
| Images    | Image gallery with variants | `images` |
| Videos    | Video files                 | `videos` |
| Files     | Any file type               | `files`  |

Images are automatically optimized and served in WebP/AVIF formats with responsive sizes.

### Structural Components

#### Chunk

Groups related fields together. Can be marked as repeatable.

```
Specifications (Chunk, Repeatable)
├── Weight (Numeric, kg)
├── Height (Numeric, cm)
└── Material (Single Line)
```

#### Choice

Polymorphic field where editors select ONE option from predefined choices.

```
Guitar Specs (Choice)
├── Electric Specs
│   ├── Pickup Type (Single Line)
│   └── Wattage (Numeric)
└── Acoustic Specs
    ├── Body Wood (Single Line)
    └── Soundhole Style (Single Line)
```

#### Multiple Choice

Like Choice, but multiple options can be selected simultaneously.

### Relation Components

| Component      | Description              | Use Case                      |
| -------------- | ------------------------ | ----------------------------- |
| Item Relation  | Links to catalogue items | Related products, cross-sells |
| Grid Relation  | Links to grids           | Featured collections          |
| Topic Relation | Links to topics          | Categories, tags              |

## Component Settings

### Identifier

Unique key used in API queries. Auto-generated from name but customizable.

- Use camelCase: `productDescription`
- Keep stable once in production
- Must be unique within the shape

### Localization

Enable to allow translation into multiple languages. When enabled:

- Content can be entered per language
- API queries require language parameter
- Missing translations return null

### Discoverability

Controls whether the field appears in Discovery API:

- **Enabled**: Field is searchable and filterable
- **Disabled**: Field only in Catalogue API

Use for fields that need search/filter capabilities.

### Repeatability (in Chunks)

When enabled on a chunk, editors can add multiple instances:

```
Ingredients (Chunk, Repeatable)
├── Name (Single Line)
├── Amount (Numeric)
└── Unit (Single Line)

Result:
- Flour, 500, grams
- Sugar, 200, grams
- Eggs, 3, pieces
```

## Creating a Shape

1. Go to **Settings → Shapes**
2. Click **+** icon
3. Select shape type
4. Drag components from right panel
5. Configure each component
6. Click **Update** to save

## Shape Best Practices

1. **Plan before building** - Sketch your data model first
2. **Use semantic names** - `productDescription` not `field1`
3. **Group with chunks** - Keep related fields together
4. **Make fields discoverable** - Enable for searchable attributes
5. **Consider localization** - Enable early if multilingual
6. **Keep shapes focused** - One shape per content type
7. **Version carefully** - Changing shapes affects existing content

## Related Links

- [Crystallize Shapes Documentation](https://crystallize.com/docs/pim/shapes)
- [Design Patterns](design-patterns.md)
