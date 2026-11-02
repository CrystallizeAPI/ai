# Promotions Reference

Promotions are the final layer in the Crystallize pricing hierarchy. They apply at the **cart level** — they only become visible during checkout, not on product pages. This keeps your base catalogue pricing clean while enabling flexible campaign mechanics.

## How Promotions Work

Unlike price variants and price lists (which set product-level prices), promotions evaluate **cart contents** at checkout time and apply discounts or adjustments based on rules you define.

```
Customer browses    →  Sees base price (from variant + applicable price list)
Customer adds items →  Cart is hydrated
Cart is evaluated   →  Promotions engine checks triggers, targets, limitations
Checkout displays   →  Adjusted prices with promotion applied
```

## Promotion Components

Every promotion is built from these parts:

### 1. Mechanism (required)

How the discount is calculated. The app and the API name these differently, and "Fixed" is a different mechanism in each:

| In the app     | API `mechanism.type` | `value`                                  | Use Case                                                  |
| -------------- | -------------------- | ---------------------------------------- | --------------------------------------------------------- |
| **Percentage** | `Percentage`         | % off the line price                     | "20% off all shoes"                                       |
| **Cart**       | `Fixed`              | Amount off, spread across targeted lines | "$10 off when you spend $50+", "$20 off the entire order" |
| **Fixed**      | `DynamicFixed`       | New unit price, applied when lower       | "All T-shirts at $15"                                     |
| **X for Y**    | `XforY`              | `0`, with `triggers.xForY: [x, y]`       | "Buy 3, pay for 2" (cheapest items are free)              |

`XforY` refuses `targets`: its `triggers` choose the items. A cart discount is simply `Fixed` with no `targets`. The amount of `Fixed` and `DynamicFixed` has no currency of its own, so on a multi-currency tenant restrict them with `triggers.currencies`, or 10 comes off in every currency.

### 2. Period (optional)

When the promotion is active:

- **Start date** — When the promotion begins
- **End date** — When it expires
- **Multiple periods** — For recurring campaigns (e.g. every December). There is no recurrence rule: list each window, each with both `start` and `end`
- **No period** — Active immediately and indefinitely. An empty `periods: []` is different: the promotion never runs

### 3. Trigger (optional)

What conditions must be met for the promotion to activate:

- **Product-based** — "3 of product X in the cart" (`skus`, `productIds`, `paths`, `topics`)
- **Quantity-based** — "At least 5 items total" (`minQuantity`)
- **Value-based** — "Cart total above $100" (`minValue`, on gross unless `discountOnNetPrices`)
- **Coupon code** — "Enter SUMMER20 at checkout" (`codes`, exact match against `context.price.voucherCodes`)
- **Audience** — `markets`, `currencies`, `customers` (identifier or email), `customerGroups` (matched against `context.price.customerGroups`, not the customer record)
- **Exclusions** — `exclusions` takes the same lists, to carve out SKUs, markets, customers or groups
- **No trigger** — Applies to every cart automatically

Different kinds of trigger combine with AND, and values inside one kind with OR. Inside the product lists it is OR too: `skus: ["A", "B"]` means A or B, and "A and B both in the cart" cannot be expressed. `minQuantity` and `minValue` count only the lines matching the product lists, or all lines when there are none. `paths` and `topics` match by prefix, so a folder path covers what is under it.

### 4. Target (optional)

Which product variants the promotion affects:

- **Specific products** — Only these are discounted: `skus`, `productIds`, `paths`, `topics`, with `exclusions` to carve some out
- **All products** — Entire catalogue
- **No target** — Same as all products

**Note:** Trigger and target can be the same ("Buy 2 of X, get 1 of X free") or different ("Buy shoes, get 50% off socks").

### 5. Limitations

Control how the promotion behaves:

| Limitation               | API field             | Description                                 | Example                                  |
| ------------------------ | --------------------- | ------------------------------------------- | ---------------------------------------- |
| **Cumulative**           | `cumulativeDiscount`  | Can combine with other discounts?           | Yes/No                                   |
| **Combine with**         | `canBeCombinedWith`   | Specific promotions it can stack with       | Only with "Free Shipping"                |
| **Repeatable**           | `repeatable`          | Applies per qualifying set or once per cart | "Buy 3 pay 2" repeats for every set of 3 |
| **Max usage**            | `maxUsage`            | Total uses across the whole tenant          | The first 500 orders                     |
| **Max per customer**     | `maxUsagePerCustomer` | Times each customer can use it              | 1 per customer lifetime                  |
| **Quantity per trigger** | `quantityPerTrigger`  | Items discounted per trigger match          | Discount 1 item per trigger              |

What these do in a cart, beyond their names:

- **Not cumulative** (the default): `Fixed`, `DynamicFixed` and `XforY` skip a line that already has a discount, and `Percentage` replaces that discount only if its own percentage is higher. A sale price counts: a line whose `compareAtVariantIdentifier` is above its selected price already carries a discount.
- **`canBeCombinedWith`** is read when the promotion is reached, in stored order: it is dropped unless every promotion accepted so far is in its list. It is one-way: a promotion reached later, with no list of its own, still joins. Omitted means no restriction.
- **`maxUsage` and `maxUsagePerCustomer`** count once per promotion when a cart is **placed**, not when it is paid, across all carts of the tenant. The app's "per cart" tooltip is wrong. A customer is the cart's `customer.identifier`, else its email.
- **`maxUsagePerCustomer` needs a customer**: an anonymous cart never gets that promotion. With both limits set, a customer still under their own limit keeps getting it after `maxUsage` is reached.
- **`quantityPerTrigger`** picks the cheapest lines first for `Percentage` and `DynamicFixed`, and the most expensive first for `Fixed`.

## Common Promotion Patterns

### Simple Sitewide Sale

```
Mechanism: Percentage — 20% off
Period: Black Friday weekend (Nov 25–28)
Trigger: None (automatic)
Target: All products
Limitations: Not cumulative
```

### Coupon Code

```
Mechanism: Percentage — 15% off
Period: None (always active)
Trigger: Coupon code "WELCOME15"
Target: All products
Limitations: Max 1 per customer
```

### Buy X Get Y Free

```
Mechanism: X for Y — Buy 3, pay for 2 (type XforY, value 0, triggers.xForY: [3, 2])
Period: None
Trigger: 3 items of any product in cart
Target: None, it cannot have one (cheapest item is free)
Limitations: Repeatable (every 3 items), cumulative
```

### Free Shipping Threshold

The cart has no shipping concept of its own. Shipping is an `externalItems` line you add with `type: shipping`, which a promotion can target by SKU:

```
Mechanism: Percentage — 100% off
Period: None
Trigger: Cart total ≥ $75, with the shipping SKU in exclusions.skus so it does not count
Target: The SKU of the shipping line
Limitations: Cumulative (can combine with product discounts)
```

### Members-Only Discount

```
Mechanism: Percentage — 10% off
Period: None
Trigger: customerGroups: ["members"], which the storefront must send in context.price.customerGroups
Target: All products
Limitations: Cumulative, no max usage
```

### Bundle Discount

There is no "A AND B" trigger. The closest is either product plus a minimum quantity, which two of A also satisfies:

```
Mechanism: Cart — $15 off (type Fixed, value 15)
Period: Summer campaign (Jun 1 – Aug 31)
Trigger: skus: [A, B] with minQuantity: 2
Target: None, so the amount spreads over the whole cart
Limitations: None needed: a promotion applies once per cart unless repeatable
```

## Promotions vs Price Lists vs Price Variants

| Feature             | Price Variants            | Price Lists                         | Promotions             |
| ------------------- | ------------------------- | ----------------------------------- | ---------------------- |
| Scope               | Global / all products     | Product or market specific          | Cart level             |
| Visibility          | Always (on product pages) | Always (resolved at query/checkout) | Only in cart/checkout  |
| Time-limited        | No                        | Yes (via period)                    | Yes (via period)       |
| Conditions          | None                      | Market / customer                   | Cart contents, coupons |
| Coupon codes        | ❌                        | ❌                                  | ✅                     |
| Buy X Get Y         | ❌                        | ❌                                  | ✅                     |
| Per-customer limits | ❌                        | ❌                                  | ✅                     |
| Stacking rules      | N/A                       | Lowest price wins                   | Cumulative / exclusive |

## Managing Promotions Through the API

Promotions live on the Shop API admin endpoint, `POST https://shop-api.crystallize.com/{tenant-identifier}/cart/admin`, with a token holding the `cart` and `cart:admin` scopes (see [[query]] for getting one). Mass operations cannot write them.

```graphql
mutation SetPromotion {
    setPromotion(
        input: {
            identifier: "welcome15"
            name: "Welcome 15%"
            mechanism: { type: Percentage, value: 15 }
            periods: [{ start: "2026-06-01T00:00:00Z", end: "2026-08-31T23:59:59Z" }]
            triggers: { codes: ["WELCOME15"], markets: ["eu-retail"] }
            targets: { paths: ["/shop/shoes"] }
            limitations: { maxUsagePerCustomer: 1 }
        }
    ) {
        identifier
    }
}
```

| Operation                       | Effect                                                                    |
| ------------------------------- | ------------------------------------------------------------------------- |
| `setPromotion(input)`           | Creates or replaces one promotion, by `identifier`                        |
| `setPromotions(input)`          | Replaces the **whole** list: a promotion left out is deleted              |
| `promotion(identifier)`         | Reads one                                                                 |
| `promotions`                    | Reads all                                                                 |
| `promotionUsage`                | `count` and `perCustomer`, both JSON hashes keyed by promotion identifier |
| `setPPI(url, refreshFrequency)` | Replaces the list from JSON at your URL, and again on each refresh        |

A tenant holds at most **100 promotions**, and each trigger or target list at most 5,000 entries.

## Applying Promotions in the Cart

Promotions are resolved during cart hydration in the Shop API. The cart context determines which market, customer, and coupon codes are active. These run against `POST https://shop-api.crystallize.com/{tenant-identifier}/cart`, with a `cart` token.

### Cart Hydration with a Coupon Code

```graphql
mutation HydrateCartWithCoupon {
    hydrate(
        input: {
            context: { price: { markets: ["eu-retail"], voucherCodes: ["WELCOME15"], currency: "EUR", decimals: 2 } }
            items: [{ sku: "TSHIRT-RED-L", quantity: 2 }, { sku: "HOODIE-BLK-M", quantity: 1 }]
        }
    ) {
        id
        items {
            variant {
                sku
                name
            }
            quantity
            price {
                gross
                net
                currency
                discounts {
                    amount
                    percent
                }
            }
        }
        total {
            gross
            net
            currency
            discounts {
                amount
                percent
            }
        }
        appliedPromotions {
            identifier
            name
            mechanism {
                type
                value
            }
        }
    }
}
```

The response includes a `discounts` list on each item and on the cart total when a discount has been applied, and `appliedPromotions` names what fired. If the coupon code is invalid or no promotion matches, the prices are returned without discounts and **without an error**. To tell the shopper, query `validateVoucher(voucher: "WELCOME15") { isValid promotions { identifier name } }` on the same endpoint. It only says that a promotion carries the code, not that this cart qualifies, so compare with `appliedPromotions` after hydrating.

### Cart Hydration with Automatic Promotions

Promotions without triggers apply automatically — no coupon code needed:

```graphql
mutation HydrateCart {
    hydrate(
        input: {
            context: { price: { markets: ["us-retail"], currency: "USD", decimals: 2 } }
            items: [{ sku: "SNEAKER-WHT-42", quantity: 3 }]
        }
    ) {
        id
        items {
            variant {
                sku
            }
            quantity
            price {
                gross
                net
                currency
                discounts {
                    amount
                    percent
                }
            }
        }
        total {
            gross
            net
            currency
            discounts {
                amount
                percent
            }
        }
    }
}
```

If a "Buy 3, pay for 2" promotion is limited to sneakers through its trigger, the discount is applied automatically when the quantity condition is met.

## Best Practices

1. **Keep it simple** — Start with 1–3 promotions. Complex stacking rules confuse customers and support teams.
2. **Always set an end date** — Even for "permanent" promotions, set a far-future date for review.
3. **Test in cart** — Always hydrate a test cart to verify the promotion resolves correctly.
4. **Name for humans** — Use descriptive names: "Black Friday 2025 — 20% off shoes" not "Promo 7".
5. **Be explicit about stacking** — Decide early whether promotions combine. Most stores should default to non-cumulative.
6. **Use triggers wisely** — Automatic promotions (no trigger) apply to every customer. Be intentional.
7. **Monitor usage** — Set `maxUsage` and `maxUsagePerCustomer` to prevent abuse of coupon codes.

## Anti-Patterns

- ❌ Using promotions for permanent price differences (use price variants or price lists)
- ❌ Creating dozens of overlapping promotions (causes unpredictable stacking)
- ❌ Forgetting to test in the cart (promotions are invisible until checkout)
- ❌ Setting cumulative + no max usage on percentage discounts (can result in near-free products)
- ❌ Using promotions for B2B pricing tiers (use price lists with customer groups instead)
