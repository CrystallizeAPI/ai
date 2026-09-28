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
    "limit": 100,
    "skip": 0
}
```

> **Scope this on the server.** The JWT is per tenant, not per shopper: `orders` answers for whatever
> `customerIdentifier` it is given. Take the identifier from the session and never from the client. The
> same holds for `subscriptionContracts(customerIdentifier:)` on the `/subscription-contract` endpoint.

**`limit`/`skip` paged inconsistently** in the Tools Universe build: `limit: 10` returned 5 orders and
then 4 for a customer with 9. Ask for everything a customer has in one page (`limit: 100`) rather than
walking pages.

For a company or a department there is no query by parent: read the people's orders and filter on your
own `meta` (the ordering person, the cost centre).

## The Order Store and Core

Shop API orders and Core orders are the same orders in two stores, and they do **not** converge. Two
build findings decide how a storefront should read them.

**Orders edited in Core appear more than once here.** Three `order { update }` calls on one seeded order
left **three** orders in `orders(customerIdentifier:)`: new Shop ids, the same `coreId`, different
`updatedAt`. A storefront that sums an order list then counts the same money several times over — the Lab
Universe build saw a department budget of NOK 1,249,299 instead of 411,775. Two defences, use both:

1. **Group by `coreId` and keep the most recently updated copy** whenever you read a list.
2. **Change orders through the Shop API** (`setMeta`, `addToStage`) when a storefront reads them, so no
   copy is ever made.

**The sync runs one way, Shop → Core.** An order created with the Shop API gets its `coreId` in about ten
seconds, and `addToStage` on the Shop API moves the Core stage too. Nothing comes back the other way:
orders registered in Core with `registerOrder` showed up in the Shop store only sometimes, carrying the
pipelines they had at creation time, and a later `updateOrderPipelineStage` or `deleteOrder` in Core never
reached the Shop store at all (watched for minutes). So a storefront that lists orders with the Shop API
must have them **created** there, and **moved between stages** there. Seed demo orders with the Shop API,
not with `registerOrder`. (Tools Universe.)

Two smaller consequences:

- **`pipelines` comes back as identifiers only** (`{ identifier, stage }`). A storefront that shows a
  stage name has to map the ids to names itself; the names live in the admin APIs, so resolve them at
  build or seed time rather than at runtime.
- **`coreId` can read `null`** on an order created with Shop `create` even after it has reached Core.
  Don't treat a null `coreId` as "not synced yet".

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
