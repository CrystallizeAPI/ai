---
name: pricing
description: Design and implement pricing strategies in Crystallize using Price Variants, Price Lists, Promotions, and Markets. Use when recommending pricing structures, setting up multi-currency support, configuring B2B/B2C pricing, planning promotional campaigns, defining markets, or advising on pricing architecture for commerce projects. Also use when the user asks about currencies, multi-market setup, was/now pricing, strikethrough prices, wholesale pricing, coupon codes, discount campaigns, tiered pricing, cart discounts, tax-inclusive/exclusive pricing, or any question about how prices work in Crystallize — even if they don't explicitly mention "pricing".
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
2. Whether a price list overrides that variant (based on market, customer group, time period)
3. Whether any promotions apply (based on cart contents, coupon codes, triggers)

## Quick Start Decision Tree

```
START: You need to set up pricing.

Q1: Do you sell in a single currency with one price per product?
  → Yes → Create 1 price variant (e.g. "default" in your currency)
  → No → Continue

Q2: Do you need different price *types* (retail vs wholesale, regular vs sale)?
  → Yes → Create a price variant per type (see Price Variant Patterns below)

Q3: Do you sell in multiple currencies or regions?
  → Yes → Create Markets + Price Lists (see Markets & Price Lists below)

Q4: Do you need temporary discounts, coupon codes, or "buy X get Y" deals?
  → Yes → Set up Promotions (see Promotions below)

Q5: Do you have customer-specific pricing (B2B agreements, VIP tiers)?
  → Yes → Use Price Lists targeted to customer groups
```

## Price Variants

Price variants are **global definitions** — they define the _types_ of prices available across your entire catalogue. Every product variant can then have a value for each price variant.

### Key Concepts

- **Name**: Human-readable (e.g. "US Dollar Retail")
- **Identifier**: API-safe, lowercase (e.g. `usd-retail`)
- **Currency**: ISO 4217 code (e.g. `USD`, `EUR`, `NOK`)
- A single price variant = one currency. For multi-currency, create separate variants.

### The Default Price Variant

Every Crystallize tenant comes with a `default` price variant. It **must always exist** — it is the system's fallback and cannot be deleted.

**Best practice: Rename it to match your primary use case.**

| Business Type     | Rename `default` to             | Currency             | Rationale                         |
| ----------------- | ------------------------------- | -------------------- | --------------------------------- |
| B2C single market | `retail`                        | Your main currency   | The standard consumer price       |
| B2C multi-market  | `retail` (main market currency) | Main market currency | The primary market's retail price |
| B2B single market | `b2b` or `wholesale`            | Your main currency   | Your main B2B list price          |
| B2B + B2C         | `retail` (main market)          | Main market currency | Retail is the most common base    |

The default variant serves as the **fallback** everywhere — if no price list override or more specific variant applies, this is the price the system resolves to. So it should represent your most common, primary price type for your main market.

### Naming Conventions

Use clear, consistent names that encode **purpose** and **currency**:

| Pattern        | Example Identifier       | Example Name                     | Currency   |
| -------------- | ------------------------ | -------------------------------- | ---------- |
| Single market  | `default`                | Default                          | USD        |
| Currency-based | `usd`, `eur`, `nok`      | US Dollar, Euro, Norwegian Krone | respective |
| Purpose-based  | `retail`, `sales`, `b2b` | Retail, Sales, B2B               | same       |
| Combined       | `usd-retail`, `eur-b2b`  | USD Retail, EUR B2B              | respective |

### Recommended Patterns by Business Type

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

**Key rule:** Retail is always set. Sales is only set when the product is on sale. The storefront checks: if Sales exists and is lower than Retail → show strikethrough. Otherwise → show Retail as the current price.

#### B2C Per-Market (the most typical B2C pattern)

```
Price Variants:
  ├── retail (USD)  — US retail (the default variant, renamed)
  ├── sales (USD)   — US sales / marked-down price
  ├── retail-eur (EUR) — EU retail
  ├── sales-eur (EUR)  — EU sales
  ├── retail-gbp (GBP) — UK retail
  └── sales-gbp (GBP)  — UK sales
```

**When:** Multi-market B2C with was/now pricing per market. Each market gets a Retail + Sales pair. The default variant is renamed to `retail` for the primary market. Secondary markets use `retail-{currency}` / `sales-{currency}` suffixes.

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
  ├── retail (USD)      — US consumer price (default, renamed)
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
2. **Leaving "default" named as "default"** — Always rename it to reflect its purpose (e.g. `retail` for B2C, `b2b` for B2B). The name "default" tells nobody what the price represents.
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
- **Be scoped to**: a market, customer group, or individual customer

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
  ├── "Wholesale Tier 1" — 15% off B2B variant, Customer Group: Tier 1
  ├── "Wholesale Tier 2" — 25% off B2B variant, Customer Group: Tier 2
  └── "Acme Corp Agreement" — Fixed prices, Customer: Acme Corp
```

#### Seasonal Campaigns

```
Price Lists:
  ├── "Summer Sale EU" — 20% off retail, Market: EU, Period: Jun–Aug
  └── "Black Friday Global" — Specific prices, Period: Nov 25–28
```

## Markets

Markets define selling contexts. They group together the rules for who gets which prices, promotions, and configurations.

### What Markets Represent

A market can be:

- A **country** (Norway, Sweden, Germany)
- A **region** (EU, Nordics, North America)
- A **segment** (Norway B2B, Norway Retail)
- A **channel** (Online, In-Store, Marketplace)

### Market Setup Recommendations

#### Simple: One Market

```
Markets:
  └── "default" — Your only selling context
```

#### Multi-Region

```
Markets:
  ├── "us" — United States
  ├── "eu" — European Union
  ├── "uk" — United Kingdom
  └── "row" — Rest of World (fallback)
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

Markets are set in the **checkout context** — at cart/checkout time, the active market determines which price lists and promotions are evaluated.

## Promotions

Promotions apply at the **cart level** — they only become visible during checkout, not on product pages. This keeps your base pricing clean while enabling flexible campaigns.

### Promotion Mechanisms

| Mechanism      | Description       | Example                   |
| -------------- | ----------------- | ------------------------- |
| **Percentage** | % off the price   | "20% off all shoes"       |
| **Fixed**      | Flat amount off   | "$10 off orders over $50" |
| **X for Y**    | Buy X, pay for Y  | "Buy 3, pay for 2"        |
| **Cart**       | Reduce cart total | "$20 off the entire cart" |

### Promotion Components

1. **Mechanism** — How the discount is calculated (percentage, fixed, X-for-Y, cart)
2. **Period** (optional) — When the promotion is active (start/end dates, can recur)
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

## Tax & Pricing

Prices in Crystallize are stored as raw numbers — the system does not enforce whether they are tax-inclusive or tax-exclusive. This is a business decision:

- **B2C (most of Europe, Australia):** Prices typically include VAT. Store gross prices in your variants.
- **B2B / US B2C:** Prices are typically tax-exclusive. Store net prices and calculate tax at checkout.
- **Mixed:** Use price variants or price lists to maintain both. For example, EU retail variants hold gross prices while US retail variants hold net prices.

Tax calculation itself happens at the checkout/order layer — configure tax rates in your checkout flow or use an external tax service. The pricing hierarchy (variants → price lists → promotions) resolves the price; tax is applied on top of (or extracted from) that resolved price.

## Migration Paths

Start simple and add layers as your business requires. Here are common upgrade paths:

### Single variant → Sales pricing

```
Before: default (USD)
After:  retail (USD) + sales (USD)
```

Rename `default` to `retail`. Create a new `sales` variant in the same currency. Only set `sales` on products that are currently on sale.

### Single currency → Multi-currency

```
Before: retail (USD) + sales (USD)
After:  retail (USD) + sales (USD) + retail-eur (EUR) + sales-eur (EUR)
```

Keep your primary market variants as-is. Add new variant pairs for each additional currency. Create Markets for each region and Price Lists if you need regional adjustments beyond the base variant prices.

### B2C only → B2C + B2B

```
Before: retail (USD) + sales (USD)
After:  retail (USD) + sales (USD) + b2b (USD)
```

Add a `b2b` variant. Create a Market for B2B customers (e.g. `us-b2b`). Use Price Lists for customer-specific or tiered B2B pricing.

### Static pricing → Campaigns

```
Before: Price variants only
After:  Price variants + Promotions
```

Keep your variant structure unchanged. Add Promotions for time-limited, cart-level discounts (coupons, buy-X-get-Y, seasonal sales). If you need persistent regional adjustments, add Price Lists instead of (or alongside) Promotions.

## Further Reading

- [Price Variants Reference](references/price-variants.md) — Detailed technical reference for variant setup
- [Price Lists & Markets Reference](references/price-lists-and-markets.md) — Price list configuration and market architecture
- [Promotions Reference](references/promotions.md) — Promotion types, mechanisms, and limitations
