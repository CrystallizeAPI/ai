---
name: mutation
description: Mutate data in Crystallize - create products, documents, and folders, update item components, manage product variants and SKUs, publish/unpublish items, handle customers and orders, manage carts and checkout flows, convert cart to order, create orders from checkout or directly (POS, imports), record payments, track fulfillment pipeline stages, upload images and media, import data, delete items, and perform bulk operations. Use this skill when creating or updating any content in Crystallize, adding products to the catalogue, modifying descriptions or fields, setting up checkout, placing orders, managing stock, recording payments, tracking order fulfillment, or writing data through the Core API or Shop API.
metadata:
    author: Crystallize
    version: "2.0"
---

# Crystallize Mutation Skill

Create, update, and manage data in Crystallize using GraphQL mutations. This skill covers all write operations across the Core API (admin/content management) and Shop API (cart/checkout).

## Consultation Approach

Before writing mutations, understand the context. Ask clarifying questions:

1. **What are you trying to create or update?** Products, documents, folders, customers, orders?
2. **Do you have the tenant identifier and access tokens?** Mutations require authentication.
3. **Where in the flow are you?** Content/catalog management → Core API. Cart/checkout/orders → Shop API.
4. **Do you need to update individual fields or create items from scratch?** `updateComponent` for fields, `create` for new items.
5. **Should changes be published immediately?** Creating an item doesn't publish it — that's a separate step.
6. **Are you doing a one-off change or a bulk import?** Single mutations vs mass operations.

## Decision Tree

```
What do you need to do?
│
├─ Create/update catalogue items (products, documents, folders)
│  ├─ Create new item → Core API: product/document/folder.create
│  ├─ Update a field on an item → Core API: item.updateComponent
│  ├─ Add/update product variants → Core API: product.setVariants
│  ├─ Publish/unpublish → Core API: item.publish / item.unpublish
│  └─ Delete an item → Core API: item.delete
│
├─ Manage customers
│  ├─ Create individual → Core API: customer.createIndividual
│  ├─ Create organization → Core API: customer.createOrganization
│  └─ Update customer → Core API: customer.update
│
├─ Manage orders
│  ├─ Create order from cart → Shop API /order: createFromCart
│  ├─ Create order directly (POS, import) → Shop API /order: create
│  ├─ Add/update payments → Shop API /order: addPayments / setPayments
│  ├─ Track order through pipeline → Shop API /order: addToStage
│  └─ Update order metadata → Shop API /order: setMeta (or Core API: order.update)
│
├─ Cart & checkout (storefront)
│  ├─ Create/hydrate a cart → Shop API: hydrate
│  ├─ Modify cart items → Shop API: addItems / removeItems / setCartItem
│  ├─ Set customer & addresses → Shop API: setCustomer / setAddresses
│  └─ Convert cart to order → Shop API: cartAsOrderIntent
│
└─ Bulk operations
   └─ Use mass operation JSON via the content-model skill's output format
```

## API Selection

| Use Case                                  | API                              | Why                                 |
| ----------------------------------------- | -------------------------------- | ----------------------------------- |
| Creating/editing items, shapes, customers | **Core API**                     | Full read/write, admin-level access |
| Cart management, checkout                 | **Shop API `/cart`**             | Edge-distributed cart lifecycle     |
| Order creation, payments, pipelines       | **Shop API `/order`**            | Full order CRUD after checkout      |
| Bulk shape + item creation                | **Core API** via mass operations | Ordered multi-step creation         |

## API Endpoints & Authentication

| API         | Endpoint                                          | Auth Required | Use For                   |
| ----------- | ------------------------------------------------- | ------------- | ------------------------- |
| Core        | `https://api.crystallize.com/@{tenant}`           | Yes           | Items, shapes, customers  |
| Shop /cart  | `https://shop-api.crystallize.com/{tenant}/cart`  | Yes (JWT)     | Cart management, checkout |
| Shop /order | `https://shop-api.crystallize.com/{tenant}/order` | Yes (JWT)     | Order CRUD, payments      |

### Core API

```
POST https://api.crystallize.com/@{tenant-identifier}
```

Note the `@` prefix before the tenant identifier.

```bash
curl -X POST 'https://api.crystallize.com/@your-tenant' \
  -H 'Content-Type: application/json' \
  -H 'X-Crystallize-Access-Token-Id: YOUR_TOKEN_ID' \
  -H 'X-Crystallize-Access-Token-Secret: YOUR_TOKEN_SECRET' \
  -d '{"query": "mutation { ... }"}'
```

Generate access tokens in the Crystallize App under Settings > Access Tokens. See the [permissions skill](../permissions/SKILL.md) for scoping tokens.

### Shop API

```
POST https://shop-api.crystallize.com/{tenant-identifier}/cart
Authorization: Bearer YOUR_JWT_TOKEN
```

No `@` prefix for the Shop API endpoint.

## Common Workflow Patterns

### Create a product end-to-end

1. **Create the product** with shape and parent folder
2. **Set variants** with SKU, pricing, stock, and images
3. **Update components** (description, specs, media)
4. **Publish** the item

See [Core API Reference](references/core-api.md) for each mutation.

### Update content on an existing item

1. **Query the item** to confirm its ID and current state (use the query skill)
2. **Call `item.updateComponent`** for each field you need to change
3. **Publish** if the item should go live immediately

Each `updateComponent` call targets a single component by `componentId`. You can update multiple components by sending multiple mutations.

### Checkout flow (storefront)

1. **Hydrate a cart** with product SKUs and quantities
2. **Add/remove items** as the customer shops
3. **Set customer info** and addresses
4. **Place the cart** to lock it for payment
5. **Create the order** from the placed cart

See [Shop API Cart Mutations](references/shop-api-mutations.md) for steps 1-4, and [Shop API Order Mutations](references/shop-api-order-mutations.md) for step 5.

### Bulk import / mass operations

For creating many items at once, use the mass operations JSON format produced by the [content-model skill](../content-model/SKILL.md). Mass operations follow a 4-phase ordering:

1. Pieces (dependencies first)
2. Shapes
3. Topic maps
4. Items

## Error Handling

The Core API uses union return types. Always include error fragments in your mutations:

```graphql
mutation {
  product {
    create(input: { ... }) {
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
}
```

Common error types: `BasicError`, `UnauthorizedError`, `ItemNotFoundError`, `OrderDoesNotBelongToTenantError`.

## Using the JS API Client

For JavaScript/TypeScript projects, use `@crystallize/js-api-client` instead of raw HTTP calls. It provides typed helpers for all mutations. See the [js-api-client skill](../js-api-client/SKILL.md) for setup and usage.

```typescript
import { createClient } from "@crystallize/js-api-client";
const api = createClient({
    tenantIdentifier: "your-tenant",
    accessTokenId: "...",
    accessTokenSecret: "...",
});

// Use pimApi for Core API mutations
const result = await api.pimApi(mutationString, variables);
```

## Output Format

When generating mutations for the user, produce:

1. **GraphQL mutations** with clear variable placeholders (e.g., `"your-tenant-id"`, `"item-id"`)
2. **Variable definitions** when the mutation uses GraphQL variables
3. **Expected response shape** so the user knows what to look for

If the user is working in a JS/TS project, prefer generating code using `@crystallize/js-api-client` helpers.

## References

- [Core API Mutations](references/core-api.md) - Item CRUD, variants, components, customers, publish/unpublish, delete, media uploads
- [Shop API Cart Mutations](references/shop-api-mutations.md) - Cart hydration, item management, checkout flow, cart lifecycle
- [Shop API Order Mutations](references/shop-api-order-mutations.md) - Order creation (from cart or direct), payments, pipelines, metadata
