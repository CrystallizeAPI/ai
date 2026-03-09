# Design Patterns for Content Modelling

Crystallize provides five data modelling design patterns for structuring relationships and polymorphism in your content model. Each pattern solves a specific class of problem. The key is recognizing **which problem you're facing** — then the pattern choice follows naturally.

## Pattern Overview

| Pattern                               | One-line summary                                          | Core mechanism                            |
| ------------------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| **Semantic Classification Bridge**    | Shared, enrichable attributes as separate documents       | Item Relation → Document                  |
| **Quantised Classification Bridge**   | Relationships with measurable quantities                  | Chunk (Relation + Numeric + Unit)         |
| **Conditional Classification Bridge** | Relationships with rules and dependencies                 | Chunk (Relation + Rule selection)         |
| **Composite Classification Bridge**   | Relationships that describe what the relationship means   | Chunk (Relation + Role/meaning selection) |
| **Polymorphic Choice**                | A single concept with mutually exclusive structural forms | Choice component                          |

## Decision Tree: Which Pattern Do I Need?

```
START: You have a relationship between items.

Q1: Is the relationship just "this item has this attribute"?
    (e.g., product has allergen, product has brand, product has material)
  → Yes → Is the attribute a simple label or does it need its own content?
           → Simple label → Use Topic Map or Selection component (no pattern needed)
           → Needs content (description, image, translations) → SEMANTIC BRIDGE

Q2: Does the relationship carry a quantity?
    (e.g., recipe has 200g of flour, kit contains 4x screws)
  → Yes → QUANTISED BRIDGE

Q3: Does the relationship carry rules or logic?
    (e.g., topping A requires topping B, part X excludes part Y)
  → Yes → CONDITIONAL BRIDGE

Q4: Does the relationship need to describe its own meaning?
    (e.g., person is the "author" of this book, material is applied to the "lining")
  → Yes → COMPOSITE BRIDGE

Q5: No relationship — but a concept can take different structural forms?
    (e.g., hero section is image-hero OR video-hero, product is guitar OR amplifier)
  → Yes → POLYMORPHIC CHOICE
```

---

## 1. Semantic Classification Bridge

### The problem it solves

You have product attributes that are shared across many products, and those attributes need to be **more than just a label**. They need descriptions, images, translations, or other rich content. And you need to update the attribute once and have the change reflected everywhere.

### Recognizing when you need it

- Multiple products share the same attribute values (e.g., 50 products are all "Organic certified")
- The attribute value needs its own story (a brand has a logo and description, a material has care instructions)
- You need to filter/search products by these attributes
- You want to localize attribute values independently

### How it works

1. Create a **Document shape** for the classification (e.g., "Allergen", "Brand", "Material")
2. Create documents for each value (e.g., "Peanuts", "Gluten", "Dairy")
3. Add an **Item Relation** component to the product shape
4. Configure the Item Relation component:
   - **Accepted shapes**: restrict to only the classification document shape (e.g., only "Allergen" documents)
   - **Min relations**: enforce minimum links (e.g., at least 1 brand required)
   - **Max relations**: limit how many (e.g., max 3 materials, or unlimited for allergens)
5. Products link to the relevant classification documents

These configuration options act like foreign key constraints in a relational database, enforcing data integrity and guiding editors.

```
Product ──(Item Relation)──→ Classification Document
                              ├── name
                              ├── description (Rich Text)
                              ├── image (Images)
                              └── metadata
```

### Example: Product with Brand and Allergen classification

**Step 1: Create classification document shapes**

```json
{
  "identifier": "brand",
  "name": "Brand",
  "type": "document",
  "components": [
    { "id": "logo", "name": "Logo", "type": "images" },
    { "id": "description", "name": "Description", "type": "richText" },
    { "id": "website", "name": "Website", "type": "singleLine" }
  ]
}
```

```json
{
  "identifier": "allergen",
  "name": "Allergen",
  "type": "document",
  "components": [
    { "id": "icon", "name": "Icon", "type": "images" },
    { "id": "severity", "name": "Severity", "type": "singleLine" }
  ]
}
```

**Step 2: Add Item Relation components to Product shape with `acceptedShapeIdentifiers`**

```json
{
  "identifier": "product",
  "name": "Product",
  "type": "product",
  "components": [
    {
      "id": "brand",
      "name": "Brand",
      "type": "itemRelations",
      "config": {
        "acceptedShapeIdentifiers": ["brand"],
        "minItems": 1,
        "maxItems": 1
      }
    },
    {
      "id": "allergens",
      "name": "Allergens",
      "type": "itemRelations",
      "config": {
        "acceptedShapeIdentifiers": ["allergen"],
        "minItems": 0,
        "maxItems": 999
      }
    }
  ]
}
```

**Key configuration properties:**

- `acceptedShapeIdentifiers` — array of shape identifiers that can be linked. Enforces type safety.
- `minItems` — minimum required links (0 = optional, 1+ = required)
- `maxItems` — maximum allowed links (use high number like 999 for "unlimited")

Without `acceptedShapeIdentifiers`, editors could accidentally link any shape type, breaking the semantic meaning of the relationship.

### Real-world examples

| Domain      | Classification | Document shape fields                                |
| ----------- | -------------- | ---------------------------------------------------- |
| Food        | Allergen       | name, icon, severity level, regulatory info          |
| Fashion     | Material       | name, image, care instructions, sustainability score |
| Electronics | Brand          | name, logo, description, website, country of origin  |
| Beauty      | Ingredient     | name, INCI name, description, benefits, warnings     |
| B2B         | Certification  | name, logo, issuing body, validity period, PDF       |

### When NOT to use it

- The classification is just a simple label with no content needs → use **Selection** or **Topic Map**
- The classification needs a quantity (200g of flour) → use **Quantised Bridge** instead
- The classification needs rules (A requires B) → use **Conditional Bridge** instead

---

## 2. Quantised Classification Bridge

### The problem it solves

You need to express that one item **contains a measurable amount** of another item. Not just "this recipe uses flour" but "this recipe uses 200g of flour". Not just "this kit includes screws" but "this kit includes 4 screws".

### Recognizing when you need it

- Items are compositions of other items with quantities
- You need to calculate totals (nutrition sums, material costs, weight totals)
- You want to show ingredient/component breakdowns on product pages
- A product is a kit, bundle, recipe, assembly, or bill of materials

### How it works

Add a **repeating Chunk** to the parent item's shape. Each chunk entry contains:

- **Numeric** — the quantity (200)
- **Selection** or **Single Line** — the unit (g, pcs, m, L)
- **Item Relation** — link to the ingredient/component product
  - Configure **accepted shapes**: restrict to only the component shape (e.g., only "Ingredient" products)
  - Configure **min/max relations**: typically min=1, max=1 per chunk entry (each entry links to exactly one item)

```
Parent Product
  └── ingredients (Chunk[], repeating)
        ├── quantity (Numeric)
        ├── unit (Selection: g, kg, ml, L, pcs, m)
        └── ingredient (Item Relation → Ingredient product)
              ↳ Accepted shapes: ["ingredient"]
              ↳ Min: 1, Max: 1
```

### Example: Recipe with Ingredients

**Step 1: Create Ingredient product shape**

```json
{
  "identifier": "ingredient",
  "name": "Ingredient",
  "type": "product",
  "components": [
    {
      "id": "nutritionInfo",
      "name": "Nutrition Info",
      "type": "propertiesTable"
    },
    {
      "id": "allergens",
      "name": "Allergens",
      "type": "itemRelations",
      "config": { "acceptedShapeIdentifiers": ["allergen"] }
    }
  ]
}
```

**Step 2: Add repeating Chunk to Recipe product shape**

```json
{
  "identifier": "recipe",
  "name": "Recipe",
  "type": "product",
  "components": [
    {
      "id": "ingredients",
      "name": "Ingredients",
      "type": "contentChunk",
      "config": {
        "contentChunk": {
          "repeatable": true,
          "components": [
            {
              "id": "quantity",
              "name": "Quantity",
              "type": "numeric"
            },
            {
              "id": "unit",
              "name": "Unit",
              "type": "selection",
              "config": {
                "selection": {
                  "options": [
                    { "key": "g", "value": "grams" },
                    { "key": "ml", "value": "milliliters" },
                    { "key": "pcs", "value": "pieces" }
                  ]
                }
              }
            },
            {
              "id": "ingredient",
              "name": "Ingredient",
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
  ]
}
```

**Critical**: The `acceptedShapeIdentifiers: ["ingredient"]` ensures editors can only select Ingredient products, not recipes or other shapes. This prevents data integrity issues.

### Real-world examples

| Domain         | Parent item   | Linked item | Quantity meaning                |
| -------------- | ------------- | ----------- | ------------------------------- |
| Food/Recipes   | Recipe        | Ingredient  | 200g of flour, 2 eggs           |
| Manufacturing  | Assembly      | Part        | 4x M6 bolts, 1x motor           |
| Furniture kits | Furniture kit | Component   | 4x legs, 1x tabletop, 8x screws |
| Nutrition      | Meal          | Ingredient  | Enables calorie/macro rollups   |
| Construction   | Material list | Material    | 50m² of tiles, 25kg of adhesive |

### When NOT to use it

- The relationship doesn't need a quantity → use **Semantic Bridge** (just a link)
- The relationship carries rules, not quantities → use **Conditional Bridge**
- The relationship needs a role description → use **Composite Bridge**

---

## 3. Conditional Classification Bridge

### The problem it solves

Relationships between items have **rules**: selecting option A **requires** option B, or selecting option A **excludes** option B. This is essential for product configurators, builders, and compatibility systems.

### Recognizing when you need it

- Products can be configured with interdependent options
- Some combinations are invalid and should be prevented
- You're building a product configurator, builder, or wizard
- Parts/accessories have compatibility requirements

### How it works

Add a **repeating Chunk** where each entry stores the relation AND the rule:

```
Configurable Product
  └── options (Chunk[], repeating)
        ├── part (Item Relation → Component product)
        │     ↳ Accepted shapes: ["Component Part"]
        │     ↳ Min: 1, Max: 1
        ├── rule (Selection: requires | excludes | optional)
        └── depends-on (Item Relation → another Component product, optional)
              ↳ Accepted shapes: ["Component Part"]
              ↳ Min: 0, Max: 1
```

Common rule types:

- **Requires**: selecting A demands that B is also selected
- **Excludes**: selecting A prevents selecting B
- **Optional**: no constraint, purely informational

### Real-world examples

| Domain        | Scenario                                | Rule                               |
| ------------- | --------------------------------------- | ---------------------------------- |
| Pizza builder | Chili topping requires Cheese           | Chili → requires → Cheese          |
| Pizza builder | Vegan Cheese excludes Meat toppings     | Vegan Cheese → excludes → Meat     |
| PC builder    | RTX 4090 requires 850W PSU              | GPU → requires → PSU with min spec |
| Furniture     | Wooden legs require matching screw set  | Legs → requires → Screw Set        |
| Cameras       | EF-S lens excludes full-frame body      | Lens → excludes → Body type        |
| Car config    | Sport package requires sport suspension | Package → requires → Suspension    |

### Frontend implications

The conditional bridge produces structured data that your frontend can interpret to:

- Grey out incompatible options
- Auto-add required dependencies
- Show validation messages ("Chili requires Cheese")
- Build progressive configuration wizards

### When NOT to use it

- The relationship has no rules or dependencies → use **Semantic** or **Quantised Bridge**
- The relationship needs to describe its role/meaning → use **Composite Bridge**
- You just need one-of-many selection → use **Polymorphic Choice**

---

## 4. Composite Classification Bridge

### The problem it solves

You need to link items together **and describe what the relationship means**. Not just "this book links to this person" but "this person is the illustrator of this book". Not just "this jacket uses wool" but "wool is used in the lining".

### Recognizing when you need it

- The same type of relationship can mean different things (person can be author, editor, or illustrator)
- You need to display the relationship role in the UI ("Illustrated by", "Written by")
- The meaning of the relationship matters for filtering, display, or integrations
- You want structured, predictable data about why two items are connected

### How it works

Add a **repeating Chunk** where each entry stores the relation AND a classification of what it means:

```
Book Product
  └── contributors (Chunk[], repeating)
        ├── person (Item Relation → Author document)
        │     ↳ Accepted shapes: ["Author", "Person"]
        │     ↳ Min: 1, Max: 1
        └── role (Selection: Writer | Illustrator | Editor | Translator)
```

The classification (role/meaning) can be a **Selection** (simple label) or an **Item Relation** to a classification document (if the role itself needs enrichment).

### Real-world examples

| Domain       | Parent item | Related item | Relationship meaning            |
| ------------ | ----------- | ------------ | ------------------------------- |
| Publishing   | Book        | Person       | Writer, Illustrator, Editor     |
| Fashion      | Jacket      | Material     | Lining, Sleeve, Collar, Body    |
| Music        | Album       | Person       | Producer, Vocalist, Guitarist   |
| Construction | Building    | Company      | Architect, Contractor, Supplier |
| Modular sofa | Sofa        | Component    | Legs, Cushion, Frame, Fabric    |

### Example: Book with Contributors

**Step 1: Create Author/Person document shape**

```json
{
  "identifier": "author",
  "name": "Author",
  "type": "document",
  "components": [
    { "id": "bio", "name": "Biography", "type": "richText" },
    { "id": "photo", "name": "Photo", "type": "images" },
    { "id": "website", "name": "Website", "type": "singleLine" }
  ]
}
```

**Step 2: Add Contributors chunk to Book product shape**

```json
{
  "identifier": "book",
  "name": "Book",
  "type": "product",
  "components": [
    { "id": "description", "name": "Description", "type": "richText" },
    {
      "id": "contributors",
      "name": "Contributors",
      "type": "contentChunk",
      "config": {
        "contentChunk": {
          "repeatable": true,
          "components": [
            {
              "id": "person",
              "name": "Person",
              "type": "itemRelations",
              "config": {
                "itemRelations": {
                  "acceptedShapeIdentifiers": ["author"],
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            },
            {
              "id": "role",
              "name": "Role",
              "type": "selection",
              "config": {
                "selection": {
                  "options": [
                    { "key": "writer", "value": "Writer" },
                    { "key": "illustrator", "value": "Illustrator" },
                    { "key": "editor", "value": "Editor" },
                    { "key": "translator", "value": "Translator" }
                  ]
                }
              }
            }
          ]
        }
      }
    }
  ]
}
```

**Key insight**: Each contributor entry links a person AND describes their role, enabling displays like "Written by Jane Doe" and "Illustrated by John Smith".

### When NOT to use it

- All relationships have the same meaning → use **Semantic Bridge** (no role needed)
- The relationship needs a quantity → use **Quantised Bridge** (or combine both)
- The relationship carries rules → use **Conditional Bridge**

---

## 5. Polymorphic Choice

### The problem it solves

A single semantic concept can take **one of several mutually exclusive structural forms** — *poly-* (many) + *morph* (form). The meaning stays the same, but the internal fields change based on a deliberate selection. You want to handle this variation within a single shape rather than creating separate shapes. Crystallize implements this via the **Choice** (`componentChoice`) and **Multiple Choice** (`componentMultipleChoice`) component types.

### Recognizing when you need it

- A concept has multiple valid representations, but only one applies at a time
- You want one shape for products that have different field sets (guitar vs amplifier vs pedal)
- Page sections can be different layouts (image hero vs video hero vs text hero)
- Product data follows a standard where each class has its own property set (ETIM, UNSPSC)

### How it works

Add a **Choice** component to the shape. Define multiple named structures within the Choice, each with its own set of components. The editor selects exactly one.

```
Product Shape
  └── product-type (Choice)
        ├── Guitar
        │     ├── body-type (Selection: Solid, Semi-hollow, Hollow)
        │     ├── strings (Numeric)
        │     ├── scale-length (Numeric, cm)
        │     └── pickup-config (Selection: SSS, HSS, HH)
        ├── Amplifier
        │     ├── wattage (Numeric, W)
        │     ├── channels (Numeric)
        │     └── speaker-size (Numeric, inches)
        └── Pedal
              ├── effect-type (Selection: Overdrive, Delay, Reverb, ...)
              ├── power-draw (Numeric, mA)
              └── true-bypass (Switch)
```

### Real-world examples

| Domain         | Choice concept   | Variants                                         |
| -------------- | ---------------- | ------------------------------------------------ |
| Music gear     | Product type     | Guitar, Amplifier, Pedal, Accessory              |
| Landing pages  | Hero section     | Image hero, Video hero, Text hero, Product hero  |
| B2B industrial | Product class    | ETIM class A, ETIM class B (each with own specs) |
| Real estate    | Property type    | Apartment, House, Commercial, Land               |
| Food           | Preparation type | Ready-to-eat, Cook-at-home, Raw ingredient       |

### When to use Choice vs Multiple Choice

- **Choice** → exactly one form, mutually exclusive. "This product IS a guitar."
- **Multiple Choice** → one or more forms can coexist. "This product has physical attributes AND a digital license."

### When NOT to use it

- Products differ so fundamentally that they share almost no fields → use separate shapes
- You just need a dropdown value, not different field sets → use **Selection**
- The variation is about relationships, not field structure → use a bridge pattern

### Advanced: Polymorphic Choice with Pieces

For large or reusable field sets, reference **Pieces** inside choice options instead of defining components inline. This makes variants more maintainable and reusable across shapes.

**When to use this variant:**
- Choice variants have many components (10+ fields each)
- The same variant appears in multiple choice components or shapes
- You want to update variant fields in one place
- You're building reusable patterns across your model

**Structure:**

```json
{
  "id": "flower-type",
  "name": "Flower Type",
  "type": "choice",
  "config": {
    "choice": {
      "choices": [
        {
          "id": "rose",
          "name": "Rose",
          "type": "piece",
          "config": {
            "piece": {
              "identifier": "rose-attributes"
            }
          }
        },
        {
          "id": "orchid",
          "name": "Orchid",
          "type": "piece",
          "config": {
            "piece": {
              "identifier": "orchid-attributes"
            }
          }
        }
      ]
    }
  }
}
```

**Pieces (referenced above):**

```json
{
  "identifier": "rose-attributes",
  "name": "Rose Attributes",
  "components": [
    { "id": "thorns", "name": "Has Thorns", "type": "boolean" },
    { "id": "petal-count", "name": "Petal Count", "type": "numeric" },
    { "id": "rose-type", "name": "Rose Type", "type": "selection", "config": {...} }
  ]
}
```

**Benefits:**
- Cleaner JSON structure — choice definitions stay focused on selection
- Pieces are reusable across multiple shapes and choices
- Easier to maintain — update piece definition once, affects all uses
- Better for model visualization tools (pieces show as distinct nodes)

---

## Combining Patterns

Patterns can be combined on the same shape. A single product shape might use:

- **Semantic Bridge** for brand and material classification
- **Quantised Bridge** for ingredient composition
- **Polymorphic Choice** for product-type-specific fields
- **Topic Maps** for navigation categories

The patterns are not mutually exclusive — they solve different axes of the same content model.

## Pattern Selection Summary

| Your data looks like...                                 | Pattern                              |
| ------------------------------------------------------- | ------------------------------------ |
| Products share enrichable attributes                    | Semantic Classification Bridge       |
| Items contain measured amounts of other items           | Quantised Classification Bridge      |
| Options have compatibility rules and dependencies       | Conditional Classification Bridge    |
| Relationships need to describe their meaning/role       | Composite Classification Bridge      |
| A concept takes one of several mutually exclusive forms | Polymorphic Choice                   |
| Simple labels for filtering (no enrichment needed)      | Topic Maps or Selection (no pattern) |
