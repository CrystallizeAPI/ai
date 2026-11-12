# Showcases (hotspots)

A showcase links a point on an image to products, SKUs or documents: the "shop the look" feature. (Armaturjonsson,
Fashion Universe, WoolLand, Wee and YIT, September to November 2026.)

## Writing them (Core)

`ImageShowcaseInput` (introspected 2026-11-12):

```graphql
input ImageShowcaseInput {
    hotspot: FocalPointInput # { x: Float!, y: Float! }
    itemIds: [ID!]
    skus: [String!]! # required: send [] for a showcase of items only
    meta: [KeyValuePairInput!]
}
```

It is accepted as `showcase` (singular, a list) in two places:

- `updateImage(key:, language:, input: { showcase })`, on the **library asset**, per language;
- every `ImageInput`: `images` components, paragraph images, and variant images through
  `updateProductVariant(sku:, input: { images })`.

```json
{
    "images": [
        {
            "key": "<image key>",
            "showcase": [
                {
                    "hotspot": { "x": 0.42, "y": 0.63 },
                    "skus": ["SKU-1"],
                    "itemIds": ["<product item id>"],
                    "meta": [{ "key": "label_en", "value": "Basin mixer" }]
                }
            ]
        }
    ]
}
```

- **Coordinates are fractions of the image, 0-1**: not percent, not pixels. Keep percent in your source data for
  review if you like, and divide by 100 when writing.
- **Labels are not part of a showcase**: put them in `meta`. On an `images` component that isn't multilingual, the
  showcase list is stored once for all languages and keeps the meta of the **last** language written, so write
  `label_<lang>` keys and read `meta(key: "label_<lang>")`. On library images (`updateImage` per language), a plain
  `label` is per language.
- **A product's images are variant images**, so a showcase on a product image is written onto every variant that
  carries that key, with the full `images` list (it replaces the list).
- Errors: `ImageShowcaseInvalidSkuError` (a SKU that doesn't exist yet: create the products first, or retry without
  SKUs) and `ImageShowcaseInvalidIdError`. A just-registered key can answer `ImageNotFoundError` for a while.
- **The mass-operation schema spells the hotspot `hotpost`** (`@crystallize/schema` 6.17, image content →
  `showcase[].hotpost { x, y }`). Write showcases with Core `updateImage` or component content instead.

Core reads them back as `Image.showcase` (`{ hotspot itemIds skus meta }`).

## Reading them (Discovery)

Discovery serves **`showcases`** (plural):

```graphql
{
    search(language: en, filters: { path: { equals: "/inspiration/bathroom" } }) {
        hits {
            ... on document {
                hero {
                    url
                    showcases {
                        hotspot
                        meta
                        items {
                            name
                            path
                        }
                        variants {
                            sku
                            name
                            defaultPrice
                        }
                    }
                }
            }
        }
    }
}
```

`hotspot(key:)` and `meta(key:)` are `Hash` fields (`{ x, y }`). `items` resolves to full documents and products, and
`variants` to full variants, so one hotspot can carry a product (for the path) and a SKU (for the price) at once.

New page-builder pieces that render showcases can need two ignites before Discovery serves them
([Discovery Indexing](../../query/references/discovery-indexing.md)).
