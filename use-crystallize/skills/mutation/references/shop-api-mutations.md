# Shop API Cart Mutations Reference

The Shop API `/cart` scope provides edge-distributed mutations for cart management and checkout flows.

See [SKILL.md](../SKILL.md) for endpoint URLs and authentication headers. This file covers the `/cart` endpoint only. For order creation and management, use the [`/order` endpoint](shop-api-order-mutations.md).

## Cart State Machine

Carts follow a state machine that controls what operations are allowed:

```
cart → placed → ordered
  ↕      ↗
abandoned
```

| State       | Description                                   | Mutable?                |
| ----------- | --------------------------------------------- | ----------------------- |
| `cart`      | Active cart, items and prices can be changed  | Yes                     |
| `placed`    | Locked for payment — no modifications allowed | No                      |
| `ordered`   | Linked to an order via `orderId`              | No                      |
| `abandoned` | Explicitly abandoned, or left to go stale     | Yes: a write revives it |

`abandon` works only from `cart`, so a placed cart cannot be abandoned: its only way forward is `ordered`.
An abandoned cart goes back to `cart` on the next `hydrate` or write, and can be placed directly.

**A write on a placed or ordered cart can look like it worked.** `hydrate` refuses a placed cart and serves
an ordered one read-only, but `addSkuItem`, `setCustomer`, `setMeta` and the other item mutations answer with
the changed cart while nothing is stored. Check `state` before you write.

Query the cart state with:

```graphql
query {
    cart(id: "cart-id") {
        id
        state # cart | placed | ordered | abandoned
        isStale # true once staleAt has passed: no write for context.staleTtl
        isExpired # true once expiresAt has passed: no write for context.ttl
        orderId # set when an order is created from the cart
    }
}
```

Stale is about time, not prices. Every write pushes `staleAt` forward by `context.staleTtl` (1 hour by
default), and a stale cart turns `abandoned` within about five minutes. Wishlists never go stale or expire.

## Cart Hydration

The primary mutation for creating and updating carts. Hydration:

1. Takes SKUs and external items as input
2. Fetches product data from Catalogue API
3. Calculates prices, taxes, and totals
4. Returns a fully constructed cart

**Hydrating an existing `id` replaces the cart, it does not merge.** `items`, `externalItems`, `customer`,
`meta` and `context` are all taken from this input, so anything you leave out is dropped, the customer and
the price context included. Resend the whole cart, or use the targeted mutations below. An `id` that does
not exist creates a new cart with a new id.

**A SKU the catalogue does not return is dropped with no error**: an unknown SKU, an unpublished product,
or a language it is not published in. Compare the `items` you get back with the ones you sent.

### Basic Hydration

```graphql
mutation {
    hydrate(
        input: { items: [{ sku: "robot-pink-standard", quantity: 1 }, { sku: "robot-red-standard", quantity: 3 }] }
    ) {
        id
        state
        isStale
        isExpired
        items {
            name
            quantity
            variant {
                sku
            }
            price {
                gross
                net
            }
        }
        total {
            gross
            net
        }
    }
}
```

### Hydration with Customer and Context

The hydrate input accepts customer info inline — this is the recommended way to associate a customer during checkout. `isGuest` is required on `CustomerInput`. It also accepts item `type` and `group` for categorizing line items.

```graphql
mutation {
    hydrate(
        input: {
            customer: { identifier: "john@example.com", isGuest: false, firstName: "John", lastName: "Doe" }
            context: {
                language: "en"
                price: {
                    pricesHaveTaxesIncludedInCrystallize: true
                    decimals: 4
                    currency: "EUR"
                    selectedVariantIdentifier: "sales"
                    compareAtVariantIdentifier: "default"
                    fallbackVariantIdentifiers: ["default"]
                }
            }
            items: [
                { sku: "palissade-lounge-sofa-iron-red", quantity: 1, type: standard, group: "Outdoor" }
                { sku: "palissade-bar-stool-sky-grey", quantity: 1, type: standard, group: "Outdoor" }
                { sku: "monstera-deliciosa-medium", quantity: 2, type: standard, group: "Plants" }
            ]
        }
    ) {
        id
        state
        isStale
        customer {
            identifier
            firstName
            lastName
        }
        appliedPromotions {
            identifier
            name
            mechanism {
                type
                value
            }
        }
        items {
            name
            variant {
                sku
                price {
                    gross
                    net
                    taxAmount
                    taxPercent
                }
                compareAtPrice {
                    gross
                    net
                }
            }
            price {
                net
                gross
                taxAmount
                discounts {
                    percent
                    amount
                }
            }
        }
        total {
            net
            gross
            discounts {
                percent
                amount
            }
        }
    }
}
```

### CartInput Fields

| Field           | Type                  | Description                                |
| --------------- | --------------------- | ------------------------------------------ |
| `id`            | `UUID`                | Existing cart ID (omit to create new cart) |
| `items`         | `[CartSkuItemInput]`  | SKU items to add to the cart               |
| `externalItems` | `[CartItemInputType]` | External items (shipping, fees)            |
| `customer`      | `CustomerInput`       | Customer info (inline with hydration)      |
| `context`       | `ContextInput`        | Language and pricing context               |
| `type`          | `CartType`            | `cart` or `wishlist`                       |
| `name`          | `String`              | Optional cart name (mainly for wishlists)  |
| `meta`          | `[KeyValueInput]`     | Arbitrary key-value metadata               |

### CartSkuItemInput Fields

| Field      | Type              | Required | Description                                                                                                |
| ---------- | ----------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `sku`      | `String!`         | Yes      | Product variant SKU                                                                                        |
| `quantity` | `PositiveInt`     | No       | Quantity (default: 1)                                                                                      |
| `lineId`   | `String`          | No       | Selects an existing line, needed only when several lines share a SKU. Read it from `items { lineId }`      |
| `type`     | `CartItemType`    | No       | `standard`, `subscription`, `shipping`, `fee`, `promotion`, `refund`, `service`, `digital`, `bonus`, `tax` |
| `group`    | `String`          | No       | Free-form group label (e.g., "Outdoor", "Plants")                                                          |
| `taxRate`  | `Rate`            | No       | Override tax rate for this item                                                                            |
| `meta`     | `[KeyValueInput]` | No       | Item-level metadata                                                                                        |

### Context Options

`context` holds `language`, `ttl`, `staleTtl` and a nested `price` object:

| Field                                        | Description                                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `language`                                   | Locale for product names (default: "en")                                                                                                                                |
| `ttl`                                        | Seconds until the cart expires, reset by each write (default: 30 days)                                                                                                  |
| `staleTtl`                                   | Seconds without a write before the cart goes stale (default: 1 hour)                                                                                                    |
| `price.selectedVariantIdentifier`            | Price variant to use as active price (default: `default`)                                                                                                               |
| `price.compareAtVariantIdentifier`           | Price variant for discount comparison                                                                                                                                   |
| `price.fallbackVariantIdentifiers`           | Tried in order when the selected variant has no price. If none has one, the SKU's first price variant is used, so a wrong identifier prices the line instead of failing |
| `price.decimals`                             | Decimal precision (default: 0, recommended: 4)                                                                                                                          |
| `price.pricesHaveTaxesIncludedInCrystallize` | Default `false`. Tax handling: `true` for B2C, `false` for B2B                                                                                                          |
| `price.discountOnNetPrices`                  | Apply discounts on the net price (default: `false`)                                                                                                                     |
| `price.taxRate`                              | Override tax rate, between 0 and 1                                                                                                                                      |
| `price.markets`                              | Array of markets for price lists                                                                                                                                        |
| `price.currency`                             | Label stamped on the prices (default: `eur`). It converts nothing and nothing checks it against the price variant, so pass that variant's currency                      |
| `price.customerGroups`                       | Customer groups for pricing (`customerGroup` is deprecated)                                                                                                             |
| `price.voucherCodes`                         | Apply voucher codes (`voucherCode` is deprecated)                                                                                                                       |

### Hydration with External Items

For items not in Crystallize (shipping, fees):

```graphql
mutation {
    hydrate(
        input: {
            items: [{ sku: "product-sku", quantity: 1 }]
            externalItems: [
                {
                    sku: "shipping-fedex"
                    quantity: 1
                    name: "FedEx Ground Shipping"
                    images: []
                    variant: {
                        price: { gross: 12.99, net: 10.39 }
                        product: { id: "shipping-product", path: "/shipping" }
                    }
                }
            ]
        }
    ) {
        id
        items {
            name
            variant {
                sku
            }
        }
    }
}
```

## Cart Item Management

### Add SKU Item

Add a single SKU item to an existing cart. If the SKU is already in the cart, `quantity` is **added** to that line. It does not take a `booking`: use `bookSkuItem`, see [[bookable-resources]].

```graphql
mutation {
    addSkuItem(id: "cart-id", input: { sku: "new-product-sku", quantity: 2, type: standard, group: "Furniture" }) {
        id
        items {
            name
            variant {
                sku
            }
            quantity
        }
    }
}
```

### Add External Item

Add a fully custom item not in Crystallize (e.g., shipping, service fees). `name` and `variant` are required, and `variant.price` is the unit price. If the SKU is already an external line, `quantity` is added to it.

```graphql
mutation {
    addExternalItem(
        id: "cart-id"
        input: {
            sku: "shipping-standard"
            name: "Standard Shipping"
            quantity: 1
            type: shipping
            variant: { price: { gross: 9.99, net: 7.99 }, product: { id: "shipping-product", path: "/shipping" } }
        }
    ) {
        id
        items {
            name
            variant {
                sku
            }
            price {
                gross
                net
            }
        }
    }
}
```

### Remove Items

`quantity` defaults to 1, so leaving it out takes **one unit off** the line. The line goes when it reaches 0: pass its full quantity to remove it.

```graphql
mutation {
    removeCartItem(id: "cart-id", sku: "product-to-remove", quantity: 3) {
        id
        items {
            variant {
                sku
            }
            quantity
        }
    }
}
```

### Update Item Quantity

`addCartItem` adds to a line already in the cart and `removeCartItem` takes from it, both by a delta. A SKU that is not in the cart is ignored: use `addSkuItem` for that.

```graphql
mutation {
    addCartItem(id: "cart-id", sku: "product-sku", quantity: 2) {
        id
        items {
            quantity
            variant {
                sku
            }
        }
    }
}
```

### Change Item Pricing

Override managed pricing (makes item unmanaged). `price` is the unit price, and `input` also takes `quantity`, which is how to set an absolute quantity. A SKU that is not in the cart is ignored.

```graphql
mutation {
    changeCartItemPricing(id: "cart-id", input: { sku: "product-sku", price: { gross: 49.99, net: 39.99 } }) {
        id
        items {
            context # HashMap: managed, origin, taxRate
            variant {
                sku
            }
            price {
                gross
                net
            }
        }
    }
}
```

An unmanaged line keeps its price through later hydrations, only its quantity moves.

`setCartItem(id:, input:)` is the full form: it takes the same `CartItemInput` as `addExternalItem`, so `name` and `variant` are required, then adds or replaces the line and flags it unmanaged.

## Customer Information

### Set Customer on Cart

The argument is `input` here, and `customer` on the `/order` endpoint's `setCustomer`. `isGuest` is required, and the customer you send replaces the one on the cart.

```graphql
mutation {
    setCustomer(
        id: "cart-id"
        input: { isGuest: false, firstName: "John", lastName: "Doe", email: "john@example.com", phone: "+1234567890" }
    ) {
        id
        customer {
            firstName
            lastName
            email
        }
    }
}
```

### Set Addresses

Addresses live on the customer, so they go in `customer.addresses` with a `type` of `billing`, `delivery` or `other`:

```graphql
mutation {
    setCustomer(
        id: "cart-id"
        input: {
            isGuest: false
            firstName: "John"
            addresses: [
                { type: billing, street: "123 Main St", city: "New York", postalCode: "10001", country: "US" }
                { type: delivery, street: "456 Oak Ave", city: "Brooklyn", postalCode: "11201", country: "US" }
            ]
        }
    ) {
        id
    }
}
```

### Set Cart Metadata

`merge` defaults to `true`, and `false` replaces all the meta.

```graphql
mutation {
    setMeta(id: "cart-id", meta: [{ key: "campaign", value: "summer" }], merge: true) {
        id
        meta
    }
}
```

## Cart to Order Intent

`createFromCart` is the normal way to get an order from a cart. Use `orderIntent`, a **query** on `/cart`, when you create the order yourself: it works on a placed cart only, and you close the cart with `fulfill` afterwards.

```graphql
query {
    orderIntent(id: "cart-id", format: shop) {
        order # HashMap: the order input
        cart {
            id
            state
        }
    }
}
```

`format` is `legacy` (the default), `core`, `coreWithOrderV2` or `shop`. Use `shop` for the `/order` `create` mutation.

## Cart Lifecycle

### Place Cart

Placing a cart locks it and makes it **immutable**. This should happen when the user enters checkout (e.g., before collecting payment). After placing, items, quantities, and prices cannot be changed. `place` hydrates the cart one last time first, so charge the `total` it returns, not the one you showed earlier.

```graphql
mutation {
    place(id: "cart-id") {
        id
        state # now "placed"
        items {
            name
            quantity
        }
        total {
            gross
            net
            currency
        }
    }
}
```

> **Back navigation**: If the user navigates back after the cart is placed, create a new cart by calling `hydrate` without an `id`. The placed cart cannot be modified.

### Fulfill Cart

**Not needed after `createFromCart`.** [`createFromCart`](shop-api-order-mutations.md) on the `/order` endpoint already moves the cart to `ordered` and sets `orderId`, and the order id is the cart id. Use `fulfill` to link a placed cart to an order created some other way:

```graphql
mutation {
    fulfill(id: "cart-id", orderId: "order-uuid") {
        id
        state # now "ordered"
        orderId # the linked order ID
    }
}
```

### Abandon Cart

Explicitly mark a cart as abandoned (e.g., user left checkout, session timeout). This fails on a placed or ordered cart.

```graphql
mutation {
    abandon(id: "cart-id") {
        id
        state # now "abandoned"
    }
}
```

### Mark as Wishlist

Convert a cart in state `cart` to a non-expiring wishlist:

```graphql
mutation {
    markAsWishlist(id: "cart-id", name: "My Favorites") {
        id
        isWishlist
        name
    }
}
```

### Set Cart Expiration

There is no expiration mutation. Pass `context.ttl` and `context.staleTtl`, in seconds, to `hydrate`.

### Remove Cart

`remove` returns a Boolean, so it takes no selection:

```graphql
mutation {
    remove(id: "cart-id")
}
```

## Complete Checkout Flow

The full checkout flow spans the Core API, `/cart` endpoint, and `/order` endpoint:

```
0. (Optional) Create Customer → POST /customer — customer(input:)
1. Hydrate Cart               → POST /cart   — Create cart with items, customer, context
2. (Optional edits)           → POST /cart   — addSkuItem, setCustomer, etc.
3. Place Cart                 → POST /cart   — Lock cart for payment
4. Create Order               → POST /order  — createFromCart (⚠ different endpoint!)
```

After step 4 the cart is `ordered` and linked to the order; the order id is the cart id. There is no
separate fulfill step.

### Customer Creation

Customers can be created **before** checkout, on the Shop API or the [Core API](core-api.md), or **inline** during hydration:

- **Shop API `/customer`** (from a storefront): `customer(input: { identifier, ... })` creates or updates the customer, and `addAddress`, `setAddress`, `removeAddress` and `setMeta` edit it. The token needs the `customer` scope.
- **Core API** (persistent customer records, from a back office): Use `createCustomer` with `type: individual` or `type: organization`. The customer's `identifier` (typically email) can then be passed to `hydrate`.
- **Inline during hydrate** (recommended for checkout): Pass `customer: { identifier, firstName, lastName, isGuest }` directly in the hydrate input. This associates the customer with the cart without requiring a separate API call.

For guest checkout, set `isGuest: true` in the hydrate customer input.

### Minimal checkout example:

```graphql
# Step 1: Create and hydrate cart (POST /cart)
mutation {
    hydrate(
        input: {
            customer: { identifier: "john@example.com", isGuest: false }
            context: {
                language: "en"
                price: {
                    pricesHaveTaxesIncludedInCrystallize: true
                    decimals: 4
                    currency: "EUR"
                    selectedVariantIdentifier: "default"
                }
            }
            items: [
                { sku: "product-sku-1", quantity: 2, type: standard }
                { sku: "product-sku-2", quantity: 1, type: standard }
            ]
        }
    ) {
        id
        state
        total {
            gross
            net
            currency
        }
    }
}

# Step 2: Place cart — locks it for payment (POST /cart)
mutation {
    place(id: "cart-uuid-from-step-1") {
        id
        state # "placed"
    }
}

# Step 3: Create order from placed cart (POST /order — DIFFERENT ENDPOINT!)
mutation {
    createFromCart(id: "cart-uuid-from-step-1", input: { type: standard, paymentStatus: paid }) {
        id
        coreId
        type
        total {
            gross
            net
            currency
        }
    }
}
```

## Best Practices

1. **Reuse cart IDs** — Pass returned ID to subsequent requests
2. **Set customer and context in hydrate** — Set them inline during hydration rather than separate calls
3. **Place before payment** — Always place the cart before initiating payment to prevent modifications
4. **Use `/order` for order creation** — `createFromCart` is on the `/order` endpoint, not `/cart`
5. **Handle back navigation** — If user goes back after placing, create a new cart via `hydrate` without an `id`
6. **Use item groups** — Group items logically ("Outdoor", "Plants") for organized order views
7. **Handle managed state** — Know when items become unmanaged after price overrides
8. **External items for non-catalog items** — Shipping, fees, discounts via `addExternalItem`
9. **Auto-cleanup** — Carts expire 30 days after the last write by default (`context.ttl`) and are deleted three months after that
10. **Don't write in parallel** — Most cart writes land just after the response, and on the same cart the last one wins. Wait for each answer and work from the cart it returns

## Related Links

- [Shop API Order Mutations](shop-api-order-mutations.md) - Order creation, payments, pipelines (`/order` endpoint)
- [Core API Mutations](core-api.md) - Customer creation (`createCustomer`), order updates
- [Crystallize Shop API Documentation](https://crystallize.com/docs/developer/apis/shop-api)
- [Checkout Flow Tutorial](https://crystallize.com/docs/developer/apis/shop-api/checkout-flow-tutorial)
