# Crystallize JS API Client — High-Level Helpers

These helpers wrap common workflows with typed interfaces and reduce boilerplate.

---

## Catalogue Fetcher

Build queries from nested objects instead of raw GraphQL strings:

```typescript
import {
  createCatalogueFetcher,
  catalogueFetcherGraphqlBuilder as b,
} from "@crystallize/js-api-client";

const fetchCatalogue = createCatalogueFetcher(api);

const data = await fetchCatalogue<{
  catalogue: { name: string; path: string };
}>({
  catalogue: {
    __args: { path: "/shop", language: "en" },
    name: true,
    path: true,
    ...b.onProduct({}, { onVariant: { sku: true, name: true } }),
  },
});
```

---

## Navigation Fetcher

Fetch navigation trees up to any depth:

```typescript
import { createNavigationFetcher } from "@crystallize/js-api-client";

const nav = createNavigationFetcher(api);
const tree = await nav.byFolders("/", "en", 3);
```

---

## Product Hydrater

Fetch product/variant data by paths or SKUs with market and price list support:

```typescript
import { createProductHydrater } from "@crystallize/js-api-client";

const hydrater = createProductHydrater(api, {
  marketIdentifiers: ["eu"],
  priceList: "b2b",
  priceForEveryone: true,
});

const products = await hydrater.bySkus(["SKU-1", "SKU-2"], "en");
```

---

## Order Fetcher

Fetch orders with type-safe field selection:

```typescript
import { createOrderFetcher } from "@crystallize/js-api-client";

const orders = createOrderFetcher(api);
const order = await orders.byId("order-id", {
  onOrder: { payment: { provider: true } },
  onOrderItem: { subscription: { status: true } },
  onCustomer: { email: true },
});

const list = await orders.byCustomerIdentifier("customer-123", { first: 20 });
```

---

## Order Manager

Create and update orders, set payments, and move through pipeline stages:

```typescript
import { createOrderManager } from "@crystallize/js-api-client";

const om = createOrderManager(api);

// Register an order
const confirmation = await om.register({
  cart: [
    {
      sku: "SKU-1",
      name: "Product",
      quantity: 1,
      price: { gross: 100, net: 80, currency: "USD" },
    },
  ],
  customer: { identifier: "customer-123" },
});

// Set payments
await om.setPayments("order-id", [
  {
    provider: "STRIPE",
    amount: { gross: 100, net: 80, currency: "USD" },
    method: "card",
  },
]);

// Move to pipeline stage
await om.putInPipelineStage({
  id: "order-id",
  pipelineId: "pipeline",
  stageId: "stage",
});
```

---

## Customer Manager

```typescript
import { createCustomerManager } from "@crystallize/js-api-client";

const customers = createCustomerManager(api);
await customers.create({ identifier: "cust-1", email: "john@doe.com" });
await customers.update({ identifier: "cust-1", firstName: "John" });
```

---

## Customer Group Manager

```typescript
import { createCustomerGroupManager } from "@crystallize/js-api-client";

const groups = createCustomerGroupManager(api);
await groups.create({ identifier: "vip", name: "VIP" });
```

---

## Subscription Contract Manager

```typescript
import { createSubscriptionContractManager } from "@crystallize/js-api-client";

const scm = createSubscriptionContractManager(api);

const template = await scm.createTemplateBasedOnVariantIdentity(
  "/shop/my-product",
  "SKU-1",
  "plan-identifier",
  "period-id",
  "default",
  "en",
);

const created = await scm.create({
  customerIdentifier: "customer-123",
  tenantId: "tenant-id",
  payment: {
    /* … */
  },
  ...template,
});
```

---

## Cart Manager (Shop API)

Token handling is automatic:

```typescript
import { createCartManager } from "@crystallize/js-api-client";

const cart = createCartManager(api);

// Hydrate a new cart
const hydrated = await cart.hydrate({
  language: "en",
  items: [{ sku: "SKU-1", quantity: 1 }],
});

// Manage an existing cart
await cart.addSkuItem(hydrated.id, { sku: "SKU-2", quantity: 2 });
await cart.setCustomer(hydrated.id, {
  identifier: "customer-123",
  email: "john@doe.com",
});
await cart.setMeta(hydrated.id, {
  merge: true,
  meta: [{ key: "source", value: "web" }],
});
await cart.place(hydrated.id);
```
