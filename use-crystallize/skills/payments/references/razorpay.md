# Razorpay with Crystallize

Razorpay is an Indian payment gateway (UPI, cards, netbanking, wallets, EMI, Pay Later, and international cards in
160+ currencies) that only onboards **businesses incorporated in India** (sign-up needs an Indian phone number, a PAN
and video KYC), **Malaysia and Singapore** (Razorpay Curlec) or **the US**; a Nordic or EU company cannot sign up,
and other foreign businesses can only use it to take payments _from Indian customers_. The recommended integration
creates a Razorpay **Order** on the server from the placed cart, opens **Standard Checkout** (the `checkout.js`
modal) on that order, and creates the Crystallize order from the signed `order.paid` / `payment.captured` webhook —
the signature Checkout hands the browser is for the UX only. Payments are **auto-captured** by default; manual
capture must happen within 3 days, after which authorized payments are refunded automatically.

> Verification: Written from Razorpay's official docs, checked 2026-10-06. Not run end-to-end.
> Official docs: [Standard Checkout][standard], [Create an Order][orders], [Fetch orders][orders-all],
> [Capture][capture], [Capture settings][capture-settings], [Per-order capture][capture-api], [Refunds][refund],
> [Validate webhooks][validate], [Webhook best practices][best], [Payment events][ev-pay], [Order events][ev-order],
> [Refund events][ev-refund], [API keys][keys], [Test cards][cards], [International payments][intl]. Markdown
> mirrors of every page: <https://razorpay.com/docs/llms.txt>. Crystallize page: [Razorpay][crystallize].

## At a glance

| Topic                     | Razorpay                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------- |
| Markets & currencies      | Merchants in IN, MY/SG (Curlec), US. INR; 160+ currencies once international is on    |
| Recommended integration   | Server Order (`POST /v1/orders`) → Standard Checkout (`checkout.js`) → webhook        |
| Alternative               | Hosted Checkout (redirect), Payment Links                                             |
| API version               | REST `https://api.razorpay.com/v1`, no dated versions; Basic auth `key_id:key_secret` |
| SDKs                      | `razorpay` on npm (2.9.x, optional — the code uses `fetch`); script `checkout.js`     |
| Amount units              | Integer sub-units; 0 decimals (JPY, ISK, KRW…); 3 decimals ending in 0 (KWD, BHD…)    |
| Capture + auth lifetime   | Auto-capture by default; manual capture within 3 days, then auto-refunded             |
| Cart id field             | `receipt` (≤ 40 chars, unique) = the cart id; `notes.cartId` (15 keys × 256 chars)    |
| One session per cart      | `receipt` is idempotent ("Duplicate request") → `GET /v1/orders?receipt=` and reuse   |
| Notification verification | `X-Razorpay-Signature`: hex HMAC-SHA256 of the raw body with the webhook secret       |

## Credentials and setup

- **Who can sign up:** the crystallize.com page warns that sign-up needs an Indian phone number and a PAN; Razorpay
  also asks for business documents and a video KYC with Aadhaar and PAN. Malaysian and Singaporean companies go
  through Razorpay Curlec, US companies through Razorpay US. Check this before writing any code.
- **Key ID** and **secret key** (as the crystallize.com page names them): Dashboard → **Test** or **Live** mode →
  Account & Settings → **API Keys** (under Website and app settings) → Generate Key. The secret is shown once; Live
  keys need a verified website (up to 3 working days). Every call sends them as HTTP Basic auth, "a base64 encoded
  string of `RAZORPAY_KEY_ID:RAZORPAY_KEY_SECRET`" in the crystallize.com page's words.
- **Webhook:** Account & Settings → **Webhooks** → + Add New Webhook: URL, a **secret** you choose (not the key
  secret), an alert email, and `order.paid`, `payment.captured`, `payment.authorized` (manual capture only),
  `payment.failed`, `refund.processed`, `refund.failed`. Test and Live are set up separately; test-mode OTP `754081`.
- **Capture mode:** Account & Settings → **Payment Capture** (account owner only).

```bash
RAZORPAY_KEY_ID=rzp_test_...      # key ID — public, also handed to Checkout
RAZORPAY_KEY_SECRET=...           # secret key — server only: API auth and the Checkout signature
RAZORPAY_WEBHOOK_SECRET=...       # the webhook's own secret
RAZORPAY_MANUAL_CAPTURE=false     # true when Payment Capture is manual (capture on shipment)
```

- **Test mode** uses the test keys and a mock bank page. Cards (any CVV, future expiry; an OTP of 4–10 digits
  succeeds, shorter fails): Visa `4100 2800 0000 1007`, Mastercard `5500 6700 0000 1002`, RuPay `6527 6589 0000 1005`;
  international Mastercard `5555 5555 5555 4444`, Visa `4012 8888 8888 1881`; declined Visa `4100 2800 0006 0003`.
  UPI: `success@razorpay` / `failure@razorpay`.
- **Localhost:** webhooks need a public URL, and Razorpay blocks `localhost`, `.local`, `.internal`, `ngrok.io`,
  `loca.lt`, `webhook.site`, `requestbin.com` and similar. It suggests a `zrok` tunnel; a preview deployment works
  too. Requests can be tried in Razorpay's [Postman workspace][postman] or with the Razorpay CLI.

## Create the payment

A Razorpay Order fixes amount and currency; Checkout pays that order, and payments without an `order_id` cannot be
captured and are refunded. Create it from the **placed** cart in the pay route of
[SKILL.md](../SKILL.md#lock-the-cart-before-you-charge). The cart id is the `receipt`, which Razorpay treats as an
idempotency key, so two tabs share one order; a failed attempt is retried inside Checkout on the same order.

```ts
// lib/razorpay.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Payment, PlacedCart } from "@/lib/crystallize-payments";

export async function razorpay<T>(path: string, init: { method?: string; body?: unknown; headers?: object } = {}) {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
        method: init.method ?? "GET",
        headers: {
            Authorization: `Basic ${btoa(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`)}`,
            "Content-Type": "application/json",
            ...init.headers,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Razorpay ${init.method ?? "GET"} ${path} ${res.status}: ${json.error?.description}`);
    return json as T;
}

export function hmacMatches(secret: string, message: string, signature: string | null) {
    const expected = createHmac("sha256", secret).update(message).digest();
    const received = Buffer.from(signature ?? "", "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
}

// Razorpay's currency table: these have 0 or 3 decimals, every other currency 2
const ZERO = "CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF".split(" ");
const THREE = "BHD IQD JOD KWD OMR TND".split(" ");
const decimals = (currency: string) => (ZERO.includes(currency) ? 0 : THREE.includes(currency) ? 3 : 2);
export function toMinor(major: number, currency: string) {
    const minor = Math.round(major * 10 ** decimals(currency));
    return decimals(currency) === 3 ? Math.round(minor / 10) * 10 : minor; // 3 decimals: the last digit must be 0
}
export const toMajor = (minor: number, currency: string) => minor / 10 ** decimals(currency);

// Amounts in sub-units, `created_at` in unix seconds; `notes` is an empty array when there are none
type Entity = { id: string; amount: number; currency: string; created_at: number };
export type RzpOrder = Entity & {
    amount_paid: number;
    status: "created" | "attempted" | "paid";
    notes: Record<string, string>;
};
// status: created | authorized | captured | refunded | failed; method: card | upi | netbanking | wallet | emi | …
export type RzpPayment = Entity & { order_id: string; status: string; captured: boolean; method: string };
export type RzpRefund = Entity & { payment_id: string };

export const findOrder = async (cartId: string) =>
    (await razorpay<{ items: RzpOrder[] }>(`/orders?receipt=${encodeURIComponent(cartId)}`)).items[0];

export async function createRazorpayOrder(placed: PlacedCart) {
    const currency = placed.total.currency.toUpperCase(); // must be enabled on the account
    const amount = toMinor(placed.total.gross, currency); // the placed total, never from the browser
    const order =
        (await findOrder(placed.id)) ?? // one order per cart: the other tab may have created it
        (await razorpay<RzpOrder>("/orders", {
            method: "POST",
            body: {
                amount,
                currency,
                receipt: placed.id, // a UUID is 36 chars (max 40); a second create with it is refused
                notes: { cartId: placed.id },
                // payment: { capture: "manual", … } captures this order on shipment, see Capture
            },
        }).catch(async (error) => (await findOrder(placed.id)) ?? Promise.reject(error))); // lost the race: reuse
    if (order.amount !== amount || order.currency !== currency) throw new Error(`${order.id} does not match the cart`);
    const c = placed.customer;
    const prefill = {
        name: [c?.firstName, c?.lastName].filter(Boolean).join(" "),
        email: c?.email,
        contact: c?.phone, // "+<country code><number>", else +91 is assumed
        method: placed.meta?.razorpayMethod, // chosen before place, see Provider specifics
    };
    const key = process.env.RAZORPAY_KEY_ID!; // the key ID only, never the secret
    // paid: the other tab already paid — go straight to the return page
    return { key, cartId: placed.id, orderId: order.id, amount, currency, paid: order.status === "paid", prefill };
}
```

The minimum amount is INR 1.00. Never set `partial_payment`: the order must be paid in full. Razorpay's Orders page
also says to create a new order after a failed payment because reusing one "will cause an error", while its order
states and late-authorization pages let several attempts share an order (unconfirmed which case errors). If Checkout
refuses a reopened `attempted` order, send the shopper back to a new cart, which gets a new order.

## Client

Load `checkout.js` once and open Checkout only when it is ready. Use the **`handler`**, not `callback_url` (meant for
WebView and redirect flows; it bypasses the handler). The handler only moves the shopper on: the return page from
[SKILL.md](../SKILL.md#the-return-page) waits until the webhook has turned the cart into an order. Failed attempts
are retried inside the modal.

```tsx
// app/checkout/razorpay-button.tsx
"use client";
import Script from "next/script";
import { useState } from "react";
import type { createRazorpayOrder } from "@/lib/razorpay"; // type only: nothing server-side reaches the bundle

type Session = Awaited<ReturnType<typeof createRazorpayOrder>>;

export function RazorpayButton() {
    const [ready, setReady] = useState(false);
    async function pay() {
        const s = (await (await fetch("/api/checkout/pay", { method: "POST" })).json()) as Session; // place + order
        const returnUrl = `/checkout/confirmation?cart=${s.cartId}`; // the return page reads this cart
        if (s.paid) return location.assign(returnUrl);
        new (window as any).Razorpay({
            key: s.key,
            order_id: s.orderId,
            amount: s.amount, // sub-units, from the server
            currency: s.currency,
            name: "Your store",
            image: "https://shop.example/logo.png", // a URL or a base64 string
            prefill: s.prefill,
            handler: async (r: { razorpay_payment_id: string; razorpay_signature: string }) => {
                const body = JSON.stringify({ ...r, cartId: s.cartId });
                await fetch("/api/payments/razorpay/verify", { method: "POST", body }); // UX only
                location.assign(returnUrl);
            },
        }).open();
    }
    return (
        <>
            <Script src="https://checkout.razorpay.com/v1/checkout.js" onReady={() => setReady(true)} />
            <button type="button" disabled={!ready} onClick={pay}>
                Pay
            </button>
        </>
    );
}
```

The verify route lets the page say "payment received" at once. It checks the signature against the order id **your
server** created for this cart — never the `razorpay_order_id` the browser sends — and it never creates the order: a
closed tab would lose it, and a valid signature says nothing about capture.

```ts
// app/api/payments/razorpay/verify/route.ts
import { findOrder, hmacMatches } from "@/lib/razorpay";

export async function POST(req: Request) {
    const r = (await req.json()) as { cartId: string; razorpay_payment_id: string; razorpay_signature: string };
    const order = await findOrder(r.cartId); // the HMAC below ties the payment to this cart's order
    const signed = `${order?.id}|${r.razorpay_payment_id}`; // hex HMAC-SHA256 with the KEY secret
    const ok = !!order && hmacMatches(process.env.RAZORPAY_KEY_SECRET!, signed, r.razorpay_signature);
    return Response.json({ ok }, { status: ok ? 200 : 400 });
}
```

## Webhook

```ts
// app/api/payments/razorpay/webhook/route.ts
import { createOrderOnce, readCart, recordPayment, updatePayment, withMeta } from "@/lib/crystallize-payments";
import { hmacMatches, razorpay, razorpayPayment, razorpayRefund } from "@/lib/razorpay";
import type { RzpOrder, RzpPayment, RzpRefund } from "@/lib/razorpay";

type RzpEvent = { event: string; payload: { payment?: { entity: RzpPayment }; refund?: { entity: RzpRefund } } };
const manualCapture = process.env.RAZORPAY_MANUAL_CAPTURE === "true";

export async function POST(req: Request) {
    const raw = await req.text(); // the exact bytes Razorpay signed
    if (!hmacMatches(process.env.RAZORPAY_WEBHOOK_SECRET!, raw, req.headers.get("x-razorpay-signature"))) {
        return new Response("bad signature", { status: 400 });
    }
    const { event, payload } = JSON.parse(raw) as RzpEvent;
    const snapshot = payload.payment?.entity;
    if (!snapshot?.order_id) return new Response("ignored"); // not an Orders API payment
    try {
        // Payloads are snapshots and arrive in any order: act on the current order and payment
        const order = await razorpay<RzpOrder>(`/orders/${snapshot.order_id}`);
        const cartId = order.notes.cartId;
        if (!cartId) return new Response("not ours");
        const payment = await razorpay<RzpPayment>(`/payments/${snapshot.id}`);
        if (event === "refund.processed") {
            if ((await readCart(cartId))?.state !== "ordered") return new Response("no order"); // e.g. a late auth
            if (!payment.captured) await updatePayment(cartId, payment.id, (r) => withMeta(r, { state: "cancelled" }));
            else await recordPayment(cartId, razorpayRefund(payload.refund!.entity, payment, cartId));
            return new Response("ok");
        }
        if (payment.amount !== order.amount || payment.currency !== order.currency) {
            console.error(`[razorpay] ${payment.id} does not match order ${order.id}: check by hand`);
            return new Response("mismatch logged"); // 2xx: retrying would not fix it
        }
        if (payment.status === "captured" && order.status === "paid" && order.amount_paid === order.amount) {
            await createOrderOnce(cartId, "paid", razorpayPayment(payment, cartId, "captured"));
            if (manualCapture) await updatePayment(cartId, payment.id, (r) => withMeta(r, { state: "captured" }));
        } else if (payment.status === "authorized" && manualCapture) {
            await createOrderOnce(cartId, "unpaid", razorpayPayment(payment, cartId, "authorized"));
        } // failed, created, or authorized under auto-capture (order.paid follows): nothing yet
        return new Response("ok");
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 });
    }
}
```

Razorpay wants a **2xx within 5 seconds**; anything else (a 3xx from middleware included) or a timeout fails and is
retried with backoff for 24 hours — then **the webhook is disabled** until re-enabled (the alert email says so).
Delivery is at least once and unordered (`payment.authorized` can follow `payment.captured`), hence the re-read and
`createOrderOnce`; `x-razorpay-event-id` identifies duplicates. Retries keep the secret they were signed with.

| Event, current state re-read                     | Crystallize ([paymentStatus](../SKILL.md#paymentstatus))          |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `order.paid` / `payment.captured`, order `paid`  | `createOrderOnce(…, 'paid', …)`, `state=captured`                 |
| `payment.captured` after a manual capture        | `updatePayment` → `state=captured`                                |
| `payment.authorized`, manual capture             | `createOrderOnce(…, 'unpaid', …)`, `state=authorized`             |
| `payment.authorized`, auto-capture               | Nothing: `order.paid` follows                                     |
| `payment.failed`                                 | Nothing; Checkout offers a retry. A late authorization may follow |
| `refund.processed`, captured payment             | `recordPayment`, `meta type=refund`                               |
| `refund.processed`, never captured (unconfirmed) | `updatePayment` → `state=cancelled`: the authorization lapsed     |
| `refund.failed`                                  | Alert a human                                                     |

## Capture, refund, cancel

**Capture mode** is an account setting (auto-capture by default) and applies only to payments made through Orders.
Manual capture must happen within **3 days** (the Dashboard maximum), then the payment is refunded automatically. A
per-order `payment: { capture: "manual", capture_options: { manual_expiry_period, refund_speed: "normal" } }` on
the order overrides the setting; `manual_expiry_period` is documented up to 7 200 minutes (5 days) — the docs
disagree, so plan for 3. Too short for made-to-order goods: keep auto-capture and refund instead.

```ts
// lib/razorpay.ts (continued) — captureByProvider.razorpay = capture
// Razorpay captures synchronously, so this never returns null: the captured amount in major units
export async function capture(transactionId: string, amount: number): Promise<number | null> {
    const payment = await razorpay<RzpPayment>(`/payments/${transactionId}`);
    if (toMinor(amount, payment.currency) !== payment.amount) throw new Error("Razorpay captures the full amount only");
    if (payment.status === "authorized") {
        // no idempotency key: reading the status first keeps a retried stage webhook from capturing twice
        const body = { amount: payment.amount, currency: payment.currency };
        await razorpay(`/payments/${transactionId}/capture`, { method: "POST", body });
    } else if (payment.status !== "captured") {
        throw new Error(`Razorpay payment ${transactionId} is ${payment.status}`); // refunded: the authorization lapsed
    }
    return toMajor(payment.amount, payment.currency);
}

/** `key`: one per business refund (e.g. the return id), ≥ 10 chars of [A-Za-z0-9_-]. refund.processed records it. */
export async function refund(transactionId: string, amount: number, key: string) {
    const payment = await razorpay<RzpPayment>(`/payments/${transactionId}`);
    return razorpay<RzpRefund>(`/payments/${transactionId}/refund`, {
        method: "POST",
        headers: { "X-Refund-Idempotency": key }, // same key + same body = the same refund; 409 = still running
        body: { amount: toMinor(amount, payment.currency), speed: "normal" }, // omit amount for a full refund
    });
}
```

- **Refunds** are recorded by the `refund.processed` webhook — Dashboard refunds included — never from here, so two
  writers never race. `speed: "optimum"` requests an instant refund (fee); normal takes 5–7 working days.
- **Cancel:** Razorpay has no void. An uncaptured authorization is refunded at the capture timeout (the webhook then
  marks it `cancelled`); to release it at once, capture and refund. On an auto-captured payment, cancel = refund.

## Mapping

```ts
// lib/razorpay.ts (continued)
export const razorpayPayment = (payment: RzpPayment, cartId: string, state: "authorized" | "captured"): Payment => ({
    provider: "razorpay",
    method: payment.method, // card, upi, netbanking, wallet, emi, paylater, …
    transactionId: payment.id, // pay_…: capture and refund use it
    amount: toMajor(payment.amount, payment.currency), // MAJOR units
    createdAt: new Date(payment.created_at * 1000).toISOString(),
    meta: [
        { key: "state", value: state },
        { key: "cartId", value: cartId },
        { key: "razorpayOrderId", value: payment.order_id },
    ],
});

export const razorpayRefund = (refund: RzpRefund, payment: RzpPayment, cartId: string): Payment => ({
    provider: "razorpay",
    method: payment.method,
    transactionId: refund.id, // rfnd_…
    amount: toMajor(refund.amount, refund.currency),
    createdAt: new Date(refund.created_at * 1000).toISOString(),
    meta: [
        { key: "type", value: "refund" },
        { key: "cartId", value: cartId },
        { key: "paymentId", value: payment.id },
    ],
});
```

## Provider specifics

**Payment method chosen in the storefront.** `prefill.method` (`card`, `netbanking`, `wallet`, `upi`, `emi`) opens
Checkout on that method when `email` and `contact` are prefilled too. Store the choice on the cart **before** `place`
— `carts.setMeta(id, { meta: [{ key: "razorpayMethod", value: "upi" }], merge: true })` — and the pay route reads it
from `placed.meta`. To hide or reorder methods for everyone, use Checkout's `config.display` ([methods][methods]).

**International shoppers.** International cards and every currency but INR must be activated (Account & Settings →
International payments), or order creation fails. Prefill `contact` with its country code (else +91 is assumed);
dummy email or phone values make international payments fail. Three-decimal currencies (KWD, BHD, OMR, …) must end
in 0, so `toMinor` can move the charge by up to 0.005 from the placed total: price those markets with two decimals.

**After payment (prose only).** `GET /v1/payments/{id}/refunds` lists refunds; Route transfers split a captured
payment between linked accounts; the Invoices API issues invoices; saved cards and recurring payments use tokens
(`customer_id`, `recurring` in Checkout).

## Going further

- **Hosted Checkout** redirects to a Razorpay page for the same order and webhook. **Payment Links** (e.g. for
  abandoned carts) are separate objects with their own `payment_link.*` events.
- **Magic Checkout** collects addresses, shipping, COD and coupons inside Razorpay: Razorpay then charges another
  amount than the placed cart and the Crystallize order lacks the shipping line. Choose shipping before `place`.
- **Offers** (`offer_id`) and **Dynamic Currency Conversion** change what the shopper pays; settle how the amount
  check and reconciliation treat them first. **Subscriptions** and recurring payments: not covered here.
- **Late authorization:** a payment reported failed can be authorized days later; with Orders, a late payment on an
  already paid order is refunded at once.
- **Tooling:** [Postman workspace][postman], the Razorpay CLI and MCP server, webhook IP allowlists, event replay on
  request (Dashboard → Help, up to 15 days). The crystallize.com page's flow (lock the cart, create a Razorpay order,
  open the modal, verify the signature, create the order) is this reference — with the webhook creating the order.

## Common mistakes

- Creating the Crystallize order from the browser handler's signature check: a closed tab after paying leaves a
  captured payment and no order.
- Checking the Checkout signature with the order id the browser sent, comparing with `!==`, or answering a mismatch
  with 200 `{}`.
- Verifying the webhook over `JSON.stringify(body)` (Razorpay's own Node example) instead of the raw text; mixing up
  the **key secret** (Checkout signature) and the **webhook secret**.
- Not checking the order status, `amount_paid` and currency before creating the order.
- A new Razorpay order on every click: a fixed `receipt` then fails ("Duplicate request"), a random one lets a cart
  be paid twice. Look the order up by `receipt` first.
- Answering 3xx (middleware), 4xx or 5xx, or taking over 5 seconds, for a day: Razorpay disables the webhook.
- `gross * 100` without rounding, or ignoring zero- and three-decimal currencies.
- `new Razorpay(…)` before `checkout.js` has loaded; `image` as an object; `contact` without a country code.
- `callback_url` in a web integration; paying without an `order_id` (auto-refunded); going live with test keys
  (Checkout shows success, nothing is captured).
- Manual capture for goods that ship after 3 days: the authorization is refunded before you capture.

[standard]: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
[orders]: https://razorpay.com/docs/api/orders/create/
[orders-all]: https://razorpay.com/docs/api/orders/fetch-all/
[capture]: https://razorpay.com/docs/api/payments/capture/
[capture-settings]: https://razorpay.com/docs/payments/payments/capture-settings/
[capture-api]: https://razorpay.com/docs/build/llm-docs/payments/payments/capture-settings/api.md
[refund]: https://razorpay.com/docs/build/llm-docs/api/refunds/normal-refunds-idempotent.md
[validate]: https://razorpay.com/docs/webhooks/validate-test/
[best]: https://razorpay.com/docs/webhooks/best-practices/
[ev-pay]: https://razorpay.com/docs/webhooks/payments/
[ev-order]: https://razorpay.com/docs/webhooks/orders/
[ev-refund]: https://razorpay.com/docs/webhooks/refunds/
[keys]: https://razorpay.com/docs/payments/dashboard/account-settings/api-keys/
[cards]: https://razorpay.com/docs/payments/payments/test-card-details/
[intl]: https://razorpay.com/docs/payments/international-payments/
[methods]: https://razorpay.com/docs/build/llm-docs/payments/payment-gateway/web-integration/standard/configure-payment-methods.md
[postman]: https://www.postman.com/razorpaydev/workspace/razorpay-public-workspace
[crystallize]: https://crystallize.com/docs/developer/integrations/payment-gateways/razorpay
