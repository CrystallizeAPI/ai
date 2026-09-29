---
name: payments
description: >
    Take payment for a Crystallize order with a payment provider — Stripe, Adyen, Klarna, Qliro,
    Dintero, Vipps MobilePay, QuickPay, Montonio or Razorpay. Covers the payment step between placing a
    Shop API cart and creating the order from it: creating the provider session with the cart id,
    redirect or embedded checkout, verifying webhooks and callbacks, creating exactly one order per cart,
    recording payments and paymentStatus, and later capture, refund and cancellation. Use when the user
    wants to add a payment provider or payment method to a Crystallize storefront, build or fix checkout
    payment, handle a payment webhook, capture on shipment, refund an order, or port payment code from
    the old furniture boilerplates. Trigger on "payment", "payment provider", "PSP", "checkout payment",
    "webhook", "capture", "refund", "authorize", "paymentStatus", "addPayments", "setPayments",
    "Stripe", "Adyen", "Klarna", "Qliro", "Dintero", "Vipps", "MobilePay", "QuickPay", "Montonio",
    "Razorpay", "Checkout Session", "PaymentIntent", "Drop-in", "Hosted Payment Page", "ePayment".
metadata:
    author: Crystallize
    version: "1.0"
---

# Crystallize Payments

Crystallize does not take payment. It holds the cart, the order and a record of every payment; the
money moves at a payment provider. This skill is the join: how to get from a **placed cart** to a
**paid order** through a provider, and how to keep the order right when the payment later changes
(captured, refunded, cancelled).

The cart and order calls themselves live in the [mutation skill](../mutation/SKILL.md) —
[`hydrate` and `place`](../mutation/references/shop-api-mutations.md) on `/cart`,
[`createFromCart`, `addPayments`, `setPayments`](../mutation/references/shop-api-order-mutations.md) on
`/order`. This skill says **when** to call them and **what to put in them**.

> Crystallize side verified on 2026-09-29 against the live Core API schema and existing orders on the
> `sofa-configurator` tenant. Each provider reference states its own verification level.

## The payment step

```text
Shop /cart   hydrate → place            the cart is frozen; its total is what gets charged
Provider     create session             amount from the placed cart, cart id in the provider's reference/metadata
Browser      pay                        redirect to the provider, or its embedded component
Provider     webhook / callback         → verify it → re-read the payment from the provider if the reference says so
Shop /order  createFromCart             once per cart, with payments[] and paymentStatus (see mapping below)
             … later …
Provider     capture / refund / cancel  → setPayments / addPayments on /order, paymentStatus on Core
```

**Place before you charge.** Create the provider session from the placed cart's `total`, never from a
total the browser sent. If the shopper goes back and changes the basket, the placed cart is dead: hydrate
a new cart and create a new session.

**Order lines** (Klarna, Qliro, Dintero, Montonio send them): on the placed cart, `items[].price` is the
**line total** (unit × quantity) and `items[].variant.price` is the unit price. Carts can
hold zero-priced lines (options, components of a bundle); keep them or drop them, but the lines must sum
to `total.gross` exactly.

**The order comes from the webhook, not the browser.** The return URL only shows a confirmation page
(poll for the order, as the order may not exist yet). The browser can close, lie or arrive twice.

## Rules for every provider

| Rule                                         | Why                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Verify every webhook**                     | An unverified endpoint lets anyone POST "paid" and get an order. Each reference gives the exact algorithm                  |
| **Read the raw body** (`await req.text()`)   | Signatures are computed over the exact bytes. `req.json()` then `JSON.stringify` breaks them                               |
| **One order per cart**                       | Providers deliver at least once and retry. Only the "authorized/paid" event creates the order; later events update it      |
| **Answer fast, and 5xx on your own failure** | Timeouts are short (Klarna 2 s, Vipps and Adyen 10 s). A 4xx is permanent for some (Dintero); 5xx makes the provider retry |
| **Round when converting amounts**            | `Math.round(gross * 100)`, never `gross * 100`. Check each provider's zero- and three-decimal currencies                   |
| **Secrets stay on the server**               | Only publishable/client keys reach the browser. Never put the Crystallize token in a client bundle                         |
| **Test mode first**                          | Every reference names its sandbox, test cards and how to reach localhost (CLI forwarder or tunnel)                         |

Unsigned notifications (Klarna's authorization callback, Qliro's push) are made safe by **re-fetching the
payment from the provider's API** and by a signed, per-session token in the callback URL.

## Mapping to Crystallize

### The payment record

`createFromCart`, `addPayments` and `setPayments` take `OrderPaymentInput`:

```ts
{
    provider: 'klarna',                 // free-form string, lower-case provider name
    method: 'pay_later',                // what the shopper used: card, vipps, invoice, bank, …
    transactionId: 'a8c3…',             // the provider's id for this payment (see each reference)
    amount: 1499.0,                     // MAJOR units, like the order total — not cents
    createdAt: '2026-09-29T10:12:00Z',
    meta: [{ key: 'state', value: 'authorized' }],
}
```

In Core and the admin UI, this record appears as a `custom` payment whose `properties` are `provider`,
`transactionId`, `amount`, `method`, `createdAt` and every `meta` key — so do not use those five names
as meta keys. Keep meta small: `state` (`authorized`, `captured`, `refunded`, `cancelled`), `type`
(`payment` or `refund`), and the few provider ids needed to capture or refund later.

### paymentStatus

Crystallize has no "authorized" status — `OrderPaymentStatus` is `paid`, `partiallyPaid`,
`partiallyRefunded`, `refunded`, `unpaid`. Many providers authorize first and capture when the goods ship
(Klarna, Qliro, Dintero, Vipps, QuickPay; Stripe and Adyen when manual capture is on). Record that as:

| Provider event                  | Crystallize                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| Authorized, capture later       | `createFromCart` with `paymentStatus: unpaid`, payment `meta state=authorized`               |
| Paid (captured immediately)     | `createFromCart` with `paymentStatus: paid`, payment `meta state=captured`                   |
| Captured later (full)           | `setPayments` with `state=captured`; `paymentStatus: paid`                                   |
| Captured later (part)           | `setPayments` with the captured amount; `paymentStatus: partiallyPaid`                       |
| Refunded (part / full)          | `addPayments` with `type=refund`, the refund id and amount; `partiallyRefunded` / `refunded` |
| Authorization cancelled/expired | `setPayments` with `state=cancelled`; leave `unpaid`, move the order to a cancelled stage    |
| Failed / declined               | No order. The cart stays placed; the shopper retries with a new session                      |

`paymentStatus` is changed after creation on the **Core API**:
`updateOrder(id: <coreId>, input: { paymentStatus: paid })`. Take `coreId` from the Shop API order. Do
**not** pass `payment` to Core `updateOrder` — Core's payment input is the older typed union and would
replace the records written through the Shop API. Pipeline stages (`addToStage` on `/order`) are the
right place for fulfilment state such as "awaiting capture" or "shipped".

## Creating the order exactly once

The Shop API order id **is** the cart id, and `createFromCart` moves the cart to `ordered`. Check first,
create second, and treat losing a race as success. The provider references import these helpers from
`lib/crystallize-payments.ts`:

```ts
// lib/crystallize-payments.ts
export type PaymentStatus = "paid" | "partiallyPaid" | "partiallyRefunded" | "refunded" | "unpaid";
export type Payment = {
    provider: string;
    method?: string;
    transactionId?: string;
    amount?: number;
    createdAt?: string;
    meta?: { key: string; value: string }[];
};

// shop(scope, query, variables): POST https://shop-api.crystallize.com/{tenant}/{scope} with the
// Shop API bearer token — see the mutation skill for the token. core(query, variables): POST
// https://api.crystallize.com/@{tenant} with the access token id/secret headers.
type OrderRead = {
    id: string;
    coreId: string | null;
    paymentStatus: PaymentStatus;
    payments: { provider: string; transactionId: string | null; amount: number | null }[] | null;
};

export async function readOrder(id: string) {
    const data = await shop<{ order: OrderRead | null }>(
        "order",
        `query($id: UUID!) { order(id: $id) { id coreId paymentStatus payments { provider transactionId amount } } }`,
        { id },
    ).catch(() => ({ order: null }));
    return data.order;
}

export async function createOrderOnce(cartId: string, paymentStatus: PaymentStatus, payment: Payment) {
    const existing = await readOrder(cartId);
    if (existing) return existing; // a retry or a duplicate event

    try {
        const data = await shop<{ createFromCart: { id: string; coreId: string | null } }>(
            "order",
            `mutation($id: UUID!, $input: OrderFromCartInput) { createFromCart(id: $id, input: $input) { id coreId } }`,
            { id: cartId, input: { type: "standard", paymentStatus, payments: [payment] } },
        );
        return data.createFromCart;
    } catch (error) {
        const raced = await readOrder(cartId); // another delivery created it first
        if (raced) return raced;
        throw error; // let the route answer 5xx so the provider retries
    }
}

// Capture, cancel: replace the payment record. Refund: addPayments with a type=refund record instead.
export async function replacePayments(orderId: string, payments: Payment[]) {
    await shop(
        "order",
        `mutation($id: UUID!, $payments: [OrderPaymentInput!]!) {
        setPayments(id: $id, payments: $payments) { id } }`,
        { id: orderId, payments },
    );
}

// Refunds: providers resend refund events too, so skip a transactionId the order already has.
export async function addPayment(orderId: string, payment: Payment) {
    const order = await readOrder(orderId);
    if (!order) throw new Error(`Order ${orderId} not readable yet`); // → 5xx, provider retries
    if (order.payments?.some((p) => p.transactionId === payment.transactionId)) return;
    await shop(
        "order",
        `mutation($id: UUID!, $payments: [OrderPaymentInput!]!) {
        addPayments(id: $id, payments: $payments) { id } }`,
        { id: orderId, payments: [payment] },
    );
}

// paymentStatus lives on Core. Never pass `payment` here — see "paymentStatus" above.
export async function setPaymentStatus(orderId: string, paymentStatus: PaymentStatus) {
    const order = await readOrder(orderId);
    if (!order?.coreId) throw new Error(`Order ${orderId} not readable yet`); // → 5xx, provider retries
    await core(
        `mutation($id: ID!, $input: UpdateOrderInput!) {
        updateOrder(id: $id, input: $input) { ... on Order { id } ... on BasicError { errorName message } } }`,
        { id: order.coreId, input: { paymentStatus } },
    );
}
```

`setPayments` replaces **all** payment records, and the Shop API does not return a payment's `meta`, so
rebuild the full list from your provider's data: the payment record with its new `state`, plus every
refund record (refund ids and amounts come back from the provider's payment/refund lookup). Capture and
cancel normally happen before any refund, when the order has only the one record.

A just-created order can take a moment to be readable (`coreId` may still be `null`). If the provider
may deliver two events at once (Stripe says so explicitly), serialise per cart where your platform
allows — a queue, or a lock keyed on the cart id — or store processed event ids.

## Choosing a provider

| Provider                                         | Where it sells                                   | Style                                  | Capture          |
| ------------------------------------------------ | ------------------------------------------------ | -------------------------------------- | ---------------- |
| [Stripe](references/stripe.md)                   | Global; cards, wallets, Klarna, Vipps, MobilePay | Checkout Session + Payment Element     | Auto (or manual) |
| [Adyen](references/adyen.md)                     | Global, enterprise onboarding                    | Sessions flow + Web Drop-in            | Auto (or manual) |
| [Klarna](references/klarna.md)                   | EU, Nordics, UK, US, AU                          | Klarna Payments, Hosted Payment Page   | Manual           |
| [Qliro](references/qliro.md)                     | Nordics (SEK, NOK, DKK, EUR)                     | Qliro Checkout, embedded               | Manual           |
| [Dintero](references/dintero.md)                 | Nordics                                          | Checkout session, redirect or embedded | Manual or auto   |
| [Vipps MobilePay](references/vipps-mobilepay.md) | Norway, Denmark, Finland (NOK, DKK, EUR)         | ePayment API, redirect / app switch    | Manual           |
| [QuickPay](references/quickpay.md)               | Denmark and EU acquiring                         | Payment Link, redirect                 | Manual           |
| [Montonio](references/montonio.md)               | Baltics, Finland, Poland (EUR, PLN)              | Order → payment URL, redirect          | None (paid)      |
| [Razorpay](references/razorpay.md)               | Merchants in India, Malaysia/Singapore, US only  | Standard Checkout + server Order       | Auto, 3-day cap  |

Pick by where the merchant is incorporated and where its shoppers are, then by capture model: furniture
and other made-to-order goods want **authorize now, capture on shipment**, so check how long each
provider keeps an authorization alive (in each reference).

## Porting the old boilerplates

`furniture-remix` and `nextjs-furnitut` contain payment code for these providers. Use it to see what a
provider needs, **never** for the Crystallize side: it creates orders with the deprecated
`createOrderPusher` / `@crystallize/node-service-api-request-handlers` and the typed
`provider: 'stripe', stripe: {…}` payment shape. Every provider reference lists what is wrong in the old
code — several had unverified webhooks, created an order on every callback, or call APIs that no longer
exist.

## References

Each reference follows the same outline — at a glance, setup, create session, client, webhook,
capture/refund, mapping, gotchas — and opens with its verification level.

- [references/stripe.md](references/stripe.md)
- [references/adyen.md](references/adyen.md)
- [references/klarna.md](references/klarna.md)
- [references/qliro.md](references/qliro.md)
- [references/dintero.md](references/dintero.md)
- [references/vipps-mobilepay.md](references/vipps-mobilepay.md)
- [references/quickpay.md](references/quickpay.md)
- [references/montonio.md](references/montonio.md)
- [references/razorpay.md](references/razorpay.md)

Related: [[mutation]] for the cart and order mutations, [[query]] for reading orders back,
[[pricing]] for markets and currencies, [[bookable-resources]] when the cart holds bookings (confirm
them after `createFromCart`).
