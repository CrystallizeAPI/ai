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

Always select `... on BasicError { errorName message }`: most failures arrive as `UnknownError`, with the actual reason in `errorName`.

**`updateShape(identifier: String!, input: UpdateShapeInput!)`** takes the same fields except `identifier` and `type`. For `components` and `variantComponents`, an omitted key changes nothing, `null` clears the list, and an array replaces it entirely. Unlike the mutation, mass operations treat an omitted list as empty.

---

## CreateShapeInput

```typescript
{
  name: String!                          // REQUIRED — display name
  type: ShapeType!                       // REQUIRED — see ShapeType enum
  identifier?: String                    // optional — auto-generated from name if omitted (required in mass operations, 2 to 64 characters)
  components?: ComponentDefinitionInput[]  // shape-level component definitions
  variantComponents?: ComponentDefinitionInput[]  // product-only: custom components on variants
  meta?: { key: String!, value?: String }[]  // arbitrary key-value metadata (mass operations ignore it)
}
```

**`ShapeType` enum:** `document` | `folder` | `product`

**`variantComponents`** is only accepted on `type: "product"` shapes: any other type is rejected. Use it to add custom fields to product variants beyond the built-in `sku`, `images`, `videos`, `price`, `stock`, and `attributes`.

---

## ComponentDefinitionInput

Used in both `components` and `variantComponents` arrays, and recursively inside structural component configs.

```typescript
{
  name: String!          // REQUIRED — display name, up to 256 characters
  type: ComponentType!   // REQUIRED — see ComponentType enum
  id?: String            // optional — identifier used in API queries. Auto-generated from name if omitted. Prefer explicit IDs. Required in mass operations.
  description?: String   // optional — help text shown to editors, up to 1024 characters
  config?: ComponentConfigInput  // optional — required for some types (see per-type rules below)
}
```

**`ComponentType` enum:** `boolean` | `colors` | `componentChoice` | `componentMultipleChoice` | `contentChunk` | `datetime` | `files` | `gridRelations` | `images` | `itemRelations` | `location` | `numeric` | `paragraphCollection` | `piece` | `propertiesTable` | `richText` | `selection` | `singleLine` | `videos`

**`id` and `identifier` rules:** 1 to 64 characters: letters, digits, space and `; : + @ ( ) . _ - " =`. Every `id` must be unique within its list (`components`, `variantComponents`, `choices`).

---

## ComponentConfigInput — Per-Type Required Fields

The `config` object must match the component `type`. Only set the key that corresponds to the component type.

Every type below also takes these keys, left out of the blocks to keep them short:

- `searchable`, `filterable`, `sortable`, `facetable`: `true` when left out. They narrow what the Discovery API can do with the field and take effect at the next `igniteDiscoApi`. See [Discoverability Rules](components.md#discoverability-rules).

Three more behave differently from what the name suggests:

- `required`: `true` rejects an empty component, `false` accepts one and skips its other rules. Left out, an empty component is still held to its `min`, `minItems`, `pattern` and `units`.
- `discoverable`: `true` when left out. Only `false` keeps a component out of Discovery.
- `multilingual`: see the [default per component](components.md#default-localization-settings-by-component).

On every type with `min` and `max`, `min` cannot exceed 256, `max` cannot exceed 1048576, and `min` cannot exceed `max`. Some types have a lower ceiling, noted below.

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

No required sub-fields. The API rejects a `pattern` it considers unsafe, such as one with nested quantifiers. With `required` left out, an empty value fails the pattern.

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
    decimalPlaces?: Int  // 1–64; floors the stored number to that many decimals. Leave it out to store the number as sent (mass operations reject 0)
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
    format?: DateComponentFormat  // "date" | "datetime" (default: date)
  }
}
```

No required sub-fields. Mass operations do not accept `format`, so a datetime created that way uses `date`.

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
    max?: Int   // max number of images, 512 at most
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
    max?: Int   // 512 at most
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
    max?: Int   // 512 at most
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

Sub-fields `contentType`, `size`, and `unit` are required when their parent objects are provided. In mass operations `maxFileSize` itself is required whenever `config.files` is present. It cannot exceed the platform's upload limit.

---

### selection

```typescript
config: {
  selection: {
    options: {            // REQUIRED — at least one option
      key: String!        // REQUIRED — API value (e.g. "red")
      value: String!      // REQUIRED — option value (e.g. "Red")
      label: String       // optional, but set it — the text the App UI shows for the option (e.g. "Red")
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

**`options` is required** (non-nullable array) and each `key` must be unique. Each option requires `key` (the API identifier) and `value`. `label` is optional, but it is good practice to set it on every option — it is the text the App UI displays to editors. Use the same human-readable text as `value` unless the user asks for something different. `label` is accepted by the Core API (Next and legacy) and by mass operations.

---

### colors

```typescript
config: {
  colors: {
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
    min?: Int                 // min number of colour entries
    max?: Int                 // max number of colour entries (100 when unset)
    requireLabel?: Boolean    // force every entry to carry a label
    colorPresets?: {          // palette editors pick from
      label?: String
      hex?: String
      rgb?: { r: Int!, g: Int!, b: Int!, a?: Float }
      hsl?: { h: Int!, s: Int!, l: Int!, a?: Float }
      cmyk?: { c: Int!, m: Int!, y: Int!, k: Int! }
      pantone?: String
      ral?: String
    }[]
    customColorSpaces?: ColorSpace[]   // cmyk | hex | hsl | pantone | ral | rgb
  }
}
```

Every field is optional — `colors` with no config is valid for the API, but it gives editors nothing to
enter in the App, which shows no colour inputs without `customColorSpaces`. Set `customColorSpaces`, or
`colorPresets`, or both. One colour entry may carry several notations at once, so `colorPresets` entries and
stored content share the same shape.

Use `customColorSpaces` to narrow which notations editors are offered — a print-facing shape might expose
only `hex` and `pantone`. Content in any other notation is rejected. Use `colorPresets` with no
`customColorSpaces` to hold editors to a brand palette in the App. The API does not check content against
the presets.

Unset `multilingual` stores the whole colour list per language. Set `multilingual: false` when the colours
are universal. Content rules (hex, RAL and Pantone formats) are in
[Components Reference](components.md#i-need-to-store-a-colour).

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

`keys` is required when a section is provided, and a key cannot repeat within a section. Omit `sections` entirely for fluid/dynamic keys (editors define keys at content time).

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
    maxItems?: Int   // 75 at most
    minSkus?: Int    // for linking specific variant SKUs
    maxSkus?: Int    // 75 at most
    quickSelect?: {
      folders: {
        folderId: String!   // REQUIRED — must be a folder of this tenant
      }[]                   // REQUIRED — at least one folder, 100 at most
      view?: "nerdy" | "pretty"  // not accepted by mass operations
    }
  }
}
```

**Always set `acceptedShapeIdentifiers`** — without it, editors can link any shape, breaking semantic meaning. Every identifier must name an existing shape when the component is saved. A component holds at most 75 items and 75 SKUs even with no `maxItems` set, so a larger `maxItems` is rejected. The `min`/`max` fields (without `Items` suffix) are deprecated aliases — use `minItems`/`maxItems` instead.

---

### gridRelations

```typescript
config: {
  gridRelations: {
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
    min?: Int
    max?: Int   // 512 at most
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
    repeatable?: Boolean   // true = editors can add multiple chunk instances. Defaults to true: set false for a single group
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
    choices: ComponentDefinitionInput[]  // REQUIRED — min 1 choice
    allowDuplicates?: Boolean            // true = same choice can be selected multiple times. Defaults to true
    required?: Boolean
    discoverable?: Boolean
    multilingual?: Boolean
  }
}
```

**`choices` is required** (non-nullable). **Minimum 1 choice**. **`allowDuplicates`** (not `repeatable`) controls whether editors can add the same choice more than once (e.g., two Banner sections on one page). Children MUST be pieces or regular components; not other structural components.

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
    multilingual?: ("body" | "images" | "structure" | "title" | "videos")[]  // array of paragraph parts that are translatable (lowercase). Required in mass operations
  }
}
```

**Important**: mass operations require `multilingual` in this config. If all parts are localized, use `["title", "body", "videos", "images"]`. For universal content (no localization), use `[]`. Left out on `createShape`, title and body are translated, images and videos shared.

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
                                { key: "gloss", value: "Gloss", label: "Gloss" }
                                { key: "satin", value: "Satin", label: "Satin" }
                                { key: "matte", value: "Matte", label: "Matte" }
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

| Error                                   | Cause                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `ShapeIdentifierTakenError`             | A shape with this `identifier` already exists                              |
| `IdentifierInvalidCharactersError`      | `identifier` or component `id` contains a character outside the rule above |
| `PieceNotFoundError`                    | A `piece` component refers to a piece that does not exist yet              |
| `InvalidShapeIdentifiersProvidedError`  | `acceptedShapeIdentifiers` names a shape that does not exist yet           |
| `ComponentNotNestableError`             | A structural component is a direct child of another one                    |
| `ComponentDepthTooBigError`             | Nesting goes past the depth limit                                          |
| `UnauthorizedError`                     | Access token lacks write permissions                                       |
| `ExperimentalFeaturesNotAvailableError` | Feature not available on current plan                                      |

Apart from the last two, these arrive as `UnknownError` with this value in `errorName`.
