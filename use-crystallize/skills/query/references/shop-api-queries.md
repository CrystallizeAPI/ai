# Shop API Queries Reference

The Shop API handles cart and checkout operations at the edge for low-latency commerce experiences.

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

### Token Scopes

| Scope        | Description                                  |
| ------------ | -------------------------------------------- |
| `cart`       | Manage a single cart                         |
| `cart:admin` | Manage multiple carts                        |
| `order`      | Create and manage orders (`/order` endpoint) |
| `usage`      | Access usage/metrics API                     |
| `lock`       | Acquire/release locks                        |

### Using the Token

Include in request headers:

```
Authorization: Bearer YOUR_JWT_TOKEN
```

## Cart Queries

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
            sku
            name
            quantity
            managed
            origin
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

### Cart as Order Intent

Retrieve cart formatted for order creation:

```graphql
query {
    cartAsOrderIntent(id: "cart-id-here") {
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

This format can be pushed directly to the Order API without transformation.

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

- You can set cart expiration time
- Carts without updates for 3+ months are automatically deleted

## Related Links

- [Shop API Order Queries](shop-api-order-queries.md) - Querying orders (`/order` endpoint)
- [Shop API Order Mutations](../../mutation/references/shop-api-order-mutations.md) - Creating and managing orders
- [Crystallize Shop API Documentation](https://crystallize.com/docs/developer/apis/shop-api)
- [Order API Documentation](https://crystallize.com/learn/developer-guides/order-api)
