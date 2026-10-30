# Shop API Order Mutations Reference

The Shop API `/order` scope provides mutations for creating and managing orders. This is a **separate endpoint** from the `/cart` scope.

See [SKILL.md](../SKILL.md) for endpoint URLs and authentication headers. This file covers the `/order` endpoint. Order mutations use `/order`, NOT `/cart` — the `createFromCart` mutation and all order management mutations must be sent to this endpoint.

## Create Order from Cart

Convert a placed cart into an order. The cart must be in "placed" state first (via `place` mutation on the `/cart` endpoint). Any other state fails, so a second call on the same cart fails too: the first one left it `ordered`.

**The order is saved just after the answer.** An `addPayments` or `addToStage` sent right behind `createFromCart` can miss it, and an immediate read can lag. Pass `paymentStatus`, `payments` and `pipelines` in this input instead of chaining calls.

```graphql
mutation CreateOrderFromCart($id: UUID!, $input: OrderFromCartInput) {
    createFromCart(id: $id, input: $input) {
        id
        coreId
        type
        paymentStatus
        total {
            gross
            net
            taxAmount
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
        customer {
            firstName
            lastName
            email
        }
        createdAt
    }
}
```

Variables:

```json
{
    "id": "cart-uuid-here",
    "input": {
        "type": "standard",
        "paymentStatus": "paid"
    }
}
```

### OrderFromCartInput

| Field                     | Type                   | Description                                  |
| ------------------------- | ---------------------- | -------------------------------------------- |
| `type`                    | `OrderType` enum       | Order type. No default: pass `standard`      |
| `paymentStatus`           | `OrderPaymentStatus`   | Payment status. Set here or never, see below |
| `payments`                | `[OrderPaymentInput]`  | Payment records                              |
| `pipelines`               | `[OrderPipelineInput]` | Pipeline stage assignments                   |
| `stockLocationIdentifier` | `String`               | Stock location for inventory                 |
| `relatedOrderIds`         | `[String]`             | Related **Core** order ids (`coreId`)        |
| `additionalInformation`   | `String`               | Free-text additional info                    |

## Create Order Directly

Create an order without a cart (e.g., for POS, imports, or manual order creation).

```graphql
mutation CreateOrder($input: OrderInput!) {
    create(input: $input) {
        id
        coreId
        type
        paymentStatus
        total {
            gross
            net
            taxAmount
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
        createdAt
    }
}
```

Variables:

```json
{
    "input": {
        "customer": {
            "isGuest": false,
            "firstName": "John",
            "lastName": "Doe",
            "email": "john@example.com",
            "identifier": "john@example.com",
            "addresses": [
                {
                    "type": "billing",
                    "street": "123 Main St",
                    "city": "New York",
                    "postalCode": "10001",
                    "country": "US"
                },
                {
                    "type": "delivery",
                    "street": "456 Oak Ave",
                    "city": "Brooklyn",
                    "postalCode": "11201",
                    "country": "US"
                }
            ]
        },
        "items": [
            {
                "name": "Robot Action Figure",
                "sku": "robot-pink-standard",
                "quantity": 2,
                "productId": "product-id",
                "imageUrl": "https://example.com/robot.jpg",
                "price": {
                    "gross": 49.99,
                    "net": 39.99
                }
            }
        ],
        "type": "standard",
        "paymentStatus": "paid",
        "payments": [
            {
                "provider": "stripe",
                "transactionId": "pi_abc123",
                "amount": 99.98,
                "method": "card",
                "createdAt": "2025-01-15T10:30:00Z"
            }
        ],
        "meta": [
            { "key": "source", "value": "web" },
            { "key": "campaign", "value": "summer-sale" }
        ]
    }
}
```

### OrderInput

| Field                     | Type                   | Required | Description                                                                                                 |
| ------------------------- | ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `items`                   | `[OrderItemInput]`     | No       | Order line items                                                                                            |
| `customer`                | `CustomerInput`        | No       | Customer information                                                                                        |
| `context`                 | `OrderContextInput`    | No       | `{ language, price: { currency, decimals, discountOnNetPrices } }`. `currency` defaults to `eur`, so set it |
| `type`                    | `OrderType`            | No       | Order type. No default: pass `standard`                                                                     |
| `paymentStatus`           | `OrderPaymentStatus`   | No       | Payment status. Set here or never, see below                                                                |
| `payments`                | `[OrderPaymentInput]`  | No       | Payment records                                                                                             |
| `pipelines`               | `[OrderPipelineInput]` | No       | Pipeline stage assignments                                                                                  |
| `stockLocationIdentifier` | `String`               | No       | Stock location for inventory deduction                                                                      |
| `relatedOrderIds`         | `[String]`             | No       | Related **Core** order ids (`coreId`), for returns and replacements. A Shop id fails the sync to Core       |
| `additionalInformation`   | `String`               | No       | Free-text additional info                                                                                   |
| `meta`                    | `[KeyValueInput]`      | No       | Arbitrary key-value metadata                                                                                |
| `createdAt`               | `DateTime`             | No       | Override creation timestamp                                                                                 |

### OrderItemInput

| Field                    | Type                         | Required | Description                    |
| ------------------------ | ---------------------------- | -------- | ------------------------------ |
| `name`                   | `String!`                    | Yes      | Item display name              |
| `sku`                    | `String!`                    | Yes      | Item SKU                       |
| `quantity`               | `PositiveInt!`               | Yes      | Quantity ordered               |
| `price`                  | `PriceInput!`                | Yes      | Unit price (gross + net)       |
| `productId`              | `String`                     | No       | Crystallize product ID         |
| `imageUrl`               | `String`                     | No       | Item image URL                 |
| `group`                  | `String`                     | No       | Free-form group label          |
| `type`                   | `CartItemType`               | No       | Line type, see the enum below  |
| `promotions`             | `[Float]`                    | No       | Discount amounts on item total |
| `subscriptionContractId` | `String`                     | No       | Subscription contract ID       |
| `subscription`           | `OrderItemSubscriptionInput` | No       | Subscription details           |
| `meta`                   | `[KeyValueInput]`            | No       | Item-level metadata            |

### PriceInput

| Field       | Type              | Required | Description         |
| ----------- | ----------------- | -------- | ------------------- |
| `gross`     | `Float!`          | Yes      | Price including tax |
| `net`       | `Float!`          | Yes      | Price excluding tax |
| `discounts` | `[DiscountInput]` | No       | Applied discounts   |

### CustomerInput

| Field                | Type              | Required | Description                              |
| -------------------- | ----------------- | -------- | ---------------------------------------- |
| `isGuest`            | `Boolean!`        | Yes      | Whether customer is guest                |
| `identifier`         | `String`          | No       | Unique customer ID                       |
| `firstName`          | `String`          | No       | First name                               |
| `lastName`           | `String`          | No       | Last name                                |
| `middleName`         | `String`          | No       | Middle name                              |
| `email`              | `String`          | No       | Email address                            |
| `phone`              | `String`          | No       | Phone number                             |
| `birthDate`          | `DateTime`        | No       | Date of birth                            |
| `companyName`        | `String`          | No       | Company name                             |
| `taxNumber`          | `String`          | No       | Tax/VAT number                           |
| `type`               | `CustomerType`    | No       | `individual` (default) or `organization` |
| `externalReferences` | `[KeyValueInput]` | No       | External system references               |
| `addresses`          | `[AddressInput]`  | No       | Customer addresses                       |
| `meta`               | `[KeyValueInput]` | No       | Customer metadata                        |

### AddressInput

| Field          | Type              | Required | Description                       |
| -------------- | ----------------- | -------- | --------------------------------- |
| `type`         | `AddressType`     | No       | `delivery`, `billing`, or `other` |
| `firstName`    | `String`          | No       | First name                        |
| `middleName`   | `String`          | No       | Middle name                       |
| `lastName`     | `String`          | No       | Last name                         |
| `street`       | `String`          | No       | Street address                    |
| `street2`      | `String`          | No       | Additional street info            |
| `streetNumber` | `String`          | No       | Street number                     |
| `postalCode`   | `String`          | No       | Postal/ZIP code                   |
| `city`         | `String`          | No       | City                              |
| `state`        | `String`          | No       | State/province                    |
| `country`      | `String`          | No       | Country code                      |
| `phone`        | `String`          | No       | Phone number                      |
| `email`        | `String`          | No       | Email address                     |
| `meta`         | `[KeyValueInput]` | No       | Address metadata                  |

### OrderPaymentInput

| Field           | Type              | Required | Description           |
| --------------- | ----------------- | -------- | --------------------- |
| `provider`      | `String`          | No       | Payment provider name |
| `transactionId` | `String`          | No       | Transaction reference |
| `amount`        | `Float`           | No       | Payment amount        |
| `method`        | `String`          | No       | Payment method        |
| `createdAt`     | `DateTime`        | No       | Payment timestamp     |
| `meta`          | `[KeyValueInput]` | No       | Payment metadata      |

### OrderPipelineInput

| Field        | Type      | Required | Description                                                   |
| ------------ | --------- | -------- | ------------------------------------------------------------- |
| `identifier` | `String!` | Yes      | The pipeline **id**, not its name                             |
| `stage`      | `String`  | Yes      | The stage **id**. The schema allows null, validation does not |

These are ids, see [Pipeline Management](#pipeline-management). When `pipelines` is left out, the Core order lands in the pipelines the tenant set up for new orders.

## Add Payments to Order

Add payment records to an existing order.

```graphql
mutation AddPayments($id: UUID!, $payments: [OrderPaymentInput!]!) {
    addPayments(id: $id, payments: $payments) {
        id
        paymentStatus
        payments {
            provider
            transactionId
            amount
            method
            createdAt
        }
    }
}
```

Variables:

```json
{
    "id": "order-uuid",
    "payments": [
        {
            "provider": "stripe",
            "transactionId": "pi_xyz789",
            "amount": 99.98,
            "method": "card",
            "createdAt": "2025-01-15T10:30:00Z"
        }
    ]
}
```

## Replace All Payments

Replace all payment records on an order.

Neither mutation changes `paymentStatus`, and the `/order` endpoint has no mutation for it: it is set once, by `create` or `createFromCart`. See [[payments]] for tracking captures and refunds afterwards.

```graphql
mutation SetPayments($id: UUID!, $payments: [OrderPaymentInput!]!) {
    setPayments(id: $id, payments: $payments) {
        id
        paymentStatus
        payments {
            provider
            transactionId
            amount
        }
    }
}
```

## Set Order Metadata

Set or merge metadata on an order.

```graphql
mutation SetOrderMeta($id: UUID, $meta: [KeyValueInput], $merge: Boolean) {
    setMeta(id: $id, meta: $meta, merge: $merge) {
        id
        meta
    }
}
```

Variables:

```json
{
    "id": "order-uuid",
    "meta": [
        { "key": "fulfillment_status", "value": "shipped" },
        { "key": "tracking_number", "value": "1Z999AA10123456784" }
    ],
    "merge": true
}
```

When `merge` is `true` (default), new keys are added and existing keys are updated. When `false`, all existing metadata is replaced.

## Set Order Customer

Update the customer information on an existing order. It replaces the customer, and `isGuest` is required.

```graphql
mutation SetOrderCustomer($id: UUID!, $customer: CustomerInput!) {
    setCustomer(id: $id, customer: $customer) {
        id
        customer {
            firstName
            lastName
            email
            identifier
        }
    }
}
```

## Create Order from Subscription Contract

`createFromSubscriptionContract` is in the schema but not implemented: every call errors. Read the `orderIntent` query on the `/subscription-contract` endpoint and pass the result to `create`. See [[subscriptions]].

## Pipeline Management

`pipeline` and `stage` take the pipeline **id** and the stage **id**, not their names, here and in `pipelines` on `create` and `createFromCart`. Read them from the PIM API (`pipeline { getMany(tenantId:) { edges { node { id name stages { id name } } } } }`). **The Shop API does not check them:** the mutation succeeds and stores what you sent, and a name there stops the order from syncing to Core.

### Add Order to Pipeline Stage

Put an order in a pipeline stage. An order holds one stage per pipeline, so calling this again on the same pipeline moves it, and its other pipelines are untouched.

```graphql
mutation AddToStage($id: UUID!, $pipeline: String!, $stage: String!) {
    addToStage(id: $id, pipeline: $pipeline, stage: $stage) {
        id
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
    "id": "order-uuid",
    "pipeline": "<pipeline id>",
    "stage": "<stage id>"
}
```

### Remove Order from Pipeline

```graphql
mutation RemoveFromPipeline($id: UUID!, $pipeline: String!) {
    removeFromPipeline(id: $id, pipeline: $pipeline) {
        id
        pipelines {
            identifier
            stage
        }
    }
}
```

## Enums

### OrderType

| Value         | Description                          |
| ------------- | ------------------------------------ |
| `standard`    | Regular order                        |
| `draft`       | Draft order (not finalized)          |
| `creditNote`  | Credit note / refund                 |
| `replacement` | Replacement order                    |
| `backorder`   | Backorder (out-of-stock fulfillment) |
| `preOrder`    | Pre-order                            |
| `quote`       | Price quote                          |
| `recurring`   | Recurring/subscription order         |
| `split`       | Split order (partial shipment)       |
| `test`        | Test order                           |

### OrderPaymentStatus

| Value               | Description        |
| ------------------- | ------------------ |
| `paid`              | Fully paid         |
| `partiallyPaid`     | Partially paid     |
| `partiallyRefunded` | Partially refunded |
| `refunded`          | Fully refunded     |
| `unpaid`            | Not yet paid       |

### CustomerType

| Value          | Description       |
| -------------- | ----------------- |
| `individual`   | Individual person |
| `organization` | Company/org       |

### AddressType

| Value      | Description      |
| ---------- | ---------------- |
| `delivery` | Shipping address |
| `billing`  | Billing address  |
| `other`    | Other address    |

### CartItemType (on Order items)

| Value          | Description          |
| -------------- | -------------------- |
| `standard`     | Regular product item |
| `subscription` | Subscription item    |
| `shipping`     | Shipping fee         |
| `fee`          | Additional fee       |
| `promotion`    | Promotional item     |
| `refund`       | Refund line          |
| `service`      | Service item         |
| `digital`      | Digital product      |
| `bonus`        | Bonus/gift item      |
| `tax`          | Tax line item        |

## Order Response Type

The `Order` type returned by all mutations:

| Field                     | Type                 | Description                              |
| ------------------------- | -------------------- | ---------------------------------------- |
| `id`                      | `UUID!`              | Shop API order ID                        |
| `coreId`                  | `String`             | Core API order ID                        |
| `reference`               | `String`             | Order reference                          |
| `type`                    | `OrderType`          | Order type enum                          |
| `additionalInformation`   | `String`             | Additional info text                     |
| `stockLocationIdentifier` | `String`             | Stock location                           |
| `relatedOrderIds`         | `[String]`           | Related order IDs                        |
| `createdAt`               | `DateTime`           | Creation timestamp                       |
| `updatedAt`               | `DateTime`           | Last update timestamp                    |
| `context`                 | `HashMap`            | Order context (pricing, language)        |
| `customer`                | `Customer`           | Customer details with addresses          |
| `items`                   | `[Item]`             | Order line items                         |
| `total`                   | `TotalPrice!`        | Order totals (gross, net, tax, currency) |
| `paymentStatus`           | `OrderPaymentStatus` | Payment status                           |
| `payments`                | `[Payment]`          | Payment records                          |
| `pipelines`               | `[Pipeline]`         | Pipeline stage assignments               |
| `appliedPromotions`       | `[PromotionSlim!]`   | Applied promotions                       |
| `meta`                    | `HashMap`            | All metadata as key-value map            |
| `metaProperty`            | `String`             | Single metadata property by key          |

## Complete Checkout Flow (Cart → Order)

The full checkout flow spans both `/cart` and `/order` endpoints:

```
1. Hydrate Cart        → POST /cart   (hydrate mutation)
2. Set Customer        → POST /cart   (setCustomer mutation)
3. Place Cart          → POST /cart   (place mutation)
4. Create Order        → POST /order  (createFromCart mutation)
```

```graphql
# Step 1: Hydrate cart (on /cart endpoint)
mutation {
    hydrate(input: { items: [{ sku: "product-sku", quantity: 1 }] }) {
        id
    }
}

# Step 2: Set customer info (on /cart endpoint)
mutation {
    setCustomer(
        id: "cart-id"
        input: { isGuest: false, firstName: "John", lastName: "Doe", email: "john@example.com" }
    ) {
        id
    }
}

# Step 3: Place the cart (on /cart endpoint)
mutation {
    place(id: "cart-id") {
        id
    }
}

# Step 4: Create order from cart (on /order endpoint — DIFFERENT ENDPOINT!)
mutation {
    createFromCart(id: "cart-id", input: { type: standard, paymentStatus: paid }) {
        id
        coreId
        total {
            gross
            net
            currency
        }
    }
}
```

`createFromCart` also moves the cart to `ordered` and sets its `orderId`. The order id is the cart id, so
there is nothing left to link: do not follow it with `fulfill`.

## The Order Store and Core

Shop API orders and Core orders are the same orders in two stores, synced asynchronously in both
directions. Where an order was born decides what a Core write does to it.

**Shop → Core.** An order created here gets its `coreId` in about ten seconds, and `addToStage`
moves the Core stage with it. (`coreId` can still read `null` in the answer of a Shop `create` even after
the order has reached Core, so don't use it as a sync flag.)

| Born in                               | Core `updateOrder`                                     | Core `deleteOrder`             |
| ------------------------------------- | ------------------------------------------------------ | ------------------------------ |
| Shop API (`create`, `createFromCart`) | Rewrites the same Shop order with Core's whole version | Removes it from the Shop store |
| Core (`registerOrder`)                | **Adds another copy** to the Shop store                | Removes only the latest copy   |

**A stage moved in Core or the App does not reach the Shop store, and the next Shop write puts it back.**
Every `/order` mutation sends the whole Shop order to Core, and Core makes the order's pipelines match it: a
stage that differs is moved back, a pipeline that is missing is removed. Before a Shop write to an order whose
stage may have moved, read the stages from Core and copy them over with `addToStage`. [[payments]] has a helper.

**Seed demo orders with the Shop API, not with `registerOrder`**, if a storefront is going to list them:
orders registered in Core showed up in the Shop store only sometimes.

**Editing an order born in Core adds another copy of it to the Shop store.** Such an order has no Shop id
to come back to, so every change arrives as a new order. Three `updateOrder` calls on one seeded order left
three orders in `orders(customerIdentifier:)` — new Shop ids, the same `coreId`, different `updatedAt`. A
storefront that sums that list counts the same money several times over; the Lab Universe build read a
department budget of NOK 1,249,299 instead of 411,775. So:

- **Change orders through the Shop API** (`setMeta`, `addToStage`, `setPayments`) whenever a storefront
  reads them. On an order born here, a Core edit also overwrites whatever the Shop wrote just before it.
- If an order born in Core must be edited there anyway, have the reader **group by `coreId` and keep the
  most recently updated copy**.

**There is no delete on the Shop API.** Cancelled or mistaken orders stay in the list until `deleteOrder`
on the Core order removes them. Otherwise archive them with `setMeta` (`archived: true`) and filter them
out when reading.

(Both findings come from the Tools Universe and Lab Universe builds.)

## Best Practices

1. **Use the correct endpoint** — Cart operations on `/cart`, order operations on `/order`
2. **Include `order` scope in JWT** — Token must have `order` scope for `/order` endpoint: `"scopes": ["cart", "order"]` when you request it
3. **Place cart before creating order** — `createFromCart` requires the cart to be in "placed" state
4. **Always check for errors** — Validate `result?.errors` in responses
5. **Use `meta` for custom data** — Store fulfillment status, tracking numbers, external references
6. **Use pipelines for workflow** — Track orders through fulfillment stages
7. **Use `coreId`** — When you need to reference the order in Core API mutations
8. **Write in one store** — If a storefront reads the orders, create and change them here, not in Core
9. **Resolve pipeline names up front** — Orders carry pipeline and stage **ids** only; map them to names at build or seed time from the admin APIs

## Related

- [Shop API Cart Mutations](shop-api-mutations.md) - Cart hydration and management (`/cart` endpoint)
- [Shop API Order Queries](../../query/references/shop-api-order-queries.md) - Querying orders (`/order` endpoint)
