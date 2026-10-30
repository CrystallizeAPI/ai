---
name: js-api-client
description: Use the @crystallize/js-api-client package to interact with Crystallize APIs in JavaScript/TypeScript. Use when setting up the Crystallize API client, configuring credentials (including the bearer token of a plugin), calling catalogueApi/discoveryApi/pimApi/nextPimApi/meApi or the Shop API callers (shopCartApi, shopOrderApi, shopCustomerApi, shopLockApi, shopSubscriptionContractApi, shopBookingApi), configuring Shop API token scopes, working with high-level helpers for catalogue fetching, cart management, Shop API orders (createFromCart, addPayments, setPayments, pipeline stages), Shop API customers, distributed locks, Core orders, customers, subscriptions, navigation, or using any helper from the @crystallize/js-api-client npm package (createCartManager, createShopOrderManager, createShopCustomerManager, createShopLock, createOrderManager, createCustomerManager, createBinaryFileManager, createSignatureVerifier, …).
metadata:
    author: Crystallize
    version: "2.1"
---

# Crystallize JS API Client

The `@crystallize/js-api-client` package provides typed utilities for working with all Crystallize APIs in JavaScript/TypeScript environments.

## Consultation Approach

Before writing code, understand the context. Ask clarifying questions:

1. **What are you trying to do?** Read data, write data, manage carts, handle webhooks?
2. **Do you need raw GraphQL or a high-level helper?** Helpers reduce boilerplate for common workflows (orders, carts, navigation). Use raw GraphQL via API callers for custom queries or when helpers don't cover the use case.
3. **Which API?** Catalogue/Discovery for storefront reads, Core (`nextPimApi`) for back-office reads and writes, the
   Shop API for checkout: carts (`/cart`), orders made from them (`/order`), customers (`/customer`), locks (`/lock`).
   Orders and customers exist on both sides — pick the helper for the side you are on (see
   [Shop API](#shop-api-carts-orders-customers-locks)).
4. **What auth do you have?** `staticAuthToken` is enough for read-only. PIM/Shop operations need `accessTokenId` + `accessTokenSecret`. A plugin passes its `backendToken` JWT as `bearerToken` — it becomes `Authorization: Bearer <jwt>` and works on the Core APIs only (see [Authentication](#authentication)).
5. **Is this server-side or client-side?** The client works in both, but credentials should only live server-side.

## Installation

```bash
pnpm add @crystallize/js-api-client
# or npm install @crystallize/js-api-client
# or yarn add @crystallize/js-api-client
```

## Quick Start

```typescript
import { createClient } from "@crystallize/js-api-client";

const api = createClient({
    tenantIdentifier: "your-tenant",
    // For protected APIs, provide credentials:
    // accessTokenId: '…',
    // accessTokenSecret: '…',
    // staticAuthToken: '…', // for read-only catalogue/discovery
    // bearerToken: '…',     // JWT sent as `Authorization: Bearer <jwt>` (plugin backendToken)
});

// Call any GraphQL API with string queries
const { catalogue } = await api.catalogueApi(
    `query Q($path: String!, $language: String!) {
    catalogue(path: $path, language: $language) {
      name
      path
    }
  }`,
    { path: "/shop", language: "en" },
);

// Close when using HTTP/2 option
api.close();
```

## Configuration

```typescript
createClient(configuration, options?)
```

### Configuration Options

| Option                                | Description                                                              |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `tenantIdentifier`                    | **Required**. Your tenant name                                           |
| `tenantId`                            | Optional tenant ID                                                       |
| `accessTokenId` / `accessTokenSecret` | For PIM/Shop operations                                                  |
| `sessionId`                           | Alternative to token-based auth                                          |
| `staticAuthToken`                     | For read-only catalogue/discovery                                        |
| `bearerToken`                         | JWT forwarded as `Authorization: Bearer <jwt>` (a plugin `backendToken`) |
| `shopApiToken`                        | A Shop API token; auto-fetched when omitted                              |
| `shopApiStaging`                      | Use staging Shop API                                                     |
| `origin`                              | Custom host suffix (default: `.crystallize.com`)                         |

### Client Options

| Option             | Description                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useHttp2`         | Enable HTTP/2 transport                                                                                                                                             |
| `http2IdleTimeout` | HTTP/2 idle timeout in milliseconds (default 5 minutes)                                                                                                             |
| `timeout`          | Abort requests that take longer than this many milliseconds                                                                                                         |
| `profiling`        | Profiling callbacks for debugging                                                                                                                                   |
| `extraHeaders`     | Extra request headers for all calls except the Shop API callers                                                                                                     |
| `shopApiToken`     | `{ scopes?, expiresIn?, doNotFetch? }` — Shop API token fetching (`expiresIn` in seconds, default 12 hours), see [Shop API](#shop-api-carts-orders-customers-locks) |

## API Callers

All callers share the same signature:

```typescript
<T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
```

| Caller                        | Purpose                                                               |
| ----------------------------- | --------------------------------------------------------------------- |
| `catalogueApi`                | Catalogue GraphQL                                                     |
| `discoveryApi`                | Discovery GraphQL (search/browse)                                     |
| `pimApi`                      | PIM GraphQL (legacy — prefer `nextPimApi`)                            |
| `nextPimApi`                  | PIM Next GraphQL (scoped to tenant, recommended)                      |
| `meApi`                       | Per-user GraphQL (`@me`) — call on behalf of the authenticated viewer |
| `shopCartApi`                 | Shop API `/cart` GraphQL (token auto-handled)                         |
| `shopOrderApi`                | Shop API `/order` GraphQL (7.5+)                                      |
| `shopCustomerApi`             | Shop API `/customer` GraphQL (7.5+)                                   |
| `shopLockApi`                 | Shop API `/lock` GraphQL (7.5+)                                       |
| `shopSubscriptionContractApi` | Shop API `/subscription-contract` GraphQL (7.5+)                      |
| `shopBookingApi`              | Shop API `/booking` GraphQL (7.5+)                                    |

## High-Level Helpers

Available helpers:

| Helper                              | Import                       | Purpose                                                    |
| ----------------------------------- | ---------------------------- | ---------------------------------------------------------- |
| `createCatalogueFetcher`            | `@crystallize/js-api-client` | Build typed catalogue queries with object syntax           |
| `createNavigationFetcher`           | `@crystallize/js-api-client` | Fetch navigation trees by depth                            |
| `createProductHydrater`             | `@crystallize/js-api-client` | Fetch products/variants by path or SKU                     |
| `createOrderFetcher`                | `@crystallize/js-api-client` | **Core**: fetch orders with type-safe field selection      |
| `createOrderManager`                | `@crystallize/js-api-client` | **Core**: register/update orders, set payments, pipelines  |
| `createCustomerFetcher`             | `@crystallize/js-api-client` | **Core**: fetch customers by identifier or reference       |
| `createCustomerManager`             | `@crystallize/js-api-client` | **Core**: create and update customers                      |
| `createCustomerGroupManager`        | `@crystallize/js-api-client` | **Core**: manage customer groups                           |
| `createSubscriptionContractFetcher` | `@crystallize/js-api-client` | **Core**: fetch subscription contracts                     |
| `createSubscriptionContractManager` | `@crystallize/js-api-client` | **Core**: create and manage subscription contracts         |
| `createBinaryFileManager`           | `@crystallize/js-api-client` | **Core**: upload images and files (server-side only)       |
| `createCartManager`                 | `@crystallize/js-api-client` | **Shop**: hydrate, fetch, place, fulfill and abandon carts |
| `createShopOrderManager`            | `@crystallize/js-api-client` | **Shop**: order from a cart, payments, pipelines (7.5+)    |
| `createShopCustomerManager`         | `@crystallize/js-api-client` | **Shop**: upsert customers, addresses, meta (7.5+)         |
| `createShopLock`                    | `@crystallize/js-api-client` | **Shop**: acquire/release a distributed lock (7.5+)        |
| `createSignatureVerifier`           | `@crystallize/js-api-client` | Verify the signature of a webhook                          |
| `createPluginPayloadDecrypter`      | `@crystallize/js-api-client` | Decrypt a plugin payload                                   |
| `pricesForUsageOnTier`              | `@crystallize/js-api-client` | Prices for a usage on volume or graduated tiers            |
| `createMassCallClient`              | `@crystallize/js-api-client` | Deprecated: batched calls, use `p-limit` instead           |

## Shop API: carts, orders, customers, locks

The Shop API is one GraphQL endpoint per concern at `https://shop-api.crystallize.com/@{tenant}/{endpoint}`, each with
its own `shop*Api` caller. Since **7.5.0** (which needs `@crystallize/schema` 6.15.0) there are helpers for `/order`,
`/customer` and `/lock` next to the cart manager.

**One token for all of them.** The client fetches a Shop API token with your access token pair (or `sessionId`),
asking for `shopApiToken.scopes` (default `['cart']`). When a caller needs an endpoint the token does not cover, the
token is refetched with the union of the scopes; it is also refreshed 5 minutes before it expires. List every endpoint
you use up front to get a single token. A `shopApiToken` passed in the configuration goes through the same checks,
except that a token with no `scopes` claim is trusted for any endpoint; with `doNotFetch: true` it is used as is and
nothing is ever fetched.

**The fetch needs an access token pair or a session.** The token endpoint does not read a `bearerToken`, and it checks
who you are on `/@me`, which refuses a tenant-scoped access token. A bearer-only client, a `bearerToken` set next to an
access token pair (it is sent instead of the pair) and a tenant-scoped pair all fail with
`Could not fetch shop api token: …`.

```typescript
import { createCartManager, createClient, createShopOrderManager } from "@crystallize/js-api-client";

const api = createClient(
    { tenantIdentifier: "your-tenant", accessTokenId: "…", accessTokenSecret: "…" },
    { shopApiToken: { scopes: ["cart", "order"] } },
);
const carts = createCartManager(api);
const orders = createShopOrderManager(api);

const cart = await carts.hydrate(
    {
        items: [{ sku: "SKU-1", quantity: 2 }],
        context: {
            language: "en",
            ttl: 3600 * 24 * 30,
            price: {
                currency: "eur",
                decimals: 4,
                selectedVariantIdentifier: "default",
                pricesHaveTaxesIncludedInCrystallize: false,
                discountOnNetPrices: false,
                markets: [],
            },
        },
    },
    { total: { gross: true, currency: true } },
);
const placed = await carts.place(cart.id, { total: { gross: true, currency: true } }); // frozen: charge this total
// … the payment provider confirms the payment (webhook) …
const order = await orders.createFromCart(cart.id, {
    type: "standard",
    paymentStatus: "paid", // set once: the Shop API has no mutation to change it later
    payments: [{ provider: "stripe", transactionId: "pi_123", amount: 100, method: "card" }],
    pipelines: [{ identifier: pipelineId, stage: stageId }], // ids from Core, not names
});
// … later, each write on its own, once the previous one shows in a read …
await orders.addPayments(order.id, [
    { provider: "stripe", transactionId: "re_1", amount: 20, meta: [{ key: "type", value: "refund" }] },
]);
await orders.setPayments(order.id, [/* the whole list */]); // replaces every payment
await orders.addToStage(order.id, pipelineId, shippedStageId);
const read = await orders.fetch(order.id, { payments: { provider: true, transactionId: true, meta: true } });
```

- **`hydrate` takes a whole `context`.** Every `context` field above is required, or the client throws before calling.
  With no `context` at all, which only plain JavaScript allows, it sends the defaults: `en`, 30 days, `eur`, 0 decimals, the
  `default` price variant. The schema silently drops what it does not know, so `type`, `name`, `context.catalogue` and
  `context.wishlist` never reach the API: use `shopCartApi` for those.
- The cart manager also has `addSkuItem(id, item)`, `removeItem(id, { sku, quantity })`, `setMeta(id, { meta, merge })`
  (`merge` is required) and `setCustomer(id, customer)`. The rest of `/cart` (`addExternalItem`, `bookSkuItem`,
  `markAsWishlist`, `remove`, `orderIntent`, `carts`) has no helper: call it through `shopCartApi`.
- A cart or order customer (`hydrate`, `carts.setCustomer`, `orders.setCustomer`) needs `isGuest`, `type` and `addresses`
  (`[]` when there are none). `birthDate` is a `Date`, on Shop customers too.
- **The order id is the cart id**, and `createFromCart` only accepts a `placed` cart. It moves the cart to `ordered`
  itself, so `carts.fulfill` is refused after it: `fulfill` is for an order made another way. Always pass an intent:
  `createFromCart(cartId)` alone is refused, `{}` is enough.
- **`pipelines`, `addToStage` and `removeFromPipeline` take Core ids, not names.** In `pipelines`, `identifier` is the
  pipeline id and `stage` the stage id, required even though the client's type makes it optional. The Shop API stores
  any string, and a name such as `fulfilment` then keeps the order from reaching Core. Without `pipelines`, Core uses
  the pipelines the tenant set up for new orders.
- **A Shop write also moves the Core stages**: every `/order` write sends the whole order to Core, which moves the order
  to match its `pipelines` list. That list does not follow stage moves made in the App or on Core, so a bare
  `addPayments` can undo them: see [the Shop order and the Core order](../payments/SKILL.md#the-shop-order-and-the-core-order).
- **Payments are generic records**: `provider` is any string, nothing is charged. `meta` is written as
  `[{ key, value }]` but read back as a JSON object.
- **Writes persist just after the response**: a read right after any `/order` write can still see the previous state,
  and so can the next write, which loads the order first. `addPayments` right after `createFromCart` can fail with
  "not found", and of two quick writes the first can be lost. `fetch` rejects (`JSApiClientCallError`) when the order
  does not exist.
- **Optional fields reject `null`** (the `@crystallize/schema/shop` inputs are `.optional()`, not nullable, and the
  customer input is strict): strip `null`s from data you read back before sending it. An explicit `undefined` fails
  too: the client prints it into the query, so leave the key out.
- `listByCustomer(identifier, { limit, skip })`, `setMeta(id, { meta, merge })`, `setCustomer(id, customer)` and
  `removeFromPipeline(id, pipeline)` complete the order manager. The `/order` `create` mutation (an order with no cart)
  has no helper: call it through `shopOrderApi`.

```typescript
import { createShopCustomerManager, createShopLock } from "@crystallize/js-api-client";

const customers = createShopCustomerManager(api); // `customer` scope
const exists = await customers.fetch("jane@example.com").then(
    () => true,
    () => false,
); // rejects when missing
const address = { type: "delivery", street: "Main St 1", city: "Oslo" } as const;
if (exists) await customers.addAddress("jane@example.com", address);
else
    await customers.upsert({
        identifier: "jane@example.com",
        email: "jane@example.com",
        firstName: "Jane",
        addresses: [address],
    });
// also: setAddress(identifier, index, address), removeAddress(identifier, index), setMeta(identifier, { meta })

const lock = createShopLock(api); // `lock` scope
if (await lock.acquire(`order-${cartId}`, 30)) {
    // ttl in seconds (default 60); false when already held
    try {
        // … work that must not run twice at once
    } finally {
        await lock.release(`order-${cartId}`);
    }
}
```

- **`upsert` replaces the whole customer**: what you leave out is cleared, addresses, meta and external references
  included. To change one part, use `addAddress`, `setAddress`, `removeAddress` or `setMeta`.
- Customer writes persist just after the response too, so `addAddress` right after `upsert` can fail with "not found":
  pass `addresses` to `upsert`.
- **Lock keys keep only `a-z`, `0-9` and `-`**: any other character is dropped, so `Order:1` and `rder1` are the same
  lock.

**Shop or Core?** An order made from a cart lives on the Shop API: create it with `createShopOrderManager`
(`createFromCart`) and keep recording its payments there. `createOrderManager` writes Core orders (`register`,
`update`, `setPayments`) — for orders that never had a cart (imports, POS, back office). A Core write on a Shop order
is pushed back to the Shop order as a whole and can overwrite payments just set through the Shop API. The same split
holds for customers (`createShopCustomerManager` vs `createCustomerManager`). The [payments skill](../payments/SKILL.md)
shows the whole checkout.

**Upgrading to 7.5:** nothing changes for `createClient` users. A hand-built `ClientInterface` (a typed test mock)
needs the five new callers. Cart and Shop customer `birthDate` is now sent as an ISO string.

## Authentication

| Auth Type                             | Header sent                                                           | Use Case                                                                       |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `staticAuthToken`                     | `X-Crystallize-Static-Auth-Token: <token>`                            | Read-only catalogue/discovery                                                  |
| `accessTokenId` + `accessTokenSecret` | `X-Crystallize-Access-Token-Id` + `X-Crystallize-Access-Token-Secret` | PIM/Shop operations                                                            |
| `sessionId`                           | `Cookie: connect.sid=<sessionId>`                                     | Alternative to token pair                                                      |
| `bearerToken`                         | `Authorization: Bearer <jwt>`                                         | Plugins forward `envelope.backendToken`, the only JWT accepted; Core APIs only |
| `shopApiToken`                        | `Authorization: Bearer <token>` (Shop API only)                       | Optional; fetched with the access token pair or `sessionId` if omitted         |

**Priority** when multiple are set on the same client: `sessionId` > `bearerToken` > `staticAuthToken` > `accessTokenId`/`accessTokenSecret`. Only one is sent per request. Per-caller restrictions:

- `discoveryApi` sends `bearerToken` or `staticAuthToken`, but Discovery reads only the static token: a bearer token is
  ignored.
- `catalogueApi` sends `bearerToken`, `staticAuthToken`, or `accessTokenId`/`accessTokenSecret`, but Catalogue reads only
  the credential the tenant requires, the static token or the pair: a bearer token is ignored.
- `pimApi` and `nextPimApi` honor `sessionId`, `bearerToken`, and `accessTokenId`/`accessTokenSecret`.
- `meApi` sends the same three, but `/@me` answers 403 to a tenant-scoped token: a plugin `backendToken`, or an access
  token created with a tenant scope. Use a session or an access token with no tenant scope.

**A higher-priority credential hides the others.** With a `bearerToken` set, `staticAuthToken` is never sent, so
Discovery and Catalogue reject the call on a tenant that protects them, and the Shop API token cannot be fetched. With
`staticAuthToken` next to an access token pair, Catalogue gets only the static token, which fails when the tenant
requires the pair. Use one client per credential. A plugin payload carries the tenant's static token, when it has one,
as `envelope.staticAuthToken`.

Generate access tokens in the Crystallize App: **Settings → Access Tokens**. For plugin-issued JWTs, use the `backendToken` from the decrypted iframe/webhook payload — see the [plugins skill](../plugins/SKILL.md).

### Example: bearer-token client (plugin context)

```typescript
import { createClient } from "@crystallize/js-api-client";

const api = createClient({
    tenantIdentifier,
    bearerToken: decoded.envelope.backendToken, // RS256 JWT from the plugin payload
});

const { tenant } = await api.nextPimApi<{ tenant: { id: string; name: string } }>(
    "{ tenant { ... on Tenant { id name } } }",
);
```

## Errors

- A failed call rejects with `JSApiClientCallError` (`code` and `statusCode`, `statusText`, `message`, `errors`, `query`,
  `variables`). That covers a non-2xx response, a GraphQL `errors` array (`code` is then 400), and a Core Next error
  union: any field of `data` that carries an `errorName`.
- The client only sees a union error the query selects. In raw `nextPimApi` calls add
  `... on BasicError { errorName message }`, or the failure comes back as an empty object and nothing throws.
- Most helpers validate their input with the `@crystallize/schema` Zod schemas: a bad input throws a `ZodError` before
  any request is sent.
- A failed Shop API token fetch throws a plain `Error` (`Could not fetch shop api token: …`).

## References

- [Official Documentation](https://crystallize.com/docs/developer/sdk/js-api-client) - High-level helpers and utilities (GraphQL Builder, Signature Verification, Binary File Manager, Pricing Utilities, Request Profiling)
- [GitHub Repository](https://github.com/CrystallizeAPI/libraries/tree/main/components/js-api-client)
- [NPM Package](https://www.npmjs.com/package/@crystallize/js-api-client)

Related: [[payments]] for the checkout built on the Shop API helpers, [[mutation]] for the raw GraphQL behind them,
[[plugins]] for `bearerToken` and payload decryption.
