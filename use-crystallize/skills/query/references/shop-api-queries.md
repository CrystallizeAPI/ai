# Shop API Queries Reference

The Shop API is everything about a shopper: carts, the price for this customer and market, checkout, orders,
payments, customers, bookings, subscription contracts and locks. It runs at the edge, **from your server only**. It
is one GraphQL endpoint per route, each with its own schema and scope:

| Route                    | Scope                                  |
| ------------------------ | -------------------------------------- |
| `/cart`                  | `cart`                                 |
| `/cart/admin`            | `cart` and `cart:admin` (promotions)   |
| `/order`                 | `order`                                |
| `/customer`              | `customer`                             |
| `/subscription-contract` | `subscription-contract` (and `:admin`) |
| `/booking/admin`         | `booking:admin`                        |
| `/lock`                  | `lock`                                 |

## Base URL

```
https://shop-api.crystallize.com/{tenant-identifier}/{route}
```

The `@` before the tenant is optional here. `GET https://shop-api.crystallize.com/{tenant-identifier}` lists the
routes the tenant serves (seven on tools-universe, 2026-11-12), and each route serves a GraphQL playground.

**Server only.** The Shop API's CORS allows Crystallize origins and localhost, so a browser call that works in
development fails on your own domain (checked 2026-11-12: no `Access-Control-Allow-Origin` for another origin). The
browser keeps the cart id in an httpOnly cookie, and server actions or routes make the calls.

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

`expiresIn` is in seconds and defaults to one day in the API; js-api-client asks for 12 hours unless told otherwise.
The response is `{ "success": true, "token": "..." }`.

- **Mint it with an access token that is not tenant-scoped.** The token endpoint checks who you are on `/@me`, which
  refuses a tenant-scoped access token and a plugin bearer token ([[permissions]]).
- **The JWT is per tenant, not per shopper.** It reads any customer's orders and carts, so it never reaches the
  browser, and the `customerIdentifier` you pass comes from your session.
- **Cache it on the server and refresh it before it expires.** An expired token fails with
  `"exp" claim timestamp check failed`; a missing or rejected one answers HTTP 401 with `{ "success": false, … }`
  and no GraphQL `errors`.
- **Request a separate token for `/subscription-contract`.** A token with every scope read contracts but answered
  "Unexpected error" on `create`; one scoped to `subscription-contract` (and `:admin`) worked.
- **The Shop API reads products from the Catalogue with the request's credentials**, and the Shop JWT is not one of
  them. On a tenant whose Catalogue API requires authentication, send its `X-Crystallize-Static-Auth-Token` (or its
  access token pair) as headers on every `/cart` call that reads a product, `hydrate` included, next to the
  `Authorization` header ([[bookable-resources]]). `context.catalogue` is not the place: it carries only
  `productVariantMaxAge` and `productVariantImages` (`maxCount`, `renditions { minWidth maxWidth formats }`).

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

### Profile data without Core

A storefront that needs per-shopper data (family members, sizes, saved lists) without Core can keep it on a
`wishlist` cart: write it to `customer.meta` and find the cart again with
`carts(customerIdentifier:, types: [wishlist], name:)`. Wishlists never expire.

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
`customerIdentifier` is given. Contracts live in **one store per tenant**, the Shop API (marked experimental) or
Core: read them where that tenant writes them. See [[subscriptions]].

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
