# Shape Consolidation Strategy

## Minimizing Product and Folder Shapes

**Principle:** Keep the number of product and folder shapes to a minimum by using polymorphic patterns instead of creating separate shapes for similar items.

## When to Consolidate Shapes

**Use the polymorphic product/folder pattern when:**

1. **Similarity threshold**: Two or more product/folder shapes share 50%+ of their components
    - Example: Plant and Vase both have description and SEO components

2. **Common base components**: Shapes have the same foundational components but differ in specialized attributes
    - Common: description, SEO, images, pricing
    - Differ: plant-specific fields (care-level, light-requirement) vs vase-specific fields (material, dimensions)

3. **Semantic similarity**: Items represent variations of the same concept rather than fundamentally different entities
    - Example: Guitar, Amplifier, and Pedal are all music equipment (consolidate into "Music Product")
    - Example: Plant and Vase are both home decor items (consolidate into "Home Decor Product")

## When NOT to Consolidate

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

## Consolidation Approach

**Step 1: Identify common components**

- Extract all shared components (description, SEO, images, etc.)
- These become the base components of the consolidated shape

**Step 2: Create a type selector**

- Add a selection component to distinguish between variants
- Example: `product-type` with options "plant", "vase", "bundle"

**Step 3: Extract variant-specific attributes into pieces**

- Create separate pieces for each variant's unique components
- Example: `plant-attributes` piece, `vase-attributes` piece

**Step 4: Use a `componentChoice` for polymorphic structure**

- Add a `componentChoice` with one piece per variant. The editor picks the form there and only sees its fields
- Nothing links it to the selection from step 2: a component cannot show or hide another one. Keep the selection only if you need it as a filter token

## Example: Consolidating Plant and Vase into Product

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
                        { "key": "plant", "value": "Plant", "label": "Plant" },
                        { "key": "vase", "value": "Vase", "label": "Vase" }
                    ]
                }
            }
        },
        { "id": "description", "name": "Description", "type": "richText" },
        {
            "id": "variant-attributes",
            "name": "Product Details",
            "type": "componentChoice",
            "config": {
                "componentChoice": {
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
                        { "key": "low", "value": "Low Light", "label": "Low Light" },
                        { "key": "medium", "value": "Medium Light", "label": "Medium Light" },
                        { "key": "bright", "value": "Bright Light", "label": "Bright Light" },
                        { "key": "direct", "value": "Direct Sunlight", "label": "Direct Sunlight" }
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
                        { "key": "small", "value": "Small (under 12\")", "label": "Small (under 12\")" },
                        { "key": "medium", "value": "Medium (12-24\")", "label": "Medium (12-24\")" },
                        { "key": "large", "value": "Large (24-48\")", "label": "Large (24-48\")" },
                        { "key": "xl", "value": "Extra Large (48\"+)", "label": "Extra Large (48\"+)" }
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
                    "repeatable": false,
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

- Slightly more complex for editors (`componentChoice` requires selecting variant type)
- Frontend may need to handle polymorphic structure
- Only worthwhile when shapes share significant overlap

## Mass Operations Pattern for Consolidated Shapes

When using the 4-phase ordering with consolidated shapes:

1. **Phase 1**: Create variant-specific pieces (plant-attributes, vase-attributes)
2. **Phase 2**: Create consolidated shape container
3. **Phase 3**: Add components to variant pieces
4. **Phase 4**: Add components (including the `componentChoice` with piece references) to consolidated shape

This ensures all piece references in the `componentChoice` resolve correctly.
