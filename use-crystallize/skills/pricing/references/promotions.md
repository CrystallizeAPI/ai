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

How the discount is calculated:

| Mechanism      | Description              | Use Case                                     |
| -------------- | ------------------------ | -------------------------------------------- |
| **Percentage** | % off the original price | "20% off all shoes"                          |
| **Fixed**      | Flat amount off          | "$10 off when you spend $50+"                |
| **X for Y**    | Buy X items, pay for Y   | "Buy 3, pay for 2" (cheapest items are free) |
| **Cart**       | Reduce the cart total    | "$20 off the entire order"                   |

### 2. Period (optional)

When the promotion is active:

- **Start date** — When the promotion begins
- **End date** — When it expires
- **Multiple periods** — For recurring campaigns (e.g. every December)
- **No period** — Active immediately and indefinitely

### 3. Trigger (optional)

What conditions must be met for the promotion to activate:

- **Product-based** — "3 of product X in the cart"
- **Quantity-based** — "At least 5 items total"
- **Value-based** — "Cart total above $100"
- **Coupon code** — "Enter SUMMER20 at checkout"
- **No trigger** — Applies to every cart automatically

### 4. Target (optional)

Which product variants the promotion affects:

- **Specific products** — Only these SKUs are discounted
- **All products** — Entire catalogue
- **No target** — Same as all products

**Note:** Trigger and target can be the same ("Buy 2 of X, get 1 of X free") or different ("Buy shoes, get 50% off socks").

### 5. Limitations

Control how the promotion behaves:

| Limitation               | Description                                 | Example                                  |
| ------------------------ | ------------------------------------------- | ---------------------------------------- |
| **Cumulative**           | Can combine with other discounts?           | Yes/No                                   |
| **Combine with**         | Specific promotions it can stack with       | Only with "Free Shipping"                |
| **Repeatable**           | Applies per qualifying set or once per cart | "Buy 3 pay 2" repeats for every set of 3 |
| **Max usage**            | Total times it can be applied to a cart     | Max 1 application per cart               |
| **Max per customer**     | Times each customer can use it              | 1 per customer lifetime                  |
| **Quantity per trigger** | Items discounted per trigger match          | Discount 1 item per trigger              |

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
Mechanism: X for Y — Buy 3, pay for 2
Period: None
Trigger: 3 items of any product in cart
Target: Same as trigger (cheapest item is free)
Limitations: Repeatable (every 3 items), cumulative
```

### Free Shipping Threshold

```
Mechanism: Cart — Reduce shipping to $0
Period: None
Trigger: Cart total ≥ $75
Target: Shipping line item
Limitations: Cumulative (can combine with product discounts)
```

### Members-Only Discount

```
Mechanism: Percentage — 10% off
Period: None
Trigger: Customer is in "Members" group
Target: All products
Limitations: Cumulative, no max usage
```

### Bundle Discount

```
Mechanism: Fixed — $15 off
Period: Summer campaign (Jun 1 – Aug 31)
Trigger: Product A AND Product B in cart
Target: Cart total
Limitations: Max 1 per cart
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
| Stacking rules      | N/A                       | Priority-based                      | Cumulative / exclusive |

## Applying Promotions in the Cart

Promotions are resolved during cart hydration in the Shop API. The cart context determines which market, customer, and coupon codes are active.

### Cart Hydration with a Coupon Code

```graphql
mutation HydrateCartWithCoupon {
    cart {
        hydrate(
            input: {
                context: { market: ["eu-retail"], voucherCode: "WELCOME15" }
                items: [{ sku: "TSHIRT-RED-L", quantity: 2 }, { sku: "HOODIE-BLK-M", quantity: 1 }]
            }
        ) {
            cart {
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
                        discount {
                            amount
                            percentage
                        }
                    }
                }
                total {
                    gross
                    net
                    currency
                    discount
                }
            }
        }
    }
}
```

The response includes a `discount` field on each item and on the cart total when a promotion has been applied. If the coupon code is invalid or no promotion matches, the prices are returned without discounts.

### Cart Hydration with Automatic Promotions

Promotions without triggers apply automatically — no coupon code needed:

```graphql
mutation HydrateCart {
    cart {
        hydrate(input: { context: { markets: ["us-retail"] }, items: [{ sku: "SNEAKER-WHT-42", quantity: 3 }] }) {
            cart {
                items {
                    variant {
                        sku
                    }
                    quantity
                    price {
                        gross
                        net
                        currency
                        discount {
                            amount
                            percentage
                        }
                    }
                }
                total {
                    gross
                    net
                    currency
                    discount
                }
            }
        }
    }
}
```

If a "Buy 3, pay for 2" promotion targets sneakers and has no trigger restriction, the discount is applied automatically when the quantity condition is met.

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
