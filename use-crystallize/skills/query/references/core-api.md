# Core API Queries Reference

The Core API provides comprehensive read access to items, customers, orders, shapes, and tenant configuration. Use this for admin interfaces, reporting, and complex filtering needs.

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
        content
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
        content
      }
    }
    ... on Folder {
      id
      name
      shapeIdentifier
      children {
        id
        name
        type
      }
    }
    ... on ItemNotFoundError {
      errorName
      message
    }
  }
}
```

### List Items with Pagination

```graphql
query ListItems {
  items(
    language: "en"
    first: 20
    after: "cursor"
    filter: {
      shapeIdentifiers: ["product", "bundle"]
      # path: { prefix: "/shop" }
      # includeDescendants: true
    }
    sort: { field: updatedAt, direction: desc }
  ) {
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
}
```

### Get Item Component

Read a specific component from an item:

```graphql
query GetItemComponent {
  item(id: "item-id", language: "en") {
    ... on Item {
      id
      component(id: "description") {
        componentId
        content
      }
    }
  }
}
```

### Check Identifier Availability

```graphql
query CheckIdentifier {
  isIdentifierAvailable(
    tenantId: "tenant-id"
    identifier: "new-product-slug"
  ) {
    ... on IdentifierAvailability {
      available
    }
  }
}
```

## Customer Queries

### Get Customer by Identifier

```graphql
query GetCustomer {
  customer(identifier: "customer@example.com") {
    ... on Customer {
      id
      identifier
      tenantId
      ... on IndividualCustomer {
        firstName
        lastName
        email
        phone
      }
      ... on OrganizationCustomer {
        name
        taxId
        organizationNumber
      }
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
    ... on CustomerNotFoundError {
      errorName
      message
    }
  }
}
```

### List Customers

```graphql
query ListCustomers {
  customers(
    tenantId: "tenant-id"
    first: 20
    filter: {
      email: { contains: "@example.com" }
      # customerType: individual
    }
  ) {
    edges {
      node {
        id
        identifier
        ... on IndividualCustomer {
          firstName
          lastName
          email
        }
        ... on OrganizationCustomer {
          name
        }
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

### Get Customer Groups

```graphql
query GetCustomerGroup {
  customerGroup(id: "group-id") {
    ... on CustomerGroup {
      id
      name
      customerIdentifiers
    }
  }
}

query ListCustomerGroups {
  customerGroups(tenantId: "tenant-id", first: 20) {
    edges {
      node {
        id
        name
        customerIdentifiers
      }
    }
  }
}
```

## Order Queries

### Get Order by ID

```graphql
query GetOrder {
  order(id: "order-id") {
    ... on Order {
      id
      createdAt
      updatedAt
      customer {
        identifier
        ... on IndividualCustomer {
          firstName
          lastName
          email
        }
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
    ... on OrderNotFoundError {
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
    tenantId: "tenant-id"
    first: 20
    filter: {
      customerIdentifier: "customer@example.com"
      # sku: "PROD-123"
      # paymentProvider: "stripe"
      # meta: [{ key: "source", value: "mobile-app" }]
    }
    sort: { field: createdAt, direction: desc }
  ) {
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
}
```

**Filter Options:**
- `customerIdentifier` - Filter by customer email/identifier
- `sku` - Filter orders containing specific SKU
- `paymentProvider` - Filter by payment method (stripe, klarna, etc.)
- `meta` - Filter by metadata key/value pairs
- `createdAt` - Date range filtering

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
        config
      }
      variantComponents {
        id
        name
        type
        config
      }
    }
  }
}
```

### List All Shapes

```graphql
query ListShapes {
  shapes(tenantId: "tenant-id") {
    identifier
    name
    type
    itemCount
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
        config
      }
    }
  }
}
```

### List All Pieces

```graphql
query ListPieces {
  pieces(tenantId: "tenant-id", first: 100) {
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
}
```

## Flow Queries

### Get Flow

```graphql
query GetFlow {
  flow(id: "flow-id") {
    ... on Flow {
      id
      name
      stages {
        id
        name
        position
      }
    }
  }
}
```

### Get Flow Content

List items in a flow stage:

```graphql
query GetFlowContent {
  flowContent(
    flowId: "flow-id"
    stageId: "stage-id"
    language: "en"
    first: 20
  ) {
    edges {
      node {
        item {
          id
          name
          type
        }
        assignedTo {
          id
          email
        }
        dueDate
      }
    }
  }
}
```

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
  }
}
```

### List Archived Versions

```graphql
query ListArchives {
  archives(
    itemId: "item-id"
    language: "en"
    first: 10
    sort: { field: number, direction: desc }
  ) {
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
  }
}
```

### List Bulk Tasks

```graphql
query ListBulkTasks {
  bulkTasks(
    tenantId: "tenant-id"
    first: 20
    filter: { status: running }
  ) {
    edges {
      node {
        id
        type
        status
        createdAt
      }
    }
  }
}
```

## File and Image Queries

### Get Image

```graphql
query GetImage {
  image(key: "image-key") {
    ... on Image {
      key
      url
      altText
      caption
      variants {
        url
        width
        height
      }
    }
  }
}
```

### List Images

```graphql
query ListImages {
  images(
    tenantId: "tenant-id"
    first: 20
    filter: { path: { prefix: "/products/" } }
  ) {
    edges {
      node {
        key
        url
        altText
        createdAt
      }
    }
  }
}
```

## Error Handling

The Core API uses union return types. Always handle potential errors:

```graphql
query {
  item(id: "item-id", language: "en") {
    ... on Product {
      id
      name
    }
    ... on ItemNotFoundError {
      errorName
      message
    }
    ... on UnauthorizedError {
      errorName
      message
    }
  }
}
```

Common error types:
- `UnauthorizedError` - Invalid or missing credentials
- `ItemNotFoundError` - Item doesn't exist
- `CustomerNotFoundError` - Customer doesn't exist
- `OrderNotFoundError` - Order doesn't exist
- `BasicError` - Generic error

## TypeScript Types

Use generated types for type safety:

```typescript
import {
  Query,
  GetItemQuery,
  GetCustomerQuery,
  ListOrdersQuery
} from '@/generated/core';
```

Types are generated from the Core API schema via GraphQL Code Generator.

## Related Links

- [Crystallize Core API Documentation](https://crystallize.com/docs/developer/apis/core-api)
- [Core API Mutations](../mutation/references/core-api.md)
