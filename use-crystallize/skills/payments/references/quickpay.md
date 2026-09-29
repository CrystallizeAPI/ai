# QuickPay with Crystallize

> Verification: Written from QuickPay's official docs, checked 2026-09-29. Not run end-to-end.
> Official docs: [API introduction][api], [Callback][callback], [Quickpay Link][link], [Payments guide][guide],
> [Test data][test], [Payment methods][methods], [Acquirer details][acquirers], [Errors & codes][errors],
> [API reference][services] (machine-readable: <https://api.quickpay.net/docs/v10/merchant/api/payments.json>).
> QuickPay publishes no llms.txt or agent plugin.

## At a glance

| Topic                   | QuickPay                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| Markets & currencies    | Danish gateway; DK, Nordics, EU. Currency per acquirer (DKK, NOK, SEK, EUR, …)            |
| Recommended integration | Quickpay Link: `POST /payments`, `PUT /payments/{id}/link`, redirect to `url`             |
| Alternative             | Same link with `framed: true` in an iframe. The Quickpay Form (HTML POST) is legacy       |
| API version             | `v10`, sent as the `Accept-Version: v10` header; only the two newest versions are served  |
| Server SDK              | None for Node (only PHP, Ruby, Python, .NET clients) — use `fetch`                        |
| Client SDK              | None; hosted payment window at `payment.quickpay.net`                                     |
| Amount units            | Integer **minor** units (`amount: 100` = 1.00 DKK)                                        |
| Capture                 | Manual (authorize, then `POST /payments/{id}/capture`); `auto_capture` for digital goods  |
| Cart id                 | `order_id` 4–20 chars (a UUID does not fit) → derived id + `variables.cartId`             |
| Webhook verification    | `QuickPay-Checksum-Sha256` = hex HMAC-SHA256 of the raw body with the account Private key |

## Setup

- Sign up at <https://manage.quickpay.net>. **Settings → Integration** holds the Merchant ID, the
  **Private key** (callback checksums) and the API user's **API key** (Basic auth). The docs recommend
  a separate, restricted API user.
- There is no sandbox host. Test cards run on the normal account and each payment carries
  `test_mode: true`. Test transactions can be disabled per merchant (same page) — do that in production.
- Callbacks go to the URL in the link's `callback_url`, else the account default. API operations
  (capture, refund, cancel) take a `QuickPay-Callback-Url` header. There is no registration API.
- Localhost: tunnel (ngrok, cloudflared) and pass the tunnel URL as `callback_url`.

```bash
QUICKPAY_API_KEY=...        # API user key — Basic auth, username empty
QUICKPAY_PRIVATE_KEY=...    # account Private key — callback checksum
QUICKPAY_CALLBACK_URL=https://shop.example/api/payments/quickpay/webhook
QUICKPAY_ACCEPT_TEST=false  # true only outside production
```

## Create the session

Call after `place` ([SKILL.md](../SKILL.md#the-payment-step)). `order_id` must be unique and 4–20 chars;
a retry for the same cart needs a new one, so derive it from the cart id plus an attempt counter. The real
cart id travels in `variables`, which every callback echoes.

```ts
type PlacedCart = { id: string; total: { gross: number; net: number; currency: string } };

export async function quickpay<T>(path: string, method: string, body?: unknown, headers = {}) {
    const res = await fetch(`https://api.quickpay.net${path}`, {
        method,
        headers: {
            Authorization: `Basic ${btoa(`:${process.env.QUICKPAY_API_KEY}`)}`, // empty username
            "Accept-Version": "v10",
            Accept: "application/json",
            "Content-Type": "application/json",
            ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`QuickPay ${method} ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
}

export async function createQuickPaySession(cart: PlacedCart, attempt: number, origin: string, lang = "da") {
    // order_id: 4–20 chars, unique → 18 hex chars of the cart id + 2-digit attempt
    const orderId = `${cart.id.replace(/-/g, "").slice(0, 18)}${String(attempt).padStart(2, "0")}`;
    const payment = await quickpay<{ id: number }>("/payments", "POST", {
        order_id: orderId,
        currency: cart.total.currency,
        variables: { cartId: cart.id },
    });
    const link = await quickpay<{ url: string }>(`/payments/${payment.id}/link`, "PUT", {
        amount: Math.round(cart.total.gross * 100),
        continue_url: `${origin}/checkout/quickpay/return?cartId=${cart.id}`, // not proof of payment
        cancel_url: `${origin}/checkout?cancelled=quickpay`,
        callback_url: process.env.QUICKPAY_CALLBACK_URL,
        language: lang,
        auto_capture: false, // physical goods: capture on shipment
        // payment_methods: 'creditcard, mobilepay, apple-pay, google-pay', // omit = all enabled
    });
    return { url: link.url, paymentId: payment.id };
}
```

`basket[]` (`qty`, `item_no`, `item_name`, `item_price` minor incl. VAT, `vat_rate`) is optional but
**required for Klarna**, and basket plus `shipping.amount` must equal the amount.

## Client

Redirect the browser (a server `redirect(url)` or `window.location.assign(url)`). Cards, 3-D Secure,
MobilePay, Vipps, Apple Pay and Google Pay run in QuickPay's hosted window. The link can be reopened
until it is paid, which is useful for abandoned-cart emails. The `continue_url` page shows "confirming
payment" and polls your backend for the order. It may call `GET /payments/{id}` to show a decline early,
but it never creates the order.

## Webhook

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export async function verifyQuickPay(req: Request): Promise<string> {
    const raw = await req.text(); // the raw bytes — QuickPay's own Node sample re-stringifies; don't
    const expected = createHmac("sha256", process.env.QUICKPAY_PRIVATE_KEY!).update(raw).digest("hex");
    const actual = req.headers.get("quickpay-checksum-sha256") ?? "";
    const ok = expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
    if (!ok) throw new Error("checksum");
    return raw;
}
```

```ts
// app/api/payments/quickpay/webhook/route.ts
import { createOrderOnce } from "@/lib/crystallize-payments";

type Op = {
    id: number;
    type: string; // authorize | capture | refund | cancel | …
    amount: number;
    pending: boolean;
    qp_status_code: string; // '20000' = approved
    created_at: string;
};

export async function POST(req: Request) {
    let raw: string;
    try {
        raw = await verifyQuickPay(req);
    } catch {
        return new Response("invalid checksum", { status: 401 });
    }
    if (req.headers.get("quickpay-resource-type") !== "Payment") return new Response("ignored");
    const payment = JSON.parse(raw); // the whole Payment after the change
    if (payment.test_mode && process.env.QUICKPAY_ACCEPT_TEST !== "true") return new Response("test ignored");

    const ops: Op[] = payment.operations;
    const last = ops[ops.length - 1];
    const approved = (op?: Op) => op && !op.pending && op.qp_status_code === "20000";
    try {
        const auth = ops.find((op) => op.type === "authorize");
        if (payment.accepted && approved(auth)) {
            // every operation re-sends the payment; createOrderOnce makes the repeats no-ops
            await createOrderOnce(payment.variables.cartId, "unpaid", quickPayPayment(payment, auth!));
        }
        if (approved(last) && last.type !== "authorize") {
            // capture/refund/cancel done outside your code (e.g. in the Manager): same helpers as below
        }
        return new Response("ok");
    } catch {
        return new Response("retry", { status: 500 });
    }
}
```

QuickPay expects 2xx (or 302/303). Its docs say failed callbacks are retried "up to 24 times" and also
"after an hour" — they don't agree, so don't depend on the timing. Callbacks for one payment arrive in
operation order; across payments any order. Every operation (authorize, capture, refund, cancel)
triggers a callback carrying the full payment.

| Latest operation              | Crystallize ([paymentStatus](../SKILL.md#paymentstatus))                      |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `authorize` `20000`, accepted | `createOrderOnce(cartId, 'unpaid', …)`, `state=authorized`                    |
| `capture` `20000`             | `replacePayments` `state=captured`; `setPaymentStatus` `paid`/`partiallyPaid` |
| `refund` `20000`              | `addPayment` `type=refund`; `setPaymentStatus` `partiallyRefunded`/`refunded` |
| `cancel` `20000`              | `replacePayments` `state=cancelled`; stay `unpaid`, cancelled stage           |
| `authorize` declined          | No order; retry with a new `order_id`                                         |

## Capture, refund, cancel

```ts
import { addPayment, replacePayments, setPaymentStatus } from "@/lib/crystallize-payments";

const cb = { "QuickPay-Callback-Url": process.env.QUICKPAY_CALLBACK_URL! };
const sum = (p: any, type: string) =>
    p.operations
        .filter((o: Op) => o.type === type && !o.pending && o.qp_status_code === "20000")
        .reduce((total: number, o: Op) => total + o.amount, 0); // minor units

// ?synchronized returns the payment with the finished operation (not just 202 + a callback)
async function operate(id: number, op: "capture" | "refund" | "cancel", body?: object) {
    const p = await quickpay<any>(`/payments/${id}/${op}?synchronized`, "POST", body, cb);
    const last: Op = p.operations[p.operations.length - 1];
    if (last.qp_status_code !== "20000") throw new Error(`QuickPay ${op}: ${last.qp_status_code}`);
    return { p, last }; // on 40000 see aq_status_code / aq_status_msg for the acquirer's reason
}

export async function captureQuickPay(cartId: string, id: number, major: number) {
    const { p, last } = await operate(id, "capture", { amount: Math.round(major * 100) }); // partial ok
    const auth = p.operations.find((o: Op) => o.type === "authorize");
    const captured = sum(p, "capture");
    // replaces ALL records — capture before any refund, or pass the refund records back in too
    await replacePayments(cartId, [
        quickPayPayment(p, { ...auth, amount: captured, created_at: last.created_at }, "captured"),
    ]);
    await setPaymentStatus(cartId, captured < auth.amount ? "partiallyPaid" : "paid");
}

export async function refundQuickPay(cartId: string, id: number, major: number) {
    const { p, last } = await operate(id, "refund", { amount: Math.round(major * 100) });
    await addPayment(cartId, {
        provider: "quickpay",
        method: "refund",
        transactionId: `${p.id}-${last.id}`, // payment id + operation id
        amount: last.amount / 100,
        createdAt: last.created_at,
        meta: [
            { key: "type", value: "refund" },
            { key: "state", value: "refunded" },
        ],
    });
    await setPaymentStatus(cartId, sum(p, "refund") < sum(p, "capture") ? "partiallyRefunded" : "refunded");
}

export async function cancelQuickPay(cartId: string, id: number) {
    const { p } = await operate(id, "cancel"); // voids an uncaptured authorization
    const auth = p.operations.find((o: Op) => o.type === "authorize");
    await replacePayments(cartId, [quickPayPayment(p, auth, "cancelled")]); // stays unpaid
}
```

- There is **no idempotency key**. Before retrying a capture or refund, read `GET /payments/{id}` and
  check `operations` so that a retry does not double-capture.
- The authorization lifetime is set by the acquirer and card scheme (error `40002` = expired).
  `POST /payments/{id}/renew` renews it. Capture only when the goods ship.

## Mapping

```ts
import type { Payment } from "@/lib/crystallize-payments";

function quickPayPayment(p: any, auth: { amount: number; created_at: string }, state = "authorized"): Payment {
    return {
        provider: "quickpay",
        method: p.metadata?.brand ?? p.metadata?.type ?? "card", // 'visa', 'dankort', 'mobilepay', …
        transactionId: String(p.id), // QuickPay payment id — capture/refund/cancel use it
        amount: auth.amount / 100, // Crystallize: major units
        createdAt: auth.created_at,
        meta: [
            { key: "state", value: state },
            { key: "type", value: "payment" },
            { key: "orderId", value: p.order_id },
        ],
    };
}
```

## Gotchas

- `order_id` is 4–20 characters and unique per merchant. Swish additionally allows only `a-zA-Z0-9-`,
  1–35 chars, so the hex id above is safe.
- `gross * 100` must be rounded; `amount` is an integer.
- The checksum key is the **Private key**, not the API key. Hash the raw body; parsing and
  re-stringifying breaks on key order and unicode escaping.
- Test cards work on a live account. Filter `test_mode` in production, or disable test transactions.
- Test cards (any plausible expiry and CVD; CVD = ISO numeric country code sets the issuing country):
  `1000 0000 0000 0008` Visa approved, `…0016` rejected, `…0024` expired, `…0032` capture rejected,
  `…0040` refund rejected, `…0073` 3DS required; Mastercard `1000 0100 0000 0007`, Dankort
  `1000 0200 0000 0006` approved.
- `payment_methods` restricts to what you list; `!brand` excludes. MobilePay Checkout via QuickPay was
  discontinued on 2024-03-12.
- HTTP 429 is "Too Many 4XX Requests" and comes with `Retry-After` — a burst of bad calls throttles you.
- In the old furniture boilerplates:
    - The callback created an order on **every** `type === 'payment'` callback, so a capture or refund
      created another order. It also created one when `accepted` was `false` (stored as `REFUSED`).
    - The checksum was computed over `JSON.stringify(await request.json())`, not the raw body.
    - An invalid checksum returned `{}` with HTTP 200, so QuickPay considered it delivered and never
      retried.
    - No `test_mode` check; `cart.total.gross * 100` unrounded; no capture, refund or cancel at all.
    - `order_id` was an md5 of the cart id cut to 20 chars, which is fine, but a second attempt collides.
      Keep `variables.cartId` as the join key.
    - The cart was placed and the link fetched from the browser via the service API. Do both
      server-side.

[api]: https://learn.quickpay.net/tech-talk/api/
[callback]: https://learn.quickpay.net/tech-talk/api/callback/
[link]: https://learn.quickpay.net/tech-talk/payments/link/
[guide]: https://learn.quickpay.net/tech-talk/guides/payments/
[test]: https://learn.quickpay.net/tech-talk/appendixes/test/
[methods]: https://learn.quickpay.net/tech-talk/appendixes/payment-methods/
[acquirers]: https://learn.quickpay.net/tech-talk/appendixes/acquirer-details/
[errors]: https://learn.quickpay.net/tech-talk/appendixes/errors/
[services]: https://learn.quickpay.net/tech-talk/api/services/
