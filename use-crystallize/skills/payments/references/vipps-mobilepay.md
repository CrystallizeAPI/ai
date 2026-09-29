# Vipps MobilePay with Crystallize

> Verification: Written from Vipps MobilePay's official docs, checked 2026-09-29. Not run end-to-end.
> Official docs: [ePayment API][epayment], [Create payment][create], [Concepts][concepts],
> [Webhooks API][webhooks], [Webhook HMAC][hmac], [Test environment][test], [OpenAPI v1.8.4][spec].
> Vipps publishes an official agent plugin — prefer it for provider detail:
> `claude plugin marketplace add vippsas/agent-toolkit && claude plugin install vipps-developer@agent-toolkit`
> ([vippsas/agent-toolkit][toolkit]), and an index at <https://developer.vippsmobilepay.com/llms.txt>
> (every docs page is also served as `.md`).

## At a glance

| Topic                   | Vipps MobilePay                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Markets & currencies    | NO (Vipps, NOK), DK (MobilePay, DKK), FI (MobilePay, EUR); SE shoppers pay NO shops in NOK |
| Recommended integration | ePayment API, `paymentMethod: WALLET`, `userFlow: WEB_REDIRECT` + Widget SDK button        |
| Alternative             | `paymentMethod: CARD` (freestanding card, `WEB_REDIRECT` only, not testable in MT)         |
| Not for new work        | eCom API v2 (legacy, Norway only); Checkout API (deprecated, being sold to Kustom)         |
| API version             | `/epayment/v1` (spec 1.8.4), `/webhooks/v1`, `POST /accesstoken/get`                       |
| Server SDK              | None current (`@vippsmobilepay/sdk@2` is stale, 2024-11) — use `fetch`                     |
| Client SDK              | Widget SDK `https://cdn.vippsmobilepay.com/js/widget-sdk/vipps-widget.js` (not on npm)     |
| Amount units            | Integer **minor** units. Min NOK 100, DKK 1, EUR 1; max 65 000 000. Currency = sales unit  |
| Capture                 | Manual. Deadline NO 180 days, DK/FI 14 days; see `captureGuaranteedUntil`                  |
| Cart id                 | `reference` `^[a-zA-Z0-9-]{8,64}$`, unique per MSN → `${cart.id}-${n}`, plus `metadata`    |
| Webhook verification    | `x-ms-content-sha256` = SHA-256 of body; HMAC-SHA256 of method/path/date/host/hash         |

## Setup

- Keys: [business portal][portal] → _For developers_ → test sales unit: client id, client secret,
  subscription key, MSN. Test (`apitest.vipps.no`) and production (`api.vipps.no`) keys are separate.
- Test users (phone + NIN) are created in the same portal tab. Install the orange MT app
  ([TestFlight](https://testflight.apple.com/join/hTAYrwea); Android: join Google group
  `vipps-mobilepay-test-app`, install `no.dnb.vipps.mt`), log in with OTP `0000`, PIN `1236`. Push is
  flaky in MT: open _Payments_ and pull to refresh.
- `POST /epayment/v1/test/payments/{reference}/approve` approves without the app (MT only, after the
  test user has approved one payment by hand). Test amounts (øre): `151` insufficient funds, `186` expired
  card, `201` result unknown for 1 h.
- Webhook: register **once per environment** from a script (not per payment). The `secret` is returned
  once; lost it → delete and re-register. Deliveries come from `callback-mt-1/2.vipps.no` (test) and
  `callback-[dr-]1..4.vipps.no` (prod) — allowlist hostnames, not IPs. Localhost: tunnel (ngrok,
  cloudflared) and register the tunnel URL as its own webhook.

```bash
# POST $VIPPS_BASE_URL/webhooks/v1/webhooks (auth headers as below) → { "id", "secret" }
# { "url": "$VIPPS_WEBHOOK_URL", "events": ["epayments.payment.authorized.v1", "…aborted.v1",
#   "…expired.v1", "…terminated.v1", "…captured.v1", "…refunded.v1", "…cancelled.v1"] }
VIPPS_BASE_URL=https://apitest.vipps.no      # production: https://api.vipps.no
VIPPS_CLIENT_ID=...
VIPPS_CLIENT_SECRET=...
VIPPS_SUBSCRIPTION_KEY=...                   # Ocp-Apim-Subscription-Key
VIPPS_MSN=...                                # Merchant-Serial-Number
VIPPS_WEBHOOK_URL=https://shop.example/api/payments/vipps/webhook
VIPPS_WEBHOOK_SECRET=...
```

## Create the session

Call after `place` with the placed cart ([SKILL.md](../SKILL.md#the-payment-step)). A retry for the same
cart needs a **new** `reference`, so keep an attempt counter per cart. Vipps requires the shopper to have
accepted your terms before the payment is created.

```ts
type PlacedCart = { id: string; total: { gross: number; net: number; currency: string } };

let token: { value: string; expiresAt: number } | undefined; // valid 1 h in test, 24 h in production

export async function vippsHeaders(idempotencyKey?: string): Promise<Record<string, string>> {
    const base = {
        "Ocp-Apim-Subscription-Key": process.env.VIPPS_SUBSCRIPTION_KEY!,
        "Merchant-Serial-Number": process.env.VIPPS_MSN!,
        "Vipps-System-Name": "crystallize", // each Vipps-System-* ≤ 30 chars
        "Vipps-System-Version": "1.0",
        "Vipps-System-Plugin-Name": "crystallize-payments",
        "Vipps-System-Plugin-Version": "1.0",
    };
    if (!token || token.expiresAt < Date.now() + 60_000) {
        const res = await fetch(`${process.env.VIPPS_BASE_URL}/accesstoken/get`, {
            method: "POST",
            headers: {
                ...base,
                client_id: process.env.VIPPS_CLIENT_ID!,
                client_secret: process.env.VIPPS_CLIENT_SECRET!,
            },
        });
        if (!res.ok) throw new Error(`Vipps token ${res.status}`);
        const json = await res.json();
        token = { value: json.access_token, expiresAt: Number(json.expires_on) * 1000 };
    }
    return {
        ...base,
        Authorization: `Bearer ${token.value}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}), // ≤ 50 chars
    };
}

export async function createVippsSession(cart: PlacedCart, attempt: number, origin: string) {
    const reference = `${cart.id}-${attempt}`; // 36-char UUID + suffix, well under 64
    const res = await fetch(`${process.env.VIPPS_BASE_URL}/epayment/v1/payments`, {
        method: "POST",
        headers: await vippsHeaders(`create-${reference}`),
        body: JSON.stringify({
            amount: { currency: cart.total.currency, value: Math.round(cart.total.gross * 100) },
            paymentMethod: { type: "WALLET" },
            userFlow: "WEB_REDIRECT",
            reference,
            returnUrl: `${origin}/checkout/vipps/return?cartId=${cart.id}`, // carries no status
            paymentDescription: `Order ${cart.id.slice(0, 8)}`, // 3–100 chars, shown in the app
            metadata: { cartId: cart.id }, // ≤ 5 pairs; returned by GET, not in webhooks
        }),
    });
    if (!res.ok) throw new Error(`Vipps create ${res.status}: ${await res.text()}`);
    const { redirectUrl } = await res.json();
    return { redirectUrl, reference };
}
```

## Client

Use the Widget SDK: it app-switches on mobile and shows the landing page in a Vipps-hosted dialog on
desktop (the only sanctioned iframe). Never rewrite `redirectUrl`, frame it yourself, or sniff for the
app. The SDK's `success` event is not proof of payment.

```tsx
// <Script src="https://cdn.vippsmobilepay.com/js/widget-sdk/vipps-widget.js" data-vipps-widget-sdk />
useEffect(() => {
    const vipps = (window as any).vipps;
    vipps.host().start(); // once, on the top-level page
    vipps
        .trigger(async () => {
            const res = await fetch("/api/payments/vipps/session", { method: "POST" }); // place + create
            return (await res.json()).redirectUrl;
        })
        .button()
        .brand(market === "NO" ? "vipps" : "mobilepay")
        .mount("#vipps-button");
}, []);
```

The return page shows "confirming payment" and polls your backend for the order. It may call
`GET /epayment/v1/payments/{reference}` to show `ABORTED`/`EXPIRED` early — it never creates the order.

## Webhook

```ts
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export async function verifyVipps(req: Request): Promise<string> {
    const raw = await req.text();
    const date = req.headers.get("x-ms-date") ?? "";
    const hash = req.headers.get("x-ms-content-sha256") ?? "";
    if (createHash("sha256").update(raw).digest("base64") !== hash) throw new Error("content hash");
    // host and path+query of the REGISTERED url — behind a proxy the request's own may differ
    const url = new URL(process.env.VIPPS_WEBHOOK_URL!);
    const signed = `POST\n${url.pathname}${url.search}\n${date};${url.host};${hash}`; // \n, not \r\n
    const sig = createHmac("sha256", process.env.VIPPS_WEBHOOK_SECRET!).update(signed).digest("base64");
    const expected = Buffer.from(`HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${sig}`);
    const actual = Buffer.from(req.headers.get("authorization") ?? "");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("signature");
    return raw;
}
```

```ts
// app/api/payments/vipps/webhook/route.ts
import { createOrderOnce } from "@/lib/crystallize-payments";

export async function POST(req: Request) {
    let raw: string;
    try {
        raw = await verifyVipps(req);
    } catch {
        return new Response("invalid signature", { status: 401 });
    }
    const event = JSON.parse(raw) as { reference: string; name: string; timestamp: string };
    try {
        if (event.name === "AUTHORIZED") {
            // re-read: the webhook lacks paymentMethod and metadata
            const payment = await getVippsPayment(event.reference);
            if (payment.state === "AUTHORIZED") {
                await createOrderOnce(payment.metadata.cartId, "unpaid", vippsPayment(payment, event.timestamp));
            }
        }
        // CAPTURED/REFUNDED/CANCELLED done outside your code (Vipps portal): same helpers as below
        return new Response("ok"); // within 10 s
    } catch {
        return new Response("retry", { status: 500 });
    }
}
```

Vipps retries on 4xx/5xx or no answer in 10 s, for 7 days; order is kept **per payment** (a failing
`AUTHORIZED` holds back `CAPTURED`); a registration failing for 2 weeks is deleted. Webhooks alone are
not enough: also poll `GET /payments/{reference}` from a cron for payments still `CREATED` after 10 min.

| `epayments.payment.<name>.v1`      | Crystallize ([paymentStatus](../SKILL.md#paymentstatus))                      |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `authorized`                       | `createOrderOnce(cartId, 'unpaid', …)`, `state=authorized`                    |
| `captured`                         | `replacePayments` `state=captured`; `setPaymentStatus` `paid`/`partiallyPaid` |
| `refunded`                         | `addPayment` `type=refund`; `setPaymentStatus` `partiallyRefunded`/`refunded` |
| `cancelled`                        | `replacePayments` `state=cancelled`; stay `unpaid`, cancelled stage           |
| `aborted`, `expired`, `terminated` | No order; the next attempt uses a new `reference`                             |

## Capture, refund, cancel

The payment `state` stays `AUTHORIZED` forever. What moved is in `aggregate` (`capturedAmount`,
`refundedAmount`, `cancelledAmount`, minor units) on `GET /payments/{reference}` and in every
modification response. One `Idempotency-Key` per operation, reused only to retry that operation.

```ts
type VippsOp = "capture" | "refund" | "cancel";
type Minor = { currency: string; value: number };

export async function vippsModify(reference: string, op: VippsOp, key: string, amount?: Minor) {
    const res = await fetch(`${process.env.VIPPS_BASE_URL}/epayment/v1/payments/${reference}/${op}`, {
        method: "POST",
        headers: await vippsHeaders(key), // e.g. `${reference}-capture-1`
        body: JSON.stringify(op === "cancel" ? {} : { modificationAmount: amount }),
    });
    if (!res.ok) throw new Error(`Vipps ${op} ${res.status}: ${await res.text()}`);
    return res.json(); // { aggregate, pspReference, … }
}

export async function getVippsPayment(reference: string) {
    const res = await fetch(`${process.env.VIPPS_BASE_URL}/epayment/v1/payments/${reference}`, {
        headers: await vippsHeaders(),
    });
    if (!res.ok) throw new Error(`Vipps get ${res.status}`);
    return res.json(); // { state, aggregate, amount, paymentMethod, metadata, … }
}
```

```ts
import { addPayment, replacePayments, setPaymentStatus } from "@/lib/crystallize-payments";

// On shipment. Partial captures: call again with the next n. Order id = cart id.
export async function captureVipps(cartId: string, reference: string, major: number, n = 1) {
    const p = await getVippsPayment(reference);
    await vippsModify(reference, "capture", `${reference}-capture-${n}`, {
        currency: p.amount.currency,
        value: Math.round(major * 100),
    });
    const { aggregate } = await getVippsPayment(reference);
    const captured = aggregate.capturedAmount.value;
    // replaces ALL records — capture before any refund, or pass the refund records back in too
    await replacePayments(cartId, [vippsPayment(p, new Date().toISOString(), "captured", captured)]);
    await setPaymentStatus(cartId, captured < aggregate.authorizedAmount.value ? "partiallyPaid" : "paid");
}

// ≤ captured, within 365 days of capture
export async function refundVipps(cartId: string, reference: string, major: number, n = 1) {
    const p = await getVippsPayment(reference);
    const r = await vippsModify(reference, "refund", `${reference}-refund-${n}`, {
        currency: p.amount.currency,
        value: Math.round(major * 100),
    });
    await addPayment(cartId, {
        provider: "vipps-mobilepay",
        method: "refund",
        transactionId: r.pspReference,
        amount: major,
        createdAt: new Date().toISOString(),
        meta: [
            { key: "type", value: "refund" },
            { key: "state", value: "refunded" },
        ],
    });
    const { refundedAmount, capturedAmount } = r.aggregate;
    await setPaymentStatus(cartId, refundedAmount.value < capturedAmount.value ? "partiallyRefunded" : "refunded");
}

// Cancel releases the uncaptured rest (a fully captured payment cannot be cancelled: 6040).
export async function cancelVipps(cartId: string, reference: string) {
    await vippsModify(reference, "cancel", `${reference}-cancel`);
    const p = await getVippsPayment(reference);
    await replacePayments(cartId, [vippsPayment(p, new Date().toISOString(), "cancelled")]);
}
```

Capturing before delivery is not allowed; if you will not capture the rest, cancel it. The helpers are in
[SKILL.md](../SKILL.md#creating-the-order-exactly-once). Retries of the same operation reuse its key.

## Mapping

```ts
import type { Payment } from "@/lib/crystallize-payments";

function vippsPayment(p: any, createdAt: string, state = "authorized", minor = p.amount.value): Payment {
    return {
        provider: "vipps-mobilepay",
        method: p.paymentMethod.type === "CARD" ? "card" : "wallet",
        transactionId: p.reference, // capture/refund/cancel are keyed on it
        amount: minor / 100, // Crystallize: major units
        createdAt,
        meta: [
            { key: "state", value: state },
            { key: "type", value: "payment" },
        ],
    };
}
```

Refund records (`refundVipps` above): `transactionId` = the refund's `pspReference`, `meta type=refund`.

## Gotchas

- `gross * 100` gives `12345.000000002`, which Vipps rejects (error 4040) — always `Math.round`.
- A reused `reference` returns 4020/4150; each attempt needs a new one. Leading zeros and purely numeric
  references are discouraged.
- `pspReference` differs per webhook event and from the one in API responses — key on `reference`.
- Verify against the **registered** host and path; Vercel rewrites change `req.url`.
- Do not cancel or unlock before the 10-minute expiry or an `expired` event — the shopper can still
  approve in the app.
- Reserve the full total, shipping included: you can never capture more than was authorized. Visa holds
  last ~7 days and BankAxept 7, so capture late and it can fail even inside Vipps' deadline.
- Rate limits per reference: GET 120/min; create/capture/refund/cancel 5/min. `QR` is for
  customer-facing screens, `PUSH_MESSAGE` needs approval, `NATIVE_REDIRECT` is discouraged.
- In the old furniture boilerplates:
    - Capture, cancel and refund call `/ecomm/v2/…` on ePayment payments (eCom cannot modify them) and send
      `client_id`/`client_secret` instead of a Bearer token — pipeline capture and refund never worked.
    - No webhooks: an in-request `pollingUntil` loop (dies on serverless); the "webhook" route verified nothing.
    - Checkout API (`vippsCheckoutSDK.js`, iframe/handoff) and eCom Express (`callbackPrefix`) are legacy.
    - `reference = cartId` blocks retries; the cart id was the `Idempotency-Key` for every call (a second
      partial capture is a "duplicate"); `gross * 100` unrounded; currency hard-coded `NOK`.

[epayment]: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/README.md
[create]: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/api-guide/operations/create.md
[concepts]: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/api-guide/concepts.md
[webhooks]: https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/api-guide.md
[hmac]: https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/request-authentication.md
[test]: https://developer.vippsmobilepay.com/docs/knowledge-base/test-environment.md
[spec]: https://developer.vippsmobilepay.com/redocusaurus/epayment-swagger-id.yaml
[toolkit]: https://github.com/vippsas/agent-toolkit
[portal]: https://portal.vippsmobilepay.com
