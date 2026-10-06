---
name: payments
description: >
    Take payment for a Crystallize Shop API checkout with Stripe, Adyen, Klarna, Qliro, Dintero, Vipps MobilePay,
    Mollie, Montonio, QuickPay, Two or Razorpay: placing (locking) the cart before charging, creating the provider
    session from the placed cart, verifying webhooks, creating exactly one order per cart, recording payments, and
    capture, refund and cancellation from fulfilment pipelines. Use when adding a payment provider or method to a
    Crystallize storefront, building or fixing checkout payment or a payment webhook, stopping duplicate or unpaid
    orders, a cart changed after paying (two tabs, back button), capturing on shipment or refunding. Trigger on
    "payment", "payment gateway", "webhook", "capture", "refund", "place cart", "lock the cart", "duplicate order",
    "paymentStatus", "addPayments", "setPayments", "createFromCart", "createShopOrderManager", "Stripe", "Adyen",
    "Klarna", "Qliro", "Dintero", "Vipps", "MobilePay", "Mollie", "Montonio", "QuickPay", "Two", "Razorpay",
    "B2B invoice".
metadata:
    author: Crystallize
    version: "2.0"
---

# Crystallize Payments

Crystallize is agnostic about payments: it holds the cart, the order and a record of every payment, and
the money moves at a payment gateway of your choice. This skill is the join between them — how to get
from a cart to a **paid order** through any provider without ever charging one amount and delivering
another, and how to keep the order right when the payment later changes (captured, refunded,
cancelled). Each provider has its own reference; this page is what they all share.

The cart and order calls themselves are documented in the [mutation skill](../mutation/SKILL.md) —
[`hydrate` and `place`](../mutation/references/shop-api-mutations.md) on `/cart`,
[`createFromCart`, `addPayments`, `setPayments`](../mutation/references/shop-api-order-mutations.md) on
`/order`. This skill says **when** to call them and **what to put in them**.

## The common flow

The flow is the same with every gateway:

1. Towards the end of checkout, the shopper has a cart and wants to pay.
2. The checkout page loads the gateway's form, or links to a page hosted by the gateway.
3. The shopper enters their payment details.
4. The gateway hands the shopper back to your site (often a redirect) and the page updates.
5. **Invisibly, asynchronously, server-to-server:** the gateway calls your service to report the
   payment status. This is the step that matters.

**Never validate a payment from the client.** The browser can close, lie, replay a URL or arrive twice;
only a server-to-server notification you have verified (most gateways sign them) or a status you
fetched from the gateway yourself proves a payment. On Crystallize that becomes:

```text
Storefront    hydrate → set customer, shipping, selections     everything the order needs, on the cart
Shop /cart    place                                            cart frozen; place's total = what you charge
Server        create provider session / intent                 amount from place, cart id as the reference
Browser       pay                                              provider's hosted page or embedded component
Provider ───► your webhook                                     verify → customer → createFromCart once
Browser       return page                                      read-only: wait until the cart is `ordered`
              … later …
Crystallize   order enters the "Shipped" stage ───► your hook  provider capture → setPayments
```

**When to save the order.** You can create the order before payment and add the payment to it later,
or create it once the payment is confirmed. This skill does the second: the placed cart _is_ your saved
checkout, and `createFromCart` turns it into an order (with the same id) only when the money is there.
Creating orders up front leaves an unpaid order behind for every abandoned payment.

## Lock the cart before you charge

**The attack this prevents.** A shopper opens checkout in two tabs. In tab A they start paying for a
cart worth 100. In tab B they add a sofa: the cart is now worth 2 100. Tab A completes the payment of
100, the webhook arrives with the cart id, the server turns "the cart" into an order — and ships 2 100
worth of goods for 100. Any flow that charges an amount computed from a cart that can still change has
this hole, with or without malice (back button, a stale tab, a slow network).

Crystallize closes it with `place`:

- **`place` freezes the cart.** A placed cart cannot be hydrated or edited, and there is no way back to
  the `cart` state. `createFromCart` refuses a cart that is not `placed` ("The cart is not placed yet."),
  so an order can only ever come from a frozen cart.
- **Place first, then create the provider session — never the other way round.** Charge the `total` that
  `place` returns: `place` re-prices the cart from the catalogue one last time, so it can differ from the
  last `hydrate`. Never take an amount from the browser.
- **Everything the order needs goes on the cart before `place`:** customer and addresses
  (`setCustomer`), shipping as an external item so it is part of the total, and checkout choices that
  shape the order, such as a pickup point or a B2B company (cart `meta`). A payment method or bank
  preselection does not change the amount: keep it on the cart, or pass it when you create the session
  (and put it in the session's idempotency key) so the shopper can switch method on the same placed cart.
- **Writes to a placed cart fail silently.** `addSkuItem`, `addExternalItem`, `setCustomer`, `setMeta`
  and item changes answer with a cart that shows your change — but nothing is saved. Read
  the cart's `state` before editing it.
- **Back from the payment page = a new cart.** If the shopper wants to change anything, `hydrate` a new
  cart without an id (copy the items over) and swap your cookie. The old placed cart keeps its own
  session; if that session is paid later, it pays for exactly the old cart — still consistent. Expire or
  cancel that old session where the provider allows it (each reference says how).
- On a placed cart, `isStale` turns `true` after about an hour and means nothing: placed prices never
  change. Carts (placed included) are deleted about three months after they expire.

```ts
// app/api/checkout/pay/route.ts — the storefront's "Pay" button
import { carts, PLACED_CART, type PlacedCart } from "@/lib/crystallize-payments";

export async function POST(req: Request) {
    const cartId = getCartIdFromCookie(req); // your session handling
    const cart = (await carts.fetch(cartId, { state: true, ...PLACED_CART })) as unknown as PlacedCart & {
        state: "cart" | "placed" | "ordered" | "abandoned";
    };
    if (cart.state !== "cart" && cart.state !== "placed") return Response.json({ error: "closed" }, { status: 409 });
    const placed = cart.state === "placed" ? cart : ((await carts.place(cartId, PLACED_CART)) as unknown as PlacedCart);
    // → the provider reference's create function: amount = placed.total.gross, reference = placed.id. It reuses
    //   the cart's existing session, and answers "already paid" (→ the return page) when that session completed.
}
```

## One payment per cart

Placing stops the cart from changing; it does not stop two tabs from both paying for the **same**
placed cart. Make the provider session idempotent per cart, so both tabs get the same session — every
reference names its provider's mechanism (an idempotency key derived from the cart id, a reference the
provider refuses twice, or looking the payment up by cart id before creating one), or says there is none
(Klarna Payments), in which case the duplicate flag below is the safety net.

If a second successful payment still arrives for a cart that is already an order, `createOrderOnce`
below records it on the order with `meta attention=duplicate-payment` and logs it: someone must refund
it. Never create a second order and never refund automatically from a webhook.

## The webhook

The same skeleton for every provider:

1. **Verify** the request (each reference gives the exact algorithm) over the **raw body** — read it
   with `await req.text()` before anything else. Unsigned notifications (Klarna's authorization
   callback and HPP `status_update`, Mollie, Qliro) prove nothing on their own: **re-fetch the payment
   from the provider's API** and act on what the provider returns.
2. **Find the cart id** in the provider's reference or metadata — never in a URL the shopper controls,
   unless it is protected by a signed token.
3. **Decide by the provider's status** (paid, authorized, pending, failed — the reference has the table).
   Pending and failed create nothing.
4. **`createOrderOnce`**: reads the cart, creates the Core customer if needed, and calls `createFromCart` once.
   Deliveries that collide in the same instant are a trade-off: see
   [Serialising order writes](#serialising-order-writes-optional).
5. **Answer fast.** 2xx when done or deliberately ignored; **5xx when it failed on your side**, so the
   provider retries. Never answer 2xx to a bad signature (answer 401/400) and never 3xx (a redirect from
   auth or i18n middleware counts as delivered or failed, depending on the provider). The one exception:
   a provider that demands 2xx before the work (Klarna's widget authorization callback) gets it, the work
   runs after the answer, and a scheduled re-check of carts still `placed` catches what failed.

| Rule                                 | Why                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Verify, then trust                   | An unverified endpoint lets anyone POST "paid" and receive goods                              |
| Raw bytes, timing-safe compare       | `JSON.stringify(await req.json())` is not the bytes that were signed; `===` leaks timing      |
| Re-fetch when unsigned               | The notification is only a hint that something changed                                        |
| One order per cart                   | Providers deliver at least once, retry for hours or days, and may deliver twice at once       |
| 5xx on your own failure              | 4xx is permanent for some providers; 5xx makes them retry                                     |
| `Math.round(major * 100)`            | `19.99 * 100` is `1998.9999…`. Check zero- and three-decimal currencies in each reference     |
| Currency and country from the market | Never hardcode `NOK` / `NO`, and never guess the country from the currency                    |
| Secrets stay on the server           | Only publishable or client keys reach the browser; never put a Crystallize token in a bundle  |
| Test mode first, then a tunnel       | Gateways cannot reach localhost: ngrok, cloudflared or a CLI forwarder (some block ngrok)     |
| No long polling in the request       | It dies on serverless. Webhook first; a scheduled job may re-check carts still `placed` later |

## The return page

The page the provider sends the shopper back to **only reads**. Put the cart id in the return URL (an app
switch can open it in another browser, without your cookie) and fetch the cart: `ordered` → show the
confirmation (the order id is the cart id) and clear the cart cookie; still `placed` → ask the provider
for that payment's status (keep its id in a cookie or the URL): failed or cancelled → offer to pay again;
otherwise "We are confirming your payment…" and refresh every few seconds — the webhook usually lands
within seconds.
Adyen's redirect methods need a call from this page (`submitDetails`); Qliro's thank-you snippet, Two's confirm
and reading Klarna's HPP session are optional. The reference says so; the page still never creates the order.

## `lib/crystallize-payments.ts`

The provider references import these helpers. Everything goes through `@crystallize/js-api-client` (7.5 or later):
`createCartManager` for the Shop API `/cart`, `createShopOrderManager` for `/order` (`createFromCart`,
`addPayments`, `setPayments`) and `createShopCustomerManager` for `/customer`. The client fetches one Shop API
token for all of them.

```ts
// lib/crystallize-payments.ts
import {
    createCartManager,
    createClient,
    createShopCustomerManager,
    createShopOrderManager,
} from "@crystallize/js-api-client";

export const api = createClient(
    {
        tenantIdentifier: process.env.CRYSTALLIZE_TENANT_IDENTIFIER!,
        accessTokenId: process.env.CRYSTALLIZE_ACCESS_TOKEN_ID!,
        accessTokenSecret: process.env.CRYSTALLIZE_ACCESS_TOKEN_SECRET!,
    },
    { shopApiToken: { scopes: ["cart", "order", "customer"] } }, // one token for every endpoint used here
);
export const carts = createCartManager(api);
export const orders = createShopOrderManager(api);
const customers = createShopCustomerManager(api);

// What a provider session needs from the placed cart. `price` is the line total, `variant.price` the unit.
// `type` tells product lines from external ones (`shipping`, `fee`, `promotion`, …).
const ADDRESS = {
    type: true,
    firstName: true,
    lastName: true,
    street: true,
    street2: true,
    streetNumber: true,
    postalCode: true,
    city: true,
    state: true,
    country: true,
    phone: true,
    email: true,
};
const CUSTOMER = {
    identifier: true,
    isGuest: true,
    type: true,
    email: true,
    firstName: true,
    lastName: true,
    phone: true,
    companyName: true,
    taxNumber: true,
    addresses: ADDRESS,
};
export const PLACED_CART = {
    total: { gross: true, net: true, taxAmount: true, currency: true },
    items: {
        lineId: true,
        type: true,
        name: true,
        quantity: true,
        variant: { sku: true, price: { gross: true, net: true, taxPercent: true } },
        price: { gross: true, net: true, taxAmount: true, taxPercent: true },
    },
    customer: CUSTOMER,
    meta: true,
};
type Address = { type: "delivery" | "billing" | "other" } & Partial<
    Record<Exclude<keyof typeof ADDRESS, "type">, string | null>
>;
type CartCustomer = {
    identifier?: string | null;
    isGuest?: boolean;
    type?: "individual" | "organization" | null;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    companyName?: string | null;
    taxNumber?: string | null;
    addresses?: Address[] | null;
};
export type PlacedCart = {
    id: string;
    total: { gross: number; net: number; taxAmount: number; currency: string };
    items: {
        lineId: string | null;
        type: "standard" | "shipping" | "fee" | "promotion" | "service" | "digital" | string | null;
        name: string;
        quantity: number;
        variant: { sku: string | null; price: { gross: number; net: number; taxPercent: number } } | null;
        price: { gross: number; net: number; taxAmount: number; taxPercent: number };
    }[];
    customer: {
        identifier?: string;
        type?: "individual" | "organization";
        email?: string;
        firstName?: string;
        lastName?: string;
        phone?: string;
        companyName?: string;
        taxNumber?: string;
        addresses?: Address[];
    } | null;
    meta: Record<string, string> | null;
};

export type PaymentStatus = "paid" | "partiallyPaid" | "partiallyRefunded" | "refunded" | "unpaid";
export type Payment = {
    provider: string; // lower-case provider name: "stripe", "klarna", "two", …
    method?: string; // what the shopper used: card, vipps, invoice, bank, …
    transactionId: string; // the provider's id for this payment or refund
    amount: number; // MAJOR units, like the cart total
    createdAt?: string;
    meta?: { key: string; value: string }[];
};

/** Thrown when the provider should retry: answer 5xx. */
export class RetryLater extends Error {}

type CartState = { id: string; state: "cart" | "placed" | "ordered" | "abandoned"; customer: CartCustomer | null };
export const readCart = async (id: string) =>
    (await carts.fetch(id, { state: true, customer: CUSTOMER })) as unknown as CartState | null;

type OrderRead = {
    id: string;
    coreId: string | null;
    payments:
        | {
              provider: string;
              method: string | null;
              transactionId: string | null;
              amount: number | null;
              createdAt: string | null;
              meta: Record<string, string> | null; // written as [{ key, value }], read back as an object
          }[]
        | null;
};
const ORDER = {
    coreId: true,
    payments: { provider: true, method: true, transactionId: true, amount: true, createdAt: true, meta: true },
};
/** null while the order is not readable yet: createFromCart and payment writes persist just after answering. */
export const readOrder = (id: string) => orders.fetch<OrderRead>(id, ORDER).catch(() => null);

/** The order id is the cart id. Creates it once; a later, different payment is recorded and flagged. */
export async function createOrderOnce(
    cartId: string,
    paymentStatus: PaymentStatus,
    payment: Payment,
    pipelines?: { identifier: string; stage?: string }[], // e.g. [{ identifier: "fulfilment", stage: "new" }]
) {
    const cart = await readCart(cartId);
    if (cart?.state === "ordered") return addRecord(cartId, payment, true);
    if (cart?.state !== "placed") throw new Error(`cart ${cartId} is ${cart?.state ?? "missing"}`); // alert a human
    await ensureCustomer(cart.customer);
    await orders.createFromCart(cartId, { type: "standard", paymentStatus, payments: [payment], pipelines });
}

const toInput = (p: NonNullable<OrderRead["payments"]>[number]): Payment => ({
    provider: p.provider,
    method: p.method ?? undefined,
    transactionId: p.transactionId ?? "",
    amount: p.amount ?? 0,
    createdAt: p.createdAt ?? undefined,
    meta: Object.entries(p.meta ?? {}).map(([key, value]) => ({ key, value: String(value) })),
});

/** Refunds: append a record unless this transactionId is already on the order. */
export const recordPayment = (orderId: string, payment: Payment) => addRecord(orderId, payment, false);

async function addRecord(orderId: string, payment: Payment, isAnotherCharge: boolean) {
    const order = await readOrder(orderId);
    if (!order) throw new RetryLater(`order ${orderId} not readable yet`);
    if (order.payments?.some((p) => p.transactionId === payment.transactionId)) return; // a redelivery
    const flagged = isAnotherCharge && payment.meta?.find((m) => m.key === "type")?.value !== "refund";
    if (flagged) console.error(`[payments] second payment ${payment.transactionId} for order ${orderId}: refund it`);
    const record = flagged
        ? { ...payment, meta: [...(payment.meta ?? []), { key: "attention", value: "duplicate-payment" }] }
        : payment;
    await orders.addPayments(orderId, [record]);
}

/** Capture, cancel: change one record and write the whole list back (setPayments replaces all). */
export async function updatePayment(orderId: string, transactionId: string, change: (p: Payment) => Payment) {
    const order = await readOrder(orderId);
    if (!order?.payments) throw new RetryLater(`order ${orderId} not readable yet`);
    const payments = order.payments.map(toInput).map((p) => (p.transactionId === transactionId ? change(p) : p));
    await orders.setPayments(orderId, payments);
}

export const withMeta = (p: Payment, values: Record<string, string>, amount = p.amount): Payment => ({
    ...p,
    amount,
    meta: [
        ...(p.meta ?? []).filter((m) => !(m.key in values)),
        ...Object.entries(values).map(([key, value]) => ({ key, value })),
    ],
});

/** The Shop API rejects null where a field is optional: send only what the cart has. */
const defined = <T extends object>(o: T) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as {
        [K in keyof T]?: NonNullable<T[K]>;
    };

/** The docs' "create the customer in Crystallize if it does not exist yet". Guests are skipped. */
async function ensureCustomer(customer: CartCustomer | null) {
    if (!customer?.identifier || customer.isGuest) return;
    const exists = await customers.fetch(customer.identifier).then(
        () => true,
        () => false, // fetch rejects when the customer does not exist
    );
    if (exists) return; // never overwrite a known customer with checkout data
    const { isGuest, addresses, ...fields } = customer;
    await customers.upsert({
        ...defined(fields),
        identifier: customer.identifier,
        type: customer.type ?? (customer.companyName ? "organization" : "individual"),
        addresses: addresses?.map((address) => ({ ...defined(address), type: address.type })),
    });
}
```

A provider webhook route then reads:

```ts
try {
    // … verified, cart id found, provider says "paid" …
    await createOrderOnce(cartId, "paid", { provider: "stripe", transactionId: pi.id, amount, meta: [...] });
    return new Response("ok");
} catch (error) {
    console.error(error);
    return new Response("retry", { status: 500 }); // RetryLater and real failures alike
}
```

## Serialising order writes (optional)

`createOrderOnce` reads the cart's state, then calls `createFromCart`. That is enough for most shops and adds
nothing to the webhook's latency. What it leaves open is two deliveries for the same cart arriving at the same
moment: `createFromCart` answers before it moves the cart to `ordered`, so both can see `placed` and both create
the order. Crystallize still keeps one order (its id is the cart id); the second call rewrites it with its own
payment list:

- **The same payment twice** (a provider redelivering): nothing is lost.
- **Two different payments for one cart, in the same second** (two tabs both paid): the first payment's record
  disappears from the order. The money was taken, and nothing flags it for a refund.
- **A capture and a refund handled at the same instant**: `updatePayment` reads, changes and writes the whole
  list, so one of the two changes is lost.

The Shop API's `/lock` endpoint closes those gaps, at a cost on every webhook: two more round trips, the request
held until the cart shows `ordered` (up to a few seconds), and a 5xx (so a provider retry) whenever two deliveries
collide. It is a trade-off for the merchant: opt in for expensive or made-to-order goods, for a provider with no
per-cart idempotency that delivers concurrently, or for orders with frequent after-sales operations. Never put it
in the shopper's path (the Pay route).

To opt in, add `"lock"` to the `shopApiToken` scopes and wrap the writes:

```ts
// lib/crystallize-payments.ts — opt-in serialisation through the Shop API lock
import { createShopLock } from "@crystallize/js-api-client";

const lock = createShopLock(api);

export async function withCartLock<T>(cartId: string, work: () => Promise<T>): Promise<T> {
    const key = `order:${cartId}`;
    if (!(await lock.acquire(key, 60))) throw new RetryLater(`cart ${cartId} is being processed`); // → 5xx, retry
    try {
        return await work();
    } finally {
        await lock.release(key).catch(() => {});
    }
}

/** createFromCart answers before it moves the cart to `ordered`: hold the lock until it has. */
export async function waitUntilOrdered(cartId: string) {
    for (let i = 0; i < 10; i++) {
        if ((await readCart(cartId))?.state === "ordered") return;
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new RetryLater(`order ${cartId} created, cart not ordered yet`);
}

// In a webhook:
//   await withCartLock(cartId, async () => {
//       await createOrderOnce(cartId, "paid", payment);
//       await waitUntilOrdered(cartId);
//   });
// Capture vs refund:
//   await withCartLock(cartId, () => updatePayment(cartId, transactionId, change));
```

## Mapping to Crystallize

### The payment record

`createFromCart`, `addPayments` and `setPayments` take the same **generic** record (`OrderPaymentInput`)
for every provider — `provider` is a free string. Use it for all of them:

```ts
{
    provider: 'klarna',                 // lower-case provider name
    method: 'pay_later',                // what the shopper used
    transactionId: 'a8c3…',             // the provider's id: capture, refund and cancel need it
    amount: 1499.0,                     // MAJOR units, like the cart total — not cents
    createdAt: '2026-10-06T10:12:00Z',
    meta: [
        { key: 'state', value: 'authorized' },  // authorized | captured | cancelled
        { key: 'cartId', value: cartId },       // lets a Core-side webhook find the Shop order (see capture)
    ],
}
```

Crystallize stores it as a custom payment whose properties are `provider`, `transactionId`, `amount`,
`method`, `createdAt` and every `meta` key — so never use those five names as meta keys. Keep meta
small: `state`, `type` (`refund` on refund records), `cartId`, and the few provider ids needed later.
The Shop API returns `meta` as an object (`{ state: "authorized" }`); `toInput` above turns it back into
the `[{ key, value }]` list the mutations take.

### paymentStatus

`paymentStatus` is one of `paid`, `partiallyPaid`, `partiallyRefunded`, `refunded`, `unpaid` — there is
no "authorized". It is set **once**, by `createFromCart`; the Shop API has no mutation to change it
later. Many providers authorize first and capture when the goods ship, so the payment record's `state`
is what tracks the money afterwards, and the pipeline stage tracks the fulfilment.

| Provider event                  | Crystallize                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Authorized, capture later       | `createOrderOnce(…, 'unpaid', …)` with `meta state=authorized`                      |
| Paid (captured immediately)     | `createOrderOnce(…, 'paid', …)` with `meta state=captured`                          |
| Captured later (full or part)   | `updatePayment` → `state=captured`, `amount` = captured amount                      |
| Refunded (part or full)         | `recordPayment` with `transactionId` = refund id, `amount`, `meta type=refund`      |
| Authorization cancelled/expired | `updatePayment` → `state=cancelled`; move the order to your cancelled stage         |
| Pending (bank transfer, SEPA)   | Nothing yet: the provider sends another event when it settles                       |
| Failed / declined               | No order. The shopper retries: same session if the provider allows, else a new cart |

Do **not** patch `paymentStatus` or payments through the Core API's `updateOrder` on these orders: a
Core write is pushed back to the Shop order as a whole and can overwrite payments you have just set
through the Shop API. Keep every write to a checkout order on the Shop API `/order` endpoint.

## Capture on shipment, from fulfilment pipelines

Payment is the end of checkout and the start of the order's life. Put orders in a
[fulfilment pipeline](https://crystallize.com/docs/commerce/order-management/fulfilment-pipelines) at
creation (the last argument of `createOrderOnce`, passed to `createFromCart` as `pipelines`), and
let the stage drive the provider:

1. Crystallize → Settings → Webhooks: concern **Order**, event **pipeline stage change**, POST to
   `/api/crystallize/order-stage`, **no GraphQL query**. The body is then
   `{ orderId, pipelineId, stageId, tenantId, webhookId }` — `orderId` is the **Core** order id.
2. Verify `X-Crystallize-Signature` with the tenant's signature secret.
3. Read the order's payment records from Core, take the `cartId` (= Shop order id), `provider` and
   `transactionId`, call the provider's capture (or cancel) with an idempotency key, then
   `updatePayment`.

```ts
// app/api/crystallize/order-stage/route.ts
import { createSignatureVerifier } from "@crystallize/js-api-client";
import { api, updatePayment, withMeta } from "@/lib/crystallize-payments";
// provider name → each reference's `capture(transactionId, amount, record)`: the captured amount, or null when
// the provider captures asynchronously and reports the result in its own webhook (which then calls updatePayment).
// `record` is the payment's stored properties (meta included), for providers that need more (Adyen: currency).
import { captureByProvider } from "@/lib/payments";

const verify = createSignatureVerifier({ secret: process.env.CRYSTALLIZE_SIGNATURE_SECRET! });

export async function POST(req: Request) {
    const body = await req.text();
    try {
        // url must be the URL Crystallize called — behind a proxy, rebuild it from your public host
        await verify(req.headers.get("x-crystallize-signature") ?? "", { url: req.url, method: "POST", body });
    } catch {
        return new Response("bad signature", { status: 401 });
    }
    const { orderId, stageId } = JSON.parse(body) as { orderId: string; pipelineId: string; stageId: string };
    if (stageId !== process.env.CRYSTALLIZE_SHIPPED_STAGE_ID) return new Response("ignored");

    const { order } = await api.nextPimApi<{
        order: { payment?: { properties?: { property: string; value: string | null }[] }[] };
    }>(
        `query($id: ID!) { order(id: $id) { ... on Order { payment { ... on CustomPayment { properties { property value } } } } } }`,
        { id: orderId },
    );
    const records = (order.payment ?? []).map((p) =>
        Object.fromEntries((p.properties ?? []).map(({ property, value }) => [property, value ?? ""])),
    );
    const authorized = records.find((r) => r.state === "authorized" && r.type !== "refund");
    if (!authorized) return new Response("nothing to capture"); // a redelivery, or captured at checkout
    try {
        const capture = captureByProvider[authorized.provider];
        const captured = await capture(authorized.transactionId, Number(authorized.amount), authorized);
        if (captured !== null) {
            await updatePayment(authorized.cartId, authorized.transactionId, (p) =>
                withMeta(p, { state: "captured" }, captured),
            );
        }
        return new Response("ok");
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 }); // Crystallize retries failed webhooks
    }
}
```

Find the stage ids by logging one delivery. The same handler can cancel on a "Cancelled" stage. Where a
provider captures asynchronously (its `capture()` returns `null`), the record flips to `captured` from that
provider's own webhook, never before the capture has succeeded. Check
how long each provider keeps an authorization alive (in its reference): made-to-order goods often ship
after it expires.

## Choosing a provider

Crystallize works with any gateway; these have a reference here:

| Provider                                         | Where it sells                                             | Style                                             | Capture                 |
| ------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------- | ----------------------- |
| [Stripe](references/stripe.md)                   | Global; cards, wallets, Klarna, MobilePay, Vipps (preview) | Checkout Session + Payment Element                | Auto (or manual)        |
| [Adyen](references/adyen.md)                     | Global, enterprise onboarding                              | Sessions flow + Web Drop-in                       | Auto (or manual)        |
| [Klarna](references/klarna.md)                   | 26 countries: Europe, US, CA, MX, AU, NZ                   | Klarna Payments, Hosted Payment Page              | Manual                  |
| [Qliro](references/qliro.md)                     | Nordics (SEK, NOK, DKK, EUR)                               | Qliro Checkout, embedded                          | Manual (async)          |
| [Dintero](references/dintero.md)                 | Nordics                                                    | Checkout session, redirect or embedded            | Manual or auto          |
| [Vipps MobilePay](references/vipps-mobilepay.md) | Norway, Denmark, Finland (NOK, DKK, EUR)                   | ePayment API, redirect / app switch / QR          | Manual                  |
| [Mollie](references/mollie.md)                   | Merchants in the EEA, UK and Switzerland                   | Payments API, hosted checkout                     | Auto, or `captureMode`  |
| [Montonio](references/montonio.md)               | Baltics, Finland, Poland (EUR, PLN)                        | Order → payment URL, bank picker, parcel machines | None (paid)             |
| [QuickPay](references/quickpay.md)               | Denmark and EU acquiring                                   | Payment link, redirect                            | Manual                  |
| [Two](references/two.md)                         | B2B invoice: Nordics, UK, EU, US                           | Company search + hosted verification              | On fulfilment (invoice) |
| [Razorpay](references/razorpay.md)               | Merchants in India, Malaysia/Singapore, US only            | Standard Checkout + server Order                  | Auto (manual: ~3 days)  |

Pick by where the merchant is incorporated and where its shoppers are, then by capture model:
made-to-order goods want **authorize now, capture on shipment**. Payment details can also be stored on
a subscription contract; recurring payments are not covered here — the references only point at each
provider's recurring API.

## Common mistakes

- Charging an amount from a cart that is not placed, or from the browser — the two-tab attack.
- Verifying a signature over `JSON.stringify(parsedBody)`, or answering 200 (or `{}`) to a bad one.
- Creating the order on the return page, or from a verification the browser sends (only the provider's
  server-to-server notification, or a status you fetched yourself, counts).
- Creating an order on every callback, for refused or pending payments, or twice when two deliveries
  overlap — use `createOrderOnce`.
- Reading the live cart in a callback instead of the placed one: lines and total must match what was charged.
- `gross * 100` without rounding; sending `0` for VAT; mixing a per-unit price with a line discount.
- Hardcoding currency, country or locale, or deriving the country from the currency.
- Letting the shopper pick shipping inside the provider's checkout: the provider then charges more than
  the placed cart, and the order has no shipping line. Choose shipping before `place`.
- Calling a provider's old API family (eCom v2, Payments v1, `charges.data`) — each reference names the
  current one.
- Patching `paymentStatus` or payments through Core `updateOrder` on a Shop API order.
- Long polling a provider inside one request instead of handling its webhook.

## References

Each reference opens with the provider at a glance, then: credentials and setup, creating the payment
from the placed cart, the client, the webhook, capture/refund/cancel, the mapping, provider specifics,
going further, and common mistakes.

- [references/stripe.md](references/stripe.md)
- [references/adyen.md](references/adyen.md)
- [references/klarna.md](references/klarna.md)
- [references/qliro.md](references/qliro.md)
- [references/dintero.md](references/dintero.md)
- [references/vipps-mobilepay.md](references/vipps-mobilepay.md)
- [references/mollie.md](references/mollie.md)
- [references/montonio.md](references/montonio.md)
- [references/quickpay.md](references/quickpay.md)
- [references/two.md](references/two.md)
- [references/razorpay.md](references/razorpay.md)

Related: [[mutation]] for the cart and order mutations, [[query]] for reading orders back, [[js-api-client]]
for the client and `createSignatureVerifier`, [[pricing]] for markets and currencies, [[bookable-resources]]
when the cart holds bookings (confirm them after `createFromCart`).
