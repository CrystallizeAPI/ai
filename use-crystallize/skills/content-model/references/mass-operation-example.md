# Mass Operation Example

A complete operations file following the 4-phase ordering described in [SKILL.md](../SKILL.md#mass-operations--4-phase-ordering).

**Run this as it stands only on a tenant that has none of these shapes and pieces.** Phases 1 and 2 send no `components`, and an upsert replaces the whole definition, so on anything that already exists they empty it, and a run that stops before phases 3 and 4 leaves it empty. Skip phases 1 and 2 for anything that exists. [[mass-operations]] has the form for definitions that reference each other.

```json
{
    "version": "1.0.0",
    "operations": [
        // Phase 1: Create piece containers (no components)
        {
            "intent": "piece/upsert",
            "identifier": "seo",
            "name": "SEO"
        },
        {
            "intent": "piece/upsert",
            "identifier": "hero",
            "name": "Hero Section"
        },
        // Phase 2: Create shape containers (no components)
        {
            "intent": "shape/upsert",
            "identifier": "product",
            "name": "Product",
            "type": "product"
        },
        {
            "intent": "shape/upsert",
            "identifier": "brand",
            "name": "Brand",
            "type": "document"
        },
        // Phase 3: Update pieces with components (same identifier - upsert updates existing)
        {
            "intent": "piece/upsert",
            "identifier": "seo",
            "name": "SEO",
            "components": [
                { "id": "title", "name": "SEO Title", "type": "singleLine" },
                { "id": "description", "name": "SEO Description", "type": "singleLine" }
            ]
        },
        {
            "intent": "piece/upsert",
            "identifier": "hero",
            "name": "Hero Section",
            "components": [
                { "id": "headline", "name": "Headline", "type": "singleLine" },
                { "id": "image", "name": "Hero Image", "type": "images" }
            ]
        },
        // Phase 4: Update shapes with components (can now safely reference pieces)
        {
            "intent": "shape/upsert",
            "identifier": "product",
            "name": "Product",
            "type": "product",
            "components": [
                { "id": "description", "name": "Description", "type": "richText" },
                {
                    "id": "seo",
                    "name": "SEO",
                    "type": "piece",
                    "config": { "piece": { "identifier": "seo" } }
                },
                {
                    "id": "brand",
                    "name": "Brand",
                    "type": "itemRelations",
                    "config": {
                        "itemRelations": {
                            "maxItems": 1,
                            "acceptedShapeIdentifiers": ["brand"]
                        }
                    }
                }
            ],
            "variantComponents": [
                {
                    "id": "weight",
                    "name": "Weight",
                    "type": "numeric",
                    "config": { "numeric": { "units": ["g", "kg"], "discoverable": true } }
                },
                {
                    "id": "color",
                    "name": "Color",
                    "type": "selection",
                    "config": {
                        "selection": {
                            "options": [
                                { "key": "black", "value": "Black", "label": "Black" },
                                { "key": "white", "value": "White", "label": "White" }
                            ]
                        }
                    }
                }
            ]
        },
        {
            "intent": "shape/upsert",
            "identifier": "brand",
            "name": "Brand",
            "type": "document",
            "components": [
                { "id": "description", "name": "Description", "type": "richText" },
                { "id": "logo", "name": "Logo", "type": "images" }
            ]
        }
    ]
}
```
