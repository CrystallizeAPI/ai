# Price Lists & Markets Reference

Price lists and markets work together to localize and personalize pricing. Markets define _where_ and _who_; price lists define _what price_ they get.

## Markets

### What Markets Are

A market is a named selling context. It groups together the pricing, promotion, and configuration rules that apply when a customer checks out. It holds a name, an identifier and an optional list of customers: no currency, no type, no tax.

Markets are set at **checkout time** via the cart context — they are not assigned to products directly.

### Creating Markets

**In the Admin UI:**

1. Go to **Settings → Markets**
2. Click **Add market**
3. Enter a **name** (e.g. "Norway B2B") and **identifier** (e.g. `norway-b2b`)
4. Click **Create market**

The identifier is used in the API and checkout context. Choose it carefully — it should be lowercase, hyphenated, and descriptive. It cannot be changed afterwards.

### Via PIM API

Markets exist only on the legacy PIM API: the Core API has no market mutation.

```graphql
mutation CreateMarket {
    market {
        create(
            input: { tenantId: "your-tenant-id", identifier: "eu-retail", name: "EU Retail", customerIdentifiers: [] }
        ) {
            identifier
            name
        }
    }
}
```

Listing customers in `customerIdentifiers` does not put their carts in that market. Price resolution reads the markets the caller passes, nothing else.

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
    hydrate(
        input: {
            context: {
                price: { markets: ["eu-retail"], selectedVariantIdentifier: "retail-eur", currency: "EUR", decimals: 2 }
            }
            items: [{ sku: "TSHIRT-RED-L", quantity: 1 }]
        }
    ) {
        id
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
```

The market selection determines:

1. Which **price lists** are evaluated
2. Which **promotions** apply

It does not determine the currency. The storefront maps its market to a price variant and sends that in `selectedVariantIdentifier`, with the matching `currency`: see "Pricing a Cart" in the main pricing guide.

## Price Lists

### What Price Lists Do

Price lists override or adjust the base price (from price variants) for specific contexts. They answer: "Given this market / customer group / time period, what price should this customer see?" A modifier is a plain number applied to one price variant, so a list keeps that variant's currency.

### Creating Price Lists

**In the Admin UI:**

1. Go to **Special Prices → Price Lists**
2. Click **Create price list +**
3. Configure:
    - **Name and identifier** — e.g. "EU Summer Sale", `eu-summer-sale`
    - **Products** — All products, or specific ones (drag-and-drop / bulk select)
    - **Price variants** — Which variant(s) this list adjusts
    - **Adjustment type** — Percentage, relative value, or absolute price
    - **Period** (optional) — Start and end dates
    - **Target** — Market, customer group, or individual customer

### Via Core API

```graphql
mutation CreatePriceList {
    createPriceList(
        input: {
            identifier: "eu-summer-sale"
            name: "EU Summer Sale"
            modifierType: PERCENTAGE
            priceVariants: [{ identifier: "retail", modifier: -10 }]
            selectedProductVariants: { type: ALL_SKUS }
            targetAudience: { type: SOME, marketIdentifiers: ["eu-retail"] }
            startDate: "2025-06-01T00:00:00Z"
            endDate: "2025-08-31T23:59:59Z"
        }
    ) {
        ... on PriceList {
            identifier
            name
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

Every part of the input is an object, not a bare identifier:

| Field                     | Shape                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `priceVariants`           | `[{ identifier, modifier, decimalPlaces? }]` — `modifier` is read according to `modifierType`      |
| `selectedProductVariants` | `{ type: ALL_SKUS \| SOME_SKUS, variants?: [{ sku, priceVariants: [{ identifier, modifier }] }] }` |
| `targetAudience`          | `{ type: EVERYONE \| SOME, marketIdentifiers?, customerGroupIdentifiers?, customerIdentifiers? }`  |

`targetAudience.type` is required. With `SOME`, name the audience in one or more of the identifier lists; with `EVERYONE`, name nobody or the call fails.
There is no `ALL` selection type — it is `ALL_SKUS` or `SOME_SKUS`. `ALL_SKUS` refuses `variants`. A list for specific SKUs:

```graphql
selectedProductVariants: {
    type: SOME_SKUS
    variants: [{ sku: "olive-oil-500ml", priceVariants: [{ identifier: "retail", modifier: -15 }] }]
}
```

A SKU's `priceVariants` overrides the list's modifier for that SKU, and is optional: a SKU without it takes the list's. An override only works for a price variant that is also in the list's own `priceVariants`, or it is ignored.

`createPriceList` checks that customers, customer groups, SKUs and price variants exist, but **not markets**: a misspelled market identifier is accepted and the list never matches.

The legacy PIM API (`priceList { create(input: { tenantId, ... }) }`) takes the same input shape plus
`tenantId`. In a mass operation the intent is `pricelist/create` or `pricelist/upsert`, with the same
fields at the top level of the operation.

### Adjustment Types

| Type           | `modifierType` | Description                    | Example               |
| -------------- | -------------- | ------------------------------ | --------------------- |
| **Percentage** | `PERCENTAGE`   | Adjust up or down by %         | `-10%` = 10% discount |
| **Relative**   | `RELATIVE`     | Add or subtract a fixed amount | `-5` = $5 off         |
| **Absolute**   | `ABSOLUTE`     | Set a specific price           | `25.00` = exactly $25 |

The app labels `ABSOLUTE` "Fixed". A result below 0 is clamped to 0.

### Price List Patterns

#### Regional Price Adjustments

Different prices for different regions, all based on the same variants:

```
Price Variant: "retail" (EUR) — Base price: €100

Price Lists:
  ├── "Nordic Retail" → Market: nordics → Adjust: -5% → Final: €95
  ├── "Southern EU Retail" → Market: southern-eu → Adjust: +10% → Final: €110
  └── "Baltics Retail" → Market: baltics → Adjust: absolute €89 → Final: €89
```

A market selling in pounds needs its own GBP price variant: `absolute 89` on this variant is €89.

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

### Contract prices

A negotiated B2B price — an institution's framework agreement, a chain's terms — is a **price list aimed
at that customer**, not a price variant per customer. Two properties make it work, both measured on a live
tenant:

**A percentage list applies on top of the price variant's volume tiers.** The list price for one SKU had
tiers 522 / 496 (from 10) / 470 (from 50) NOK. With a −18.0077 % list for the customer, the Catalogue API
answered 428 / 406.68 / 385.36 for `count: 1 | 10 | 50` — each tier, less the percentage.

```graphql
query ContractPrice($skus: [String!]!, $c: [String!]) {
    productVariants(skus: $skus, language: "en") {
        sku
        priceVariant(identifier: "nok") {
            price # the list price
            priceFor(count: 10, customerIdentifiers: $c) {
                price # what this customer pays for 10
                identifier # which price list applied
                modifier
                modifierType
            }
        }
    }
}
```

So keep the tiers on the variant and make the contract a **`PERCENTAGE`** list. An `ABSOLUTE` list sets a
flat price and the tiers are gone — that is the only case where "price lists have no tiers" holds.

**A list aimed at a customer reaches that customer's children.** With
`targetAudience: { type: SOME, customerIdentifiers: ["acme-university"] }`, the list resolved for a person whose
`parents` include the institution (verified: a person identifier answered the institution's contract, with
the list's identifier in `priceFor`), and for a department in between. One list per organisation is enough;
you do not need customer groups, and you do not need the customer's own price variant.

**Customer groups are a dead end here for now.** A group created with Core `createCustomerGroup` is listed
by `customerGroups`, but `createPriceList(targetAudience: { customerGroupIdentifiers })` answers
`CustomerGroupNotFoundError`, also after a wait — seen on two tenants. Target the customers directly.

### Where each API resolves a price list

This is the table to read before designing a B2B storefront, because the three APIs do not agree:

| API           | Resolves a list for                                                                  | How                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Discovery** | markets only — there is **no customer context**                                      | `<variant>PriceFor(marketIdentifiers:)`, `<variant>BestPriceListFor(…)`                                                                                     |
| **Catalogue** | customer, customer group **or** market                                               | `priceVariant(identifier) { priceFor(count, customerIdentifiers, customerGroupIdentifiers, marketIdentifiers) { price identifier modifier modifierType } }` |
| **Shop API**  | the cart's customer, plus `context.price.markets` and `context.price.customerGroups` | `hydrate` prices the lines                                                                                                                                  |

`customerIdentifiers` is a **list** (`[String!]`), not a single string.

A storefront that lists products from Discovery therefore cannot show a contract price from that query
alone: `<variant>BestPriceList` comes back `null` for a customer-targeted list, since Discovery has no idea
who is asking. Read the customer's terms from the **Catalogue API** server-side, cache them per
organisation, and apply them where you render prices. The cart then agrees by itself, because the Shop API
resolves the same list from the cart's customer.

Note that every price variant generates its own Discovery fields — `nokPrice(count)`, `nokPriceTiers`,
`nokPriceFor(marketIdentifiers, count)`, `nokBestPriceListFor(…)`, plus the filter/facet/sort field
`price_nok`. A variant with no price for a product answers `null`, so `filters: { price_x: { exists: true } }`
is a usable "is this on that price variant" filter. And because Discovery is public, anyone who knows a
field name can read any price variant it exposes: keep genuinely confidential terms out of Discovery and
read them from the Catalogue API server-side.

### Working with big lists

- **One `createPriceList` call carries a whole catalogue.** A list with 2,211 SKUs went in as a single
  `SOME_SKUS` call with a modifier per SKU; no batching needed. `updatePriceList` replaces the SKU
  selection whole, so send the complete set every time. To change part of a list, use the legacy PIM API's
  `priceList { upsertSelectedProductVariants(tenantId, identifier, variants) removeSelectedProductVariants(tenantId, identifier, variants: [sku]) }`,
  or the mass operation intents `pricelist/selectedProductVariants/upsert` and `.../remove`.
- **`productVariants(skus:)` on the Catalogue API takes at most 150 SKUs** (`TOO_MANY_SKUS_PROVIDED`), and
  `priceFor` is slow — about 2 s per 150 SKUs, and 8 s for 2,211 SKUs read five at a time. Reading the list
  itself is much faster (3.5 s for 2,211): `priceList(identifier) { productVariants(language, first) { edges
  { node { sku priceVariant(identifier) { priceList(identifier) { modifier modifierType } } } } } }`. Its
  `pageInfo.hasNextPage` stays `true` past the last SKU, so stop on an empty page.
- **`decimalPlaces` rounds the result, to 2 by default, but `0` is lost on most writes.** `createPriceList`,
  `updatePriceList` and mass operations drop a `0` and fall back to 2: `decimalPlaces: 0` with −18.05 % on 698
  NOK answered 572.01. `decimalPlaces: 1` is honoured, and the legacy PIM API keeps a `0`. Only the list-level
  entry counts, not one on a SKU. Otherwise round for display in the storefront, and set the cart's
  `context.price.decimals` per currency.

### Resolution Priority

There is no priority and no notion of the most specific list. Every list that matches competes, and **the lowest resulting price wins**. A list matches when all of these hold:

1. **Active period** — Now is between its `startDate` and `endDate`, where set
2. **Product scope** — `ALL_SKUS`, or the SKU is among its `variants`
3. **Price variant** — It has a modifier for the price variant being read
4. **Audience** — `EVERYONE`, or at least one of its markets, customers or customer groups was passed. These are OR, not AND: a list aimed at a market and a customer group matches on either

So an `EVERYONE` campaign at −30 % beats a customer's −20 % contract, and a +10 % list only applies if no other matching list is lower. The base price itself does not compete: a single matching +10 % list does raise the price.

### Best Practices

1. **Name descriptively** — Include the target context in the name: "EU B2B Q1 2025" not "Price List 3"
2. **Limit overlap** — Avoid having many price lists targeting the same market+variant combination
3. **Use periods** — Even for "permanent" adjustments, set a far-future end date so they can be reviewed
4. **Bulk select products** — Use the Nerdy view on a folder to quickly add many variants to a list
5. **Test the checkout** — Always verify the resolved price in the cart to ensure the expected list wins

### Anti-Patterns

- ❌ Creating a price list per product (use base variant prices instead)
- ❌ Using price lists for structural price differences (use separate price variants)
- ❌ A price variant per customer for B2B agreements (target a price list at the customer instead)
- ❌ Overlapping lists with conflicting adjustments on the same scope
- ❌ Forgetting to set an end date on campaign lists (they stay active forever)
