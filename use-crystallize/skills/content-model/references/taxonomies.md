# Taxonomies Reference

Taxonomies in Crystallize include Topic Maps for classification and Grids for curated collections.

## Topic Maps

Topic Maps define classifications and taxonomies that can be assigned to products, documents, folders, and media assets.

### Topics vs Catalogue Hierarchy

| Aspect     | Catalogue (Folders) | Topics             |
| ---------- | ------------------- | ------------------ |
| Structure  | Single hierarchy    | Multi-dimensional  |
| Defines    | Where item lives    | What item is about |
| Navigation | Primary navigation  | Faceted filtering  |
| Assignment | One parent only     | Multiple topics    |

### Why Use Topics?

1. **Classification** - Add structured tags to any item
2. **Multi-dimensional navigation** - Faceted browsing
3. **Search & filtering** - Power Discovery API filters
4. **Consistency** - Central taxonomy across teams

### Creating Topic Maps

1. Navigate to **Topic Maps** in left menu
2. Click **+** to create new topic map
3. Name it clearly (e.g., "Flavour", "Origin", "Material")
4. Add child topics to build hierarchy

### Topic Hierarchy

Topics can be nested at multiple levels:

```
Flavour (Topic Map)
├── Fruity
│   ├── Citrus
│   │   ├── Lemon
│   │   ├── Lime
│   │   └── Orange
│   └── Berry
│       ├── Strawberry
│       └── Blueberry
├── Roasty
│   ├── Burnt Sugar
│   └── Smoky
│       ├── Dark Smoke
│       └── Light Smoke
└── Nutty
    ├── Almond
    └── Hazelnut
```

### Topic Features

**Localization:**
Each topic can be translated, enabling multilingual taxonomies.

**Visual Organization:**
Drag and drop to restructure topics visually.

**Hierarchy Depth:**
No limit on nesting depth. Design for your use case.

### Assigning Topics

Topics are assigned via:

- Catalogue UI when editing items
- Topic Relation component in shapes
- API mutations

### Querying Topics

In Discovery API:

```graphql
{
    search(filter: { type: PRODUCT, topics: { path: { equals: "/flavour/fruity/citrus" } } }) {
        edges {
            node {
                name
                topics {
                    name
                    path
                }
            }
        }
    }
}
```

### Topic Aggregations

Get facet counts:

```graphql
{
    search(filter: { type: PRODUCT }) {
        aggregations {
            topics {
                path
                name
                count
            }
        }
    }
}
```

---

## Grids

Grids are curated collections of catalogue items, independent of the main hierarchy.

### Why Use Grids?

1. **Curated selections** - Highlight products for campaigns
2. **Flexible layout** - Freeform visual arrangement
3. **Cross-category grouping** - Combine items from different areas
4. **Reusability** - Use same grid in multiple places

### Grid Use Cases

- Homepage hero/featured sections
- Seasonal promotions
- Editor's picks
- Newsletter content
- Landing page components

### Creating a Grid

1. Navigate to **Grids** in left menu
2. Click **+** to create new grid
3. Name it descriptively (e.g., "Summer Sale", "Editor's Picks")
4. Add items via search or catalogue browser
5. Switch to Edit Layout mode to arrange
6. Click **Publish** when ready

### Grid Layout

Grids support freeform layouts:

- Resize items individually
- Create visual hierarchy
- Mix content types (products + documents)
- Maintain layout across API responses

### Grid Relations

Use Grid Relation component in shapes to reference grids:

```
Homepage (Document Shape)
├── Hero Banner (Piece)
├── Featured Products (Grid Relation)
├── Latest Posts (Grid Relation)
└── Newsletter Signup (Piece)
```

### Querying Grids

```graphql
{
    grid(id: "grid-id") {
        name
        rows {
            columns {
                item {
                    name
                    path
                    ... on Product {
                        defaultVariant {
                            price
                        }
                    }
                }
                layout {
                    colspan
                    rowspan
                }
            }
        }
    }
}
```

### Grid Best Practices

1. **Name semantically** - "Summer Campaign 2024" not "Grid 1"
2. **Keep focused** - One theme per grid
3. **Consider layout** - Design for frontend display
4. **Update regularly** - Refresh campaign grids
5. **Use for merchandising** - Cross-sell, upsell opportunities

---

## Topics vs Grids

| Feature    | Topics                   | Grids                       |
| ---------- | ------------------------ | --------------------------- |
| Purpose    | Classification           | Curation                    |
| Structure  | Hierarchical taxonomy    | Flat collection with layout |
| Assignment | Topics assigned to items | Items placed in grid        |
| Discovery  | Powers filtering/facets  | Editorial selection         |
| Use case   | Navigation, search       | Merchandising, campaigns    |

## Combined Usage

Topics and grids work together:

1. Use topics to classify all products by attribute
2. Use grids to create curated selections for campaigns
3. Filter by topic in Discovery API for category pages
4. Display grids for promotional areas

## Related Links

- [Crystallize Topic Maps Documentation](https://crystallize.com/docs/pim/topic-maps)
- [Crystallize Grids Documentation](https://crystallize.com/docs/pim/grids)
