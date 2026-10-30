---
name: mutation
description: Mutate data in Crystallize - create products, documents, and folders, update item components, manage product variants and SKUs, publish/unpublish items, handle customers and orders, manage carts and checkout flows, convert cart to order, create orders from checkout or directly (POS, imports), record payments, track fulfillment pipeline stages, upload images and media, and delete items. Use this skill when creating or updating any content in Crystallize, adding products to the catalogue, modifying descriptions or fields, setting up checkout, placing orders, managing stock, recording payments, tracking order fulfillment, or writing data through the Core API or Shop API. For bulk imports and tenant migrations use mass-operations; for provider checkout flows use payments.
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
│  ├─ Create new item → Core API: createProduct / createDocument / createFolder
│  ├─ Update a field on an item → Core API: updateComponent
│  ├─ Add/update product variants → Core API: addProductVariant / updateProductVariant
│  ├─ Publish/unpublish → Core API: publishItem / unpublishItem
│  └─ Delete an item → Core API: deleteItem
│
├─ Manage customers
│  ├─ From a storefront → Shop API /customer: customer (create or update), addAddress
│  ├─ Create a person or a company → Core API: createCustomer (type: individual | organization)
│  └─ Update customer → Core API: updateCustomer(identifier:)
│
├─ Manage orders
│  ├─ Create order from cart → Shop API /order: createFromCart
│  ├─ Create order directly (POS, import) → Shop API /order: create
│  ├─ Add/update payments → Shop API /order: addPayments / setPayments
│  ├─ Track order through pipeline → Shop API /order: addToStage
│  └─ Update order metadata → Shop API /order: setMeta (not Core updateOrder — see below)
│
├─ Cart & checkout (storefront)
│  ├─ Create/hydrate a cart → Shop API: hydrate
│  ├─ Modify cart items → Shop API: addSkuItem / addCartItem / removeCartItem
│  ├─ Set customer & addresses → Shop API: setCustomer (addresses live on the customer)
│  └─ Convert cart to order → Shop API: place, then /order createFromCart
│
├─ Media (images, video)
│  ├─ Import from a supplier URL → Core API: copyRemoteAsset (images only)
│  ├─ Upload your own bytes, or any video → Core API: generatePresignedUploadRequest → registerImage
│  ├─ Alt text, topics, hotspots → Core API: updateImage (per language)
│  └─ Replace an image → registerImageRevision, then republish the items that use it
│
└─ Bulk operations
   └─ Use a mass operation: see the mass-operations skill
```

## API Selection

| Use Case                                  | API                              | Why                                 |
| ----------------------------------------- | -------------------------------- | ----------------------------------- |
| Creating/editing items, shapes, customers | **Core API**                     | Full read/write, admin-level access |
| Cart management, checkout                 | **Shop API `/cart`**             | Edge-distributed cart lifecycle     |
| Order creation, payments, pipelines       | **Shop API `/order`**            | Full order CRUD after checkout      |
| Bulk shape + item creation                | **Core API** via mass operations | Ordered multi-step creation         |

**Core is not a storefront API.** It is heavily rate limited and not meant for storefront traffic: carts, orders, customers and subscription contracts belong on the Shop API, which is edge-distributed and syncs to Core asynchronously. Keep Core for the back office — imports, seeding, scheduled jobs and admin tools, behind your own server.

**Write an order in one store.** A Core write comes back to the Shop store. On an order born in Core, each edit adds **another copy** of it there: three `updateOrder` calls left three Shop orders with the same `coreId`, so a storefront that sums an order list counts the money several times. On an order born on the Shop API, a Core edit overwrites the Shop order whole. If a storefront reads orders, create and change them on the Shop API (`create`, `createFromCart`, `setMeta`, `addToStage`). Details in [Shop API Order Mutations](references/shop-api-order-mutations.md).

## API Endpoints & Authentication

| API            | Endpoint                                             | Auth Required | Use For                   |
| -------------- | ---------------------------------------------------- | ------------- | ------------------------- |
| Core           | `https://api.crystallize.com/@{tenant}`              | Yes           | Items, shapes, customers  |
| Shop /cart     | `https://shop-api.crystallize.com/{tenant}/cart`     | Yes (JWT)     | Cart management, checkout |
| Shop /order    | `https://shop-api.crystallize.com/{tenant}/order`    | Yes (JWT)     | Order CRUD, payments      |
| Shop /customer | `https://shop-api.crystallize.com/{tenant}/customer` | Yes (JWT)     | Storefront customers      |

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

The `@` is optional on the Shop API. Get the JWT from your access token, with one scope per endpoint you call:

```bash
curl -X POST 'https://shop-api.crystallize.com/your-tenant/auth/token' \
  -H 'Content-Type: application/json' \
  -H 'X-Crystallize-Access-Token-Id: YOUR_TOKEN_ID' \
  -H 'X-Crystallize-Access-Token-Secret: YOUR_TOKEN_SECRET' \
  -d '{"scopes": ["cart", "order", "customer"], "expiresIn": 86400}'
```

It answers `{ "success": true, "token": "..." }`. `scopes` is required and `expiresIn` is in seconds (one day by default).

**Call the Shop API from your server.** It allows browser calls only from Crystallize origins and localhost, so a browser call that works in development fails on your own domain.

## Common Workflow Patterns

### Create a product end-to-end

1. **Create the product** with shape, parent folder, VAT type and every required component
2. **Set variants** with SKU, pricing, stock, and images, in the same `createProduct` call: at least one is required
3. **Update components** (description, specs, media)
4. **Publish** the item

See [Core API Reference](references/core-api.md) for each mutation.

### Update content on an existing item

1. **Query the item** to confirm its ID and current state (use the query skill)
2. **Call `updateComponent`** for each field you need to change
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

For creating many items at once, use a mass operation: see the [mass-operations skill](../mass-operations/SKILL.md), and the [content-model skill](../content-model/SKILL.md) for shapes and pieces. Mass operations follow a 4-phase ordering:

1. Pieces (dependencies first)
2. Shapes
3. Topic maps
4. Items

## Error Handling

The Core API uses union return types. Always include error fragments in your mutations:

```graphql
mutation {
  createProduct(language: "en", input: { ... }) {
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

The Shop API has no unions: a failure comes back in the standard GraphQL `errors` list.

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

// Core API mutations (api.crystallize.com/@tenant)
const result = await api.nextPimApi(mutationString, variables);

// Shop API mutations: one caller per endpoint, the Shop API token is fetched for you
await api.shopCartApi(cartMutation, variables); // /cart
await api.shopOrderApi(orderMutation, variables); // /order (js-api-client 7.5+)
```

For checkout, prefer the helpers: `createCartManager` (`hydrate`, `place`), `createShopOrderManager`
(`createFromCart`, `addPayments`, `setPayments`, `addToStage`) and `createShopCustomerManager` (`upsert`, `addAddress`).

## Output Format

When generating mutations for the user, produce:

1. **GraphQL mutations** with clear variable placeholders (e.g., `"your-tenant-id"`, `"item-id"`)
2. **Variable definitions** when the mutation uses GraphQL variables
3. **Expected response shape** so the user knows what to look for

If the user is working in a JS/TS project, prefer generating code using `@crystallize/js-api-client` helpers.

## References

- [Core API Mutations](references/core-api.md) - Item CRUD, variants, components, customers, publish/unpublish, delete, media uploads
- [Media & Images](references/media.md) - Importing and uploading images and video, renditions, showcases, replacing and deleting
- [Shop API Cart Mutations](references/shop-api-mutations.md) - Cart hydration, item management, checkout flow, cart lifecycle
- [Shop API Order Mutations](references/shop-api-order-mutations.md) - Order creation (from cart or direct), payments, pipelines, metadata

## Related skills

[[query]] covers reads across the same APIs. For bulk writes that would otherwise hit rate limits, use
[[mass-operations]]. Vector ranking has its own Core API mutations — `upsertVocabulary`, `setItemTaste`
and `igniteDiscoApi` — documented in [[vector-ranking]]. Taking payment is in [[payments]], bookings in
[[bookable-resources]] and subscription contracts in [[subscriptions]].
