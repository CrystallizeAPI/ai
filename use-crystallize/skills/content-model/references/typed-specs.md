# Typed Specs, Units and Identifiers

How to model technical specifications and product identifiers so that Discovery can filter and rank on them, and a
storefront can publish them as structured data without a second source of truth.

## Why Typed Specs

Every build that replaced label/value tables with typed components gained the same things from one model:

- **Filters and facets.** A numeric becomes a range filter, a selection a set of option filters, a switch a boolean
  filter. A properties table is one opaque value, so it gives none of them.
- **Ranking signals.** Numerics inside pieces inside a component choice are indexed and offered as `rankBy` fields
  (`specs_abrasive_discDiameter_number`, `power_voltage_number`). See [[vector-ranking]].
- **Structured data.** Each typed value becomes a schema.org `PropertyValue` in `additionalProperty`, with its unit
  as a `unitCode`. See [[seo-geo]].
- **Markdown twins and agent filters.** The same typed rows give the Markdown version of the page, and give an AI
  agent a filter it can use ("18 V, under 2 kg"). See [[agentic-commerce]].

A properties table still has a place for keys that are truly unknown in advance. A real table in body text (a sizing
chart, a handbook table) is better as a rich-text table, which Discovery returns as semantic table nodes (see
[[content-json]]).

## The Shape of a Spec Model

Put the attributes every product has in shared pieces, and the attributes of one product family behind a single
`componentChoice`, one piece per family:

```
Product Shape: Tool
  ├── power (Piece → power)                shared by every family
  │     ├── voltage (Numeric, V)
  │     └── battery-capacity (Numeric, Ah)
  ├── physical (Piece → physical)          shared by every family
  │     ├── weight (Numeric, kg)
  │     └── length (Numeric, mm)
  └── specs (componentChoice)               exactly one family per product
        ├── drilling (Piece → spec-drilling)
        │     ├── max-drilling-diameter-steel (Numeric, mm)
        │     ├── chuck (Selection)
        │     └── hammer-function (Switch)
        └── abrasive (Piece → spec-abrasive)
              ├── disc-diameter (Numeric, mm)
              └── no-load-speed (Numeric, 1/min)
```

- **Discovery has no "has this choice" filter.** To find every product of one family, combine `exists: true` over
  the family's fields. Give each family at least one field every product in it fills.
- **Specs that differ per variant go in `variantComponents`**, which accept pieces and choices too (a `spec` choice
  of the same family pieces, plus `physical`). Pieces used on variants are safest without content chunks: see the
  chunk note in [Components Reference](components.md).
- Create the pieces and shapes in the 4-phase order in SKILL.md, because the shapes reference the pieces.

## Numerics and Units

### One unit per numeric

Range filters compare the raw number and ignore the unit. A component with `["m³/h", "l/s"]` stores each item's
value in whichever unit the editor picked, and `airflow_number: { range: { gte: 100 } }` then mixes cubic metres per
hour with litres per second. Pick one unit per component and convert at import. If several units are unavoidable,
filter on a superset and check `<field>Unit` on each hit.

Discovery serves a numeric as two fields, the number and its unit, and filters on `<path>_number`:

```graphql
search(language: en, filters: { power_voltage_number: { range: { gte: 18 } } }) {
    hits { ... on tool { power { voltage voltageUnit } } }
}
# → "power": { "voltage": 18, "voltageUnit": "V" }
```

### Units that map to schema.org

A numeric with a unit is a schema.org `QuantitativeValue` (or a `PropertyValue` in `additionalProperty`) with
`value`, `unitText` (the unit as written) and `unitCode`, the UN/CEFACT Recommendation 20 code. The unit list has no
slot for the code, so the storefront maps it. Choose unit strings that map one-to-one:

| Unit | Rec 20 | Unit  | Rec 20 | Unit    | Rec 20 | Unit    | Rec 20 |
| ---- | ------ | ----- | ------ | ------- | ------ | ------- | ------ |
| `mm` | `MMT`  | `V`   | `VLT`  | `Nm`    | `NU`   | `m/s²`  | `MSK`  |
| `cm` | `CMT`  | `A`   | `AMP`  | `J`     | `JOU`  | `m³/h`  | `MQH`  |
| `m`  | `MTR`  | `Ah`  | `AMH`  | `kN`    | `B47`  | `dB(A)` | `2N`   |
| `g`  | `GRM`  | `W`   | `WTT`  | `kPa`   | `KPA`  | `°`     | `DD`   |
| `kg` | `KGM`  | `Wh`  | `WHR`  | `mbar`  | `MBR`  | `%`     | `P1`   |
| `l`  | `LTR`  | `lm`  | `LUM`  | `m/s`   | `MTS`  | `h`     | `HUR`  |
| `s`  | `SEC`  | `min` | `MIN`  | `years` | `ANN`  |         |        |

- **`1/min` is two units.** It is `RPM` on a rotational speed and `C94` (reciprocal minute) on an impact or stroke
  rate. Decide by field.
- **Leave a unit without an unambiguous code uncoded** (`l/s`, `m³/min`) rather than guessing.
- **Name bounds consistently.** A field id that starts or ends with `max` or `min` (`max-drilling-diameter`) maps to
  `maxValue` or `minValue` instead of `value`.
- **Ranges are two numerics.** A body-size range ("62-68") is `fits-from` and `fits-to` numerics on the variant, so a
  range filter finds every size that fits. A label like "62-68" means "up to 68", so `fits-from` starts just above
  the previous size's upper bound.

### decimalPlaces

`decimalPlaces: 0` floors the value (13.5 l is stored as 13), and on one tenant it was rejected outright. Leave it
out for integers, and give anything measured in fractions (litres, kilograms) at least 1.

### A unit list makes empty values fail

Nine builds hit this, and it is the most common write failure in the findings. A numeric with a `units` list needs a
unit in its content, and a value cannot carry a unit without a number. So an item that has no value for it fails:

- `createProduct`, `createDocument` and mass-operation creates, even when the operation doesn't send the component;
- `updateProduct` and upsert-updates of any product or variant without a value, even when its components are left
  out or sent empty, and even when the create of the same item worked;
- publishing: an empty piece of unit-bound numerics blocks `publishItem` (`allowedUnits`), and the mass-operation
  `item/publish` has no way around it.

What worked, in order of preference:

1. **Set `required: false` on a numeric that is genuinely optional** (see [Components Reference](components.md)).
2. **Drop the `units` list** on optional numerics. The unit is still stored with each value, so the storefront still
   reads `<field>Unit`. You lose the editor's unit picker.
3. **Write numerics with `updateComponent`, one component at a time**, after a minimal create.
4. **Publish with `publishItem(disableComponentValidation: true)`** on the Core API. It also hides real shape-limit
   violations, so use it for the publish only.

The write side is in [[mutation]] and [[mass-operations]].

## Booleans

An unset Switch reads `false` in Discovery, not `null`. A storefront can't tell "no" from "not stated", and a
published `false` is a wrong fact in JSON-LD, a feed or an agent's filter.

- Write `true` for the features an item has, and leave the rest unset. Never write `false` for "unknown".
- Treat `false` from Discovery as "not stated" when publishing facts. Show boolean specs only when `true`.
- When "no" must be stated (a product that is explicitly not waterproof), use a Selection with `yes` and `no`.

## Selections and External Codes

Every Selection option becomes a filter field of its own in Discovery (`specs_extraction_dustClass_m`, filtered with
`exists: true`). The naming is in [[query]].

An option carries only `key`, `value` and `label`, so it has no slot for an external code (an ETIM value `EV…`, a GS1
code). Keep it in one of these places, and say which in the component `description`:

- an option key convention (`ev000123-sds-plus`),
- a labels file generated from the model, shipped with the storefront,
- for codes on a classification, a topic's `meta` (see [[taxonomy]]).

## Component Description

Component definitions take a `description`, which the App shows as editor help. Use it for the standard the field
maps to (`ETIM EF000002 Nominal voltage`) and for field ownership (`Owner: ERP`, `Owner: PLM`). The model has no
first-class owner or source-system field.

## Identifiers

schema.org, Google Merchant Center and GS1 treat the merchant's SKU, the GTIN and the manufacturer's part number as
**separate facts**. A SKU used as the GTIN loses the merchant's own SKU, and a kit and the bare tool have different
GTINs. Model them apart:

| Identifier                               | Where                                                                | schema.org                                     |
| ---------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| Merchant SKU                             | the built-in variant `sku`                                           | `sku`                                          |
| GTIN (EAN, UPC)                          | `gtin` Single Line in `variantComponents`, not translatable          | `gtin8`, `gtin12`, `gtin13`, `gtin14`          |
| Manufacturer part number                 | `mpn` Single Line, on the variant when it differs per variant        | `mpn`                                          |
| National trade numbers (NOBB, NRF, ISBN) | Single Lines (grouped in an `identifiers` chunk on the product only) | `identifier` as a `PropertyValue`              |
| One external system id                   | the built-in `externalReference` on the item or variant              | none; keep it `discoverable: false` if private |

```json
{
    "id": "gtin",
    "name": "GTIN",
    "type": "singleLine",
    "description": "GS1 GTIN-8, -12, -13 or -14",
    "config": { "singleLine": { "multilingual": false, "discoverable": true, "pattern": "^(\\d{8}|\\d{12,14})$" } }
}
```

- **Each identifier gets its own named component**, never a generic key/value list, so it stays typed and filterable.
- **Don't fill a gap with a guess.** An empty GTIN is "not registered", and the storefront says so or leaves it out.
- **A single line on a variant publishes and is served by Discovery** (`variants { sku gtin }`).

## Checklist

1. Measurable values are Numerics with one unit each, and the unit strings map to Rec 20.
2. Optional numerics with a unit list have `required: false`, or no unit list.
3. Booleans state only what is true.
4. Every field the storefront renders or filters on is `discoverable` (see [Components Reference](components.md)).
5. `sku`, `gtin` and `mpn` are separate fields.
6. Each family behind the `specs` choice has a field that every product in it fills.
