# Razorpay with Crystallize

**Only for merchants incorporated in India, Malaysia/Singapore (Razorpay Curlec) or the USA (Razorpay US).**
A Nordic or EU company cannot onboard: Indian sign-up needs PAN/GSTIN and video KYC, and non-Indian
businesses can only use Razorpay to take payments _from Indian customers_. There is no Vipps, MobilePay,
Swish or Klarna. For a Nordic store, pick another provider from [SKILL.md](../SKILL.md#choosing-a-provider).

> Verification: Written from Razorpay's official docs, checked 2026-09-29. Not run end-to-end.
> Official docs: [Standard Checkout integration][standard], [Create an Order][orders], [Capture][capture],
> [Refund][refund], [Capture settings][capture-settings], [Webhooks: validate & test][validate],
> [Webhook best practices][best], [Payment events][ev-pay], [Order events][ev-order],
> [International payments][intl]. LLM index with Markdown mirrors: <https://razorpay.com/docs/llms.txt>.

## At a glance

| Topic                   | Razorpay                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| Markets & currencies    | Merchants in IN, MY/SG, US. INR + 160+ currencies for international cards (on request)          |
| Recommended integration | Standard Checkout: server-side Order → `checkout.js` modal → verify signature → webhook         |
| Alternative             | Hosted Checkout (redirect; no EMI, Offers or UPI intent), Payment Links                         |
| API version             | REST `/v1`, no dated versions; `https://api.razorpay.com/v1`, Basic auth `key_id:key_secret`    |
| Server SDK              | `razorpay@2` (typings included)                                                                 |
| Client SDK              | Script `https://checkout.razorpay.com/v1/checkout.js`; no official React package                |
| Amount units            | Integer sub-units. JPY and **ISK are exponent 0**; KWD/BHD/OMR are 3 decimals with a trailing 0 |
| Capture                 | Auto-capture is the default (Orders API only). Authorized payments auto-refund after **3 days** |
| Cart id                 | Order `notes` (≤ 15 pairs, ≤ 256 chars); `receipt` ≤ 40 chars and must be unique                |
| Webhook verification    | `X-Razorpay-Signature` = hex HMAC-SHA256 of the raw body with the webhook secret                |

## Setup

- Keys: Dashboard in **Test Mode** → Account & Settings → **API Keys** → Generate Key (`rzp_test_…` and a
  secret shown once). Live keys are generated in Live Mode after activation.
- Webhook: Account & Settings → **Webhooks** → + Add New Webhook. HTTPS on port 80/443, **secret set**,
  alert email, events `order.paid`, `payment.authorized`, `payment.captured`, `payment.failed`,
  `refund.processed`, `refund.failed`. Test and Live mode are configured separately; the test-mode OTP
  for saving a webhook is `754081`.
- Localhost: webhooks need a public URL, and Razorpay **blacklists** `ngrok.io`, `loca.lt`, `webhook.site`,
  `requestbin.com`, `beeceptor.com`, `hookbin.com`, `mockbin.org`, `localhost`, `.local`, `.internal`. Use a
  `zrok` tunnel (Razorpay's suggestion) or a deployed preview URL.

```bash
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_...
```

## Create the session

Razorpay's "session" is an **Order**, and it maps 1:1 to a payment attempt: create a new one for every
attempt (a reused `order_id` errors), always after `place` ([SKILL.md](../SKILL.md#the-payment-step)).
Payments without an `order_id` cannot be captured and are refunded automatically.

```ts
import Razorpay from "razorpay";

export const rzp = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID!, key_secret: process.env.RAZORPAY_KEY_SECRET! });

const EXPONENT: Record<string, number> = { JPY: 0, ISK: 0, KWD: 3, BHD: 3, OMR: 3 }; // default 2
const exp = (c: string) => EXPONENT[c.toUpperCase()] ?? 2;
export const toMinor = (major: number, c: string) => {
    const minor = Math.round(major * 10 ** exp(c));
    return exp(c) === 3 ? Math.round(minor / 10) * 10 : minor; // 3-decimal: last digit must be 0
};
export const toMajor = (minor: number, c: string) => minor / 10 ** exp(c);

type PlacedCart = { id: string; total: { gross: number; net: number; currency: string } };

export async function createRazorpaySession(cart: PlacedCart, attempt: number) {
    const currency = cart.total.currency.toUpperCase(); // must be enabled on the account
    const order = await rzp.orders.create({
        amount: toMinor(cart.total.gross, currency),
        currency,
        receipt: `${cart.id}-${attempt}`.slice(-40), // ≤ 40 chars, unique per order
        notes: { crystallize_cart_id: cart.id }, // echoed in the order.paid webhook
    });
    // The browser gets the order id and the PUBLIC key id only.
    return { orderId: order.id, amount: order.amount, currency: order.currency };
}
```

## Client

```tsx
"use client";
import Script from "next/script";

// <Script src="https://checkout.razorpay.com/v1/checkout.js" onReady={() => setReady(true)} />
function openRazorpay(s: { orderId: string; amount: number; currency: string }, cartId: string, shopper: Shopper) {
    const rzp = new (window as any).Razorpay({
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        order_id: s.orderId,
        amount: s.amount,
        currency: s.currency, // sub-units, from the server
        name: "Your store",
        image: "/logo.png", // image: URL or base64 string
        prefill: { name: shopper.name, email: shopper.email, contact: shopper.phone }, // '+CC…'; default +91
        handler: async (r: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
            await fetch("/api/payments/razorpay/verify", { method: "POST", body: JSON.stringify({ cartId, ...r }) });
            location.assign(`/order/cart/${cartId}`); // confirmation page polls for the order
        },
        modal: { ondismiss: () => setPaying(false) },
    });
    rzp.on("payment.failed", (r: any) => setError(r.error.description));
    rzp.open(); // only once the script has loaded
}
```

Use the **handler**, not `callback_url` (meant for WebView/redirect flows). The verify route checks the
checkout signature so the page can say "paid" at once; the webhook still creates the order:

```ts
import { validatePaymentVerification } from "razorpay/dist/utils/razorpay-utils";

export async function verifyRazorpayCheckout(body: {
    cartId: string;
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
}) {
    // hex HMAC-SHA256 of `${order_id}|${payment_id}` with the KEY secret. A forged order id cannot match.
    const ok = validatePaymentVerification(
        { order_id: body.razorpay_order_id, payment_id: body.razorpay_payment_id },
        body.razorpay_signature,
        process.env.RAZORPAY_KEY_SECRET!,
    );
    if (!ok) return false; // reject outright — do not retry, do not fulfil
    const order = await rzp.orders.fetch(body.razorpay_order_id);
    return order.notes?.crystallize_cart_id === body.cartId; // the order really belongs to this cart
}
```

## Webhook

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export async function verifyRazorpay(req: Request) {
    const raw = await req.text(); // raw bytes — Razorpay's own JSON.stringify(body) example is fragile
    const expected = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!).update(raw).digest("hex");
    const received = req.headers.get("x-razorpay-signature") ?? "";
    if (received.length !== expected.length || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
        throw new Error("bad signature");
    }
    return { eventId: req.headers.get("x-razorpay-event-id"), event: JSON.parse(raw) };
}
```

```ts
// app/api/payments/razorpay/webhook/route.ts
import { createOrderOnce } from "@/lib/crystallize-payments"; // from SKILL.md
import { rzp, toMajor, verifyRazorpay } from "@/lib/razorpay";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const verified = await verifyRazorpay(req).catch(() => null);
    if (!verified) return new Response("bad signature", { status: 400 });
    const { event } = verified;
    try {
        const payment = event.payload.payment?.entity;
        if (event.event === "order.paid" || event.event === "payment.authorized") {
            const order = event.payload.order?.entity ?? (await rzp.orders.fetch(payment.order_id));
            const cartId = order.notes?.crystallize_cart_id;
            if (!cartId) return new Response("ignored");
            const captured = event.event === "order.paid" || payment.status === "captured";
            await createOrderOnce(cartId, captured ? "paid" : "unpaid", {
                provider: "razorpay",
                method: payment.method,
                transactionId: payment.id,
                amount: toMajor(payment.amount, payment.currency),
                createdAt: new Date(payment.created_at * 1000).toISOString(),
                meta: [
                    { key: "state", value: captured ? "captured" : "authorized" },
                    { key: "razorpayOrderId", value: order.id },
                ],
            });
        }
        // payment.captured (after manual capture), refund.processed: see the table below.
        return new Response("ok"); // within 5 s, or Razorpay resends
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 }); // retried for 24 h, then the webhook is DISABLED
    }
}
```

| Razorpay event                            | Crystallize ([SKILL.md](../SKILL.md#paymentstatus))                    |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `order.paid` (order + payment entities)   | `createOrderOnce(…, 'paid', state=captured)` — the primary trigger     |
| `payment.authorized` (manual capture)     | `createOrderOnce(…, 'unpaid', state=authorized)`                       |
| `payment.captured` after a manual capture | `setPayments` state=captured; Core `paymentStatus: paid`               |
| `payment.failed`                          | No order. A `payment.captured` can still follow (UPI retry, late auth) |
| `refund.processed`                        | `addPayments` type=refund; `partiallyRefunded` / `refunded`            |
| `refund.failed`                           | Alert a human                                                          |

Delivery is at-least-once and unordered (`payment.authorized` may follow `payment.captured`). Dedupe on
the `x-razorpay-event-id` header; `createOrderOnce` already absorbs a second `order.paid`.

## Capture, refund, cancel

Capture mode is a **Dashboard setting** (Account & Settings → Payment Capture): auto-capture (default),
auto-capture with a timeout, or manual capture with a timeout, each 12 min–3 days. It applies only to
payments made through Orders. **An authorization lives at most 3 days**, then it is refunded — too short
for capture-on-shipment of made-to-order furniture; keep auto-capture and refund instead.

```ts
// Manual capture: status must be `authorized`; amount must equal what was authorized.
await rzp.payments.capture(paymentId, toMinor(amount, currency), currency);
// → payment.captured / order.paid → setPayments state=captured + Core paymentStatus paid

// Refund, full or partial; speed 'optimum' = instant refund (fee).
await rzp.payments.refund(paymentId, {
    amount: toMinor(amount, currency),
    speed: "normal",
    receipt: `refund-${cartId}-${refundNo}`,
    notes: { crystallize_cart_id: cartId },
});
// → refund.processed → addPayments { transactionId: rfnd_…, meta type=refund }
```

No cancel call: an uncaptured authorization is refunded at the timeout; record `setPayments`
state=cancelled. Crystallize calls: [SKILL.md](../SKILL.md#paymentstatus).

## Mapping

```ts
{
    provider: 'razorpay',
    method: payment.method,          // card, upi, netbanking, wallet, emi, paylater, bank_transfer
    transactionId: payment.id,       // pay_… — capture and refund use it
    amount: toMajor(payment.amount, payment.currency), // MAJOR units
    createdAt: new Date(payment.created_at * 1000).toISOString(),
    meta: [{ key: 'state', value: 'captured' }, { key: 'razorpayOrderId', value: order.id }], // or authorized/cancelled
}
```

Refund record: `transactionId: refund.id` (`rfnd_…`), refunded major amount,
`meta: [{ key: 'type', value: 'refund' }, { key: 'paymentId', value: payment.id }]`.

## Gotchas

- New Order per attempt; `receipt` must be unique — a deterministic receipt per cart collides on retry.
- `prefill.contact` without a country code is treated as `+91`. International payments fail with dummy
  email or phone.
- Signatures: the checkout signature uses the **key secret**; the webhook signature uses the **webhook
  secret**. The SDK helpers compare with `===`; the code above uses `timingSafeEqual`.
- Retries of events from before a secret rotation are signed with the old secret. Failing 24 h disables the webhook.
- The `order.paid` payload carries the order's `notes`; `payment.*` payloads carry only payment notes.
- Late authorization: Razorpay polls banks for up to 3 days, so "failed" can become "authorized/captured".
- In the old furniture boilerplates:
    - There is **no webhook**: the order is created only from the browser's handler posting to
      `/api/webhook/payment/razorpay/verify`. A closed tab after payment means a captured payment and no order.
    - The signature is computed from a client-sent `orderCreationId`, compared with `!==`, and a mismatch
      returns `{}` with HTTP 200.
    - `receipt = md5(cartId).substring(0, 20)` is identical for every attempt on a cart.
    - `amount: cart.total.gross * 100` is unrounded and ignores zero/three-decimal currencies.
    - No order-status or amount check, no dedupe: a double-submitted handler creates two orders.
    - `razorpay.tsx` appends `checkout.js` and immediately calls `new window.Razorpay` (race), calls hooks
      after an early `return null`, passes `image: { logo }` (an object), and sends no `contact`.
    - Orders use `provider: 'custom', custom: { properties: […] }` via the deprecated request handlers.

[standard]: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
[orders]: https://razorpay.com/docs/api/orders/create/
[capture]: https://razorpay.com/docs/api/payments/capture/
[refund]: https://razorpay.com/docs/api/refunds/create-normal/
[capture-settings]: https://razorpay.com/docs/payments/payments/capture-settings/
[validate]: https://razorpay.com/docs/webhooks/validate-test/
[best]: https://razorpay.com/docs/webhooks/best-practices/
[ev-pay]: https://razorpay.com/docs/webhooks/payments/
[ev-order]: https://razorpay.com/docs/webhooks/orders/
[intl]: https://razorpay.com/docs/payments/international-payments/
