# createShape Mutation — Full API Reference

Use this reference to validate all required fields and config structures when calling the `createShape` mutation on the Core API.

## Endpoint

```
POST https://api.crystallize.com/@{tenantIdentifier}
```

Auth headers: `X-Crystallize-Access-Token-Id` + `X-Crystallize-Access-Token-Secret`

---

## Mutation Signature

```graphql
mutation CreateShape($input: CreateShapeInput!) {
    createShape(input: $input) {
        ... on Shape {
            identifier
            name
            type
        }
        ... on BasicError {
            errorName
            message
        }
        ... on UnauthorizedError {
            errorName
            message
        }
    }
}
```

**Result union:** `CreateShapeResult = Shape | ExperimentalFeaturesNotAvailableError | InvalidIdError | PieceIdentifierTakenError | UnauthorizedError | UnknownError`

---

## CreateShapeInput

```typescript
{
  name: String!                          // REQUIRED — display name
  type: ShapeType!                       // REQUIRED — see ShapeType enum
  identifier?: String                    // optional — auto-generated from name if omitted
  components?: ComponentDefinitionInput[]  // shape-level component definitions
  variantComponents?: ComponentDefinitionInput[]  // product-only: custom components on variants
  meta?: { key: String!, value?: String }[]  // arbitrary key-value metadata
}
```

**`ShapeType` enum:** `document` | `folder` | `product`

**`variantComponents`** is only meaningful on `type: "product"` shapes. Use it to add custom fields to product variants beyond the built-in `sku`, `images`, `videos`, `price`, `stock`, and `attributes`.

---

## ComponentDefinitionInput

Used in both `components` and `variantComponents` arrays, and recursively inside structural component configs.

```typescript
{
  name: String!          // REQUIRED — display name
  type: ComponentType!   // REQUIRED — see ComponentType enum
  id?: String            // optional — identifier used in API queries. Auto-generated from name if omitted. Prefer explicit IDs.
  description?: String   // optional — help text shown to editors
  config?: ComponentConfigInput  // optional — required for some types (see per-type rules below)
}
```

**`ComponentType` enum:** `boolean` | `componentChoice` | `componentMultipleChoice` | `contentChunk` | `datetime` | `files` | `gridRelations` | `images` | `itemRelations` | `location` | `numeric` | `paragraphCollection` | `piece` | `propertiesTable` | `richText` | `selection` | `singleLine` | `videos`

---

## ComponentConfigInput — Per-Type Required Fields

The `config` object must match the component `type`. Only set the key that corresponds to the component type.

### boolean

```typescript
config: {
  boolean: {
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
  }
}
```

No required sub-fields.

---

### singleLine

```typescript
config: {
  singleLine: {
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
    min?: Int          // min character length
    max?: Int          // max character length
    pattern?: String   // regex validation pattern
  }
}
```

No required sub-fields.

---

### richText

```typescript
config: {
  richText: {
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
    min?: Int
    max?: Int
  }
}
```

No required sub-fields.

---

### numeric

```typescript
config: {
  numeric: {
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
    decimalPlaces?: Int
    units?: String[]   // list of allowed units editors can select (e.g. ["kg", "g", "lb"])
  }
}
```

No required sub-fields.

---

### datetime

```typescript
config: {
  datetime: {
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
    format?: DateComponentFormat  // "date" | "datetime" (default: datetime)
  }
}
```

No required sub-fields.

---

### location

```typescript
config: {
  location: {
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
  }
}
```

No required sub-fields.

---

### images

```typescript
config: {
  images: {
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
    min?: Int   // min number of images
    max?: Int   // max number of images
  }
}
```

No required sub-fields.

---

### videos

```typescript
config: {
  videos: {
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
    min?: Int
    max?: Int
  }
}
```

No required sub-fields.

---

### files

```typescript
config: {
  files: {
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
    min?: Int
    max?: Int
    acceptedContentTypes?: {
      contentType: String!    // REQUIRED — MIME type e.g. "application/pdf"
      extensionLabel?: String // e.g. "PDF"
    }[]
    maxFileSize?: {
      size: Float!            // REQUIRED
      unit: FileSizeUnit!     // REQUIRED — "Bytes" | "KiB" | "MiB" | "GiB"
    }
  }
}
```

Sub-fields `contentType`, `size`, and `unit` are required when their parent objects are provided.

---

### selection

```typescript
config: {
  selection: {
    options: {            // REQUIRED — at least one option
      key: String!        // REQUIRED — API value (e.g. "red")
      value: String!      // REQUIRED — display label (e.g. "Red")
      isPreselected?: Boolean
    }[]
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
    min?: Int             // min number of selections
    max?: Int             // max number of selections
  }
}
```

**`options` is required** (non-nullable array). Each option requires `key` (the API identifier) and `value` (the display label).

---

### propertiesTable

```typescript
config: {
  propertiesTable: {
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
    sections?: {
      keys: String[]!    // REQUIRED — predefined key names for this section
      title?: String
    }[]
  }
}
```

`keys` is required when a section is provided. Omit `sections` entirely for fluid/dynamic keys (editors define keys at content time).

---

### itemRelations

```typescript
config: {
  itemRelations: {
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
    acceptedShapeIdentifiers?: String[]   // STRONGLY RECOMMENDED — restrict which shapes can be linked
    minItems?: Int
    maxItems?: Int
    minSkus?: Int    // for linking specific variant SKUs
    maxSkus?: Int
    quickSelect?: {
      folders: {
        folderId: String!   // REQUIRED
      }[]                   // REQUIRED — at least one folder
      view?: "nerdy" | "pretty"
    }
  }
}
```

**Always set `acceptedShapeIdentifiers`** — without it, editors can link any shape, breaking semantic meaning. The `min`/`max` fields (without `Items` suffix) are deprecated aliases — use `minItems`/`maxItems` instead.

---

### gridRelations

```typescript
config: {
  gridRelations: {
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
    min?: Int
    max?: Int
  }
}
```

No required sub-fields.

---

### contentChunk

```typescript
config: {
  contentChunk: {
    components: ComponentDefinitionInput[]  // REQUIRED — MUST have at least 1 component. Empty chunks are invalid.
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
    repeatable?: Boolean   // true = editors can add multiple chunk instances
  }
}
```

**`components` is required** (non-nullable) and **must contain at least 1 entry** — an empty `components: []` is invalid and meaningless. Children MUST be pieces or regular (non-structural) components. Structural components (componentChoice, componentMultipleChoice, contentChunk) cannot be direct children.

---

### componentChoice

```typescript
config: {
  componentChoice: {
    choices: ComponentDefinitionInput[]  // REQUIRED — min 2 choices (single choice is invalid)
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
  }
}
```

**`choices` is required** (non-nullable). **Minimum 2 choices** — a single-choice componentChoice is invalid. Children MUST be pieces or regular components; not other structural components.

---

### componentMultipleChoice

```typescript
config: {
  componentMultipleChoice: {
    choices: ComponentDefinitionInput[]  // REQUIRED — min 2 choices (single choice is invalid)
    allowDuplicates?: Boolean            // true = same choice can be selected multiple times
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
  }
}
```

**`choices` is required** (non-nullable). **Minimum 2 choices** — a single-choice componentMultipleChoice is invalid. **`allowDuplicates`** (not `repeatable`) controls whether editors can add the same choice more than once (e.g., two Banner sections on one page). Children MUST be pieces or regular components; not other structural components.

---

### piece

```typescript
config: {
  piece: {
    identifier: String!   // REQUIRED — the piece's identifier (created separately)
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
  }
}
```

**`identifier` is required** — must match an existing piece's identifier.

---

### paragraphCollection

```typescript
config: {
  paragraphCollection: {
    required?: Boolean
    discoverable?: Boolean
    multilingual: ("body" | "images" | "structure" | "title" | "videos")[]  // REQUIRED: array of paragraph parts that are translatable (lowercase)
  }
}
```

**Important**: `multilingual` is **required** (not optional). If all parts are localized, use `["title", "body", "videos", "images"]`. For universal content (no localization), use `[]`.
No required sub-fields.

---

## Structural Nesting Rules

**NEVER nest structural components as direct children of other structural components:**

| Parent type               | Valid direct children      | Invalid direct children                                |
| ------------------------- | -------------------------- | ------------------------------------------------------ |
| `contentChunk`            | pieces, regular components | componentChoice, componentMultipleChoice, contentChunk |
| `componentChoice`         | pieces, regular components | componentChoice, componentMultipleChoice, contentChunk |
| `componentMultipleChoice` | pieces, regular components | componentChoice, componentMultipleChoice, contentChunk |

**Maximum nesting depth: 4 levels.** Level 5 and beyond may only contain non-structural components.

---

## Full Example

```graphql
mutation CreateProductShape {
    createShape(
        input: {
            name: "Guitar"
            type: product
            identifier: "guitar"
            components: [
                {
                    id: "description"
                    name: "Description"
                    type: richText
                    config: { richText: { discoverable: true, multilingual: true } }
                }
                {
                    id: "brand"
                    name: "Brand"
                    type: itemRelations
                    config: { itemRelations: { acceptedShapeIdentifiers: ["brand"], minItems: 1, maxItems: 1 } }
                }
                {
                    id: "body-type"
                    name: "Body Type"
                    type: itemRelations
                    config: { itemRelations: { acceptedShapeIdentifiers: ["body-type"], maxItems: 1 } }
                }
                {
                    id: "finish"
                    name: "Finish"
                    type: selection
                    config: {
                        selection: {
                            options: [
                                { key: "gloss", value: "Gloss" }
                                { key: "satin", value: "Satin" }
                                { key: "matte", value: "Matte" }
                            ]
                            discoverable: true
                        }
                    }
                }
                {
                    id: "specs"
                    name: "Specifications"
                    type: contentChunk
                    config: {
                        contentChunk: {
                            repeatable: false
                            components: [
                                {
                                    id: "weight"
                                    name: "Weight"
                                    type: numeric
                                    config: { numeric: { units: ["kg", "lb"] } }
                                }
                                {
                                    id: "scale-length"
                                    name: "Scale Length"
                                    type: numeric
                                    config: { numeric: { units: ["mm", "inch"] } }
                                }
                            ]
                        }
                    }
                }
                { id: "seo", name: "SEO", type: piece, config: { piece: { identifier: "seo" } } }
            ]
            variantComponents: [
                { id: "fret-count", name: "Fret Count", type: numeric, config: { numeric: { discoverable: true } } }
            ]
        }
    ) {
        ... on Shape {
            identifier
            name
            type
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

---

## Common Errors

| Error                                   | Cause                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `InvalidIdError`                        | `identifier` contains invalid characters (use lowercase letters, numbers, hyphens) |
| `PieceIdentifierTakenError`             | The `identifier` is already used by an existing piece                              |
| `UnauthorizedError`                     | Access token lacks write permissions                                               |
| `ExperimentalFeaturesNotAvailableError` | Feature not available on current plan                                              |
