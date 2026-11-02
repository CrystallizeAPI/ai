# Core API Queries Reference

The Core API provides comprehensive read access to items, customers, orders, shapes, and tenant configuration. Use this for admin interfaces, reporting, and complex filtering needs.

## Table of Contents

- [Base URL](#base-url)
- [Authentication](#authentication)
- [Core API vs Other APIs](#core-api-vs-other-apis)
- [Reading a Core Response](#reading-a-core-response) — Union results, component content, nulls, paging
- [Item Queries](#item-queries) — Get by ID, list with pagination, get components, check identifiers
- [Customer Queries](#customer-queries) — Get by identifier, list, customer groups
- [Order Queries](#order-queries) — Get by ID, list with advanced filtering
- [Shape and Piece Queries](#shape-and-piece-queries) — Shape definitions, pieces
- [Flow Queries](#flow-queries) — Flows and flow content
- [Archive Queries](#archive-queries) — Archived versions
- [Bulk Task Queries](#bulk-task-queries) — Task status and listing
- [File and Image Queries](#file-and-image-queries) — Images
- [Error Handling](#error-handling) — Union return types
- [TypeScript Types](#typescript-types)

## Base URL

```
https://api.crystallize.com/@{tenant-identifier}
```

Note the `@` prefix before the tenant identifier.

## Authentication

Authentication is required. Use access tokens generated in the Crystallize App:

```bash
curl -X POST 'https://api.crystallize.com/@your-tenant' \
  -H 'Content-Type: application/json' \
  -H 'X-Crystallize-Access-Token-Id: YOUR_TOKEN_ID' \
  -H 'X-Crystallize-Access-Token-Secret: YOUR_TOKEN_SECRET' \
  -d '{"query": "..."}'
```

## Core API vs Other APIs

**Use Core API for:**

- Admin interfaces and dashboards
- Complex order filtering (by customer, SKU, payment provider)
- Reading shape/piece definitions
- Customer management
- Bulk data access

**Use Discovery/Catalogue API for:**

- Storefront product listings
- Search and filtering
- Public content access

## Reading a Core Response

Every query below follows these rules. The first three are checked before anything runs, so breaking one
fails the whole request with a validation error.

- **The tenant comes from the URL.** No query takes a `tenantId` argument.
- **The root fields below return a union.** Select the result with `... on <Type>` and the failure with
  `... on BasicError`; `items(...) { edges }` without a fragment does not validate. The list types are
  `ItemConnection`, `CustomerConnection`, `CustomerGroupConnection`, `OrderConnection`, `PieceConnection`,
  `FlowContentConnection`, `ArchivedItemVersionConnection`, `BulkTaskConnection` and `ImageConnection`.
  `shapes` is the exception: it returns a plain `ShapeConnection`.
- **`content` and `config` are unions too.** Give `content` one fragment per component type you expect. The
  names carry `Component` here (`RichTextComponentContent`), unlike the Catalogue API (`RichTextContent`).
- **A missing record is `null`, not an error.** `item`, `customer` and `order` answer `null` when nothing
  matches, so a client has to handle `null` as well as the union members.
- **An empty page has `edges: null`, not `[]`.** Guard before mapping over it.
- **Keep the same `sort` on every page.** The cursor carries the sort field, and a different one is refused:
  `Invalid pagination options: cannot provide a sort field and a cursor at the same time.` `first`/`after`
  cannot be mixed with `last`/`before` either.

## Item Queries

### Get Item by ID

```graphql
query GetItem {
    item(id: "item-id", language: "en") {
        ... on Product {
            id
            name
            shapeIdentifier
            tree {
                path
                parentId
            }
            components {
                componentId
                type
                content {
                    ... on SingleLineComponentContent {
                        text
                    }
                    ... on RichTextComponentContent {
                        html
                    }
                }
            }
            defaultVariant {
                sku
                name
                price
                stock
                images {
                    url
                    altText
                }
            }
            variants {
                sku
                name
                price
                stock
            }
        }
        ... on Document {
            id
            name
            shapeIdentifier
            components {
                componentId
                type
            }
        }
        ... on Folder {
            id
            name
            shapeIdentifier
            tree {
                path
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`item` and `items` read the `current` version unless told otherwise (`versionLabel`: `current`, `draft` or
`published`). `price` and `stock` read the `default` price variant and stock location: pass `identifier:`, or
select `priceVariants` and `stockLocations`. A Core `Folder` has no `children` field; list them with
`items(filter: { parentItemId: "folder-id" })`.

### List Items with Pagination

> **`first` defaults to 25 and caps at 100.** Asking for more is refused —
> `Invalid pagination options: Cannot list more than 100 items at a time.` — and it arrives as an
> `INTERNAL_SERVER_ERROR` with the path pointing at whatever field you selected, which makes it look like
> something else went wrong. Page with `after` instead. Verified on a live tenant: `first: 100` returned
> 100 rows of 540 with `hasNextPage: true`, while `first: 150` and `first: 500` both errored.

```graphql
query ListItems {
    items(
        language: "en"
        first: 20
        after: "cursor"
        filter: {
            shapeIdentifiers: ["product", "bundle"]
            # parentItemId: "folder-id"
            # topicId: "topic-id"
        }
        sort: { field: createdAt, direction: desc }
    ) {
        ... on ItemConnection {
            edges {
                cursor
                node {
                    id
                    name
                    type
                    shapeIdentifier
                    createdAt
                    updatedAt
                    ... on Product {
                        defaultVariant {
                            sku
                            price
                            stock
                        }
                    }
                }
            }
            pageInfo {
                hasNextPage
                hasPreviousPage
                startCursor
                endCursor
            }
            totalCount
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`sort.field` is `name` (the default), `createdAt` or `position`: `updatedAt` is not sortable here. `filter` also
takes `type`, `shapeIdentifier`, `name` (case-insensitive substring), `itemIds`, `externalReferences`,
`relatingToItemId`, `imageKeys`, `videoKeys` and `fileKeys`. `parentItemId` lists direct children, shortcuts
included.

### Get Item Component

Read a specific component from an item:

```graphql
query GetItemComponent {
    item(id: "item-id", language: "en") {
        ... on Item {
            id
            component(id: "description") {
                componentId
                content {
                    ... on RichTextComponentContent {
                        html
                    }
                }
            }
        }
    }
}
```

### Check Identifier Availability

```graphql
query CheckIdentifier {
    isIdentifierAvailable(desired: "new-shape", type: shape) {
        ... on IdentifierAvailability {
            isAvailable
            suggestion
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`type` is required: `flow`, `flowStage`, `priceVariant`, `role`, `shape`, `stockLocation`, `customer` or
`customerGroup`. `suggestion` is a free alternative when `isAvailable` is false.

## Customer Queries

### Get Customer by Identifier

```graphql
query GetCustomer {
    customer(identifier: "customer@example.com") {
        ... on Customer {
            identifier
            type
            firstName
            lastName
            email
            phone
            companyName
            taxNumber
            addresses {
                type
                firstName
                lastName
                street
                street2
                city
                state
                postalCode
                country
                phone
                email
            }
            meta {
                key
                value
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

There is one `Customer` type for people and companies: `type` is `individual` or `organization`. Customers have
no `id`. `customer` also answers on `externalReference: { key: "erp", value: "1234" }` instead of `identifier`.

### List Customers

```graphql
query ListCustomers {
    customers(
        first: 20
        filter: {
            email: "jane@"
            # type: individual
        }
    ) {
        ... on CustomerConnection {
            edges {
                node {
                    identifier
                    type
                    firstName
                    lastName
                    email
                    companyName
                }
            }
            pageInfo {
                hasNextPage
                endCursor
            }
            totalCount
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`email` is a case-insensitive **prefix** match, so a domain such as `@example.com` finds nothing. `identifier`,
`firstName`, `lastName`, `companyName` and `phone` are case-insensitive substring matches. `filter` also takes
`type`, `meta: { key, value }`, `parent: { identifier, type }` and `logicalOperator` (`and` by default, `or` to
match any condition). `sort.field` is `createdAt` (the default), `name`, `identifier` or `type`.

### Get Customer Groups

```graphql
query GetCustomerGroup {
    customerGroup(identifier: "group-identifier") {
        ... on CustomerGroup {
            identifier
            name
            childCount
        }
        ... on BasicError {
            errorName
            message
        }
    }
}

query ListCustomerGroups {
    customerGroups(first: 20) {
        ... on CustomerGroupConnection {
            edges {
                node {
                    identifier
                    name
                    childCount
                }
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

A group does not list its members. Read them with
`customers(filter: { parent: { identifier: "group-identifier", type: customerGroup } })`.

## Order Queries

### Get Order by ID

```graphql
query GetOrder {
    order(id: "order-id") {
        ... on Order {
            id
            reference
            createdAt
            updatedAt
            customer {
                identifier
                firstName
                lastName
                email
            }
            cart {
                sku
                name
                quantity
                price {
                    net
                    gross
                    currency
                }
                imageUrl
            }
            total {
                net
                gross
                currency
            }
            payment {
                provider
                ... on StripePayment {
                    paymentIntentId
                }
            }
            meta {
                key
                value
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

### List Orders with Filtering

The Core API supports advanced order filtering by customer, SKU, payment provider, and metadata:

```graphql
query ListOrders {
    orders(
        first: 20
        filter: {
            customer: { identifier: "customer@example.com" }
            # sku: "PROD-123"
            # paymentProvider: stripe
            # meta: [{ key: "source", value: "mobile-app" }]
        }
        sort: { field: createdAt, direction: desc }
    ) {
        ... on OrderConnection {
            edges {
                cursor
                node {
                    id
                    createdAt
                    total {
                        gross
                        currency
                    }
                    customer {
                        identifier
                    }
                    cart {
                        sku
                        name
                        quantity
                        price {
                            gross
                        }
                    }
                }
            }
            pageInfo {
                hasNextPage
                endCursor
            }
            totalCount
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

**Filter Options:**

- `customer` - `{ identifier, firstName, lastName, email, companyName, address: { street, city, country } }`
- `sku` - Filter orders containing specific SKU
- `paymentProvider` - Enum: `cash`, `custom`, `klarna`, `paypal` or `stripe`
- `paymentStatus`, `types`, `reference` - Filter by payment status, order type or reference
- `meta` - Filter by metadata key/value pairs
- `createdAt`, `updatedAt` - Date range filtering: `{ min, max }`
- `totalPrice` - `{ min, max, type }`, where `type` is `net` (the default) or `gross`
- `pipelineId`, `pipelineIds`, `pipelineStageId`, `pipelineStageIds` - Filter by pipeline or stage
- `stockLocationIdentifier`, `appliedPromotionIdentifier`, `hasSubscription`, `subscriptionContractId`,
  `relatedToOrderId`

`sort.field` is `updatedAt` (the default) or `createdAt`, and `direction` defaults to `desc`.

## Shape and Piece Queries

### Get Shape Definition

```graphql
query GetShape {
    shape(identifier: "product") {
        ... on Shape {
            identifier
            name
            type
            components {
                id
                name
                type
                description
            }
            variantComponents {
                id
                name
                type
                description
            }
            resolvedConfiguration
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`config` on a component is the `ComponentConfig` union, so it needs one fragment per component type.
`resolvedConfiguration` is the whole definition as JSON with pieces expanded, which is usually what a script
wants.

### List All Shapes

`shapes` is the one root field here with no union around it.

```graphql
query ListShapes {
    shapes(first: 100) {
        edges {
            node {
                identifier
                name
                type
                itemCount
            }
        }
        pageInfo {
            hasNextPage
            endCursor
        }
        totalCount
    }
}
```

### Get Piece Definition

```graphql
query GetPiece {
    piece(identifier: "seo") {
        ... on Piece {
            identifier
            name
            components {
                id
                name
                type
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

### List All Pieces

```graphql
query ListPieces {
    pieces(first: 100) {
        ... on PieceConnection {
            edges {
                node {
                    identifier
                    name
                    components {
                        id
                        name
                        type
                    }
                }
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

## Flow Queries

### Get Flow

```graphql
query GetFlow {
    flow(identifier: "flow-identifier") {
        ... on Flow {
            identifier
            name
            type
            stages {
                identifier
                name
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

### Get Flow Content

List items in a flow stage:

```graphql
query GetFlowContent {
    flowContent(first: 20, filter: { stageIdentifier: "stage-identifier" }) {
        ... on FlowContentConnection {
            edges {
                node {
                    id
                    stageIdentifier
                    createdAt
                    data {
                        ... on FlowItemContentData {
                            language
                            version
                            item {
                                id
                                name
                                type
                            }
                        }
                    }
                }
            }
            pageInfo {
                hasNextPage
                endCursor
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

Flows and stages are addressed by `identifier`. `filter.item` takes `{ id, language, version }` to find where an
item sits, and `flowStage(identifier:)` reads one stage.

## Archive Queries

### Get Archived Version

```graphql
query GetArchive {
    archive(id: "archive-id") {
        ... on ArchivedItemVersion {
            id
            number
            name
            archivedAt
            archivedBy {
                email
            }
            item {
                id
                name
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`archive` takes either `id` alone, or `itemId`, `language` and `number` together (plus an optional
`versionLabel`, `published` by default). Mixing the two is refused.

### List Archived Versions

```graphql
query ListArchives {
    archives(filters: { itemId: "item-id", language: "en" }, first: 10, sort: { field: number, direction: desc }) {
        ... on ArchivedItemVersionConnection {
            edges {
                node {
                    id
                    number
                    name
                    archivedAt
                    archivedBy {
                        email
                    }
                }
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

## Bulk Task Queries

### Get Bulk Task Status

```graphql
query GetBulkTask {
    bulkTask(id: "task-id") {
        ... on BulkTask {
            id
            type
            status
            createdAt
            startedAt
            stoppedAt
            info
            actor {
                email
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

### List Bulk Tasks

```graphql
query ListBulkTasks {
    bulkTasks(first: 20, filter: { status: started }) {
        ... on BulkTaskConnection {
            edges {
                node {
                    id
                    type
                    status
                    createdAt
                }
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`status` is `pending`, `started`, `complete` or `error`. `filter` also takes `type` and `actorId`.

## File and Image Queries

### Get Image

```graphql
query GetImage {
    image(key: "image-key") {
        ... on Image {
            key
            url
            altText
            caption {
                plainText
            }
            variants {
                url
                width
                height
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`image` and `images` take an optional `language` and fall back to the tenant's default language.

### List Images

```graphql
query ListImages {
    images(first: 20, filter: { filename: { value: "hero", condition: contains } }) {
        ... on ImageConnection {
            edges {
                node {
                    key
                    url
                    altText
                    createdAt
                }
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`filename.condition` is `contains` (the default), `startsWith` or `endsWith`. `filter.topic` takes
`{ ids, includeDescendants, logicalOperator }`.

## Error Handling

The Core API uses union return types. Always handle potential errors, and spread `BasicError`, the interface
every error type implements, to catch them all in one fragment:

```graphql
query {
    item(id: "item-id", language: "en") {
        ... on Product {
            id
            name
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

Common error types:

- `UnauthorizedError` - Invalid or missing credentials
- `InvalidIdError` - The id is malformed; `providedValue` holds what was sent
- `UnknownError` - Anything else; `errorName` carries the original error name
- `BasicError` - Generic error

`ItemNotFoundError` and `OrderNotFoundError` belong to mutations. They are not members of the `item` and `order`
unions, so spreading them on a read fails validation: a read answers `null` instead.

## TypeScript Types

Use generated types for type safety:

```typescript
import { Query, GetItemQuery, GetCustomerQuery, ListOrdersQuery } from "@/generated/core";
```

These come from your own GraphQL Code Generator run against the Core API schema: the import path is wherever
your config writes them, and nothing is published under it.

## Related Links

- [Crystallize Core API Documentation](https://crystallize.com/docs/developer/apis/core-api)
- [Core API Mutations](../../mutation/references/core-api.md)
