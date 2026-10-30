# Price Variants Reference

Price variants are global definitions that determine the types of prices available across your entire Crystallize catalogue. Each product variant can have a value for every defined price variant.

## How Price Variants Work

- Defined globally in **Settings → Price Variants** in the Crystallize admin
- Once created, available on every product variant in the catalogue
- Each variant has: **name**, **identifier** (API key), and **currency**
- Editors set a price value per variant on each product variant

### Variant vs Product Variant — Terminology

Don't confuse:

- **Price variant** = a global pricing _type_ (e.g. "Retail USD") — defined in tenant settings
- **Product variant** = a specific SKU of a product (e.g. "Red, Size L") — defined on the product

A product variant can have values for multiple price variants:

```
Product: "Classic T-Shirt"
  └── Product Variant: "Red, Size L" (SKU: TSHIRT-RED-L)
        ├── Price Variant "retail" (USD): $39.99  ← always set (reference / "was" price)
        ├── Price Variant "sales" (USD): $29.99   ← only set when on sale ("now" price)
        └── Price Variant "b2b" (USD): $18.00
```

## Creating Price Variants

### In the Admin UI

1. Go to **Settings → Price Variants**
2. Click **Add price variant +**
3. Set:
    - **Name** — Human-readable (e.g. "US Dollar Retail")
    - **Identifier** — Lowercase, hyphenated (e.g. `usd-retail`). Used in the API. Cannot be changed after creation.
    - **Currency** — ISO 4217 code (e.g. `USD`, `EUR`, `NOK`, `GBP`, `SEK`, `DKK`, `JPY`, `CHF`)
4. Click **Create variant**

### Via Core API

```graphql
mutation {
    createPriceVariant(input: { identifier: "eur-retail", name: "EUR Retail", currency: "EUR" }) {
        ... on PriceVariant {
            identifier
            name
            currency
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`updatePriceVariant(identifier:, input:)` changes `name`, `currency` and `tierConfig`, never the identifier. `deletePriceVariant(identifier:)` refuses `default`. The legacy PIM API equivalent is `priceVariant { create(input: { tenantId, ... }) }`.

Mass operations cannot create a price variant: there is no such intent. Create them first, then reference them from `priceVariants` in a product or price list operation.

## Setting Prices on Products

### Via Mass Operations (product upsert)

Prices are set inside the `variants` array of a product upsert operation:

```json
{
    "intent": "product/upsert",
    "language": "en",
    "name": "Classic T-Shirt",
    "shapeIdentifier": "product",
    "resourceIdentifier": "TSHIRT-001",
    "vatTypeId": "<vat type id>",
    "tree": { "parentId": "<folder id>" },
    "variants": [
        {
            "name": "Classic T-Shirt — Red L",
            "sku": "TSHIRT-RED-L",
            "isDefault": true,
            "priceVariants": [
                { "identifier": "retail", "price": 39.99 },
                { "identifier": "sales", "price": 29.99 },
                { "identifier": "b2b", "price": 18.0 }
            ]
        }
    ]
}
```

### Via Core API Mutation

```graphql
mutation SetVariantPrice {
    modifyProductVariantPrice(sku: "TSHIRT-RED-L", priceVariantIdentifier: "retail", price: 39.99) {
        ... on ProductPriceVariant {
            identifier
            price
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

It sets one price at a time and leaves the rest of the variant alone. `updateProductVariant` also takes `priceVariants`, but rewrites more of the variant: see [[mutation]] before using it for a price change.

## Querying Prices

### Discovery API

`priceVariants` is a JSON hash keyed by identifier, not a list of objects: select it without sub-fields. Each price variant also generates its own field, `<identifier>Price`, with a hyphenated identifier in camelCase (`usd-retail` gives `usdRetailPrice`, and `price_usdRetail` to filter and sort).

```graphql
query {
    browse {
        product(language: en) {
            hits {
                name
                defaultVariant {
                    defaultPrice # the price variant whose identifier is `default`
                    salesPrice # null when `sales` has no value for this SKU
                    priceVariants # { "default": { "price": 39.99, "currency": "USD" }, ... }
                }
            }
        }
    }
}
```

### Getting a Specific Price Variant

```graphql
query {
    browse {
        product(language: en, path: "/shop/t-shirts/classic") {
            hits {
                name
                defaultVariant {
                    retail: priceVariants(key: "default") # { "price": 39.99, "currency": "USD" }
                }
            }
        }
    }
}
```

### Catalogue API

Here `priceVariants` is a list, which is what the helpers below take.

```graphql
query {
    productVariants(skus: ["TSHIRT-RED-L"], language: "en") {
        sku
        priceVariants {
            identifier
            name
            price
            currency
        }
    }
}
```

In your frontend, filter by identifier:

```typescript
const retailPrice = variant.priceVariants.find((pv) => pv.identifier === "retail");
const salesPrice = variant.priceVariants.find((pv) => pv.identifier === "sales");
```

## Volume and Graduated Tiers

A price on a product variant can carry a quantity ladder instead of a flat value. With tiers `1: 100` and `10: 90`:

| `tierType`  | 15 units                                                                       |
| ----------- | ------------------------------------------------------------------------------ |
| `volume`    | Every unit at the matched tier: 15 × 90                                        |
| `graduated` | Each unit at its own tier: 9 × 100 + 6 × 90, returned as an average unit price |

```graphql
mutation SetTiers {
    modifyProductVariantPrice(
        sku: "TSHIRT-RED-L"
        priceVariantIdentifier: "retail"
        tierType: volume
        tiers: [{ threshold: 1, price: 100 }, { threshold: 10, price: 90 }, { threshold: 50, price: 80 }]
    ) {
        ... on ProductPriceVariant {
            identifier
            tierType
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

A ladder is refused unless the first `threshold` is 1, thresholds strictly increase, every price is above 0, and `tierType` is set. A `price` sent with it must equal the first tier's price.

| Read from | How                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue | `priceVariant(identifier) { tierType tiers { threshold price } price(count: 10) priceFor(count: 10, ...) { price } }`                          |
| Discovery | `retailPrice(count: 10)`, `retailPriceTierType`, `retailPriceTiers { threshold price }`, `retailPriceFor(count: 10, marketIdentifiers: [...])` |
| Cart      | Automatic from each line's quantity, per SKU. `price { tierType resolvedTier { threshold price } tiers { threshold price } }` on the line      |

`tierConfig` on the price variant (`policy: disabled | optional | required`, `allowFreeform`, `presets`) shapes the tier editor in the app. API writes to a product variant are not checked against it.

In a mass operation, `tierType` and `tiers` go on `priceVariants[]` of the `product/*` and `product/variant/*` intents, with a few parsing caveats listed in [[mass-operations]]. The MCP mass-operation tools refuse both keys, so a file with tiers needs the CLI or the raw API. `product/variant/price/modify` is flat only, with a minimum of 1.

## Naming Convention Guide

### Rules

1. **Identifiers are permanent** — Choose carefully; they are used in API queries and cannot be renamed
2. **Use lowercase with hyphens** — `usd-retail`, not `USD_Retail` or `usdRetail`. The app only accepts lowercase letters, numbers, `-` and `_`
3. **Encode purpose and/or currency** — Make identifiers self-documenting
4. **Be consistent** — Pick one pattern and follow it across all variants

### Patterns

| Pattern                | When to Use                      | Examples                   |
| ---------------------- | -------------------------------- | -------------------------- |
| `{currency}`           | Single purpose, multi-currency   | `usd`, `eur`, `nok`        |
| `{purpose}`            | Single currency, multi-purpose   | `retail`, `b2b`, `members` |
| `{currency}-{purpose}` | Multi-currency AND multi-purpose | `usd-retail`, `eur-b2b`    |
| `default`              | Single-market, single-price      | `default`                  |

### Anti-Patterns

- ❌ `price1`, `price2` — Not descriptive
- ❌ `USD_Retail_Price` — Too verbose, wrong casing
- ❌ `norway`, `sweden` — Countries are markets, not price types. Use Price Lists for regional adjustments
- ❌ `christmas-sale` — Temporary campaigns should use Promotions, not permanent variants

## Common Scenarios

### "Was / Now" Pricing Display

Set up two variants following the convention from the main pricing guide:

- `retail` — The reference price, always set. Displayed as the "was" / compare-at / strikethrough price when a sale is active.
- `sales` — The marked-down selling price, only set when the product is on sale. This is the "now" price.

The storefront checks: if `sales` exists and is lower than `retail`, show strikethrough. Otherwise, show `retail` as the current price. In a cart, the same rule is `selectedVariantIdentifier`, `fallbackVariantIdentifiers` and `compareAtVariantIdentifier`: see "Pricing a Cart" in the main pricing guide.

```tsx
function PriceDisplay({ priceVariants }) {
    const retail = priceVariants.find((p) => p.identifier === "retail");
    const sales = priceVariants.find((p) => p.identifier === "sales");

    const onSale = sales && retail && sales.price < retail.price;

    return (
        <div>
            {onSale && <span className="line-through text-gray-400">{retail.price}</span>}
            <span className={onSale ? "text-red-600 font-bold" : ""}>
                {onSale ? sales.price : retail.price} {retail.currency}
            </span>
        </div>
    );
}
```

### Multi-Currency Store

Create one variant per currency, resolve which to show based on the customer's market or preference:

```typescript
function getDisplayPrice(priceVariants, customerCurrency = "USD") {
    return (
        priceVariants.find((pv) => pv.currency === customerCurrency) ||
        priceVariants.find((pv) => pv.identifier === "default") ||
        priceVariants[0]
    );
}
```

### B2B + B2C on Same Store

Use the checkout context / logged-in customer group to determine which variant to display:

```typescript
function getPrice(priceVariants, isB2B = false) {
    const identifier = isB2B ? "b2b" : "retail";
    return priceVariants.find((pv) => pv.identifier === identifier);
}
```
