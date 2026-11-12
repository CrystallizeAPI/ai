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

Retrieve an order by its Shop API UUID. The argument is `UUID!`: a variable typed `ID` or `String` fails validation.
An unknown id answers a GraphQL error, not `null`, and so can an order created a moment ago, so a confirmation page
shows the order that `createFromCart` returned and retries `order(id:)` rather than reporting "not found". Several
orders by id in one request (one alias each) worked well.

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
                percent
                base
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

**`limit`/`skip` do not page by date.** `limit` defaults to 10 and the window is taken over the customer's
orders **oldest first**; only the orders inside it are then sorted newest first. So a default call for a
customer with 30 orders answers their ten oldest, not their ten latest. A page can also come back short
without being the last: `limit: 10` returned 5 orders and then 4 for a customer with 9 in the Tools Universe
build. Ask for everything a customer has in one page (`limit: 100`) rather than walking pages.

For a company or a department there is no query by parent: read the people's orders and filter on your
own `meta` (the ordering person, the cost centre). A seller or approval queue across customers is a back-office
read: Core `orders(filter: { meta, pipelineStageIds, customer })` behind staff login, or an index fed by webhooks.

### The listing lags, and is sometimes incomplete

`orders(customerIdentifier:)` reads a second, eventually consistent store. Seen on five builds:

- New orders appear after **seconds to minutes**. Six orders created one at a time all listed after about 60 s.
- **Some never appear.** 47 orders created at concurrency 4: Core had all 47, the listing showed 29 and stayed there
  (Felleskjøpet). Two hours after an import, `limit: 100` returned 6 of 8 and 4 of 5 orders for two customers
  (WoolLand).
- `coreId` is `null` on some orders that have reached Core.

So:

1. **Read what you just wrote by id**, never through the listing.
2. **Never use the listing for idempotency** (has this seed or webhook already created the order?): it creates
   duplicates on a quick rerun. Key on your own meta (`seedRef`) checked by id, keep a ledger, or take a `/lock`.
3. The confirmation page and order history say that a new order can take a moment to appear.
4. A seed checks the listing per customer afterwards and recreates what is missing, rather than trusting one pass.

## The Order Store and Core

Shop API orders and Core orders are the same orders in two stores, synced asynchronously in both
directions. How an order was **created** decides how that behaves, and so how a storefront should read it.

**An order created with the Shop API stays one order.** It gets its `coreId` in about ten seconds and keeps
its Shop id for good: `addToStage` on the Shop API moves the Core stage too, and an edit, stage change or
delete in Core lands on that same order.

**An order registered in Core and edited there appears more than once here.** It has no Shop id, so every
change Core pushes arrives as a new order. Three `updateOrder` calls on one seeded order left **three** orders in
`orders(customerIdentifier:)`: new Shop ids, the same `coreId`, different `updatedAt`. A storefront that sums
an order list then counts the same money several times over — the Lab Universe build saw a department budget
of NOK 1,249,299 instead of 411,775. `deleteOrder` in Core removes only the latest copy. Two defences, use
both:

1. **Group by `coreId` and keep the most recently updated copy** whenever you read a list. A null `coreId` is
   not a group: those orders stay separate.
2. **Change orders through the Shop API** (`setMeta`, `addToStage`) when a storefront reads them, so no
   copy is ever made.

So a storefront that lists orders with the Shop API should have them **created** there, and **moved between
stages** there. Seed demo orders with the Shop API, not with `registerOrder`: orders registered in Core
showed up in the Shop store only sometimes. (Tools Universe.)

Smaller consequences:

- **`pipelines` comes back as identifiers only** (`{ identifier, stage }`). A storefront that shows a
  stage name maps the ids to names itself: read them with PIM `pipeline.getMany` at **build time** and write
  them into the storefront's data, never at runtime.
- **`coreId` can read `null`** on an order created with Shop `create` even after it has reached Core.
  Don't treat a null `coreId` as "not synced yet".
- **`meta` is a JSON object** `{ key: value }`, on orders and on lines, although it is written as `[{ key, value }]`.
- **An order line's `imageUrl` is a rendition** (`…/@200/x.jpeg`). Strip the `@<width>` segment before deriving
  another size.
- **Orders of type `test` count toward a promotion's `maxUsagePerCustomer`**, and Shop orders can't be deleted, so
  never test with a demo persona's identifier.
- **Renewal orders** of subscription contracts land in the store that holds the contracts: see [[subscriptions]].
- **Does Core `deleteOrder` reach the Shop store?** Observed both ways: two builds saw the Shop copy stay, one saw it
  disappear from the listing within a minute. Verify on your tenant before relying on either.

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
