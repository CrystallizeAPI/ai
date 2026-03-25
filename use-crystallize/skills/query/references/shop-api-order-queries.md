# Shop API Order Queries Reference

The Shop API `/order` scope provides queries for retrieving orders. This is a **separate endpoint** from the `/cart` scope.

## Base URL

```
https://shop-api.crystallize.com/{tenant-identifier}/order
```

> **Important**: Order queries use the `/order` endpoint, NOT `/cart`.

## Authentication

Requires JWT token with the `order` scope.

```
Authorization: Bearer YOUR_JWT_TOKEN
```

See the [Shop API Queries Reference](shop-api-queries.md) for token generation details.

## Get a Single Order

Retrieve an order by its Shop API UUID.

```graphql
query GetOrder($id: UUID!) {
    order(id: $id) {
        id
        coreId
        reference
        type
        paymentStatus
        createdAt
        updatedAt
        additionalInformation
        customer {
            identifier
            firstName
            lastName
            email
            phone
            companyName
            type
            addresses {
                type
                street
                city
                postalCode
                country
            }
        }
        items {
            name
            sku
            productId
            quantity
            type
            imageUrl
            price {
                gross
                net
                taxAmount
                taxPercent
                currency
            }
            subTotal {
                gross
                net
                taxAmount
                currency
            }
        }
        total {
            gross
            net
            taxAmount
            taxPercent
            currency
            discounts {
                amount
            }
            taxBreakdown {
                taxRate
                amount
            }
        }
        payments {
            provider
            transactionId
            amount
            method
            createdAt
        }
        pipelines {
            identifier
            stage
        }
        appliedPromotions {
            identifier
            name
        }
        meta
        metaProperty(key: "fulfillment_status")
    }
}
```

Variables:

```json
{
    "id": "order-uuid-here"
}
```

## Get Orders by Customer

Retrieve orders for a specific customer with pagination.

```graphql
query GetCustomerOrders($customerIdentifier: String!, $limit: Int, $skip: Int) {
    orders(customerIdentifier: $customerIdentifier, limit: $limit, skip: $skip) {
        id
        coreId
        type
        paymentStatus
        createdAt
        total {
            gross
            net
            currency
        }
        items {
            name
            sku
            quantity
            price {
                gross
                net
            }
        }
        pipelines {
            identifier
            stage
        }
    }
}
```

Variables:

```json
{
    "customerIdentifier": "john@example.com",
    "limit": 10,
    "skip": 0
}
```

## Order Response Types

### Order

| Field                     | Type                 | Description                             |
| ------------------------- | -------------------- | --------------------------------------- |
| `id`                      | `UUID!`              | Shop API order ID                       |
| `coreId`                  | `String`             | Core API order ID (for PIM operations)  |
| `reference`               | `String`             | Order reference number                  |
| `type`                    | `OrderType`          | `standard`, `draft`, `creditNote`, etc. |
| `additionalInformation`   | `String`             | Free-text additional info               |
| `stockLocationIdentifier` | `String`             | Stock location identifier               |
| `relatedOrderIds`         | `[String]`           | IDs of related orders                   |
| `createdAt`               | `DateTime`           | Creation timestamp                      |
| `updatedAt`               | `DateTime`           | Last update timestamp                   |
| `context`                 | `HashMap`            | Order context (pricing, language)       |
| `customer`                | `Customer`           | Customer details                        |
| `items`                   | `[Item]`             | Order line items                        |
| `total`                   | `TotalPrice!`        | Order totals                            |
| `paymentStatus`           | `OrderPaymentStatus` | `paid`, `unpaid`, `refunded`, etc.      |
| `payments`                | `[Payment]`          | Payment records                         |
| `pipelines`               | `[Pipeline]`         | Pipeline/workflow stage assignments     |
| `appliedPromotions`       | `[PromotionSlim!]`   | Applied promotion details               |
| `meta`                    | `HashMap`            | All metadata as key-value map           |
| `metaProperty(key)`       | `String`             | Single metadata value by key            |

### Item (Order Line Item)

| Field                    | Type           | Description                         |
| ------------------------ | -------------- | ----------------------------------- |
| `name`                   | `String!`      | Item display name                   |
| `sku`                    | `String`       | Product SKU                         |
| `productId`              | `String`       | Crystallize product ID              |
| `quantity`               | `PositiveInt`  | Quantity ordered                    |
| `group`                  | `String`       | Item grouping                       |
| `type`                   | `CartItemType` | `standard`, `shipping`, `fee`, etc. |
| `imageUrl`               | `String`       | Item image URL                      |
| `price`                  | `ItemPrice!`   | Unit price                          |
| `subTotal`               | `ItemPrice!`   | Line total (price × quantity)       |
| `subscriptionContractId` | `String`       | Subscription contract reference     |
| `subscription`           | `Subscription` | Subscription details                |
| `meta`                   | `HashMap`      | Item-level metadata                 |

### ItemPrice / TotalPrice

| Field        | Type          | Description         |
| ------------ | ------------- | ------------------- |
| `gross`      | `Float!`      | Price including tax |
| `net`        | `Float!`      | Price excluding tax |
| `taxAmount`  | `Float!`      | Tax amount          |
| `taxPercent` | `Float!`      | Tax percentage      |
| `currency`   | `String!`     | Currency code       |
| `discounts`  | `[Discount!]` | Applied discounts   |

TotalPrice also includes:

| Field          | Type                   | Description |
| -------------- | ---------------------- | ----------- |
| `taxBreakdown` | `[TaxBreakdownEntry!]` | Tax by rate |

### Customer

| Field                | Type           | Description                    |
| -------------------- | -------------- | ------------------------------ |
| `isGuest`            | `Boolean!`     | Whether customer is guest      |
| `identifier`         | `String`       | Unique customer ID             |
| `firstName`          | `String`       | First name                     |
| `lastName`           | `String`       | Last name                      |
| `middleName`         | `String`       | Middle name                    |
| `email`              | `String`       | Email address                  |
| `phone`              | `String`       | Phone number                   |
| `birthDate`          | `DateTime`     | Date of birth                  |
| `companyName`        | `String`       | Company name                   |
| `taxNumber`          | `String`       | Tax/VAT number                 |
| `type`               | `CustomerType` | `individual` or `organization` |
| `externalReference`  | `String`       | External reference             |
| `externalReferences` | `HashMap`      | Multiple external refs         |
| `addresses`          | `[Address]`    | Customer addresses             |
| `meta`               | `HashMap`      | Customer metadata              |

### Payment

| Field           | Type      | Description                       |
| --------------- | --------- | --------------------------------- |
| `provider`      | `String`  | Payment provider (e.g., "stripe") |
| `transactionId` | `String`  | Transaction reference             |
| `amount`        | `Float`   | Payment amount                    |
| `method`        | `String`  | Payment method (e.g., "card")     |
| `createdAt`     | `String`  | Payment timestamp                 |
| `meta`          | `HashMap` | Payment metadata                  |

### Pipeline

| Field        | Type     | Description         |
| ------------ | -------- | ------------------- |
| `identifier` | `String` | Pipeline identifier |
| `stage`      | `String` | Current stage       |

## Related

- [Shop API Cart Queries](shop-api-queries.md) - Cart queries (`/cart` endpoint)
- [Shop API Order Mutations](../../mutation/references/shop-api-order-mutations.md) - Creating and managing orders (`/order` endpoint)
