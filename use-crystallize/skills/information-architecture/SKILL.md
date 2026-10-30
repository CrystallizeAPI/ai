---
name: information-architecture
description: Design folder hierarchies and navigation structures in Crystallize. Create category trees, organize products and content, plan URL structures, and build scalable information architectures. Use when designing storefront navigation, category pages, collection structures, content organization, mega menus, breadcrumbs, or site maps. Also use when the user mentions organizing their catalog, planning their store structure, restructuring navigation, placing an item in several folders with shortcuts, moving or renaming folders without breaking URLs, or asks how to organize products or content in Crystallize — even if they don't explicitly say "information architecture."
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

This skill focuses on hierarchical organization. For topic maps and taxonomic classification (cross-cutting tags, filtering facets), see the **[[taxonomy]]** skill. For the shapes that consume those topics, see the **[[content-model]]** skill.

### How Paths Behave

Crystallize generates every canonical path. No folder input takes a path or a slug, so these rules decide the URLs you get:

- **A path is the parent's path plus the slugified `name`.** `Men's Shoes` under `/shop` becomes `/shop/mens-shoes`: lower case, hyphens for spaces, and whatever cannot be reduced to ASCII letters, digits or hyphens is dropped.
- **Paths are per language.** Each language builds its own path from its own name and the parent's path in that language, so `/shop/men` can be `/boutique/hommes` in French. Create and translate parents first: a child whose parent has no path in that language gets a placeholder path (`/placeholder/missing-parent-translation/...`). `paths { hreflangs { language path } }` on the Catalogue API lists the published path of each language.
- **A collision never fails.** If another item already uses the path as a canonical path, alias or shortcut in that language, the new item silently gets a random suffix (`/shop/men-x7k2q`), so two same-named siblings both succeed. A path in another item's `history` counts as free, and publishing it removes it from that history.
- **Renaming or moving changes the path of the whole subtree.** A new `name` regenerates the path in that language. A new parent regenerates it in every language.
- **Moves, renames and reorders are drafts until the item is published.** The published item keeps its old path and position until then. Publishing a moved or renamed folder is enough for what is under it: its published descendants follow in that language without being republished.
- **Old paths are kept.** Publishing a changed path adds the previous one to `paths.history`, on the item and on each published descendant, up to the last 100 per language.
- **An alias is the way to choose a path.** `item/paths/addAliases`, or `addItemTreeNodeAliases(input: { itemId, language, paths })` on the Core API, adds an extra path for one language. Unlike a generated path, a taken alias fails. It needs a publish too.

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

An item has exactly one canonical parent, so only one of `by-category` and `by-brand` can hold the real product. The other holds shortcuts (see below) or a page driven by a topic.

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
- Pricing and availability stay outside the tree: a shortcut carries no data, so set them per market with price variants, price lists and stock locations (see the **pricing** skill)

**How shortcuts behave:**

- **A shortcut adds a location, nothing else.** It stores a parent folder, a position and a generated path (`/markets/europe/germany/products/jacket`, the folder's path plus the slugified name), in every language at once. The item keeps its one canonical parent.
- **It is not live until the item is published.** Adding, repositioning or removing a shortcut creates a new draft of the item, so publish it again in each language.
- **A shortcut path has to be asked for.** `catalogue(path:)` resolves canonical paths only, so a shortcut path answers `null` without `pathResolutionMethods: [canonical, shortcut]` (or `[any]`). Discovery `path` matches all four methods by default, `history` included: `path: "/markets/europe/germany/*"` also returns items whose shortcut was removed from that folder, so pass `pathResolutionMethod: [canonical, shortcut]` for a market listing.
- **A folder listing gives the canonical path.** Catalogue `subtree` lists shortcuts with the real children, at the shortcut's own position, but each node's `path` is its canonical path and its `pathResolutionMethod` is `shortcut`. To keep the shopper inside the market, link to the matching entry of `paths { shortcuts { path folder { id } } }`. Discovery `Folder.children` lists them too, but sorts on the canonical `position`, so the shortcut's own position does not apply there.
- **`parent` stays canonical.** It returns the canonical folder even for an item reached through a shortcut. Use Discovery `breadcrumbs` for the market trail.
- **A shortcut to a folder does not bring its children.** The folder gains one extra path and its children gain none, so `<shortcut path>/<child>` does not resolve. Shortcut each product into the market folder.
- **Some requests do nothing, silently.** A shortcut to the item's canonical parent, to itself, or to a folder that already has it is dropped with no error.
- **Deleting a folder spares what is only shortcut into it.** Those items stay, and the shortcut path moves to their `history`. Deleting the canonical item removes it from every market.

Create them with `item/paths/addShortcuts` in a mass operation, where `position` defaults to 1 so set it, or with `addItemTreeNodeShortcuts(input: { itemId, shortcuts: [{ parentId, position }] })` on the Core API, where `position` is required. `updateItemTreeNodeShortcuts` takes the same input and changes positions, and `removeItemTreeNodeShortcuts(input: { itemId, parentIds })` removes them. Point `parentId` at a folder: the app offers nothing else.

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

Folder operations use the mass-operations format (see the **mass-operations** skill for validating and running a file):

```json
{
    "version": "1.0.0",
    "operations": [
        {
            "_ref": "shop",
            "intent": "folder/upsert",
            "resourceIdentifier": "folder-shop",
            "language": "en",
            "name": "Shop",
            "shapeIdentifier": "category",
            "tree": { "parentId": "{{ defaults.rootItemId }}", "position": 1 }
        },
        {
            "_ref": "men",
            "intent": "folder/upsert",
            "resourceIdentifier": "folder-shop-men",
            "language": "en",
            "name": "Men",
            "shapeIdentifier": "category",
            "tree": { "parentId": "{{ shop.id }}", "position": 1 }
        },
        { "intent": "item/publish", "itemId": "{{ shop.id }}", "language": "en" },
        { "intent": "item/publish", "itemId": "{{ men.id }}", "language": "en" }
    ]
}
```

### Operation Fields

| Field                | Description                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `name`               | Display name of the folder, and the source of its path                                                                             |
| `shapeIdentifier`    | Which folder shape to use (must match an existing shape of type `folder`)                                                          |
| `language`           | Required: the language of `name` and of the generated path                                                                         |
| `tree.parentId`      | Required: the parent's id, never its path. `{{ defaults.rootItemId }}` at the top level, `{{ <_ref>.id }}` for a folder made above |
| `tree.position`      | Optional: order within parent                                                                                                      |
| `resourceIdentifier` | Your stable key for the folder: what lets `folder/upsert` find it again                                                            |
| `intent`             | `folder/upsert` (creates or updates — preferred for idempotent operations), `folder/create` or `folder/update`                     |

Use `folder/upsert` with a `resourceIdentifier` by default so the operation can be safely re-run. An upsert finds a folder through `resourceIdentifier` or `itemId` only: with neither, it creates a second folder on every run, under a suffixed path. `folder/create` does not check for an existing folder either: the same `name` under the same parent succeeds with a suffixed path, and only a `resourceIdentifier` already in use fails. A re-run applies `name` and `tree` again, so it renames or moves a folder that changed since.

**Publish the folders too.** These operations write drafts. A folder with no published version is missing from `subtree` and `Folder.children`, and takes everything under it out of the navigation with it, although a published child still answers on its own path. `item/publish` takes one `itemId` and one `language`, so add one per folder and per language. To publish a whole subtree, use `publishItem(id, language, includeDescendants: true)` on the Core API: the mass operation ignores that flag.

### Ordering

Catalogue `subtree` and Discovery `Folder.children` sort ascending on `position` unless told otherwise. Set it deliberately:

- Positions run from 1 to 100000. `position: 0` passes mass-operation validation and is ignored.
- Without a position, a new item goes last (the highest sibling plus 1), and a moved item keeps its old number in the new folder.
- Nothing renumbers. Setting `position: 1` leaves the siblings where they are, so two items can share a number, and a tie has no meaningful order. To reorder a folder, set a position on every sibling.
- A new position reaches the storefront when the item is published.

## Integration with Other Systems

### Navigation Menus

Top-level folders typically become main navigation:

```
Root folders → Main nav items
Second-level → Dropdown/mega menu
Third-level → Sub-navigation or sidebar
```

Top-level folders are the children of the root item, so read the menu from `catalogue(path: "/")` with `subtree(type: folder)`, which keeps products and documents out. `createNavigationFetcher(client).byFolders('/', 'en', 3)` builds the nested query for you, but it reads every published child at each level: add `type` through its `perLevel` argument and filter out what is not a folder.

### Breadcrumbs

The folder path gives the shape of the trail, but it holds slugs, not display names:

```
/shop/men/shoes → Home > Shop > Men > Shoes
```

Take the labels from the API. Discovery `breadcrumbs` answers one trail per location of the item, from the top-level folder down to the item, and each crumb carries `id`, `name`, `path`, `shape` and `isShortcut`. `breadcrumbs(withShortcuts: false)` keeps the canonical trail only. On the Catalogue API, walk `parent`.

### URL Routing

Folder paths map to frontend routes:

```
Crystallize path: /shop/men/shoes
Frontend URL: https://store.com/shop/men/shoes
```

`catalogue(path:)` resolves canonical paths only by default, so a storefront that also serves shortcut, alias or old URLs passes `pathResolutionMethods` (`canonical`, `shortcut`, `alias`, `history` or `any`). The answer's `path` echoes the path you asked for, `pathResolutionMethod` says how it matched, and `paths { canonical }` is the real location.

### Topics (Cross-cutting)

While folders handle main navigation, topics handle:

- Filters (color, size, material)
- Tags (sale, new, featured)
- Cross-category discovery

For designing topic maps, see [[taxonomy]].

## Reorganizing an Existing Structure

When a user already has a folder structure and wants to improve it:

1. **Audit the current tree** — Ask the user to describe (or export) their current folder hierarchy. Identify pain points: too deep, inconsistent naming, duplicated products, orphaned folders.
2. **Identify what's working** — Don't propose a full rewrite if only part of the tree is problematic. Preserve paths that are already indexed by search engines or bookmarked by customers.
3. **Propose incremental changes** — Restructuring everything at once is risky. Suggest changes in phases: rename and flatten first, then reorganize, then clean up.
4. **Consider URL redirects** — Changing folder paths changes URLs. Remind the user to set up redirects from old paths to new ones in their frontend to avoid broken links and SEO penalties. Crystallize keeps the old paths, so the frontend can drive this itself: when a path does not resolve, query `catalogue(language: "en", path: "/old/path", pathResolutionMethods: [history]) { paths { canonical } }` and redirect to the result. `item/paths/addHistory` seeds old paths from a previous platform, and needs a publish like any other path change.
5. **Move existing items, do not recreate them** — `folder/upsert` only reuses a folder it can find by `resourceIdentifier` or `itemId`, so for a folder made without one it creates a duplicate. Use `folder/update` (or `product/update`, `document/update`) with `itemId` and `tree: { parentId, position }`, or `moveItemTreeNode` on the Core API, then publish the moved item in each language. A folder cannot move under one of its own descendants.
6. **Do not delete or unpublish a folder to empty it** — Deleting a folder deletes everything under it, in the background and with no prompt. Unpublishing it takes everything under it offline in that language. Move what stays first.

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
