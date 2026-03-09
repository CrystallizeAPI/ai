---
name: information-architecture
description: Design folder hierarchies and navigation structures in Crystallize. Create category trees, organize products and content, plan URL structures, and build scalable information architectures. Use when designing storefront navigation, category pages, collection structures, or content organization.
metadata:
  author: Crystallize
  version: "1.0"
---

# Crystallize Information Architecture Skill

Design and implement folder hierarchies for Crystallize storefronts. This skill helps you create effective navigation structures, category pages, and content organization.

## Consultation Approach

Before generating a folder structure, ask clarifying questions to understand the user's needs:

### Key Discovery Questions

1. **Multi-Dimensional Navigation**
   - "Do customers need to browse products in multiple ways? (e.g., by category AND by brand)"
   - "Would you like collections like 'New Arrivals', 'Sale', or seasonal collections?"

2. **Multi-Market Commerce**
   - "Do you sell in multiple markets or regions with different product assortments?"
   - "Do different markets have different pricing, availability, or content needs?"

3. **Content Strategy**
   - "What content pages do you need? (About, Blog, Support, etc.)"
   - "Do you have editorial content like guides, lookbooks, or tutorials?"

4. **Business Model**
   - "Is this B2C, B2B, or both?"
   - "Do you have physical stores or is it online-only?"

5. **Scale & Growth**
   - "How many products/categories do you expect to have?"
   - "Any planned expansion to new categories or markets?"

## Core Concepts

### Hierarchical Organization

Content in Crystallize is organized in a tree structure:

- **Folders** are the organizational containers
- Every item has a **path** (e.g., `/shop/men/clothing`)
- Paths become **URLs** in the storefront
- The tree drives **navigation**, **breadcrumbs**, and **category pages**

### The Three Organization Systems

1. **Hierarchical (Tree)** - Parent/child folders for main navigation
2. **Sequential (Order)** - Position within a folder for sorting
3. **Taxonomic (Topics)** - Cross-cutting tags for filtering and discovery

This skill focuses on hierarchical organization. See the Taxonomy skill for topics.

## Best Practices

### 1. User-Centric Design

Structure should match how customers think and shop:

- **Fashion**: By gender → By category → By type
- **Electronics**: By product type → By brand/features
- **Food**: By meal type or dietary need

### 2. Optimal Depth

Keep hierarchy **2-4 levels deep**:

```
✅ Good: /shop/men/shoes/sneakers
❌ Too deep: /shop/clothing/men/casual/shoes/athletic/sneakers/running
```

### 3. Balanced Width

- **Too few** items per level = unnecessary clicks
- **Too many** items = overwhelming navigation
- Aim for **5-12 items** at each level

### 4. SEO-Friendly Paths

Paths become URLs, so:

- Use descriptive, keyword-rich names
- Keep paths readable and logical
- Avoid IDs or codes in paths

### 5. Plan for Growth

Ask: "Where will new products/categories go?"

## Common Patterns

### Standard E-commerce

```
/
├── shop/
│   ├── category-1/
│   ├── category-2/
│   └── category-3/
├── brands/
├── sale/
├── new-arrivals/
└── about/
```

### Fashion Store

```
/
├── shop/
│   ├── men/
│   │   ├── clothing/
│   │   ├── shoes/
│   │   └── accessories/
│   ├── women/
│   │   ├── clothing/
│   │   ├── shoes/
│   │   └── accessories/
│   └── kids/
├── brands/
├── collections/
│   ├── summer-2024/
│   └── basics/
└── sale/
```

### Electronics Store

```
/
├── computers/
│   ├── laptops/
│   ├── desktops/
│   └── tablets/
├── mobile/
│   ├── phones/
│   └── accessories/
├── audio/
├── gaming/
├── deals/
└── support/
```

### Content-Heavy Site

```
/
├── products/
├── blog/
│   ├── news/
│   ├── tutorials/
│   └── case-studies/
├── resources/
│   ├── guides/
│   └── documentation/
└── about/
```

### Multi-Dimensional Navigation

When customers need to browse by multiple dimensions (category AND brand):

```
/
├── products/
│   ├── by-category/
│   │   ├── clothing/
│   │   ├── shoes/
│   │   └── accessories/
│   ├── by-brand/
│   │   ├── nike/
│   │   ├── adidas/
│   │   └── puma/
│   └── collections/
│       ├── summer-2024/
│       └── sale/
├── brands/           # Brand landing pages
└── about/
```

Use this pattern when:
- Customers think in both categories AND brands
- You have strong brand presence
- Different customer segments browse differently

### Multi-Market Commerce (Shortcuts Pattern)

For stores selling in multiple markets with different assortments:

```
/
├── products/              # Master product location (canonical)
│   ├── clothing/
│   ├── shoes/
│   └── electronics/
├── markets/
│   ├── europe/
│   │   ├── germany/
│   │   │   └── products/  # Shortcuts to /products/ items
│   │   └── france/
│   │       └── products/
│   └── north-america/
│       ├── usa/
│       │   └── products/
│       └── canada/
│           └── products/
├── about/
└── blog/
```

**Key benefits:**
- Products exist once in `/products/` (single source of truth)
- Market folders use **shortcuts** to reference products
- Different assortments per market (not all products everywhere)
- Market-specific category pages and content
- Pricing and availability controlled per market

**When to use:**
- Selling in multiple regions/countries
- Different product availability per market
- Region-specific pricing or content
- Regulatory requirements (some products not sold everywhere)

### B2B + B2C Hybrid

```
/
├── shop/                  # B2C storefront
│   ├── category-1/
│   └── category-2/
├── wholesale/             # B2B section
│   ├── price-lists/
│   └── bulk-orders/
├── products/              # Shared product catalog
└── about/
```

## Folder Shapes

Different folders may need different shapes:

| Folder Type | Shape Features |
|-------------|----------------|
| Category | Hero image, description, featured products grid |
| Brand | Logo, story, brand values, all products |
| Collection | Theme, curated products, limited time |
| Landing | Flexible content blocks, CTAs |

## Operations Format

Folder operations use the mass-operations format:

```json
{
  "version": "0.0.1",
  "operations": [
    {
      "name": "Shop",
      "shapeIdentifier": "category",
      "parentPath": "/",
      "intent": "folder/upsert"
    },
    {
      "name": "Men",
      "shapeIdentifier": "category", 
      "parentPath": "/shop",
      "intent": "folder/upsert"
    }
  ]
}
```

### Operation Fields

| Field | Description |
|-------|-------------|
| `name` | Display name of the folder |
| `shapeIdentifier` | Which folder shape to use |
| `parentPath` | Path to parent folder |
| `position` | Optional: order within parent |
| `intent` | `folder/create` or `folder/upsert` |

## Integration with Other Systems

### Navigation Menus

Top-level folders typically become main navigation:

```
Root folders → Main nav items
Second-level → Dropdown/mega menu
Third-level → Sub-navigation or sidebar
```

### Breadcrumbs

The folder path creates breadcrumbs automatically:

```
/shop/men/shoes → Home > Shop > Men > Shoes
```

### URL Routing

Folder paths map to frontend routes:

```
Crystallize path: /shop/men/shoes
Frontend URL: https://store.com/shop/men/shoes
```

### Topics (Cross-cutting)

While folders handle main navigation, topics handle:

- Filters (color, size, material)
- Tags (sale, new, featured)
- Cross-category discovery

## Anti-Patterns

### ❌ Duplicating Products

Don't put the same product in multiple folders. Use topics instead:

```
❌ /men/sale/shoes/sneakers AND /sale/men/sneakers
✅ /men/shoes/sneakers (tagged with "sale" topic)
```

### ❌ Deep Nesting

Don't create unnecessary depth:

```
❌ /products/all-products/shoes/athletic/running/mens
✅ /shop/men/running-shoes
```

### ❌ Generic Names

Use descriptive, SEO-friendly names:

```
❌ /category-1/subcategory-a
✅ /electronics/smartphones
```

### ❌ Mixing Concerns

Keep organizational logic consistent:

```
❌ /men/sale/electronics/blue-items
✅ /men/electronics (use topics for "sale" and "blue")
```
