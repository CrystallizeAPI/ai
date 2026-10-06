# Klarna with Crystallize

Klarna is a Swedish bank whose pay later, pay in parts, financing and pay now (card, bank) options sell in 26
countries across Europe, North America and Oceania, each in its local currency. The recommended integration is
**Klarna Payments with the Hosted Payment Page (HPP)**: create a Klarna Payments session from the placed cart,
redirect the shopper to Klarna's page, let Klarna place the order (`place_order_mode: PLACE_ORDER`), and confirm it
server-side by re-reading the session from Klarna. The embedded Klarna Payments widget with a server-side
authorization callback is the alternative. Klarna only **authorizes** at checkout: capture with the Order Management
API when the goods ship, within 28 days by default.

> Verification: Written from Klarna's official docs, checked 2026-10-06. Not run end-to-end.
> Official docs: [Klarna Payments][kp], [Hosted Payment Page][hpp], [HPP status callbacks][status],
> [JavaScript SDK][sdk], [Authorization callback][authcb], [Order Management][om], [Tax handling][tax],
> [Payments API][api], [Order Management API][omapi]. Klarna's docs now live under `docs.klarna.com/acquirer/klarna/`.
> Crystallize page: [Klarna][crystallize].

## At a glance

| Topic                     | Klarna                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| Markets & currencies      | 26 countries ([list][markets]): Europe, US, CA, MX, AU, NZ; local currency only; one agreement each |
| Recommended integration   | Payments session → HPP session → redirect, `place_order_mode: PLACE_ORDER` (Klarna places it)       |
| Alternative               | Embedded widget (`x.klarnacdn.net/kp/lib/v1/api.js`) + authorization callback; you place it         |
| API version               | Payments `v1`, HPP `v1`, Order Management `v1`. Klarna Checkout (KCO) is now Kustom: not here       |
| SDKs                      | No server SDK: `fetch` + HTTP Basic. The widget is a CDN script; HPP needs no client code           |
| Amount units              | Integer **minor** units (`2500` = 25.00); `tax_rate` in basis points (`2500` = 25 %)                |
| Capture + auth lifetime   | Manual, Order Management. 28 days (up to 180 by agreement); extendable within 180 days              |
| Cart id field             | `merchant_reference1` (≤ 255 chars; the shopper sees it as the order number): the full cart id      |
| One session per cart      | No Klarna mechanism (no idempotency key on Payments, references not unique): see below              |
| Notification verification | Unsigned callbacks: an HMAC token in each callback URL, then re-read session and order              |

## Credentials and setup

The crystallize.com page asks for a **username** and a **password**: Klarna's API key ID and secret. Start with a
test (playground) account; a live account comes with the merchant agreement.

- **Playground account:** on docs.klarna.com, **Log in** → your region → **Playground** → **Sign up**, activate
  the e-mail, then open the playground Merchant portal (`portal.playground.klarna.com`).
- **API key:** Merchant portal → **Payment settings** → **Klarna API keys** → **Generate new Klarna API key**, and
  download the file: **Key ID** = username, **Secret** = password. The secret is shown once. Playground keys only
  work against playground URLs; the live portal issues live keys.
- **Base URL** per region ([API URLs][urls]): Europe `https://api.klarna.com`, North America
  `https://api-na.klarna.com`, Oceania `https://api-oc.klarna.com`; playground: `api.playground.klarna.com`,
  `api-na.playground.klarna.com`, `api-oc.playground.klarna.com`. Keys are per region.
- **Callbacks:** every `merchant_urls` entry must match `^https://` and be reachable, so tunnel localhost
  (cloudflared, ngrok). Nothing is registered in the portal: each URL travels with its session.

```bash
KLARNA_API_URL=https://api.playground.klarna.com # https://api.klarna.com live (EU)
KLARNA_USERNAME=...                                # API key ID
KLARNA_PASSWORD=...                                # API key secret
KLARNA_CALLBACK_SECRET=...                         # 32+ random bytes: signs the callback URLs
PUBLIC_URL=https://shop.example                    # the tunnel URL in development
```

- **Test shoppers** ([sample customers][testdata]): `customer+se@klarna.com` is approved and
  `customer+se+denied@klarna.com` declined (use the purchase country's code; the denied flow cannot be tested in every
  market, e.g. Sweden and Norway). New accounts take any 6-digit OTP except `999999`.
- **Test payments** ([sample payment data][testpay]): card `4111 1111 1111 1111`, CVC `123`, any future expiry;
  `4687 3888 8888 8881` triggers 3-D Secure; direct debit IBAN `DE11 5205 1373 5120 7101 31`; bank transfer "Demo Bank".
- **Debugging:** every error body has a `correlation_id`; find it under **Logs** in the Merchant portal (7 days).

## Create the payment

Call this from the pay route in [SKILL.md](../SKILL.md#lock-the-cart-before-you-charge) with the **placed** cart.
Klarna needs order lines with tax, and their `total_amount`s must add up to `order_amount` exactly, so the lines are
built from the placed cart and checked against `placed.total.gross`.

```ts
// lib/klarna.ts
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
    carts,
    createOrderOnce,
    PLACED_CART,
    readOrder,
    recordPayment,
    updatePayment,
    withMeta,
} from "@/lib/crystallize-payments";
import type { Payment, PlacedCart } from "@/lib/crystallize-payments";

const KLARNA = process.env.KLARNA_API_URL!;
const AUTH = `Basic ${btoa(`${process.env.KLARNA_USERNAME}:${process.env.KLARNA_PASSWORD}`)}`;
export const minor = (major: number) => Math.round(major * 100); // every Klarna currency has 2 decimals

export async function call(path: string, init: RequestInit = {}) {
    const res = await fetch(KLARNA + path, {
        ...init,
        headers: { Authorization: AUTH, "Content-Type": "application/json", ...init.headers },
    });
    if (!res.ok) throw new Error(`Klarna ${init.method ?? "GET"} ${path} ${res.status}: ${await res.text()}`);
    return res;
}
export const klarna = async <T>(path: string, init?: RequestInit) => (await call(path, init)).json() as Promise<T>;

// Klarna callbacks are unsigned: an HMAC of (purpose, cart id) in the URL proves the URL is yours
const sign = (purpose: string, cartId: string) =>
    createHmac("sha256", process.env.KLARNA_CALLBACK_SECRET!).update(`${purpose}:${cartId}`).digest("hex");
export const signedUrl = (path: string, purpose: string, cartId: string) =>
    `${process.env.PUBLIC_URL}${path}?cart=${cartId}&token=${sign(purpose, cartId)}`;
export function verifySignedUrl(url: string, purpose: string) {
    const q = new URL(url).searchParams;
    const cartId = q.get("cart") ?? "";
    const [got, want] = [Buffer.from(q.get("token") ?? ""), Buffer.from(sign(purpose, cartId))];
    return got.length === want.length && timingSafeEqual(got, want) ? cartId : null;
}

// Deterministic, UUID-shaped Klarna-Idempotency-Key: a retry of the same operation reuses it (Klarna keeps it 24 h)
export const keyFor = (operation: string) => {
    const h = createHash("sha256").update(operation).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const LINE_TYPE: Record<string, string> = {
    shipping: "shipping_fee",
    fee: "surcharge",
    promotion: "discount",
    digital: "digital", // the rest: physical
};

export function orderLines(placed: PlacedCart) {
    const lines = placed.items.map((item) => {
        const total = minor(item.price.gross); // the line total, discounts included
        const rate = Math.round(item.price.taxPercent * 100); // 25 % → 2500
        const even = Math.ceil(total / item.quantity);
        const unit = total >= 0 && item.variant ? Math.max(minor(item.variant.price.gross), even) : even; // list price
        return {
            type: LINE_TYPE[item.type ?? ""] ?? "physical",
            reference: item.variant?.sku ?? item.lineId ?? undefined,
            name: item.name,
            quantity: item.quantity,
            unit_price: unit,
            total_discount_amount: unit * item.quantity - total, // never negative
            total_amount: total,
            tax_rate: rate,
            total_tax_amount: total - Math.round((total * 10000) / (10000 + rate)), // Klarna's formula, < 0 if discount
        };
    });
    const order_amount = minor(placed.total.gross);
    const drift = order_amount - lines.reduce((sum, l) => sum + l.total_amount, 0);
    if (Math.abs(drift) > lines.length) throw new Error(`Lines miss ${drift} of cart ${placed.id}: cart discount?`);
    if (drift !== 0) {
        const total_amount = drift; // cents lost to rounding: one untaxed line keeps the sum exact
        lines.push({
            type: drift < 0 ? "discount" : "surcharge",
            reference: "rounding",
            name: "Rounding",
            quantity: 1,
            unit_price: total_amount,
            total_discount_amount: 0,
            total_amount,
            tax_rate: 0,
            total_tax_amount: 0,
        });
    }
    const order_tax_amount = lines.reduce((sum, l) => sum + l.total_tax_amount, 0);
    return { order_amount, order_tax_amount, order_lines: lines };
}

export type KlarnaMarket = { country: string; locale: string }; // from the Crystallize market, e.g. SE + sv-SE
export type KlarnaCategory = { identifier: string; name: string; asset_urls: { standard: string } };

export const createKpSession = (placed: PlacedCart, market: KlarnaMarket, merchant_urls?: object) =>
    klarna<{ session_id: string; client_token: string; payment_method_categories: KlarnaCategory[] }>(
        "/payments/v1/sessions",
        {
            method: "POST",
            body: JSON.stringify({
                acquiring_channel: "ECOMMERCE",
                intent: "buy",
                purchase_country: market.country, // the shopper's billing country
                purchase_currency: placed.total.currency.toUpperCase(),
                locale: market.locale, // a pair Klarna lists for that country
                ...orderLines(placed),
                merchant_reference1: placed.id, // the cart id = the Crystallize order id
                merchant_urls,
            }),
        },
    );

/** Recommended: the Hosted Payment Page. Returns where to send the shopper. */
export async function createKlarnaPayment(placed: PlacedCart, market: KlarnaMarket) {
    const kp = await createKpSession(placed, market);
    const checkout = `${process.env.PUBLIC_URL}/checkout`;
    const hpp = await klarna<{ session_id: string; redirect_url: string }>("/hpp/v1/sessions", {
        method: "POST",
        body: JSON.stringify({
            payment_session_url: `${KLARNA}/payments/v1/sessions/${kp.session_id}`,
            merchant_urls: {
                success: `${checkout}/confirmation?cart=${placed.id}&sid={{session_id}}&order_id={{order_id}}`,
                cancel: checkout,
                back: checkout,
                failure: `${checkout}?payment=failed`,
                error: `${checkout}?payment=error`,
                status_update: signedUrl("/api/payments/klarna/webhook", "status", placed.id),
            },
            options: { place_order_mode: "PLACE_ORDER" }, // Klarna places the order, even if the redirect fails
        }),
    });
    console.info(`[klarna] cart ${placed.id} → HPP session ${hpp.session_id}`); // for reconciliation, see Webhook
    return hpp.redirect_url;
}
```

- **One session per cart.** Klarna offers nothing: the Payments API takes no idempotency key and `merchant_reference1`
  is not unique, and the placed cart cannot store a session id. Two tabs get two sessions; if both are paid,
  `createOrderOnce` records the second with `attention=duplicate-payment` and someone cancels that Klarna order (it
  was never captured, so nothing to refund). The widget flow releases the second authorization before it becomes an
  order ([Provider specifics](#provider-specifics)).
- **US:** no `tax_rate` or `total_tax_amount` on product lines; send line totals without tax plus one
  `type: "sales_tax"` line named "Sales Tax", and `order_tax_amount` = that line's `total_amount` ([tax][tax]).
- **Lifetimes:** a Payments session lives 48 h (or until an order is placed); its HPP session expires 1 h earlier.
- **Limits:** at most 1000 lines; `unit_price` and `total_amount` ≤ 200 000 000; `tax_rate` 0–10000.

## Client

The pay route answers with the `redirect_url`; the browser goes there (`location.assign`). Klarna hosts the login,
the method choice and 3-D Secure, and recommends this redirect over the widget's pop-up on mobile browsers.

- `success` is the return page from [SKILL.md](../SKILL.md#the-return-page). It reads the cart named by `cart` in its
  URL (the shopper may come back in another browser, without your cookie): `ordered` → thank you, clear the cart
  cookie; still `placed` → "confirming your payment…" and refresh. While waiting it may read the
  HPP session (`GET /hpp/v1/sessions/{sid}`) to tell "still confirming" from a `FAILED` or `CANCELLED` session. It
  never places or creates anything: the `order_id` in its URL proves nothing.
- `cancel`, `back`, `failure` and `error` land on checkout with the cart still placed. **Pay** again creates a new
  session for the same placed cart; changing the cart means a new cart.

## Webhook

HPP POSTs `{ event_id, session: { session_id, status, order_id?, klarna_reference? } }` to `status_update` on every
status change. Nothing is signed: the route checks the URL's token, **re-reads** the HPP session and the Klarna order,
and checks that the order is this cart's, for this cart's amount. HPP wants a 2xx within 3 seconds and makes at most
4 calls per event, a few seconds apart ([status callbacks][status]). A slower answer only means a retry, which
`createOrderOnce` absorbs.

```ts
// lib/klarna.ts (continued). Keep helpers here: a Next route file may only export HTTP methods.
export type KlarnaOrder = {
    order_id: string;
    merchant_reference1: string;
    klarna_reference: string;
    status: "AUTHORIZED" | "PART_CAPTURED" | "CAPTURED" | "CANCELLED" | "EXPIRED" | "CLOSED";
    fraud_status: "ACCEPTED" | "PENDING" | "REJECTED";
    order_amount: number;
    captured_amount: number;
    remaining_authorized_amount: number; // minor units
    initial_payment_method?: { type: string };
};

export async function handleHppSession(cartId: string, hppSessionId: string) {
    const hpp = await klarna<{ status: string; order_id?: string }>(`/hpp/v1/sessions/${hppSessionId}`);
    if (hpp.status !== "COMPLETED" || !hpp.order_id) return; // the body was only a hint
    const o = await klarna<KlarnaOrder>(`/ordermanagement/v1/orders/${hpp.order_id}`);
    const placed = (await carts.fetch(cartId, PLACED_CART)) as unknown as PlacedCart;
    if (o.merchant_reference1 !== cartId || o.order_amount !== minor(placed.total.gross)) {
        throw new Error(`Klarna order ${o.order_id} does not match cart ${cartId}`); // alert a human
    }
    const meta = { klarnaReference: o.klarna_reference, fraudStatus: o.fraud_status };
    const payment = toPayment(cartId, o.order_id, o.order_amount, o.initial_payment_method?.type, meta);
    await createOrderOnce(cartId, "unpaid", payment);
}
```

```ts
// app/api/payments/klarna/webhook/route.ts — HPP status_update
import { handleHppSession, verifySignedUrl } from "@/lib/klarna";

export async function POST(req: Request) {
    const body = await req.text();
    const cartId = verifySignedUrl(req.url, "status");
    if (!cartId) return new Response("bad token", { status: 401 });
    const { session } = JSON.parse(body) as { event_id: string; session: { session_id: string } };
    try {
        await handleHppSession(cartId, session.session_id);
        return new Response(null, { status: 204 });
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 }); // RetryLater and real failures alike
    }
}
```

| Klarna                                                     | Crystallize ([paymentStatus](../SKILL.md#paymentstatus))                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| HPP `COMPLETED`, order `fraud_status: ACCEPTED`            | `createOrderOnce(cartId, 'unpaid', …)`, `state=authorized`                       |
| `fraud_status: PENDING` (US/UK, when enabled)              | Same; `capture()` refuses until Klarna's `notification` URL reports a decision   |
| `IN_PROGRESS`, `WAITING`, `BACK`, `FAILED`, `ERROR`        | Nothing: the session is still open and the shopper can retry                     |
| `CANCELLED`, `DISABLED`, `TIMEOUT`                         | No order. **Pay** again opens a new session for the same placed cart             |
| Authorization expired or cancelled in the portal (no push) | `capture()` fails; `cancel()` below → `state=cancelled`, cancelled stage         |
| Widget: authorization callback                             | [Provider specifics](#provider-specifics): place the Klarna order, then the same |

If every call fails (your endpoint down for those seconds), Klarna has an order that Crystallize lacks. Re-run
`handleHppSession(cartId, hppSessionId)` from an admin action or a scheduled job with the ids logged by
`createKlarnaPayment`: it is idempotent. Never let the return page do it.

## Capture, refund, cancel

Every Order Management POST takes a `Klarna-Idempotency-Key`; Klarna applies an operation once per key for 24 h and
**ignores the body** when it compares, so one key per operation, never one per order. The `201`/`204` is the
confirmation: no need to poll the order afterwards.

```ts
// lib/klarna.ts (continued) — captureByProvider.klarna = capture. Synchronous, so never null; `record` unused.
export async function capture(transactionId: string, amount: number): Promise<number | null> {
    const o = await klarna<KlarnaOrder>(`/ordermanagement/v1/orders/${transactionId}`);
    if (o.status === "CANCELLED" || o.status === "EXPIRED" || o.fraud_status !== "ACCEPTED") {
        throw new Error(`Klarna order ${transactionId} is ${o.status}/${o.fraud_status}: not capturable`);
    }
    const todo = Math.min(minor(amount) - o.captured_amount, o.remaining_authorized_amount);
    if (todo > 0) {
        await call(`/ordermanagement/v1/orders/${transactionId}/captures`, {
            method: "POST",
            headers: { "Klarna-Idempotency-Key": keyFor(`capture:${transactionId}:${o.captured_amount}`) },
            body: JSON.stringify({ captured_amount: todo }), // add order_lines and shipping_info (carrier, tracking)
        });
    }
    return (o.captured_amount + Math.max(todo, 0)) / 100; // a retry after a capture that went through returns it
}

/** `requestId` identifies this refund in your system (a return id): retries reuse it. */
export async function refund(cartId: string, orderId: string, amount: number, requestId: string) {
    const res = await call(`/ordermanagement/v1/orders/${orderId}/refunds`, {
        method: "POST",
        headers: { "Klarna-Idempotency-Key": keyFor(`refund:${requestId}`) },
        body: JSON.stringify({ refunded_amount: minor(amount) }), // order_lines let Klarna pick the right invoice
    });
    await recordPayment(cartId, {
        provider: "klarna",
        method: "refund",
        transactionId: res.headers.get("Refund-Id")!, // 201 Created: the id is a header, the body is empty
        amount,
        createdAt: new Date().toISOString(),
        meta: [
            { key: "type", value: "refund" },
            { key: "cartId", value: cartId },
            { key: "klarnaOrderId", value: orderId },
        ],
    });
}

/** Before any capture: releases the whole authorization. */
export async function cancel(cartId: string, orderId: string) {
    await call(`/ordermanagement/v1/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Klarna-Idempotency-Key": keyFor(`cancel:${orderId}`) },
    });
    await updatePayment(cartId, orderId, (p) => withMeta(p, { state: "cancelled" }));
}
```

- **Partial capture:** capture what shipped, then `POST …/release-remaining-authorization` (`204`) once nothing more
  will ship. `cancel` fails once anything is captured (`CANCEL_NOT_ALLOWED`); refunds need a capture first.
- **Extend:** `POST …/orders/{id}/extend-authorization-time` (`204`) sets the expiry to _today_ + your account's
  period (28 days by default) ([extension rules][extend]). Only within 180 days of the purchase, never after
  expiry, not for "Pay now" card orders nor US financing. Klarna asks for it only in exceptional delays; made-to-order
  shops agree a longer period (up to 180 days) at onboarding instead.
- **Retries:** for `5xx` retry with the same key (Klarna suggests 5 s, 5 min, 5 h); `4xx` and `409` need a human
  ([escalation and retry policy][retry]).

## Mapping

The order's `order_id` is the `transactionId`: every Order Management call takes it.

```ts
// lib/klarna.ts (continued)
export const toPayment = (
    cartId: string,
    orderId: string,
    amountMinor: number,
    method: string | undefined,
    extra: Record<string, string>,
): Payment => ({
    provider: "klarna",
    method: method?.toLowerCase() ?? "klarna", // invoice, pay_in_x, card, direct_debit, …
    transactionId: orderId,
    amount: amountMinor / 100, // MAJOR units
    createdAt: new Date().toISOString(),
    meta: [
        { key: "state", value: "authorized" },
        { key: "cartId", value: cartId },
        ...Object.entries(extra).map(([key, value]) => ({ key, value })), // klarnaReference: what support asks for
    ],
});
```

A refund is its own record: `transactionId` = the `Refund-Id` header, `amount` in major units, `meta` `type=refund`,
`cartId` and `klarnaOrderId` (see `refund()` above). Capture keeps the record and sets `state=captured` with the
captured amount, through the stage handler in [SKILL.md](../SKILL.md#capture-on-shipment-from-fulfilment-pipelines).

## Provider specifics

### The embedded widget and its payment method categories

The session's `payment_method_categories` (`identifier`, `name`, `asset_urls.standard`) drive the choice shown in
your checkout. Today most accounts get one category, `klarna` ("Pay with Klarna"), and the shopper picks the actual
method inside Klarna's pop-up; older or configured accounts still get several (`pay_later`, `pay_over_time`,
`pay_now`, …). Render whatever comes back: one option per category, `load()` the chosen one, `authorize()` it. The
choice is made **after** `place` and never changes the amount, so it is not stored on the cart (and cannot be: the cart
is placed); Klarna reports the method actually used, which becomes the payment record's `method`.

```ts
// lib/klarna.ts (continued) — the widget alternative
export async function createKlarnaWidgetSession(placed: PlacedCart, market: KlarnaMarket) {
    const s = await createKpSession(placed, market, {
        authorization: signedUrl("/api/payments/klarna/authorization", "authorization", placed.id),
    });
    return { clientToken: s.client_token, categories: s.payment_method_categories };
}

export async function placeFromAuthorization(cartId: string, sessionId: string, token: string) {
    type KpRead = { merchant_reference1?: string; purchase_country: string; purchase_currency: string; locale: string };
    const session = await klarna<KpRead>(`/payments/v1/sessions/${sessionId}`); // the callback body is unsigned
    if (session.merchant_reference1 !== cartId) throw new Error(`Session ${sessionId} is not cart ${cartId}'s`);
    // Lines from the PLACED cart, read by id, never the shopper's current cart: Klarna checks them against the session
    const placed = (await carts.fetch(cartId, { state: true, ...PLACED_CART })) as unknown as PlacedCart & {
        state: string;
    };
    if (placed.state === "ordered") {
        const order = await readOrder(cartId);
        if (order?.payments?.some((p) => p.meta?.klarnaSessionId === sessionId)) return; // a redelivery
        await call(`/payments/v1/authorizations/${token}`, { method: "DELETE" }); // another tab paid: never charged
        return;
    }
    const { purchase_country, purchase_currency, locale } = session;
    type Placed = { order_id: string; fraud_status: string; authorized_payment_method?: { type: string } };
    const o = await klarna<Placed>(`/payments/v1/authorizations/${token}/order`, {
        // the token lives 60 minutes
        method: "POST",
        body: JSON.stringify({
            purchase_country,
            purchase_currency,
            locale,
            merchant_reference1: cartId,
            ...orderLines(placed),
        }),
    });
    const meta = { fraudStatus: o.fraud_status, klarnaSessionId: sessionId };
    await createOrderOnce(
        cartId,
        "unpaid",
        toPayment(cartId, o.order_id, minor(placed.total.gross), o.authorized_payment_method?.type, meta),
    ).catch((error) => {
        throw new Error(`Klarna order ${o.order_id} has no Crystallize order: ${error}`); // alert a human
    });
}
```

```ts
// app/api/payments/klarna/authorization/route.ts — merchant_urls.authorization
import { after } from "next/server";
import { placeFromAuthorization, verifySignedUrl } from "@/lib/klarna";

export async function POST(req: Request) {
    const body = await req.text();
    const cartId = verifySignedUrl(req.url, "authorization");
    if (!cartId) return new Response("bad token", { status: 401 });
    const { authorization_token, session_id } = JSON.parse(body) as { authorization_token: string; session_id: string };
    // Klarna gives this call 2 s and wants the order placed after the answer: answer first, work in after()
    after(() => placeFromAuthorization(cartId, session_id, authorization_token).catch((e) => console.error(e)));
    return new Response(null, { status: 204 }); // duplicates get 2xx too: a 409 makes Klarna retry
}
```

`after()` (Next.js 15.1+) is not durable: if your platform has a queue, enqueue the token there instead. The callback
is at-least-once and best effort (3 attempts, 2 s connect + 2 s read timeout each).

```tsx
// app/checkout/klarna-widget.tsx
"use client";
import { useEffect, useState } from "react";
import type { KlarnaCategory } from "@/lib/klarna";

type Call = (o: object, data: object, cb: (r: { approved?: boolean; show_form: boolean }) => void) => void;
type Sdk = { init(o: { client_token: string }): void; load: Call; authorize: Call };
declare global {
    interface Window {
        Klarna?: { Payments: Sdk };
        klarnaAsyncCallback?: () => void;
    }
}

type Props = { clientToken: string; categories: KlarnaCategory[]; billing: object; done: string };
export function KlarnaWidget(props: Props) {
    const [chosen, setChosen] = useState(props.categories[0]?.identifier);
    const [hidden, setHidden] = useState<string[]>([]);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        const init = () => (window.Klarna!.Payments.init({ client_token: props.clientToken }), setReady(true));
        if (window.Klarna) return init();
        window.klarnaAsyncCallback = init;
        document.body.append(
            Object.assign(document.createElement("script"), {
                src: "https://x.klarnacdn.net/kp/lib/v1/api.js",
                async: true,
            }),
        );
    }, [props.clientToken]);
    useEffect(() => {
        if (!ready || !chosen) return;
        window.Klarna!.Payments.load(
            { container: "#klarna-payments", payment_method_category: chosen },
            {},
            (r) => r.show_form || setHidden((h) => [...h, chosen]),
        );
    }, [ready, chosen]);
    // No await between the click and authorize(): the browser only opens Klarna's pop-up on a user gesture
    const pay = () =>
        window.Klarna!.Payments.authorize(
            { payment_method_category: chosen },
            { billing_address: props.billing },
            (r) => {
                if (r.approved) location.assign(props.done); // the return page; the callback creates the order
                else if (!r.show_form) setHidden((h) => [...h, chosen!]);
            },
        );
    return (
        <fieldset>
            {props.categories
                .filter((c) => !hidden.includes(c.identifier))
                .map((c) => (
                    <label key={c.identifier}>
                        <input
                            type="radio"
                            checked={chosen === c.identifier}
                            onChange={() => setChosen(c.identifier)}
                        />
                        <img src={c.asset_urls.standard} alt="" height={24} /> {c.name}
                    </label>
                ))}
            <div id="klarna-payments" />
            <button type="button" disabled={!ready || !chosen} onClick={pay}>
                Pay with Klarna
            </button>
        </fieldset>
    );
}
```

- Create the session server-side after `place` and pass `clientToken` and `categories` to the page; build `billing`
  from the placed cart's `customer` and its `billing` address: `given_name`, `family_name`, `email`, `phone`,
  `street_address`, `postal_code`, `city`, `country`. Klarna wants customer data at `authorize()`, not in the
  session (GDPR).
- Send `Cross-Origin-Opener-Policy: same-origin-allow-popups` (Helmet's default `same-origin` cuts the pop-up off) and
  allow Klarna's hosts in your CSP (`x.klarnacdn.net`, `js.klarna.com`, `*.klarna.com`, `*.klarnaevt.com`).
- `approved: true` in the browser proves nothing; the page only goes to the return page and waits.

### After payment (prose only)

- **Pending orders** (US and UK, enabled per account): `fraud_status: PENDING` for up to 24 h; Klarna POSTs
  `{ order_id, event_type: FRAUD_RISK_ACCEPTED | _REJECTED | _STOPPED }` to the session's `merchant_urls.notification`
  (unconfirmed: Klarna's pending-orders page is unreachable today). It is unsigned: re-read the order; rejected →
  `cancel()`.
- **Order Management extras** (paths under `/ordermanagement/v1/orders/{id}`): tracking via `shipping_info` on the
  capture or `POST …/captures/{capture_id}/shipping-info`; `…/trigger-send-out` resends the invoice e-mail;
  `PATCH …/authorization` changes amount and lines before capture (new risk check); `PATCH …/customer-details` and
  `…/merchant-references`; a `type: "return_fee"` line in a refund; the paid due-date extension
  (`…/captures/{capture_id}/extend-due-date-options`, pay-later only).
- **Recurring:** `intent: "tokenize"` or `"buy_and_tokenize"`, then
  `POST /payments/v1/authorizations/{token}/customer-token` and `POST /customer-token/v1/tokens/{token}/order` with a
  `Klarna-Idempotency-Key`. Not covered here.

## Going further

- **Klarna Checkout (KCO v3)** — the full checkout with Klarna's address and shipping forms — is now **Kustom**, a
  separate provider. Its docs, `/checkout/v3/orders` and the `acknowledge` step do not apply to Klarna Payments.
- **Automatic capture** for digital goods: `place_order_mode: "CAPTURE_ORDER"` on the HPP session (or `auto_capture:
  true` when you place the order). Then create the order as `paid` with `state=captured`.
- **HPP options:** `payment_method_category(ies)` to show only some categories (store a storefront choice on the cart
  before `place`), `payment_fallback`, branding ([customization][hppcustom]), and distribution by SMS, e-mail or QR code
  (`distribution_url`, `qr_code_url`) for telesales and in-store.
- **Conversion boosters:** On-site messaging, Express Checkout and Sign in with Klarna (Klarna Web SDK). Express
  Checkout collects the shopper's details at Klarna: keep shipping and the amount decided in your storefront before
  `place`, or Klarna charges something the placed cart does not contain.
- **Extra merchant data** (`attachment`) for travel, tickets and marketplaces; the **Mobile SDK** (iOS, Android, React
  Native) or HPP in a web view for apps; **settlement** reports in the portal, by API or SFTP.
- The crystallize.com page's example — initiating the payment, handling success, the order confirmation and creating
  the order in Crystallize — is this reference's flow.

## Common mistakes

- Sending no `tax_rate`, `total_tax_amount` or `order_tax_amount` (or `0`): Klarna rejects the lines or the invoice
  shows no VAT. Compute the tax from `total_amount` as above, not from a rounded per-unit value.
- Building `unit_price` as `(gross / quantity + lineDiscount) * 100`: the whole line discount lands on every unit and
  the line no longer adds up when quantity > 1. `unit_price` is before discount; the discount is per line.
- `gross * 100` without `Math.round`; leaving out `reference` (the SKU) on lines.
- Deriving the country and locale from the currency (e.g. every non-NOK cart sent as `FR` / `en-FR`). Take both from
  the market; `purchase_country` must match the shopper's billing country.
- In the authorization callback, building the Klarna order from the shopper's current cart (cookie, session) instead
  of the placed cart named by the callback: the lines no longer match the session (`409`), or the order ships
  something else than was paid.
- An unsigned, guessable callback route (`…/klarna/{cartId}`): anyone can make it run. Sign the URL; re-read Klarna.
- Placing the Klarna order and creating the Crystallize order inside the authorization callback's 2 seconds, or
  answering a duplicate with `409`: Klarna times out, retries, and duplicates follow.
- Calling `authorize()` after an `await` (placing the cart in the click handler): the pop-up is blocked. Place the cart
  and create the session before rendering the widget.
- Never capturing: authorizations expire after 28 days and nothing is paid.
- A random `Klarna-Idempotency-Key` per retry (no protection), or one key per order (Klarna ignores the body, so a
  second partial capture silently returns the first).
- Trusting the HPP success redirect or the widget's `approved: true` instead of the re-read session and order.

[kp]: https://docs.klarna.com/acquirer/klarna/web-payments/integrate-with-klarna-payments/integrate-via-sdk/step-1-initiate-a-payment/
[sdk]: https://docs.klarna.com/acquirer/klarna/web-payments/additional-resources/klarna-payments-sdk-reference/
[hpp]: https://docs.klarna.com/acquirer/klarna/web-payments/integrate-with-klarna-payments/integrate-via-hpp/before-you-start/accept-klarna-payments-using-hosted-payment-page/
[status]: https://docs.klarna.com/acquirer/klarna/web-payments/integrate-with-klarna-payments/integrate-via-hpp/api-documentation/status-callbacks/
[hppcustom]: https://docs.klarna.com/acquirer/klarna/web-payments/integrate-with-klarna-payments/integrate-via-hpp/before-you-start/customization/
[authcb]: https://docs.klarna.com/acquirer/klarna/web-payments/integrate-with-klarna-payments/other-actions/authorization-callback/
[om]: https://docs.klarna.com/acquirer/klarna/after-payments/order-management/manage-orders-with-the-api/
[extend]: https://docs.klarna.com/acquirer/klarna/web-payments/additional-resources/use-cases/extended-authorization-expiration/
[retry]: https://docs.klarna.com/acquirer/klarna/get-started/integration-resilience/escalation-and-retry-policy/
[tax]: https://docs.klarna.com/acquirer/klarna/web-payments/additional-resources/error-handling-and-validations/tax-handling/
[markets]: https://docs.klarna.com/acquirer/klarna/get-started/data-requirements/puchase-countries-currencies-locales/
[urls]: https://docs.klarna.com/acquirer/klarna/get-started/integration-resilience/api-urls/
[api]: https://docs.klarna.com/acquirer/klarna/api/payments/
[omapi]: https://docs.klarna.com/acquirer/klarna/api/ordermanagement/
[testdata]: https://docs.klarna.com/acquirer/klarna/resources/developer-tools/sample-data/sample-customer-data/
[testpay]: https://docs.klarna.com/acquirer/klarna/resources/developer-tools/sample-data/sample-payment-data/
[crystallize]: https://crystallize.com/docs/developer/integrations/payment-gateways/klarna
