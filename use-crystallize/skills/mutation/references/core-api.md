# Core API Mutations Reference

The Core API provides full read/write access to items, shapes, customers, orders, and configuration.

See [SKILL.md](../SKILL.md) for endpoint URLs and authentication headers.

## Table of Contents

- [Item Mutations](#item-mutations) - Create, update, publish, unpublish, delete
- [Component Updates](#component-updates) - Update individual fields on items
- [Product Variants](#product-variants) - SKUs, pricing, stock, images
- [Customer Mutations](#customer-mutations) - Individual, organization, update
- [Order Mutations](#order-mutations) - Update order metadata
- [Media & Images](#media--images) - Upload images for items and variants
- [Flow Mutations](#flow-mutations) - Manage item workflows
- [Error Handling](#error-handling)

---

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

### Publish Item

Publishing makes the item visible on the storefront. Creating an item does NOT publish it.

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

Set `includeDescendants: true` to publish all children (useful for folders).

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

### Delete Item

```graphql
mutation DeleteItem {
  item {
    delete(id: "item-id") {
      ... on Item {
        id
      }
      ... on BasicError {
        errorName
        message
      }
    }
  }
}
```

Deleting a folder with children will fail unless children are moved or deleted first.

### Move Item in Tree

```graphql
mutation MoveItem {
  item {
    moveToTree(
      itemId: "item-id"
      input: { parentId: "new-parent-folder-id", position: 0 }
    ) {
      ... on Item {
        id
        tree {
          parentId
          path
        }
      }
    }
  }
}
```

---

## Component Updates

Use `updateComponent` to change individual fields on an item. Each call targets one component by its `componentId` (the identifier defined in the shape).

### Rich Text

```graphql
mutation UpdateRichText {
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

### Single Line

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

### Numeric

```graphql
mutation UpdateNumeric {
  item {
    updateComponent(
      itemId: "item-id"
      language: "en"
      component: { componentId: "weight", numeric: { number: 1.5, unit: "kg" } }
    ) {
      ... on Item {
        id
      }
    }
  }
}
```

### Boolean (Switch)

```graphql
mutation UpdateSwitch {
  item {
    updateComponent(
      itemId: "item-id"
      language: "en"
      component: { componentId: "featured", boolean: { value: true } }
    ) {
      ... on Item {
        id
      }
    }
  }
}
```

### Images Component

```graphql
mutation UpdateImages {
  item {
    updateComponent(
      itemId: "item-id"
      language: "en"
      component: {
        componentId: "gallery"
        images: [
          { key: "image-key-from-upload", altText: "Product front view" }
        ]
      }
    ) {
      ... on Item {
        id
      }
    }
  }
}
```

### Selection

```graphql
mutation UpdateSelection {
  item {
    updateComponent(
      itemId: "item-id"
      language: "en"
      component: { componentId: "color", selection: { keys: ["red"] } }
    ) {
      ... on Item {
        id
      }
    }
  }
}
```

### Item Relations

```graphql
mutation UpdateItemRelations {
  item {
    updateComponent(
      itemId: "item-id"
      language: "en"
      component: {
        componentId: "related-products"
        itemRelations: { itemIds: ["related-item-id-1", "related-item-id-2"] }
      }
    ) {
      ... on Item {
        id
      }
    }
  }
}
```

### Content Chunk (repeatable)

```graphql
mutation UpdateChunk {
  item {
    updateComponent(
      itemId: "item-id"
      language: "en"
      component: {
        componentId: "specifications"
        contentChunk: {
          chunks: [
            [
              { componentId: "label", singleLine: { text: "Weight" } }
              { componentId: "value", singleLine: { text: "1.5 kg" } }
            ]
            [
              { componentId: "label", singleLine: { text: "Dimensions" } }
              { componentId: "value", singleLine: { text: "30x20x10 cm" } }
            ]
          ]
        }
      }
    ) {
      ... on Item {
        id
      }
    }
  }
}
```

---

## Product Variants

Variants represent purchasable SKUs on a product. Each variant has built-in fields: `sku`, `name`, `price`, `stock`, `images`, `attributes`.

### Set Variants on a Product

This replaces all variants on the product. Include all variants you want to keep.

```graphql
mutation SetVariants {
  product {
    setVariants(
      productId: "product-id"
      language: "en"
      variants: [
        {
          sku: "sneaker-red-42"
          name: "Red - Size 42"
          isDefault: true
          price: 129.99
          stock: 50
          attributes: [
            { attribute: "color", value: "Red" }
            { attribute: "size", value: "42" }
          ]
          images: [
            { key: "uploaded-image-key", altText: "Red sneaker size 42" }
          ]
        }
        {
          sku: "sneaker-blue-42"
          name: "Blue - Size 42"
          isDefault: false
          price: 129.99
          stock: 30
          attributes: [
            { attribute: "color", value: "Blue" }
            { attribute: "size", value: "42" }
          ]
        }
      ]
    ) {
      ... on Product {
        id
        variants {
          sku
          name
          price
          stock
        }
      }
      ... on BasicError {
        errorName
        message
      }
    }
  }
}
```

### Update Stock

Stock is managed per variant through `setVariants`. To update stock on a single variant without affecting others, query all current variants first, modify the stock value, and call `setVariants` with the full list.

### Variant Attributes

Attributes define the variant matrix (e.g., color + size). They appear as filterable properties in the storefront. Use consistent attribute names across products for proper filtering.

---

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

### Delete Customer

```graphql
mutation DeleteCustomer {
  customer {
    delete(id: "customer-id") {
      ... on Customer {
        id
      }
      ... on BasicError {
        errorName
        message
      }
    }
  }
}
```

---

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

---

## Media & Images

Images in Crystallize are uploaded to the tenant's media library, then referenced by key in components or variants.

### Upload Image via URL

```graphql
mutation UploadImageFromURL {
  fileUpload {
    uploadFromUrl(
      tenantId: "tenant-id"
      url: "https://example.com/product-photo.jpg"
      fileName: "product-photo.jpg"
    ) {
      ... on FileContent {
        key
        url
      }
      ... on BasicError {
        errorName
        message
      }
    }
  }
}
```

The returned `key` is used when assigning images to components or variants.

---

## Flow Mutations

Flows model item workflows (e.g., Draft > Review > Published). Items can be moved between stages.

### Set Item Flow Stage

```graphql
mutation SetFlowStage {
  item {
    setFlowStage(itemId: "item-id", stageId: "stage-id") {
      ... on Item {
        id
      }
      ... on BasicError {
        errorName
        message
      }
    }
  }
}
```

---

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

| Error                             | Cause                                            |
| --------------------------------- | ------------------------------------------------ |
| `BasicError`                      | General validation or input errors               |
| `UnauthorizedError`               | Missing or insufficient access token permissions |
| `ItemNotFoundError`               | Item ID doesn't exist or wrong tenant            |
| `OrderDoesNotBelongToTenantError` | Order ID belongs to a different tenant           |

## Related Links

- [Crystallize Core API Documentation](https://crystallize.com/docs/developer/apis/core-api)
- [Managing Flows](https://crystallize.com/learn/developer-guides/core-api/managing-flows)
- [Component Updates](https://crystallize.com/learn/developer-guides/core-api/component-updates)
