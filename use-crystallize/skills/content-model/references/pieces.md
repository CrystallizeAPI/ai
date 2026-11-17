# Pieces Reference

Pieces in Crystallize are reusable sets of fields that can be embedded inside Shapes. They help avoid duplication and ensure consistency across your content model.

## What Are Pieces?

Pieces are independent component groups that exist outside of shapes. Once created, they can be dragged into any shape like a regular component.

**Key characteristics:**

- Created once, used many times
- Changes to a piece affect all shapes using it
- Can contain any components including chunks and other pieces, but never itself, directly or through another piece
- Support localization

## When to Use Pieces

Use pieces for content that:

- Appears across multiple shapes
- Needs consistent structure
- Is managed separately from main content
- Represents a reusable concept

## Common Piece Examples

### Standard SEO Piece

One SEO piece for the whole model, referenced from every product, folder and document shape that has a page:

```json
{
    "identifier": "seo",
    "name": "SEO",
    "components": [
        {
            "id": "title",
            "name": "Title",
            "type": "singleLine",
            "config": { "singleLine": { "multilingual": true, "discoverable": true, "max": 70 } }
        },
        {
            "id": "description",
            "name": "Description",
            "type": "singleLine",
            "config": { "singleLine": { "multilingual": true, "discoverable": true, "max": 160 } }
        },
        {
            "id": "image",
            "name": "Image",
            "type": "images",
            "config": { "images": { "discoverable": true, "max": 1 } }
        }
    ]
}
```

Usage in a shape:

```json
{
    "id": "seo",
    "name": "SEO",
    "type": "piece",
    "config": { "piece": { "identifier": "seo" } }
}
```

- **Plain text, not rich text.** The description goes into `<meta name="description">`, Open Graph and JSON-LD, which
  take plain text. A Single Line keeps editors from adding formatting that would be stripped or leak as markup.
- **No canonical URL field.** Canonicals and hreflang come from the item's generated paths (see
  [[information-architecture]]). A typed canonical goes stale on the first rename, and nothing warns.
- **No separate OG title or OG image.** `title` and `image` serve both. Add a field only when editors really need a
  different value for social sharing.
- **Discoverable, explicitly.** A storefront that reads only Discovery loses every field that isn't indexed, so set
  `discoverable: true` on each component rather than relying on the default.
- **Always have a fallback.** Most items will leave the piece empty. Fall back in a fixed order, for example: the SEO
  title, then the item name; the SEO description, then the item's lead text (a tagline or intro), then a sentence
  built from typed specs; the SEO image, then the first product image. See [[seo-geo]].
- **Indexing rules are the storefront's job.** A `noindex` switch is only worth adding when editors decide it per
  item; search results and filtered views get `noindex` or a canonical from the storefront's own rules.

### Environmental Impact

Sustainability data for products:

```
Environmental Data (Piece)
├── Carbon Footprint (Numeric, kg CO2)
├── Recyclable (Boolean)
├── Recycled Content (Numeric, percentage)
├── Certifications (Chunk, Repeatable)
│   ├── Name (Single Line)
│   └── Logo (Images)
└── Disposal Instructions (Rich Text)
```

### Banner/Hero

Promotional banner component:

```
Banner (Piece)
├── Headline (Single Line)
├── Subheadline (Rich Text)
├── Background (Images)
├── CTA Text (Single Line)
├── CTA Link (Single Line)
└── Theme (Selection: Light, Dark, Transparent)
```

### Author

For editorial content:

```
Author (Piece)
├── Name (Single Line)
├── Avatar (Images)
├── Bio (Rich Text)
├── Social Links (Chunk, Repeatable)
│   ├── Platform (Single Line)
│   └── URL (Single Line)
└── Author Page (Item Relation → Document)
```

### Product Visualizer

3D/AR product visualization:

```
Product Visualizer (Piece)
├── 3D Model (Files, .glb/.gltf)
├── AR Enabled (Boolean)
├── Initial Rotation (Numeric, degrees)
├── Background Color (Single Line, hex)
└── Hotspots (Chunk, Repeatable)
    ├── Label (Single Line)
    ├── X Position (Numeric)
    ├── Y Position (Numeric)
    └── Description (Rich Text)
```

## Creating a Piece

1. Navigate to **Settings → Shapes**
2. Scroll to the **Pieces** section
3. Click **+** to create new piece
4. Give it a descriptive name
5. Add components using drag and drop
6. Configure each component
7. Click **Update** to save

## Using Pieces in Shapes

1. Open the shape you want to modify
2. In the right panel, find your piece
3. Drag and drop it into the shape
4. Position as needed
5. Save the shape

## Piece Configuration

### Inside a Piece

Each component can have:

- Name and identifier
- Localization settings
- Repeatability (for chunks)
- Validation rules

### When Embedded in Shape

Additional options:

- Override display name
- Set as required
- Position in component order

## Best Practices

1. **Name clearly** - "SEO", "Banner", not "Piece 1"
2. **Single responsibility** - One piece = one concept
3. **Plan for reuse** - Design pieces to work in multiple contexts
4. **Keep pieces small** - Large pieces are harder to maintain
5. **Document usage** - Note which shapes use each piece
6. **Version carefully** - Changes affect all shapes using the piece

## Pieces vs Chunks

| Feature                | Piece                        | Chunk           |
| ---------------------- | ---------------------------- | --------------- |
| Reusable across shapes | ✅                           | ❌              |
| Can be repeatable      | ❌ (embed in chunk for this) | ✅              |
| Lives in               | Settings → Shapes            | Inside a shape  |
| Changes affect         | All shapes using it          | Only that shape |

## API Access

Pieces appear in the API as nested objects:

```graphql
{
    catalogue(path: "/products/coffee", language: "en") {
        ... on Product {
            component(id: "seo") {
                content {
                    ... on PieceContent {
                        components {
                            id
                            content {
                                ... on SingleLineContent {
                                    text
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
```

## Related Links

- [Crystallize Shapes Documentation](https://crystallize.com/docs/pim/shapes)
- [Shapes Reference](shapes.md)
