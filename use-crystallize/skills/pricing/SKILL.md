---
name: pricing
description: Design and implement pricing strategies in Crystallize using Price Variants, Price Lists, Promotions, and Markets. Use when recommending pricing structures, setting up multi-currency support, configuring B2B/B2C pricing, planning promotional campaigns, defining markets, or advising on pricing architecture for commerce projects. Also use when the user asks about currencies, multi-market setup, was/now pricing, strikethrough prices, wholesale pricing, contract prices, coupon codes, discount campaigns, tiered or volume pricing, cart discounts, tax-inclusive/exclusive pricing, or any question about how prices work in Crystallize — even if they don't explicitly mention "pricing".
metadata:
    author: Crystallize
    version: "2.0"
---

# Crystallize Pricing Skill

Design, recommend, and implement pricing strategies in Crystallize. This skill covers the full pricing hierarchy — from global price variants through localized price lists to cart-level promotions — and helps you make sound architectural decisions about how to structure pricing for any commerce use case.

## The Pricing Hierarchy

Crystallize resolves prices through a layered hierarchy. Each layer can override or adjust the one above it:

```
┌─────────────────────────────────────────────────┐
│  1. Price Variants (base layer)                 │
│     Global price types applied to all products  │
│     e.g. Retail, Sales, B2B, Members            │
├─────────────────────────────────────────────────┤
│  2. Price Lists (override layer)                │
│     Market/customer-specific adjustments        │
│     e.g. "EU Retail EUR", "US B2B USD"          │
├─────────────────────────────────────────────────┤
│  3. Promotions (cart layer)                     │
│     Checkout-time discounts and campaigns       │
│     e.g. "20% off", "Buy 3 pay for 2"          │
└─────────────────────────────────────────────────┘
```

**Resolution order:** When a customer checks out, the system evaluates:

1. Which price variant applies (based on context)
2. Whether a price list overrides that variant (based on market, customer, customer group, time period). When several match, the lowest price wins
3. Whether any promotions apply (based on cart contents, coupon codes, triggers)

## Which price, from which API, for whom

Read this before building a storefront. The three read APIs resolve price lists for different audiences,
and only one of them knows the customer in the cart:

| Price                            | API                                | Call                                                                                                            | Where                      |
| -------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------- |
| List, sale and "from" price      | Discovery                          | `<variant>Price`, the `priceVariants` hash, `variantGroups.summary.price`                                       | Server, cached             |
| Market price (public)            | Discovery: **markets only**        | `<variant>PriceFor(marketIdentifiers)`, `<variant>BestPriceListFor(marketIdentifiers)`, for the SKUs on screen  | Server, cached             |
| Contract price for display (B2B) | Shop API price check, or Catalogue | A throw-away `hydrate` with the customer; or Catalogue `priceFor(customerIdentifiers)` for **any** customer     | **Server**, cached per org |
| What the cart charges            | Shop API `/cart`                   | `hydrate` resolves the **cart's customer** (and its parents), plus `context.price.markets` and `customerGroups` | Server action              |

- **Discovery has no customer argument anywhere.** `<variant>BestPriceList` answers `null` for a list aimed
  at a customer, because Discovery does not know who is asking. Never use it for a contract price.
- **Discovery is open by default, and when open, everything it serves is public**: every price variant and,
  to anyone who knows a market's identifier, that market's price list. A "market per agreement" makes the
  agreement readable without a token, so keep confidential terms out of it.
- **The Shop API and the Catalogue resolve the same list**, so a contract price shown from either agrees
  with the cart. The Shop API resolves only the cart's customer; the Catalogue resolves any customer, which
  is what a seller tool or a cached per-organisation price table needs.
- Core is never on this path. For the storefront as a whole, see [[storefront]]; for the tables behind each
  row, see [references/price-lists-and-markets.md](references/price-lists-and-markets.md), "Where each API
  resolves a price list".

## Quick Start Decision Tree

```
START: You need to set up pricing.

Q1: Do you sell in a single currency with one price per product?
  → Yes → Use the built-in "default" price variant, in your currency
  → No → Continue

Q2: Do you need different price *types* (retail vs wholesale, regular vs sale)?
  → Yes → Create a price variant per type (see Price Variant Patterns below)

Q3: Do you sell in multiple currencies or regions?
  → Multiple currencies → Create a price variant per currency: a price list cannot change the currency
  → Regional adjustments → Create Markets + Price Lists (see Markets & Price Lists below)

Q4: Do you need temporary discounts, coupon codes, or "buy X get Y" deals?
  → Yes → Set up Promotions (see Promotions below)

Q5: Do you have customer-specific pricing (B2B agreements, VIP tiers)?
  → Yes → Use Price Lists targeted at the customer (see Contract prices below)
```

**A negotiated price is a price list, not a price variant.** Price variants are price _types_ — list,
recommended, wholesale, one per currency — shared by the whole catalogue. Modelling one per customer looks
tempting for B2B and then collapses: every new account needs a new variant on every product, and the
storefront has to know which variant to ask for. Put the agreement in a price list aimed at that customer
instead, and keep the tiers on the underlying variant. See
[references/price-lists-and-markets.md](references/price-lists-and-markets.md), "Contract prices".

## Price Variants

Price variants are **global definitions** — they define the _types_ of prices available across your entire catalogue. Every product variant can then have a value for each price variant.

### Key Concepts

- **Name**: Human-readable (e.g. "US Dollar Retail")
- **Identifier**: API-safe, lowercase (e.g. `usd-retail`)
- **Currency**: ISO 4217 code (e.g. `USD`, `EUR`, `NOK`)
- A single price variant = one currency. For multi-currency, create separate variants.

### The Default Price Variant

Every Crystallize tenant comes with a `default` price variant. It **must always exist** — it cannot be deleted.

**Best practice: give it a display name that matches your primary use case.** The identifier stays `default` for good: `updatePriceVariant` takes `name`, `currency` and `tierConfig` and no identifier, and `deletePriceVariant` refuses `default`. So do not plan a `retail` identifier for it; every API call keeps saying `default`. Set its `currency` too: it is created without one and answers the tenant's default currency (EUR on a fresh tenant). Make `default` your primary currency's price rather than adding a `nok` variant next to it, or you carry two copies of the same price.

| Business Type     | Name `default`         | Currency             | Rationale                         |
| ----------------- | ---------------------- | -------------------- | --------------------------------- |
| B2C single market | "Retail"               | Your main currency   | The standard consumer price       |
| B2C multi-market  | "Retail" (main market) | Main market currency | The primary market's retail price |
| B2B single market | "B2B" or "Wholesale"   | Your main currency   | Your main B2B list price          |
| B2B + B2C         | "Retail" (main market) | Main market currency | Retail is the most common base    |

`default` is what a cart selects when `selectedVariantIdentifier` is not sent, and what the Catalogue API's `price` answers without an identifier. So it should represent your most common, primary price type for your main market. It is **not** a fallback for a missing price: see [Pricing a Cart](#pricing-a-cart).

### Naming Conventions

Use clear, consistent names that encode **purpose** and **currency**:

| Pattern        | Example Identifier       | Example Name                     | Currency   |
| -------------- | ------------------------ | -------------------------------- | ---------- |
| Single market  | `default`                | Default                          | USD        |
| Currency-based | `usd`, `eur`, `nok`      | US Dollar, Euro, Norwegian Krone | respective |
| Purpose-based  | `retail`, `sales`, `b2b` | Retail, Sales, B2B               | same       |
| Combined       | `usd-retail`, `eur-b2b`  | USD Retail, EUR B2B              | respective |

### Recommended Patterns by Business Type

In the patterns below, `retail` stands for the primary price type. That is either the `default` variant named "Retail", in which case every API call still says `default`, or a `retail` variant you created alongside it.

#### Simple B2C (single market)

```
Price Variants:
  └── default (USD) — The only price, used everywhere
```

**When:** Single-country store, one currency, no B2B. Start here and add complexity later.

#### B2C with Sales Pricing (single market)

```
Price Variants:
  ├── retail (USD) — The standard price / compare-at price ("was" price)
  └── sales (USD)  — The marked-down selling price ("now" price)
```

**When:** You show was/now or strikethrough pricing. **Retail** is the reference price — the "compare at" price displayed crossed out. **Sales** is the actual selling price. When no sale is active, the storefront falls back to the Retail price (Sales is left empty or equal to Retail).

**Key rule:** Retail is always set. Sales is only set when the product is on sale. The storefront checks: if Sales exists and is lower than Retail → show strikethrough. Otherwise → show Retail as the current price. The cart needs the same rule spelled out in its context: see [Pricing a Cart](#pricing-a-cart).

#### B2C Per-Market (the most typical B2C pattern)

```
Price Variants:
  ├── retail (USD)  — US retail (the default variant, named "Retail")
  ├── sales (USD)   — US sales / marked-down price
  ├── retail-eur (EUR) — EU retail
  ├── sales-eur (EUR)  — EU sales
  ├── retail-gbp (GBP) — UK retail
  └── sales-gbp (GBP)  — UK sales
```

**When:** Multi-market B2C with was/now pricing per market. Each market gets a Retail + Sales pair. The default variant, named "Retail", serves the primary market. Secondary markets use `retail-{currency}` / `sales-{currency}` suffixes.

**Resolution per market:**

- Primary market (US): Check `sales` → fall back to `retail`
- EU market: Check `sales-eur` → fall back to `retail-eur`
- UK market: Check `sales-gbp` → fall back to `retail-gbp`

Price Lists can further override any of these per market.

#### B2C Multi-Currency (no sales pricing)

```
Price Variants:
  ├── usd (USD) — US market price
  ├── eur (EUR) — European market price
  └── gbp (GBP) — UK market price
```

**When:** You sell internationally with manually set prices per currency but don't show was/now pricing. Simpler than the retail/sales pattern.

#### B2C + B2B (single currency)

```
Price Variants:
  ├── retail (USD) — Consumer price / compare-at reference
  ├── sales (USD)  — Consumer sale price (when on sale)
  └── b2b (USD)    — Wholesale/business price
```

**When:** You serve both consumers and business customers in the same currency. B2B customers typically don't see sales pricing — they have fixed contract rates.

#### B2C + B2B Multi-Currency

```
Price Variants:
  ├── retail (USD)      — US consumer price (default, named "Retail")
  ├── sales (USD)       — US consumer sale price
  ├── b2b (USD)         — US wholesale price
  ├── retail-eur (EUR)  — EU consumer price
  ├── sales-eur (EUR)   — EU consumer sale price
  ├── b2b-eur (EUR)     — EU wholesale price
  └── ...per additional market
```

**When:** International B2B+B2C. Each market gets a retail/sales pair for consumers plus a B2B variant. The most complex but most flexible setup.

#### Membership / Loyalty Tiers

```
Price Variants:
  ├── retail (USD) — Standard consumer price
  ├── members (USD) — Loyalty program price
  └── vip (USD) — Top-tier customer price
```

**When:** You have tiered customer programmes. Often combined with Price Lists for more granular control.

### How Many Price Variants?

**Guidelines:**

- **Start minimal** — You can always add more. Begin with 1–2 and expand when the business requires it.
- **Avoid explosion** — 10+ variants is a warning sign. Use Price Lists for market-specific overrides instead.
- **One per purpose × currency** — If you have 3 currencies and 2 purposes (retail + B2B), that's 6 variants.
- **Don't duplicate what Price Lists do** — Price variants are for structurally different price _types_. Regional adjustments belong in Price Lists.

| Business Complexity       | Typical Count | Variants                   |
| ------------------------- | ------------- | -------------------------- |
| Simple single-market      | 1             | `default`                  |
| B2C with sales pricing    | 2             | `retail` + `sales`         |
| Multi-currency B2C        | 2–5           | One per currency           |
| B2C + B2B single currency | 2–3           | `retail` + `sales` + `b2b` |
| Enterprise multi-market   | 4–8           | Purpose × currency         |

### Common Mistakes

1. **Creating a variant per country** — Use Price Lists for regional adjustments instead
2. **Leaving "default" named as "default"** — Always set its display name to reflect its purpose (e.g. "Retail" for B2C, "B2B" for B2B). The name "default" tells nobody what the price represents.
3. **Confusing retail and sales** — Retail is the reference/compare-at price (always set). Sales is the marked-down price (only set during a sale). The storefront falls back to Retail when Sales is empty.
4. **Using promotions when you need persistent sales pricing** — Promotions are for cart-level, time-limited campaigns. If you always show a was/now price on the product page, use a `sales` price variant instead.
5. **Inconsistent naming** — Pick a convention (`{purpose}-{currency}` or `{purpose}`) and stick with it across all variants
6. **No currency suffix for secondary markets** — When multi-currency, primary market variants can be just `retail`/`sales`, but secondary markets should include a currency suffix: `retail-eur`, `sales-eur`
7. **Too many variants** — 10+ variants is a red flag. Use Price Lists for customer-specific or regional fine-tuning instead of creating more variants

## Price Lists

Price lists override or adjust prices for specific contexts. They sit between variants and promotions in the hierarchy.

### When to Use Price Lists (not Price Variants)

| Scenario                               | Use Price Variant? | Use Price List? |
| -------------------------------------- | ------------------ | --------------- |
| USD vs EUR base prices                 | ✅ Yes             | No              |
| B2B vs Retail price type               | ✅ Yes             | No              |
| "Norway gets 10% less than global EUR" | No                 | ✅ Yes          |
| "VIP customers get special prices"     | No                 | ✅ Yes          |
| "Black Friday EU pricing"              | No                 | ✅ Yes          |
| "Wholesale customer X negotiated rate" | No                 | ✅ Yes          |

### Price List Configuration

Each price list can:

- **Target specific price variants** (e.g. only adjust B2B prices)
- **Apply to all or specific products** (by drag-and-drop or bulk selection)
- **Adjust by**: percentage, relative value, or absolute price
- **Have a time period**: start/end dates for seasonal campaigns
- **Be scoped to**: everyone, a market, or individual customers (organisations reach their people). Customer groups are accepted by the input but do not work today: see below

### Recommended Price List Patterns

#### Regional Adjustments

```
Price Lists:
  ├── "EU Retail" — Applies to: eur-retail variant, Market: EU
  ├── "US Retail" — Applies to: usd-retail variant, Market: US
  └── "Nordic B2B" — Applies to: eur-b2b variant, Market: Nordics
```

#### Customer-Specific B2B

```
Price Lists:
  ├── "Wholesale Tier 1" — 15% off B2B variant, Market: wholesale-tier-1
  ├── "Wholesale Tier 2" — 25% off B2B variant, Market: wholesale-tier-2
  └── "Acme Corp Agreement" — 12% off B2B variant, Customer: acme-corp (the organisation)
```

Tiers are markets because price lists **cannot target customer groups**: `createPriceList` answers `CustomerGroupNotFoundError` (or `NotFoundError`) for a group that exists, seen on four tenants. The storefront then sends the tier's market in `context.price.markets`; a market's `customerIdentifiers` do not put a customer's cart in it. A tier market is public in Discovery, so it suits published tiers, not confidential terms. Keep an agreement a `PERCENTAGE` list so the variant's volume tiers survive, and send the whole SKU set on every `updatePriceList`: see [references/price-lists-and-markets.md](references/price-lists-and-markets.md), "Price lists that work".

#### Seasonal Campaigns

```
Price Lists:
  ├── "Summer Sale EU" — 20% off retail, Market: EU, Period: Jun–Aug
  └── "Black Friday Global" — Specific prices, Period: Nov 25–28
```

## Markets

Markets define selling contexts. They group together the rules for who gets which prices, promotions, and configurations. A market is only a name and an identifier: it holds no currency, tax or price of its own, and a price list cannot change the currency of the price variant it adjusts.

### What Markets Represent

A market can be:

- A **country** (Norway, Sweden, Germany)
- A **region** (EU, Nordics, North America)
- A **segment** (Norway B2B, Norway Retail)
- A **channel** (Online, In-Store, Marketplace)

### Market Setup Recommendations

#### Simple: No Market

A tenant starts with no markets, and a single selling context needs none: a cart's `markets` defaults to `[]`, and a price list aimed at `EVERYONE` applies regardless.

#### Multi-Region

```
Markets:
  ├── "us" — United States
  ├── "eu" — European Union
  ├── "uk" — United Kingdom
  └── "row" — Rest of World (there is no automatic fallback: the storefront sends it)
```

#### B2B + B2C per Region

```
Markets:
  ├── "eu-retail" — EU consumers
  ├── "eu-b2b" — EU businesses
  ├── "us-retail" — US consumers
  └── "us-b2b" — US businesses
```

### How Markets Connect to Pricing

```
Market ──→ Price Lists (which prices apply)
       ──→ Promotions (which campaigns apply)
       ──→ Checkout context (resolved at purchase time)
```

Markets are set in the **checkout context** — at cart/checkout time, `context.price.markets` determines which price lists and promotions are evaluated.

## Promotions

Promotions apply at the **cart level** — they only become visible during checkout, not on product pages. This keeps your base pricing clean while enabling flexible campaigns. They are managed in the app under Special prices, or through the Shop API's `cart/admin` endpoint: see [references/promotions.md](references/promotions.md).

### Promotion Mechanisms

The app and the API use different names. "Fixed" means a different thing in each:

| In the app     | API `mechanism.type` | What `value` is                                 | Example                                       |
| -------------- | -------------------- | ----------------------------------------------- | --------------------------------------------- |
| **Percentage** | `Percentage`         | % off the price                                 | "20% off all shoes"                           |
| **Cart**       | `Fixed`              | Amount off, spread across the targeted lines    | "$10 off orders over $50", "$20 off the cart" |
| **Fixed**      | `DynamicFixed`       | New unit price, applied when lower than current | "All T-shirts at $15"                         |
| **X for Y**    | `XforY`              | `0`: X and Y go in `triggers.xForY`             | "Buy 3, pay for 2"                            |

### Promotion Components

1. **Mechanism** — How the discount is calculated (see above)
2. **Period** (optional) — When the promotion is active (one or more start/end windows)
3. **Trigger** (optional) — What activates it (e.g. "3 items of product X in cart")
4. **Target** (optional) — Which products are affected (if empty, applies to all)
5. **Limitations** — Cumulative rules, max usage, per-customer limits

### When to Use Promotions vs Price Lists

| Scenario                     | Promotions | Price Lists             |
| ---------------------------- | ---------- | ----------------------- |
| Time-limited discounts       | ✅         | Possible but less ideal |
| Coupon codes                 | ✅         | ❌                      |
| "Buy X get Y" deals          | ✅         | ❌                      |
| Permanent regional pricing   | ❌         | ✅                      |
| Customer-specific agreements | ❌         | ✅                      |
| Free shipping thresholds     | ✅         | ❌                      |

## Consultation Approach

When advising on pricing setup, ask these discovery questions:

### Discovery Questions

1. **Business Model**
    - "Is this B2C, B2B, or both?"
    - "Do you have tiered pricing for different customer groups?"

2. **Geographic Scope**
    - "Which markets/countries do you sell to?"
    - "Do you need separate currencies, or do you use a single currency?"
    - "Are prices manually set per region, or derived from a base price?"

3. **Sales Strategy**
    - "Do you run sales or show 'was/now' pricing?"
    - "Do you use coupon codes or promotional campaigns?"
    - "Do you have seasonal pricing patterns?"

4. **Customer Relationships**
    - "Do you have wholesale/B2B customers with negotiated rates?"
    - "Do you have a loyalty or membership programme?"
    - "Do individual customers have unique pricing agreements?"

5. **Complexity Assessment**
    - "How many products are in your catalogue?"
    - "How often do prices change?"
    - "Who manages pricing? (technical team vs merchandisers)"

### Response Framework

After discovery, structure your recommendation as:

1. **Price Variants** — The base layer: how many, naming, currencies
2. **Markets** — If multi-region: how to segment
3. **Price Lists** — Regional/customer overrides (if needed)
4. **Promotions** — Campaign strategy (if needed)
5. **Migration path** — Start simple, grow into complexity

Always recommend starting with the minimum viable setup and adding layers as the business requires them.

## Pricing a Cart

The Shop API `hydrate` mutation prices a cart from `input.context.price`. The storefront sends it on **every** hydrate: an omitted field goes back to its default, it does not keep the previous value.

| Input                                               | Default   | Effect                                                                                                                      |
| --------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `customer` on the cart (`hydrate` or `setCustomer`) | guest     | Customer-targeted price lists, **inherited from parent customers**: a person under an organisation gets its list            |
| `selectedVariantIdentifier`                         | `default` | The price variant that sets the price                                                                                       |
| `fallbackVariantIdentifiers`                        | none      | Tried in order when the selected variant has no price for the SKU: `campaign` then `default` prices campaign-or-list        |
| `compareAtVariantIdentifier`                        | none      | The "was" price (or the RRP next to a B2B price), read before price lists. A gap to the selected price lands in `discounts` |
| `markets`                                           | `[]`      | Which market-targeted price lists and promotions can match. Not read from the market's `customerIdentifiers`                |
| `customerGroups`                                    | `[]`      | The same for groups. Not read from the customer record                                                                      |
| `voucherCodes`                                      | `[]`      | A list of coupon codes. `voucherCode` is deprecated. Check one with `validateVoucher(voucher)`                              |
| `currency`                                          | `eur`     | A label, and what `triggers.currencies` tests. It selects no variant and converts nothing                                   |
| `decimals`                                          | `0`       | Rounds every amount returned. **Left at 0, 39.99 comes back as 40.** Send `4`, see below                                    |
| `pricesHaveTaxesIncludedInCrystallize`              | `false`   | Whether the stored price is gross, see below                                                                                |
| `taxRate`                                           | none      | A **fraction** (`0.25`, not `25`), overrides the product's tax group                                                        |
| `discountOnNetPrices`                               | `false`   | Promotions and `minValue` work on net instead of gross                                                                      |

A SKU with no value on the selected variant or on any fallback silently takes its **first** price variant, possibly in another currency, and a variant with no price at all hydrates at 0, not as an error.

- **`compareAtVariantIdentifier` falls back too.** When the SKU has no value on the compare-at variant, the cart compares with its first variant: a $64 line without a `usd-before` price reported a 1,172 "discount" (90 %) against the NOK price. Send it only for SKUs that have a before-price.
- **Ask for `decimals: 4` and round for display only, half up.** With 2 decimals, a percentage list on a small unit price drifts a cent between the cart and the product page. The Shop API rounds half up (11.70 × 0.85 = 9.945 → 9.95), while `Math.round(x * 100) / 100` gives 9.94: round via `toFixed(4)` first.
- **A cart line's `price` is the line total**, while order lines carry the unit price. Divide before you compare with a product page.
- **A PERCENTAGE list must carry every price variant the cart can select.** With `campaign` selected and `default` as fallback, a list with a modifier on `default` only leaves campaign-priced SKUs at full price.

Was/now in a cart:

```graphql
context: {
    price: {
        selectedVariantIdentifier: "sales"
        fallbackVariantIdentifiers: ["default"]
        compareAtVariantIdentifier: "default"
        currency: "USD"
        decimals: 4
        markets: ["us-retail"]
    }
}
```

**A contract price for display without the Catalogue API** is a throw-away `hydrate` on the server: a cart with the signed-in customer and the SKUs on screen, read once, cached per organisation, then `remove(id)`. It answers what the real cart will charge.

## Tax & Pricing

Prices in Crystallize are stored as raw numbers — the system does not enforce whether they are tax-inclusive or tax-exclusive. This is a business decision:

- **B2C (most of Europe, Australia):** Prices typically include VAT. Store gross prices in your variants, and hydrate with `pricesHaveTaxesIncludedInCrystallize: true`.
- **B2B / US B2C:** Prices are typically tax-exclusive. Store net prices and leave it at `false`, so that gross = price × (1 + rate).
- **Mixed:** Use price variants or price lists to maintain both. For example, EU retail variants hold gross prices while US retail variants hold net prices.

The Shop API calculates the tax. The rate is the first of: `taxRate` on the cart item, `context.price.taxRate` (both 0–1), the percentage of the product's tax group. To use an external tax service, pass its rate as `taxRate`. The pricing hierarchy (variants → price lists → promotions) resolves the price; tax is applied on top of (or extracted from) that resolved price.

## Migration Paths

Start simple and add layers as the business requires them:

| From → to                   | Add                                                                       | Keep                                                       |
| --------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| One variant → sales pricing | A `sales` variant in the same currency, set only on products on sale      | `default`, with the display name "Retail"                  |
| One currency → several      | A `retail-{currency}` / `sales-{currency}` pair per currency, and markets | The primary market's variants as they are                  |
| B2C → B2C + B2B             | A `b2b` variant, a B2B market, price lists per organisation or tier       | The consumer variants                                      |
| Static pricing → campaigns  | Promotions for time-limited cart discounts                                | The variant structure; price lists for lasting adjustments |

## Further Reading

- [Price Variants Reference](references/price-variants.md) — Detailed technical reference for variant setup, reading prices, and volume tiers
- [Price Lists & Markets Reference](references/price-lists-and-markets.md) — Price list configuration and market architecture
- [Promotions Reference](references/promotions.md) — Promotion types, mechanisms, limitations, and the admin API
