# Shop API Mutations Reference

The Shop API provides edge-distributed mutations for cart management and checkout flows.

## Base URL

```
https://shop-api.crystallize.com/{tenant-identifier}/cart
```

## Authentication

Requires JWT token. See [Shop API Queries Reference](../query/references/shop-api-queries.md) for token generation.

```
Authorization: Bearer YOUR_JWT_TOKEN
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
    input: {
      items: [
        { sku: "robot-pink-standard", quantity: 1 }
        { sku: "robot-red-standard", quantity: 3 }
      ]
    }
  ) {
    id
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

### Hydration with Context

Configure how hydration behaves:

```graphql
mutation {
  hydrate(
    input: {
      items: [{ sku: "product-sku", quantity: 2, taxRate: 0.25 }]
      context: {
        language: "en"
        price: {
          selectedVariantIdentifier: "retail"
          compareAtVariantIdentifier: "msrp"
          decimals: 2
          pricesHaveTaxesIncludedInCrystallize: true
          discountOnNetPrices: false
          fallbackVariantIdentifiers: ["default"]
        }
        markets: ["US", "EU"]
        currency: "USD"
        customerGroup: "wholesale"
        voucherCode: "SUMMER2024"
      }
    }
  ) {
    id
    items {
      sku
      price {
        gross
        net
        discounts {
          amount
        }
      }
    }
  }
}
```

### Context Options

| Field                                  | Description                              |
| -------------------------------------- | ---------------------------------------- |
| `language`                             | Locale for product names (default: "en") |
| `selectedVariantIdentifier`            | Price variant to use                     |
| `compareAtVariantIdentifier`           | For calculating discounts                |
| `decimals`                             | Decimal precision (default: 0)           |
| `pricesHaveTaxesIncludedInCrystallize` | Tax handling flag                        |
| `taxRate`                              | Override tax rate                        |
| `markets`                              | Array of markets for price lists         |
| `currency`                             | Display currency                         |
| `customerGroup`                        | Customer group for pricing               |
| `voucherCode`                          | Apply voucher code                       |

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

### Add Items to Existing Cart

```graphql
mutation {
  addItems(id: "cart-id", items: [{ sku: "new-product-sku", quantity: 2 }]) {
    id
    items {
      sku
      quantity
    }
  }
}
```

### Remove Items

```graphql
mutation {
  removeItems(id: "cart-id", items: [{ sku: "product-to-remove" }]) {
    id
    items {
      sku
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
  changeCartItemPricing(
    id: "cart-id"
    sku: "product-sku"
    price: { gross: 49.99, net: 39.99 }
  ) {
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
    customer: {
      firstName: "John"
      lastName: "Doe"
      email: "john@example.com"
      phone: "+1234567890"
    }
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
    billing: {
      street: "123 Main St"
      city: "New York"
      postalCode: "10001"
      country: "US"
    }
    delivery: {
      street: "456 Oak Ave"
      city: "Brooklyn"
      postalCode: "11201"
      country: "US"
    }
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

### Set Cart Expiration

```graphql
mutation {
  setCartExpiration(id: "cart-id", expiresAt: "2024-12-31T23:59:59Z") {
    id
    expiresAt
  }
}
```

### Delete Cart

```graphql
mutation {
  deleteCart(id: "cart-id") {
    success
  }
}
```

## Best Practices

1. **Reuse cart IDs** - Pass returned ID to subsequent requests
2. **Handle managed state** - Know when items become unmanaged
3. **Use context appropriately** - Set pricing context once during hydration
4. **External items for non-catalog items** - Shipping, fees, discounts
5. **Auto-cleanup** - Carts expire after 3 months of inactivity

## Related Links

- [Crystallize Shop API Documentation](https://crystallize.com/docs/developer/apis/shop-api)
- [Order API](https://crystallize.com/learn/developer-guides/order-api)
