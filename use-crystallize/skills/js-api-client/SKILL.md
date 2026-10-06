---
name: js-api-client
description: Use the @crystallize/js-api-client package to interact with Crystallize APIs in JavaScript/TypeScript. Use when setting up the Crystallize API client, configuring credentials (including bearer tokens for plugins and delegated calls), calling catalogueApi/discoveryApi/pimApi/nextPimApi/meApi or the Shop API callers (shopCartApi, shopOrderApi, shopCustomerApi, shopLockApi, shopSubscriptionContractApi, shopBookingApi), configuring Shop API token scopes, working with high-level helpers for catalogue fetching, cart management, Shop API orders (createFromCart, addPayments, setPayments, pipeline stages), Shop API customers, distributed locks, Core orders, customers, subscriptions, navigation, or using any helper from the @crystallize/js-api-client npm package (createCartManager, createShopOrderManager, createShopCustomerManager, createShopLock, createOrderManager, createCustomerManager, …).
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
4. **What auth do you have?** `staticAuthToken` is enough for read-only. PIM/Shop operations need `accessTokenId` + `accessTokenSecret`. For plugins or delegated calls where the caller already holds a JWT, pass it as `bearerToken` — it becomes `Authorization: Bearer <jwt>`.
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
    // bearerToken: '…',     // JWT sent as `Authorization: Bearer <jwt>` (e.g. plugin backendToken)
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

| Option                                | Description                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `tenantIdentifier`                    | **Required**. Your tenant name                                                |
| `tenantId`                            | Optional tenant ID                                                            |
| `accessTokenId` / `accessTokenSecret` | For PIM/Shop operations                                                       |
| `sessionId`                           | Alternative to token-based auth                                               |
| `staticAuthToken`                     | For read-only catalogue/discovery                                             |
| `bearerToken`                         | JWT forwarded as `Authorization: Bearer <jwt>` (e.g. a plugin `backendToken`) |
| `shopApiToken`                        | A Shop API token to use as is; auto-fetched when omitted                      |
| `shopApiStaging`                      | Use staging Shop API                                                          |
| `origin`                              | Custom host suffix (default: `.crystallize.com`)                              |

### Client Options

| Option         | Description                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `useHttp2`     | Enable HTTP/2 transport                                                                                                  |
| `profiling`    | Profiling callbacks for debugging                                                                                        |
| `extraHeaders` | Extra request headers for all calls                                                                                      |
| `shopApiToken` | `{ scopes?, expiresIn?, doNotFetch? }` — Shop API token fetching, see [Shop API](#shop-api-carts-orders-customers-locks) |

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
| `createCustomerManager`             | `@crystallize/js-api-client` | **Core**: create and update customers                      |
| `createCustomerGroupManager`        | `@crystallize/js-api-client` | **Core**: manage customer groups                           |
| `createSubscriptionContractManager` | `@crystallize/js-api-client` | **Core**: create and manage subscription contracts         |
| `createCartManager`                 | `@crystallize/js-api-client` | **Shop**: hydrate, fetch, place, fulfill and abandon carts |
| `createShopOrderManager`            | `@crystallize/js-api-client` | **Shop**: order from a cart, payments, pipelines (7.5+)    |
| `createShopCustomerManager`         | `@crystallize/js-api-client` | **Shop**: upsert customers, addresses, meta (7.5+)         |
| `createShopLock`                    | `@crystallize/js-api-client` | **Shop**: acquire/release a distributed lock (7.5+)        |

## Shop API: carts, orders, customers, locks

The Shop API is one GraphQL endpoint per concern at `https://shop-api.crystallize.com/@{tenant}/{endpoint}`, each with
its own `shop*Api` caller. Since **7.5.0** (which needs `@crystallize/schema` 6.15.0) there are helpers for `/order`,
`/customer` and `/lock` next to the cart manager.

**One token for all of them.** The client fetches a Shop API token with your access token pair (or `sessionId` /
`bearerToken`), asking for `shopApiToken.scopes` (default `['cart']`). When a caller needs an endpoint the token does
not cover, the token is refetched with the union of the scopes; it is also refreshed 5 minutes before it expires. List
every endpoint you use up front to get a single token. A `shopApiToken` passed in the configuration is used as is
when it carries no `scopes` claim; with `doNotFetch: true` nothing is ever fetched.

```typescript
import { createCartManager, createClient, createShopOrderManager } from "@crystallize/js-api-client";

const api = createClient(
    { tenantIdentifier: "your-tenant", accessTokenId: "…", accessTokenSecret: "…" },
    { shopApiToken: { scopes: ["cart", "order"] } },
);
const carts = createCartManager(api);
const orders = createShopOrderManager(api);

const placed = await carts.place(cartId, { total: { gross: true, currency: true } }); // frozen: charge this total
// … the payment provider confirms the payment (webhook) …
const order = await orders.createFromCart(cartId, {
    type: "standard",
    paymentStatus: "paid", // set once: the Shop API has no mutation to change it later
    payments: [{ provider: "stripe", transactionId: "pi_123", amount: 100, method: "card" }],
    pipelines: [{ identifier: "fulfilment", stage: "new" }],
});
await orders.addPayments(order.id, [
    { provider: "stripe", transactionId: "re_1", amount: 20, meta: [{ key: "type", value: "refund" }] },
]);
await orders.setPayments(order.id, [/* the whole list */]); // replaces every payment
await orders.addToStage(order.id, "fulfilment", "shipped");
const read = await orders.fetch(order.id, { payments: { provider: true, transactionId: true, meta: true } });
```

- **The order id is the cart id**, and `createFromCart` only accepts a `placed` cart.
- **Payments are generic records**: `provider` is any string, nothing is charged. `meta` is written as
  `[{ key, value }]` but read back as a JSON object.
- **Writes persist just after the response**: a read right after `createFromCart`, `addPayments` or `setPayments`
  can still see the previous state. `fetch` rejects (`JSApiClientCallError`) when the order does not exist.
- **Optional fields reject `null`** (the `@crystallize/schema/shop` inputs are `.optional()`, not nullable, and the
  customer input is strict): strip `null`s from data you read back before sending it.
- `listByCustomer(identifier, { limit, skip })`, `setMeta(id, { meta, merge })`, `setCustomer(id, customer)` and
  `removeFromPipeline(id, pipeline)` complete the order manager.

```typescript
import { createShopCustomerManager, createShopLock } from "@crystallize/js-api-client";

const customers = createShopCustomerManager(api); // `customer` scope
const exists = await customers.fetch("jane@example.com").then(
    () => true,
    () => false,
); // rejects when missing
if (!exists) await customers.upsert({ identifier: "jane@example.com", email: "jane@example.com", firstName: "Jane" });
await customers.addAddress("jane@example.com", { type: "delivery", street: "Main St 1", city: "Oslo" });
// also: setAddress(identifier, index, address), removeAddress(identifier, index), setMeta(identifier, { meta })

const lock = createShopLock(api); // `lock` scope
if (await lock.acquire(`order:${cartId}`, 30)) {
    // ttl in seconds (default 60); false when already held
    try {
        // … work that must not run twice at once
    } finally {
        await lock.release(`order:${cartId}`);
    }
}
```

**Shop or Core?** An order made from a cart lives on the Shop API: create it with `createShopOrderManager`
(`createFromCart`) and keep recording its payments there. `createOrderManager` writes Core orders (`register`,
`update`, `setPayments`) — for orders that never had a cart (imports, POS, back office). A Core write on a Shop order
is pushed back to the Shop order as a whole and can overwrite payments just set through the Shop API. The same split
holds for customers (`createShopCustomerManager` vs `createCustomerManager`). The [payments skill](../payments/SKILL.md)
shows the whole checkout.

**Upgrading to 7.5:** nothing changes for `createClient` users. A hand-built `ClientInterface` (a typed test mock)
needs the five new callers. Cart and Shop customer `birthDate` is now sent as an ISO string.

## Authentication

| Auth Type                             | Header sent                                                           | Use Case                                                                           |
| ------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `staticAuthToken`                     | `X-Crystallize-Static-Auth-Token: <token>`                            | Read-only catalogue/discovery                                                      |
| `accessTokenId` + `accessTokenSecret` | `X-Crystallize-Access-Token-Id` + `X-Crystallize-Access-Token-Secret` | PIM/Shop operations                                                                |
| `sessionId`                           | `Cookie: connect.sid=<sessionId>`                                     | Alternative to token pair                                                          |
| `bearerToken`                         | `Authorization: Bearer <jwt>`                                         | JWT-based auth — plugins forward `envelope.backendToken`; delegated/per-user calls |
| `shopApiToken`                        | `Authorization: Bearer <token>` (Shop API only)                       | Optional; fetched with the auth above (never `staticAuthToken`) if omitted         |

**Priority** when multiple are set on the same client: `sessionId` > `bearerToken` > `staticAuthToken` > `accessTokenId`/`accessTokenSecret`. Only one is sent per request. Per-caller restrictions:

- `discoveryApi` only honors `bearerToken` and `staticAuthToken`.
- `catalogueApi` honors `bearerToken`, `staticAuthToken`, and `accessTokenId`/`accessTokenSecret`.
- `pimApi`, `nextPimApi`, and `meApi` honor `sessionId`, `bearerToken`, and `accessTokenId`/`accessTokenSecret`.

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

## References

- [Official Documentation](https://crystallize.com/docs/developer/sdk/js-api-client) - High-level helpers and utilities (GraphQL Builder, Signature Verification, Binary File Manager, Pricing Utilities, Request Profiling)
- [GitHub Repository](https://github.com/CrystallizeAPI/libraries/tree/main/components/js-api-client)
- [NPM Package](https://www.npmjs.com/package/@crystallize/js-api-client)

Related: [[payments]] for the checkout built on the Shop API helpers, [[mutation]] for the raw GraphQL behind them,
[[plugins]] for `bearerToken` and payload decryption.
