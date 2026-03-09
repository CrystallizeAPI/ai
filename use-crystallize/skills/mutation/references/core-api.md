# Core API Mutations Reference

The Core API is the next-generation API for managing Crystallize data. It provides read/write access to items, shapes, customers, orders, and configuration.

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

## Core API vs PIM API

The Core API is replacing the legacy PIM API. Use Core API for:

- Direct component updates
- Path management
- Filtering orders by customer, meta, payment provider, SKU
- Creating pieces
- Archive-related mutations
- Flow operations

## Item Mutations

### Create Product

```graphql
mutation CreateProduct {
  product {
    create(
      input: {
        tenantId: "tenant-id"
        shapeIdentifier: "sneaker"
        name: "Air Max 2024"
        tree: { parentId: "folder-id" }
      }
    ) {
      ... on Product {
        id
        name
        path
      }
      ... on BasicError {
        errorName
        message
      }
    }
  }
}
```

### Create Document

```graphql
mutation CreateDocument {
  document {
    create(
      input: {
        tenantId: "tenant-id"
        shapeIdentifier: "blog-post"
        name: "Welcome to Our Store"
        tree: { parentId: "blog-folder-id" }
      }
    ) {
      ... on Document {
        id
        name
      }
    }
  }
}
```

### Create Folder

```graphql
mutation CreateFolder {
  folder {
    create(
      input: {
        tenantId: "tenant-id"
        shapeIdentifier: "category"
        name: "Summer Collection"
        tree: { parentId: "shop-folder-id" }
      }
    ) {
      ... on Folder {
        id
        name
      }
    }
  }
}
```

### Update Component

Update individual components on an item:

```graphql
mutation UpdateComponent {
  item {
    updateComponent(
      itemId: "item-id"
      language: "en"
      component: {
        componentId: "description"
        richText: {
          html: "<p>New product description with <strong>rich text</strong></p>"
        }
      }
    ) {
      ... on Item {
        id
        updatedAt
      }
      ... on BasicError {
        message
      }
    }
  }
}
```

### Update Single Line Component

```graphql
mutation UpdateSingleLine {
  item {
    updateComponent(
      itemId: "item-id"
      language: "en"
      component: {
        componentId: "tagline"
        singleLine: { text: "Premium quality materials" }
      }
    ) {
      ... on Item {
        id
      }
    }
  }
}
```

### Publish Item

```graphql
mutation PublishItem {
  item {
    publish(id: "item-id", language: "en", includeDescendants: false) {
      ... on Item {
        id
        publishedAt
      }
    }
  }
}
```

### Unpublish Item

```graphql
mutation UnpublishItem {
  item {
    unpublish(id: "item-id", language: "en", includeDescendants: false) {
      ... on Item {
        id
      }
    }
  }
}
```

## Customer Mutations

### Create Individual Customer

```graphql
mutation CreateIndividual {
  customer {
    createIndividual(
      input: {
        tenantId: "tenant-id"
        firstName: "Jane"
        lastName: "Smith"
        email: "jane@example.com"
        phone: "+1234567890"
        addresses: [
          {
            type: "delivery"
            street: "123 Main St"
            city: "New York"
            postalCode: "10001"
            country: "US"
          }
        ]
      }
    ) {
      ... on Customer {
        id
        identifier
      }
    }
  }
}
```

### Create Organization

```graphql
mutation CreateOrganization {
  customer {
    createOrganization(
      input: {
        tenantId: "tenant-id"
        name: "Acme Corp"
        email: "contact@acme.com"
        taxId: "XX123456789"
      }
    ) {
      ... on Customer {
        id
        identifier
      }
    }
  }
}
```

### Update Customer

```graphql
mutation UpdateCustomer {
  customer {
    update(id: "customer-id", input: { firstName: "Jane", lastName: "Doe" }) {
      ... on Customer {
        id
      }
    }
  }
}
```

## Order Mutations

### Update Order

```graphql
mutation UpdateOrder {
  order {
    update(
      id: "order-id"
      input: { meta: [{ key: "tracking_number", value: "1Z999AA10123456784" }] }
    ) {
      ... on Order {
        id
        updatedAt
      }
    }
  }
}
```

## Error Handling

The Core API uses union return types. Always handle potential errors:

```graphql
mutation {
  item {
    updateComponent(...) {
      ... on Item {
        id
      }
      ... on ItemNotFoundError {
        errorName
        message
      }
      ... on UnauthorizedError {
        errorName
        message
      }
      ... on BasicError {
        errorName
        message
      }
    }
  }
}
```

Common error types:

- `UnauthorizedError`
- `BasicError`
- `ItemNotFoundError`
- `OrderDoesNotBelongToTenantError`
- `ExperimentalFeaturesNotAvailableError`

## Related Links

- [Crystallize Core API Documentation](https://crystallize.com/docs/developer/apis/core-api)
- [Managing Flows](https://crystallize.com/learn/developer-guides/core-api/managing-flows)
- [Component Updates](https://crystallize.com/learn/developer-guides/core-api/component-updates)
