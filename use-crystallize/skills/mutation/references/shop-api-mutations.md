# Shop API Cart Mutations Reference

The Shop API `/cart` scope provides edge-distributed mutations for cart management and checkout flows.

See [SKILL.md](../SKILL.md) for endpoint URLs and authentication headers. This file covers the `/cart` endpoint only. For order creation and management, use the [`/order` endpoint](shop-api-order-mutations.md).

## Cart State Machine

Carts follow a state machine that controls what operations are allowed:

```
cart → placed → ordered
         ↘
       abandoned
```

| State       | Description                                     | Mutable? |
| ----------- | ----------------------------------------------- | -------- |
| `cart`      | Active cart, items and prices can be changed    | Yes      |
| `placed`    | Locked for payment — no modifications allowed   | No       |
| `ordered`   | Fulfilled — linked to an order via `orderId`    | No       |
| `abandoned` | Explicitly abandoned (e.g., user left checkout) | No       |

Query the cart state with:

```graphql
query {
    cart(id: "cart-id") {
        id
        state # cart | placed | ordered | abandoned
        isStale # true if prices may have changed since last hydration
        isExpired # true if cart has expired
        orderId # set after fulfill, links to the order
    }
}
```

## Cart Hydration

The primary mutation for creating and updating carts. Hydration:

1. Takes SKUs and external items as input
2. Fetches product data from Catalogue API
3. Calculates prices, taxes, and totals
4. Returns a fully constructed cart

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
            sku
            name
            quantity
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

The hydrate input accepts customer info inline — this is the recommended way to associate a customer during checkout. It also accepts item `type` and `group` for categorizing line items.

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
| `type`     | `CartItemType`    | No       | `standard`, `subscription`, `shipping`, `fee`, `promotion`, `refund`, `service`, `digital`, `bonus`, `tax` |
| `group`    | `String`          | No       | Free-form group label (e.g., "Outdoor", "Plants")                                                          |
| `taxRate`  | `Rate`            | No       | Override tax rate for this item                                                                            |
| `meta`     | `[KeyValueInput]` | No       | Item-level metadata                                                                                        |

### Context Options

| Field                                  | Description                                        |
| -------------------------------------- | -------------------------------------------------- |
| `language`                             | Locale for product names (default: "en")           |
| `selectedVariantIdentifier`            | Price variant to use as active price               |
| `compareAtVariantIdentifier`           | Price variant for discount comparison              |
| `decimals`                             | Decimal precision (default: 0, recommended: 4)     |
| `pricesHaveTaxesIncludedInCrystallize` | Tax handling: `true` for B2C, `false` for B2B      |
| `taxRate`                              | Override tax rate                                  |
| `markets`                              | Array of markets for price lists                   |
| `currency`                             | Display currency (must match price variant config) |
| `customerGroup`                        | Customer group for pricing                         |
| `fallbackVariantIdentifiers`           | Fallback price variants if selected is missing     |
| `voucherCode`                          | Apply voucher code                                 |

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
            sku
            name
            origin
        }
    }
}
```

## Cart Item Management

### Add SKU Item

Add a single SKU item to an existing cart. If the item already exists and is managed, only the quantity is updated.

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

Add a fully custom item not in Crystallize (e.g., shipping, service fees).

```graphql
mutation {
    addExternalItem(
        id: "cart-id"
        input: {
            sku: "shipping-standard"
            name: "Standard Shipping"
            quantity: 1
            price: { gross: 9.99, net: 7.99 }
            type: shipping
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

```graphql
mutation {
    removeCartItem(id: "cart-id", sku: "product-to-remove") {
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

```graphql
mutation {
    setCartItem(id: "cart-id", sku: "product-sku", quantity: 5) {
        id
        items {
            sku
            quantity
        }
    }
}
```

### Change Item Pricing

Override managed pricing (makes item unmanaged):

```graphql
mutation {
    changeCartItemPricing(id: "cart-id", sku: "product-sku", price: { gross: 49.99, net: 39.99 }) {
        id
        items {
            sku
            managed
            price {
                gross
                net
            }
        }
    }
}
```

## Customer Information

### Set Customer on Cart

```graphql
mutation {
    setCustomer(
        id: "cart-id"
        customer: { firstName: "John", lastName: "Doe", email: "john@example.com", phone: "+1234567890" }
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

```graphql
mutation {
    setAddresses(
        id: "cart-id"
        billing: { street: "123 Main St", city: "New York", postalCode: "10001", country: "US" }
        delivery: { street: "456 Oak Ave", city: "Brooklyn", postalCode: "11201", country: "US" }
    ) {
        id
    }
}
```

## Cart to Order Intent

Get cart formatted for order creation:

```graphql
mutation {
    cartAsOrderIntent(id: "cart-id") {
        customer {
            firstName
            lastName
            email
        }
        cart {
            sku
            name
            quantity
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

## Cart Lifecycle

### Place Cart

Placing a cart locks it and makes it **immutable**. This should happen when the user enters checkout (e.g., before collecting payment). After placing, items, quantities, and prices cannot be changed.

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

After creating an order (via [`createFromCart`](shop-api-order-mutations.md) on the `/order` endpoint), mark the cart as fulfilled by linking it to the order ID:

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

Explicitly mark a cart as abandoned (e.g., user left checkout, session timeout):

```graphql
mutation {
    abandon(id: "cart-id") {
        id
        state # now "abandoned"
    }
}
```

### Mark as Wishlist

Convert a cart to a non-expiring wishlist:

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

```graphql
mutation {
    setCartExpiration(id: "cart-id", expiresAt: "2024-12-31T23:59:59Z") {
        id
        expiresAt
    }
}
```

### Remove Cart

```graphql
mutation {
    remove(id: "cart-id") {
        id
    }
}
```

## Complete Checkout Flow

The full checkout flow spans the Core API, `/cart` endpoint, and `/order` endpoint:

```
0. (Optional) Create Customer → Core API  — createIndividual or createOrganization
1. Hydrate Cart               → POST /cart   — Create cart with items, customer, context
2. (Optional edits)           → POST /cart   — addSkuItem, setCustomer, setAddresses, etc.
3. Place Cart                 → POST /cart   — Lock cart for payment
4. Create Order               → POST /order  — createFromCart (⚠ different endpoint!)
5. (Optional) Fulfill         → POST /cart   — Link cart to order ID
```

### Customer Creation

Customers can be created **before** checkout via the [Core API](core-api.md) or **inline** during hydration:

- **Core API** (persistent customer records): Use `customer.createIndividual` or `customer.createOrganization` to create a customer in the PIM. The customer's `identifier` (typically email) can then be passed to `hydrate`.
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
9. **Auto-cleanup** — Carts expire after 3 months of inactivity

## Related Links

- [Shop API Order Mutations](shop-api-order-mutations.md) - Order creation, payments, pipelines (`/order` endpoint)
- [Core API Mutations](core-api.md) - Customer creation (`createIndividual`, `createOrganization`), order updates
- [Crystallize Shop API Documentation](https://crystallize.com/docs/developer/apis/shop-api)
- [Checkout Flow Tutorial](https://crystallize.com/docs/developer/apis/shop-api/checkout-flow-tutorial)
