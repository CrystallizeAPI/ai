# Price Lists & Markets Reference

Price lists and markets work together to localize and personalize pricing. Markets define _where_ and _who_; price lists define _what price_ they get.

## Markets

### What Markets Are

A market is a named selling context. It groups together the pricing, promotion, and configuration rules that apply when a customer checks out.

Markets are set at **checkout time** via the cart context — they are not assigned to products directly.

### Creating Markets

**In the Admin UI:**

1. Go to **Settings → Markets**
2. Click **Add market +**
3. Enter a **name** (e.g. "Norway B2B") and **identifier** (e.g. `norway-b2b`)
4. Click **Create market**

The identifier is used in the API and checkout context. Choose it carefully — it should be lowercase, hyphenated, and descriptive.

### Via PIM API

```graphql
mutation CreateMarket {
  market {
    create(
      input: {
        tenantId: "your-tenant-id"
        identifier: "eu-retail"
        name: "EU Retail"
        customerIdentifiers: []
        type: B2C
      }
    ) {
      identifier
      name
    }
  }
}
```

### Market Architecture Patterns

#### By Country

```
Markets:
  ├── norway     — "Norway"
  ├── sweden     — "Sweden"
  ├── germany    — "Germany"
  └── us         — "United States"
```

#### By Region

```
Markets:
  ├── nordics    — "Nordics" (NO, SE, DK, FI)
  ├── eu         — "European Union"
  ├── uk         — "United Kingdom"
  └── us         — "United States"
```

#### By Segment × Region

```
Markets:
  ├── eu-retail  — "EU Retail"
  ├── eu-b2b     — "EU B2B"
  ├── us-retail  — "US Retail"
  └── us-b2b     — "US B2B"
```

#### By Channel

```
Markets:
  ├── online     — "Online Store"
  ├── in-store   — "Physical Stores"
  └── marketplace — "Marketplace"
```

### How Markets Connect to Checkout

At checkout time, the storefront sets the market in the cart context:

```graphql
mutation HydrateCart {
  cart {
    hydrate(
      context: { markets: ["eu-retail"] }
      input: { items: [{ sku: "TSHIRT-RED-L", quantity: 1 }] }
    ) {
      cart {
        items {
          variant {
            sku
            name
          }
          price {
            gross
            net
            currency
          }
        }
        total {
          gross
          net
          currency
        }
      }
    }
  }
}
```

The market selection determines:

1. Which **price lists** are evaluated
2. Which **promotions** apply
3. Which **currency** is resolved

## Price Lists

### What Price Lists Do

Price lists override or adjust the base price (from price variants) for specific contexts. They answer: "Given this market / customer group / time period, what price should this customer see?"

### Creating Price Lists

**In the Admin UI:**

1. Go to **Special Prices → Price Lists**
2. Click **Add new**
3. Configure:
   - **Name and identifier** — e.g. "EU Summer Sale", `eu-summer-sale`
   - **Products** — All products, or specific ones (drag-and-drop / bulk select)
   - **Price variants** — Which variant(s) this list adjusts
   - **Adjustment type** — Percentage, relative value, or absolute price
   - **Period** (optional) — Start and end dates
   - **Target** — Market, customer group, or individual customer

### Via PIM API

```graphql
mutation CreatePriceList {
  priceList {
    create(
      input: {
        tenantId: "your-tenant-id"
        identifier: "eu-summer-sale"
        name: "EU Summer Sale"
        modifierType: PERCENTAGE
        priceVariants: ["retail"]
        selectedProductVariants: { type: ALL }
        targetAudience: { marketIdentifiers: ["eu-retail"] }
        startDate: "2025-06-01T00:00:00Z"
        endDate: "2025-08-31T23:59:59Z"
      }
    ) {
      identifier
      name
    }
  }
}
```

### Adjustment Types

| Type           | Description                    | Example               |
| -------------- | ------------------------------ | --------------------- |
| **Percentage** | Adjust up or down by %         | `-10%` = 10% discount |
| **Relative**   | Add or subtract a fixed amount | `-5` = $5 off         |
| **Absolute**   | Set a specific price           | `25.00` = exactly $25 |

### Price List Patterns

#### Regional Price Adjustments

Different prices for different regions, all based on the same variants:

```
Price Variant: "retail" (EUR) — Base price: €100

Price Lists:
  ├── "Nordic Retail" → Market: nordics → Adjust: -5% → Final: €95
  ├── "Southern EU Retail" → Market: southern-eu → Adjust: +10% → Final: €110
  └── "UK Retail" → Market: uk → Adjust: absolute £89 → Final: £89
```

#### Customer Group Tiering

```
Price Variant: "b2b" (EUR) — Base price: €80

Price Lists:
  ├── "Wholesale Tier 1" → Group: tier-1 → Adjust: -10% → Final: €72
  ├── "Wholesale Tier 2" → Group: tier-2 → Adjust: -20% → Final: €64
  └── "Strategic Partner" → Group: strategic → Adjust: -30% → Final: €56
```

#### Time-Based Campaigns

```
Price Lists:
  ├── "Summer Sale 2025"
  │     Period: Jun 1 – Aug 31
  │     Adjust: -25% on retail variant
  │     Market: all
  │
  └── "Black Friday EU"
        Period: Nov 25 – Nov 28
        Adjust: absolute prices (manually set per product)
        Market: eu
```

#### Individual Customer Agreements (B2B)

For B2B customers with negotiated rates:

```
Price Lists:
  └── "Acme Corp Agreement"
        Customer: Acme Corp (organization)
        Products: Specific items
        Adjust: absolute prices (per agreement)
        Period: Jan 1 – Dec 31 (annual renewal)
```

### Resolution Priority

When multiple price lists match a context, Crystallize evaluates them in this order:

1. **Most specific target wins** — Individual customer > customer group > market > global
2. **Active period** — Only lists within their defined period are evaluated
3. **Product scope** — Product-specific lists override "all products" lists

### Best Practices

1. **Name descriptively** — Include the target context in the name: "EU B2B Q1 2025" not "Price List 3"
2. **Limit overlap** — Avoid having many price lists targeting the same market+variant combination
3. **Use periods** — Even for "permanent" adjustments, set a far-future end date so they can be reviewed
4. **Bulk select products** — Use the Nerdy view on a folder to quickly add many variants to a list
5. **Test the checkout** — Always verify the resolved price in the cart to ensure list priority is correct

### Anti-Patterns

- ❌ Creating a price list per product (use base variant prices instead)
- ❌ Using price lists for structural price differences (use separate price variants)
- ❌ Overlapping lists with conflicting adjustments on the same scope
- ❌ Forgetting to set an end date on campaign lists (they stay active forever)
