---
name: information-architecture
description: Design folder hierarchies and navigation structures in Crystallize. Create category trees, organize products and content, plan URL structures, and build scalable information architectures. Use when designing storefront navigation, category pages, collection structures, content organization, mega menus, or site maps. Also use when the user mentions organizing their catalog, planning their store structure, restructuring navigation, or asks how to organize products or content in Crystallize — even if they don't explicitly say "information architecture."
metadata:
  author: Crystallize
  version: "1.1"
---

# Crystallize Information Architecture Skill

Design and implement folder hierarchies for Crystallize storefronts. This skill helps you create effective navigation structures, category pages, and content organization.

## Consultation Approach

Before generating a folder structure, ask clarifying questions to understand the user's needs. Focus on questions 1, 3, and 4 first — these give you enough to propose an initial structure. Then iterate with the user, refining based on their feedback. Don't exhaustively interview before proposing; a concrete draft sparks better conversation than abstract questions.

### Key Discovery Questions

1. **What are you selling or publishing?**
   - "What kind of products or content will this store have?"
   - "Is this B2C, B2B, or both?"

2. **How do customers browse?**
   - "Do customers need to browse products in multiple ways? (e.g., by category AND by brand)"
   - "Would you like collections like 'New Arrivals', 'Sale', or seasonal collections?"

3. **Content Strategy**
   - "What content pages do you need? (About, Blog, Support, etc.)"
   - "Do you have editorial content like guides, lookbooks, or tutorials?"

4. **Multi-Market Commerce**
   - "Do you sell in multiple markets or regions with different product assortments?"
   - "Do different markets have different pricing, availability, or content needs?"

5. **Scale & Growth**
   - "How many products/categories do you expect to have?"
   - "Any planned expansion to new categories or markets?"

After gathering answers to at least questions 1-3, propose an initial folder structure. It's easier for users to react to a concrete proposal than to answer more abstract questions. Present the tree, explain the reasoning, and iterate from there.

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

This skill focuses on hierarchical organization. For topics and taxonomic classification, see the **content-model** skill which covers topic maps, filtering taxonomies, and cross-cutting tags.

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

**What are shortcuts?** In Crystallize, a **shortcut** is a reference (like a symbolic link) to an item that lives elsewhere in the tree. The item exists in one canonical location (e.g., `/products/clothing/jacket`) but can appear in other folders via shortcuts. Shortcuts share the same underlying product data — edits to the original propagate everywhere. This avoids duplicating products across folders while letting them appear in multiple navigation paths.

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

Different folders serve different purposes and benefit from different shapes. Use the **content-model** skill to create these shapes once you've finalized your hierarchy.

| Folder Type | Typical Shape Identifier | Shape Features                                  |
| ----------- | ------------------------ | ----------------------------------------------- |
| Category    | `category`               | Hero image, description, featured products grid |
| Brand       | `brand-page`             | Logo, story, brand values, all products         |
| Collection  | `collection`             | Theme, curated products, limited time           |
| Landing     | `landing-page`           | Flexible content blocks, CTAs                   |

After designing the folder hierarchy, hand off to the **content-model** skill to define the actual shape components for each folder type.

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

| Field             | Description                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `name`            | Display name of the folder                                                                                      |
| `shapeIdentifier` | Which folder shape to use (must match an existing shape)                                                        |
| `parentPath`      | Path to parent folder                                                                                           |
| `position`        | Optional: order within parent                                                                                   |
| `intent`          | `folder/create` (fails if exists) or `folder/upsert` (creates or updates — preferred for idempotent operations) |

Use `folder/upsert` by default so the operation can be safely re-run without errors if the folder already exists. Use `folder/create` only when you specifically want to fail if the folder is already there.

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

## Reorganizing an Existing Structure

When a user already has a folder structure and wants to improve it:

1. **Audit the current tree** — Ask the user to describe (or export) their current folder hierarchy. Identify pain points: too deep, inconsistent naming, duplicated products, orphaned folders.
2. **Identify what's working** — Don't propose a full rewrite if only part of the tree is problematic. Preserve paths that are already indexed by search engines or bookmarked by customers.
3. **Propose incremental changes** — Restructuring everything at once is risky. Suggest changes in phases: rename and flatten first, then reorganize, then clean up.
4. **Consider URL redirects** — Changing folder paths changes URLs. Remind the user to set up redirects from old paths to new ones in their frontend to avoid broken links and SEO penalties.
5. **Use `folder/upsert`** — When generating operations for a restructure, `upsert` is safer because it won't fail on folders that already exist in the target structure.

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
