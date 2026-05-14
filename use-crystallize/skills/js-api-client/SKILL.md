---
name: js-api-client
description: Use the @crystallize/js-api-client package to interact with Crystallize APIs in JavaScript/TypeScript. Use when setting up the Crystallize API client, configuring credentials (including bearer tokens for plugins and delegated calls), calling catalogueApi/discoveryApi/pimApi/nextPimApi/meApi/shopCartApi, working with high-level helpers for catalogue fetching, cart management, orders, customers, subscriptions, navigation, or using any helper from the @crystallize/js-api-client npm package.
metadata:
    author: Crystallize
    version: "2.0"
---

# Crystallize JS API Client

The `@crystallize/js-api-client` package provides typed utilities for working with all Crystallize APIs in JavaScript/TypeScript environments.

## Consultation Approach

Before writing code, understand the context. Ask clarifying questions:

1. **What are you trying to do?** Read data, write data, manage carts, handle webhooks?
2. **Do you need raw GraphQL or a high-level helper?** Helpers reduce boilerplate for common workflows (orders, carts, navigation). Use raw GraphQL via API callers for custom queries or when helpers don't cover the use case.
3. **Which API?** Catalogue/Discovery for storefront reads, PIM for admin writes, Shop Cart for checkout flows.
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
| `shopApiToken`                        | Auto-fetched if not provided                                                  |
| `shopApiStaging`                      | Use staging Shop API                                                          |
| `origin`                              | Custom host suffix (default: `.crystallize.com`)                              |

### Client Options

| Option         | Description                         |
| -------------- | ----------------------------------- |
| `useHttp2`     | Enable HTTP/2 transport             |
| `profiling`    | Profiling callbacks for debugging   |
| `extraHeaders` | Extra request headers for all calls |
| `shopApiToken` | Control auto-fetch behavior         |

## API Callers

All callers share the same signature:

```typescript
<T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
```

| Caller         | Purpose                                                               |
| -------------- | --------------------------------------------------------------------- |
| `catalogueApi` | Catalogue GraphQL                                                     |
| `discoveryApi` | Discovery GraphQL (search/browse)                                     |
| `pimApi`       | PIM GraphQL (legacy — prefer `nextPimApi`)                            |
| `nextPimApi`   | PIM Next GraphQL (scoped to tenant, recommended)                      |
| `meApi`        | Per-user GraphQL (`@me`) — call on behalf of the authenticated viewer |
| `shopCartApi`  | Shop Cart GraphQL (token auto-handled)                                |

## High-Level Helpers

Available helpers (see [High-Level Helpers Reference](references/high-level-helpers.md) for full examples):

| Helper                              | Import                       | Purpose                                                     |
| ----------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| `createCatalogueFetcher`            | `@crystallize/js-api-client` | Build typed catalogue queries with object syntax            |
| `createNavigationFetcher`           | `@crystallize/js-api-client` | Fetch navigation trees by depth                             |
| `createProductHydrater`             | `@crystallize/js-api-client` | Fetch products/variants by path or SKU                      |
| `createOrderFetcher`                | `@crystallize/js-api-client` | Fetch orders with type-safe field selection                 |
| `createOrderManager`                | `@crystallize/js-api-client` | Create/update orders, set payments, move pipeline stages    |
| `createCustomerManager`             | `@crystallize/js-api-client` | Create and update customers                                 |
| `createCustomerGroupManager`        | `@crystallize/js-api-client` | Manage customer groups                                      |
| `createSubscriptionContractManager` | `@crystallize/js-api-client` | Create and manage subscription contracts                    |
| `createCartManager`                 | `@crystallize/js-api-client` | Hydrate carts, add items, place orders (token auto-handled) |

## Authentication

| Auth Type                             | Header sent                                                           | Use Case                                                                           |
| ------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `staticAuthToken`                     | `X-Crystallize-Static-Auth-Token: <token>`                            | Read-only catalogue/discovery                                                      |
| `accessTokenId` + `accessTokenSecret` | `X-Crystallize-Access-Token-Id` + `X-Crystallize-Access-Token-Secret` | PIM/Shop operations                                                                |
| `sessionId`                           | `Cookie: connect.sid=<sessionId>`                                     | Alternative to token pair                                                          |
| `bearerToken`                         | `Authorization: Bearer <jwt>`                                         | JWT-based auth — plugins forward `envelope.backendToken`; delegated/per-user calls |
| `shopApiToken`                        | `Authorization: Bearer <token>` (Shop API only)                       | Optional; auto-fetched if omitted                                                  |

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

- [High-Level Helpers](references/high-level-helpers.md) - Catalogue Fetcher, Navigation Fetcher, Product Hydrater, Order Manager, Customer Manager, Cart Manager, and more
- [Utilities](references/utilities.md) - GraphQL Builder, Signature Verification, Binary File Manager, Pricing Utilities, Request Profiling
- [Official Documentation](https://crystallize.com/docs/developer/sdk/js-api-client)
- [GitHub Repository](https://github.com/CrystallizeAPI/libraries/tree/main/components/js-api-client)
- [NPM Package](https://www.npmjs.com/package/@crystallize/js-api-client)
