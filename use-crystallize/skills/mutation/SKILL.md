---
name: mutation
description: Mutate data in Crystallize - create products, documents, and folders, update item components, manage product variants and SKUs, publish/unpublish items, handle customers and orders, manage carts and checkout flows, convert cart to order, create orders on the Shop API from a cart or directly (POS, accepted quotes, imports, demo seeds), record payments, track fulfillment pipeline stages, register webhooks, and delete items. Use this skill when creating or updating any content in Crystallize, adding products to the catalogue, modifying descriptions or fields, translating items, setting up checkout, placing orders, managing stock, recording payments, tracking order fulfillment, deciding whether a write belongs on the Shop API or the Core API, or writing data through the Core API or Shop API. For bulk imports and tenant migrations use mass-operations; for importing images and video use media; for provider checkout flows use payments.
metadata:
    author: Crystallize
    version: "3.0"
---

# Crystallize Mutation Skill

Create, update and manage data in Crystallize with GraphQL mutations. Writes split along the same line as reads:
**everything a shopper does goes through the Shop API, from your server**, and catalogue and tenant management goes
through the Core API, from scripts and the back office. The full storefront contract is in [[storefront]].

## Consultation Approach

Before writing mutations, ask:

1. **Who triggers the write: a shopper (storefront, account page, payment webhook) or the back office (seed, import,
   admin tool)?** Shopper → Shop API. Back office → Core API (or a mass operation).
2. **Will a storefront read the result?** Orders and customers a storefront lists are created and changed on the
   Shop API, so they stay one record in one store.
3. **Do you have the right token?** Core takes an access token pair. The Shop API takes a JWT minted with a pair that
   is **not tenant-scoped**.
4. **Is it a field edit or a rebuild?** `updateComponent` for one field; anything with `components` replaces the
   whole set (see [What a partial write replaces](references/core-api.md#what-a-partial-write-replaces)).
5. **Should it go live?** Creating or updating an item doesn't publish it, and publishing is asynchronous.
6. **One-off or bulk?** Single mutations, or a mass operation ([[mass-operations]]).

## The storefront API contract, for writes

| Who writes                        | API             | Runs                                     | Examples                                                                                     |
| --------------------------------- | --------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| A shopper, through the storefront | **Shop API**    | Server actions, routes, payment webhooks | Cart, customer on the cart, `place`, orders, payments, customers, bookings, contracts, locks |
| The back office, scripts, imports | **Core API**    | Scripts, jobs, admin tools behind login  | Items, variants, components, publish, customers with hierarchies, media, webhooks            |
| Tenant setup                      | **Legacy PIM**  | Setup scripts                            | Pipelines, stock locations, VAT types, markets, subscription plans                           |
| Many items at once                | Mass operations | Scripts                                  | Imports, migrations                                                                          |

- **Core is never in the storefront's request path**: it is heavily rate limited and not meant for shopper traffic,
  not even server-side behind a cache. The exceptions are webhook receivers and staff tools, which are back office.
  The Shop API is edge-distributed and syncs to Core asynchronously, so the back office still sees every order.
- **The Shop API is server only.** Its CORS allows only Crystallize origins and localhost, so a browser call that
  works in development fails on your own domain. The browser keeps the cart id in an httpOnly cookie.
- **Write an order in one store**, see [Orders: which store, which call](#orders-which-store-which-call).

### Endpoints and tokens

| API                         | Endpoint                                                          | Credential                                    |
| --------------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| Core                        | `https://api.crystallize.com/@{tenant}`                           | Access token pair                             |
| Shop /cart                  | `https://shop-api.crystallize.com/{tenant}/cart`                  | JWT, `cart` scope                             |
| Shop /cart/admin            | `https://shop-api.crystallize.com/{tenant}/cart/admin`            | JWT, `cart` + `cart:admin` (promotions)       |
| Shop /order                 | `https://shop-api.crystallize.com/{tenant}/order`                 | JWT, `order`                                  |
| Shop /customer              | `https://shop-api.crystallize.com/{tenant}/customer`              | JWT, `customer`                               |
| Shop /subscription-contract | `https://shop-api.crystallize.com/{tenant}/subscription-contract` | JWT, `subscription-contract`, its own token   |
| Shop /booking/admin         | `https://shop-api.crystallize.com/{tenant}/booking/admin`         | JWT, `booking:admin`                          |
| Shop /lock                  | `https://shop-api.crystallize.com/{tenant}/lock`                  | JWT, `lock`                                   |
| PIM (legacy)                | `https://pim.crystallize.com/graphql`                             | Access token pair; most calls take `tenantId` |

### Core API

```bash
curl -X POST 'https://api.crystallize.com/@your-tenant' \
  -H 'Content-Type: application/json' \
  -H 'X-Crystallize-Access-Token-Id: YOUR_TOKEN_ID' \
  -H 'X-Crystallize-Access-Token-Secret: YOUR_TOKEN_SECRET' \
  -d '{"query": "mutation { ... }"}'
```

Note the `@` before the tenant identifier. Generate access tokens in the Crystallize App under Settings > Access
Tokens; see [[permissions]] for scoping them.

### Shop API

The `@` is optional on the Shop API. Mint the JWT on your server, with one scope per route you call:

```bash
curl -X POST 'https://shop-api.crystallize.com/your-tenant/auth/token' \
  -H 'Content-Type: application/json' \
  -H 'X-Crystallize-Access-Token-Id: YOUR_TOKEN_ID' \
  -H 'X-Crystallize-Access-Token-Secret: YOUR_TOKEN_SECRET' \
  -d '{"scopes": ["cart", "order", "customer"], "expiresIn": 86400}'
```

It answers `{ "success": true, "token": "..." }`, sent as `Authorization: Bearer <token>`.

- **The access token must not be tenant-scoped**: the token endpoint checks it on `/@me`, which refuses tenant-scoped
  tokens and plugin bearer tokens ([[permissions]]).
- `scopes` is required. `expiresIn` is in seconds: one day by default in the API, 12 hours in js-api-client. Cache
  the JWT and refresh it before it expires; an expired one fails with `"exp" claim timestamp check failed`.
- The JWT is per tenant, not per shopper: it can write any customer's cart or order, so it never reaches the browser.
- Request a **separate token** for `/subscription-contract`: a token with every scope answered "Unexpected error" on
  `create`.
- The Shop API reads products from the Catalogue with the request's credentials. On a tenant whose Catalogue requires
  a token, send it (`X-Crystallize-Static-Auth-Token`, or the pair) on every `/cart` call that reads products.

## Decision Tree

```
What do you need to do?
│
├─ Shopper actions (storefront, account page, payment webhook): Shop API, server-side
│  ├─ Create or update the cart → /cart hydrate (send the WHOLE item list: it replaces) or addSkuItem
│  ├─ Customer on the cart → /cart setCustomer, or hydrate(customer: { identifier, isGuest: false })
│  │  └─ B2B on behalf of a company → the organisation as the cart customer, the person in cart meta
│  ├─ Lock the cart before charging → /cart place (charge its total)
│  ├─ Order from the cart → /order createFromCart(id, { pipelines, paymentStatus, payments }), no fulfill
│  ├─ Order without a cart (POS, accepted quote, demo seed) → /order create
│  ├─ Payments → /order addPayments / setPayments (paymentStatus is set once, at creation)
│  ├─ Pipeline stage → /order addToStage (ids, not names), then setMeta
│  ├─ Order metadata → /order setMeta (not Core updateOrder)
│  ├─ Customer record → /customer customer(input), addAddress, setMeta
│  ├─ Bookings → /cart bookSkuItem, confirmCartBooking: see bookable-resources
│  ├─ Subscription contracts → one store per tenant: see subscriptions
│  └─ Idempotency guard (webhooks, one order per cart) → /lock acquire / release
│
├─ Catalogue (back office, scripts): Core API
│  ├─ Create new item → createProduct / createDocument / createFolder
│  ├─ Update a field, or translate → updateComponent (per component, per language)
│  ├─ Rename → update*(input: { name }) (changes the path; the old one goes to history)
│  ├─ Add/update product variants → addProductVariant / updateProductVariant (send its components)
│  ├─ Publish/unpublish → publishItem / unpublishItem (asynchronous)
│  └─ Delete an item → deleteItem
│
├─ Customers in the back office: Core API
│  ├─ A person or a company, with parents → createCustomer (type: individual | organization)
│  └─ Update → updateCustomer(identifier:) (lists you send replace the stored ones)
│
├─ Orders nobody reads from the edge (imports into the back office) → Core registerOrder
│
├─ Media (images, video) → see the media skill
│
├─ Cache revalidation on publish → Core createWebhook(concern: "items")
│
└─ Bulk operations → a mass operation: see the mass-operations skill
```

## Orders: which store, which call

Shop API orders and Core orders are the same orders in two stores, synced asynchronously. Where an order is **born**
decides what later writes do to it, so choose by who reads it:

| The order                                                                              | Create with                    | Change with                                 |
| -------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------- |
| Comes from a storefront cart                                                           | Shop `/order` `createFromCart` | Shop `setMeta`, `addToStage`, `addPayments` |
| Has no cart but a storefront or the Shop API lists it (POS, accepted quote, demo seed) | Shop `/order` `create`         | The same Shop calls                         |
| Nobody reads it from the edge (an import into the back office)                         | Core `registerOrder`           | Core `updateOrder`                          |

- **A Core edit of a Core-born order adds another copy to the Shop store**: three `updateOrder` calls left three Shop
  orders with one `coreId`, and a storefront summing the list counted the money three times. A Core edit of a
  Shop-born order overwrites it whole.
- **`createFromCart`**: the cart must be `placed`; pass `pipelines`, `paymentStatus` and `payments` in the input
  rather than chaining calls, because the order is saved just after the answer. It copies the cart's `meta` (plus
  `cartId`, `cartState`, `cartType`) into the order, and its input has no `meta`, so set meta on the cart first.
  `additionalInformation: null` is refused: leave it out. It moves the cart to `ordered`, so never call `fulfill`
  after it. The order id is the cart id.
- **`create`** takes `relatedOrderIds` (Core ids) for an order made from a quote. Whether it honours `createdAt` was
  observed both ways (back-dated on one tenant, "now" on another): keep the intended date in meta (`orderedAt`) as
  well.
- **The listing lags.** `orders(customerIdentifier:)` shows new orders after seconds to minutes, and a few never
  appeared. Read by id, and key idempotency on your own meta or a `/lock`, never on the listing ([[query]]).
- There is no delete on the Shop API. Archive with `setMeta` and filter.

Details, inputs and the full store table: [Shop API Order Mutations](references/shop-api-order-mutations.md).

## Common Workflow Patterns

### Checkout (storefront, all server-side)

1. **Cart**: a server action calls `/cart` `hydrate` with the whole basket, the price context and the customer.
   Check the SKUs against Discovery in parallel: an unknown SKU is dropped, or fails the call.
2. **Customer and meta**: `setCustomer` (for B2B, the organisation, with the person in cart meta), then `setMeta`.
3. **Place**: `place` locks the cart and hydrates it one last time. If order creation later fails, the shopper needs
   a new cart.
4. **Payment**: create the provider session on the server from `place`'s `total` ([[payments]]).
5. **Order**: in the provider's webhook, verify, then `/order` `createFromCart` with `pipelines`, `paymentStatus` and
   `payments` in the input. Bookings: once `cart.orderId` is set, `confirmCartBooking` again
   ([[bookable-resources]]).
6. **Confirmation**: show the order `createFromCart` returned, or `order(id:)` with a retry; say that order history
   can take a moment to update.

See [Shop API Cart Mutations](references/shop-api-mutations.md) and
[Shop API Order Mutations](references/shop-api-order-mutations.md).

### Create a product end-to-end (back office)

1. **Create the product** with shape, parent folder, VAT type, at least one variant, and every required component.
   A numeric with a unit list must have a value on create, or the write fails
   ([Unit-bound numerics](references/core-api.md#unit-bound-numerics))
2. **Translate** with `updateComponent` per component and language, after the language version exists
3. **Publish**, then wait for the published version before relying on Discovery
   ([Discovery Indexing](../query/references/discovery-indexing.md))

### Update content on an existing item

1. **Query the item** to confirm its ID and current state (use the query skill)
2. **Call `updateComponent`** for each field you change: it touches only that component
3. **Publish** if the change should go live

### Revalidate the storefront on publish

Register a Core webhook with `concern: "items"`; `item` and `product` are accepted and never fire. Add a
`graphqlQuery` with `preserveDefaultPayload: true` when the receiver needs the path, and debug with
`webhookInvocations`. See [Webhooks](references/core-api.md#webhooks).

### Bulk import / mass operations

Use a mass operation: see [[mass-operations]], and [[content-model]] for shapes and pieces. Order: pieces, shapes,
topic maps, items.

## Error Handling

The Core API uses union return types. Always include error fragments:

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

The Shop API has no unions: a failure comes back in the standard GraphQL `errors` list. A missing, expired or
rejected token answers HTTP 401 with `{ "success": false, … }` and no `errors`. Neither API accepts an explicit
`null` for an optional field: leave the key out.

Common Core error types: `BasicError`, `UnauthorizedError`, `ItemNotFoundError`, `OrderDoesNotBelongToTenantError`.

## Using the JS API Client

For JavaScript/TypeScript, use `@crystallize/js-api-client`; see [[js-api-client]].

```typescript
import { createClient } from "@crystallize/js-api-client";
const api = createClient({
    tenantIdentifier: "your-tenant",
    accessTokenId: "...",
    accessTokenSecret: "...",
});

// Core API mutations (back office only)
const result = await api.nextPimApi(mutationString, variables);

// Shop API mutations (server-side): one caller per route, the Shop API token is fetched for you
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
4. **Where it runs**: server action, webhook, script or admin tool, and which token it needs

If the user is working in a JS/TS project, prefer generating code using `@crystallize/js-api-client` helpers.

## References

- [Core API Mutations](references/core-api.md) - Item CRUD, variants, components, partial writes, unit-bound
  numerics, id argument types, customers, pipelines, webhooks, publish/unpublish, delete
- [Shop API Cart Mutations](references/shop-api-mutations.md) - Cart hydration, item management, checkout flow, cart
  lifecycle
- [Shop API Order Mutations](references/shop-api-order-mutations.md) - Order creation (from cart or direct),
  payments, pipelines, metadata, the order store
- [Media & Images](references/media.md) - Moved to the [[media]] skill

## Related skills

[[storefront]] owns the API contract and the request path per page type. [[query]] covers reads across the same APIs.
Importing images and video is [[media]]. For bulk writes that would otherwise hit rate limits, use
[[mass-operations]]. Vector ranking has its own Core mutations (`upsertVocabulary`, `setItemTaste`,
`igniteDiscoApi`) in [[vector-ranking]]. Taking payment is in [[payments]], bookings in [[bookable-resources]],
subscription contracts in [[subscriptions]], and prices and promotions in [[pricing]].
