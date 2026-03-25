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
2. Click **Add new variant**
3. Set:
   - **Name** — Human-readable (e.g. "US Dollar Retail")
   - **Identifier** — Lowercase, hyphenated (e.g. `usd-retail`). Used in the API. Cannot be changed after creation.
   - **Currency** — ISO 4217 code (e.g. `USD`, `EUR`, `NOK`, `GBP`, `SEK`, `DKK`, `JPY`, `CHF`)
4. Save

### Via PIM API

```graphql
mutation {
  priceVariant {
    create(
      input: {
        tenantId: "your-tenant-id"
        identifier: "eur-retail"
        name: "EUR Retail"
        currency: "EUR"
      }
    ) {
      identifier
      name
      currency
    }
  }
}
```

### Via Mass Operations

```json
{
  "version": "1.0.0",
  "operations": [
    {
      "intent": "priceVariant/upsert",
      "identifier": "usd-retail",
      "name": "USD Retail",
      "currency": "USD"
    },
    {
      "intent": "priceVariant/upsert",
      "identifier": "eur-retail",
      "name": "EUR Retail",
      "currency": "EUR"
    }
  ]
}
```

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
mutation UpdateVariantPrice {
  product {
    updateVariant(
      productId: "product-id"
      language: "en"
      sku: "TSHIRT-RED-L"
      input: {
        priceVariants: [
          { identifier: "retail", price: 39.99 }
          { identifier: "sales", price: 29.99 }
        ]
      }
    ) {
      ... on Product {
        id
      }
    }
  }
}
```

## Querying Prices

### Discovery API

```graphql
query {
  browse {
    product(language: en) {
      hits {
        name
        defaultVariant {
          defaultPrice # The first/default price variant value
          priceVariants {
            identifier
            price
            currency
          }
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
          priceVariants {
            identifier
            price
            currency
          }
        }
      }
    }
  }
}
```

In your frontend, filter by identifier:

```typescript
const retailPrice = variant.priceVariants.find(
  (pv) => pv.identifier === "retail",
);
const salesPrice = variant.priceVariants.find(
  (pv) => pv.identifier === "sales",
);
```

## Naming Convention Guide

### Rules

1. **Identifiers are permanent** — Choose carefully; they are used in API queries and cannot be renamed
2. **Use lowercase with hyphens** — `usd-retail`, not `USD_Retail` or `usdRetail`
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

The storefront checks: if `sales` exists and is lower than `retail`, show strikethrough. Otherwise, show `retail` as the current price.

```tsx
function PriceDisplay({ priceVariants }) {
  const retail = priceVariants.find((p) => p.identifier === "retail");
  const sales = priceVariants.find((p) => p.identifier === "sales");

  const onSale = sales && retail && sales.price < retail.price;

  return (
    <div>
      {onSale && (
        <span className="line-through text-gray-400">{retail.price}</span>
      )}
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
