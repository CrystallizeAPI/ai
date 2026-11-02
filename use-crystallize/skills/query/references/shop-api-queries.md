# Shop API Queries Reference

The Shop API handles cart and checkout operations at the edge for low-latency commerce experiences. It is one
GraphQL endpoint per concern, each with its own schema: `/cart`, `/order`, `/customer`, `/subscription-contract`
and `/lock`.

## Base URL

```
https://shop-api.crystallize.com/{tenant-identifier}/cart
```

The endpoint also serves as a GraphQL playground for documentation.

## Authentication

The Shop API requires a JWT token. Obtain tokens from:

```
POST https://shop-api.crystallize.com/{tenant-identifier}/auth/token
```

### Getting a Token

```bash
curl -X POST 'https://shop-api.crystallize.com/YOUR_TENANT/auth/token' \
  -H 'Accept: application/json' \
  -H 'x-crystallize-access-token-id: YOUR_ACCESS_TOKEN_ID' \
  -H 'x-crystallize-access-token-secret: YOUR_ACCESS_TOKEN_SECRET' \
  -H 'Content-Type: application/json' \
  -d '{"scopes":["cart","cart:admin","order"],"expiresIn":18000}'
```

`expiresIn` is in seconds and defaults to one day. The response is `{ "success": true, "token": "..." }`.

### Token Scopes

A token needs the scope named after the endpoint it calls. An `/admin` sub-path needs `<scope>:admin` **as well**.

| Scope                   | Description                                               |
| ----------------------- | --------------------------------------------------------- |
| `cart`                  | Read and manage carts (`/cart` endpoint)                  |
| `cart:admin`            | Cart administration and promotions (`/cart/admin`)        |
| `order`                 | Create and manage orders (`/order` endpoint)              |
| `customer`              | Read and manage customers (`/customer` endpoint)          |
| `subscription-contract` | Read and manage contracts (`/subscription-contract`)      |
| `lock`                  | Acquire/release locks                                     |
| `booking:admin`         | Booking administration (`/booking/admin`, with `booking`) |

### Using the Token

Include in request headers:

```
Authorization: Bearer YOUR_JWT_TOKEN
```

## Cart Queries

An unknown `id` answers a GraphQL error, not `null`.

### Retrieve Cart

```graphql
query {
    cart(id: "cart-id-here") {
        id
        state
        isStale
        isExpired
        createdAt
        updatedAt
        items {
            lineId
            name
            quantity
            context
            variant {
                sku
            }
            images {
                url
            }
            price {
                gross
                net
                taxAmount
            }
        }
        total {
            gross
            net
            taxAmount
        }
    }
}
```

- The SKU sits on `variant`, not on the item.
- `items.price` is the **line** total (quantity × unit price). The unit price is `items.variant.price`.
- `items.context` is a `HashMap` holding `taxRate`, `origin` (`crystallize` or `external`) and `managed`, so it
  takes no sub-selection.

### List Carts

`carts` lists carts and wishlists. Like `orders`, it answers for whatever `customerIdentifier` it is given, so
take the identifier from the session.

```graphql
query {
    carts(types: [wishlist], customerIdentifier: "customer@example.com", limit: 20) {
        hits {
            id
            name
            updatedAt
        }
        summary {
            totalHits
            hasMoreHits
        }
    }
}
```

`limit` defaults to 20 and `skip` to 0. It also takes `states`, `name`, `nameContains`, `updatedAfter`,
`updatedBefore`, `createdAfter` and `createdBefore`.

### Cart as Order Intent

Retrieve a placed cart formatted for order creation:

```graphql
query {
    orderIntent(id: "cart-id-here", format: shop) {
        order
        cart {
            id
            total {
                gross
                net
            }
        }
    }
}
```

`order` is a `HashMap`, so it takes no sub-selection, and it can be pushed to the matching API without
transformation. `format` names that API and defaults to `legacy`: pass `shop` for the Shop API `create`, or
`core` or `coreWithOrderV2` for the Core API. A cart that is not in the `placed` state is refused.

## Customer and Subscription Contract Queries

Both follow the same pattern on their own endpoint, with their own scope. The JWT is per tenant, so take the
identifier from the session here too.

```graphql
# POST https://shop-api.crystallize.com/{tenant-identifier}/customer
query {
    customer(identifier: "customer@example.com") {
        identifier
        firstName
        lastName
        email
        addresses {
            type
            street
            city
            postalCode
            country
        }
        meta
    }
}
```

`/subscription-contract` serves `subscriptionContract(id:)` and
`subscriptionContracts(customerIdentifier:, limit:, skip:)`, which answers an empty list when no
`customerIdentifier` is given. See [[subscriptions]].

## Cart Concepts

### Hydration

The process where Shop API fetches and computes data on your behalf to construct or update the cart.

### Cart Items

Two types of items can be in a cart:

1. **SKU Items** - Items with a SKU that exist in Crystallize
2. **External Items** - Items that don't exist in Crystallize (e.g., shipping)

### Managed vs Unmanaged Items

- **Managed (true)**: Shop API fetches info from Crystallize
- **Managed (false)**: You provide all item information

SKU items start as managed but become unmanaged if you override properties like pricing.

### Expiration

- You can set cart expiration time with `context.ttl` (30 days by default); every write pushes `expiresAt` back
- A cart in the `cart` state goes stale after `context.staleTtl` without a write (1 hour by default), and turns
  `abandoned` within five minutes
- Carts are automatically deleted three months after `expiresAt`. Wishlists never expire

## Related Links

- [Shop API Order Queries](shop-api-order-queries.md) - Querying orders (`/order` endpoint)
- [Shop API Order Mutations](../../mutation/references/shop-api-order-mutations.md) - Creating and managing orders
- [Crystallize Shop API Documentation](https://crystallize.com/docs/developer/apis/shop-api)
- [Order API Documentation](https://crystallize.com/learn/developer-guides/order-api)
