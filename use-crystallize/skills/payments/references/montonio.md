# Montonio with Crystallize

> Verification: Written from Montonio's official docs, checked 2026-09-29. Not run end-to-end.
> Official docs: [Payments overview][overview], [API reference][reference], [Create and validate an
> Order][orders], [Webhooks][webhooks], [Refunds][refunds], [Payment methods][methods],
> [Embedded cards][embedded]. Montonio's docs ask agents to start from <https://docs.montonio.com/llms.txt>
> (the whole site inlined: <https://docs.montonio.com/llms-full.txt>).

## At a glance

| Topic                   | Montonio                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Markets & currencies    | Estonia, Latvia, Lithuania, Finland, Poland. **EUR and PLN only**                        |
| Recommended integration | Stargate: `POST /orders`, redirect to `paymentUrl` (all methods)                         |
| Alternative             | Embedded cards: `POST /sessions` + `@montonio/montonio-js` `MontonioCheckout`            |
| API version             | "Stargate" (unversioned), `https://stargate.montonio.com/api`. Payments V1 is deprecated |
| Server SDK              | None — `jsonwebtoken@9` for HS256 JWTs + `fetch`                                         |
| Client SDK              | `@montonio/montonio-js@1` (embedded cards only); redirect needs none                     |
| Amount units            | **Major** units, 2 decimals (`grandTotal: 99.99`), like Crystallize                      |
| Capture                 | None: `PENDING → PAID`. `AUTHORIZED` only as opt-in (bank, enterprise)                   |
| Cart id                 | `merchantReference` (unique per store; reuse on an unpaid order replaces it)             |
| Webhook verification    | Body `{ orderToken }` / `{ refundToken }`: HS256 JWT signed with your Secret Key         |

Methods (`payment.method`): `paymentInitiation` (bank, EUR/PLN), `cardPayments`, `applePay`,
`googlePay` (EUR/PLN), `mobilePay` (EUR), `blik` (PLN), `bnpl` and `hirePurchase` (EUR, EE/LV/LT).

## Setup

- Register at montonio.com. In the Partner System (<https://partner.montonio.com>) go to **Stores** →
  your store → **API Keys**. Sandbox keys are available at once; production keys after approval.
  Generating new keys invalidates the old ones.
- Sandbox API: `https://sandbox-stargate.montonio.com/api`. Test cards (embedded cards guide):
  `5577 0000 5577 0004` success, `5454 5454 5454 5454` success with 3DS, both `03/30`, CVC `737`; a
  wrong CVC fails. Force the redirect 3DS flow with `billingAddress.email = redirect-3ds-test@montonio.com`.
  The sandbox bank list comes from `GET /stores/payment-methods`; test-bank behaviour is not documented.
- No webhook registration: each order carries its own `notificationUrl`, and refund webhooks go to the
  same URL. Webhooks come from `35.156.245.42` and `35.156.159.169` (User-Agent `MontonioWebhooks/1.0`) —
  allowlist them in a WAF or Cloudflare. Localhost: ngrok or webhook.site.

```bash
MONTONIO_API_URL=https://sandbox-stargate.montonio.com/api  # prod: https://stargate.montonio.com/api
MONTONIO_ACCESS_KEY=...
MONTONIO_SECRET_KEY=...
MONTONIO_NOTIFICATION_URL=https://shop.example/api/payments/montonio/webhook
```

## Create the session

Call after `place` ([SKILL.md](../SKILL.md#the-payment-step)). Auth is a JWT signed HS256 with the Secret
Key and carrying `accessKey`. For POST, the **payload itself** is the JWT, sent as `{ data }`; for GET, it
goes in `Authorization: Bearer`. Let the shopper pick the method (and bank) in your checkout **before**
creating the order.

```ts
import jwt from "jsonwebtoken";

type PlacedCart = {
    id: string;
    total: { gross: number; net: number; currency: string };
    items: { name: string; quantity: number; price: { gross: number } }[]; // line totals, major units
};

const sign = (payload: object, expiresIn: "10m" | "1h") =>
    jwt.sign({ accessKey: process.env.MONTONIO_ACCESS_KEY, ...payload }, process.env.MONTONIO_SECRET_KEY!, {
        algorithm: "HS256",
        expiresIn,
    });

export async function montonio<T>(path: string, payload?: object): Promise<T> {
    const init: RequestInit = payload
        ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ data: sign(payload, "10m") }), // POST: the payload IS the JWT
          }
        : { headers: { Authorization: `Bearer ${sign({}, "1h")}` } };
    const res = await fetch(`${process.env.MONTONIO_API_URL}${path}`, init);
    // 401 STORE_NOT_FOUND = wrong access key, 403 INVALID_TOKEN = wrong secret
    if (!res.ok) throw new Error(`Montonio ${path} ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
}

// GET /stores/payment-methods → paymentMethods.paymentInitiation.setup[country].paymentMethods[] (banks);
// cache it for a few hours and render your own selector (or Montonio's bank widget).

export async function createMontonioSession(
    cart: PlacedCart,
    origin: string,
    choice: { method: string; bank?: string; country?: string },
    customer: { firstName: string; lastName: string; email: string; country: string },
) {
    const grandTotal = Math.round(cart.total.gross * 100) / 100; // major units, 2 decimals
    const order = await montonio<{ uuid: string; paymentUrl: string }>("/orders", {
        merchantReference: cart.id, // placed cart can't change, so re-POSTing on retry is safe
        returnUrl: `${origin}/checkout/montonio/return`, // gets ?order-token=<JWT>
        notificationUrl: process.env.MONTONIO_NOTIFICATION_URL,
        currency: cart.total.currency, // EUR | PLN
        grandTotal,
        locale: "en", // de en et fi lt lv pl ru
        billingAddress: customer,
        lineItems: cart.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            finalPrice: Math.round((i.price.gross / i.quantity) * 100) / 100, // unit price incl. tax
        })),
        payment: {
            method: choice.method, // e.g. 'paymentInitiation'
            amount: grandTotal, // must equal grandTotal
            currency: cart.total.currency,
            methodOptions: choice.bank
                ? { preferredProvider: choice.bank, preferredCountry: choice.country } // bank code, e.g. LHVBEE22
                : undefined,
        },
        expiresIn: 30, // minutes until ABANDONED (5 … 44640)
    });
    return { url: order.paymentUrl, montonioOrderUuid: order.uuid };
}
```

Re-using a `merchantReference` for an unpaid order **replaces** that order, amount included, and
returns a new URL. For a paid order it errors. Montonio: "If you change the amount … create a new order".

## Client

Redirect to `paymentUrl` (a server `redirect()` from the Server Action). For a bank payment with
`preferredProvider`, Montonio skips its own bank picker and sends the shopper straight to the bank. The
shopper comes back to `returnUrl?order-token=<JWT>` after success **or** cancel. Verify that token
server-side to render the result (`paymentStatus`), then poll for the order. The page never creates the
order; the webhook does.

Embedded cards (optional): on the server call `POST /sessions` once per checkout load; on the client
use `new MontonioCheckout({ sessionUuid, environment: 'sandbox' | 'production', onSuccess, onError })`,
`.initialize('#container')`, then `validateOrReject()`. Then create the order with `sessionUuid` and
call `submitPayment()`. Call `destroy()` before re-initialising (React re-renders). If
`cardPayments.processor === 'stripe'`, the store is still on the legacy embedded flow.

## Webhook

```ts
export async function verifyMontonio(req: Request) {
    const body = JSON.parse(await req.text()) as { orderToken?: string; refundToken?: string };
    const token = body.orderToken ?? body.refundToken;
    if (!token) throw new Error("no token");
    const claims = jwt.verify(token, process.env.MONTONIO_SECRET_KEY!, { algorithms: ["HS256"] }) as any;
    if (claims.accessKey !== process.env.MONTONIO_ACCESS_KEY) throw new Error("other store");
    return { kind: body.orderToken ? ("order" as const) : ("refund" as const), claims };
}
```

```ts
// app/api/payments/montonio/webhook/route.ts
import { addPayment, createOrderOnce, replacePayments, setPaymentStatus } from "@/lib/crystallize-payments";

export async function POST(req: Request) {
    let event: Awaited<ReturnType<typeof verifyMontonio>>;
    try {
        event = await verifyMontonio(req);
    } catch {
        return new Response("invalid token", { status: 401 });
    }
    const c = event.claims;
    try {
        if (event.kind === "order" && c.paymentStatus === "PAID") {
            const order = await createOrderOnce(c.merchantReference, "paid", montonioPayment(c));
            if ("paymentStatus" in order && order.paymentStatus === "unpaid") {
                // it existed as AUTHORIZED: the bank has now settled it
                await replacePayments(c.merchantReference, [montonioPayment(c)]);
                await setPaymentStatus(c.merchantReference, "paid");
            }
        } else if (event.kind === "order" && c.paymentStatus === "AUTHORIZED") {
            await createOrderOnce(c.merchantReference, "unpaid", montonioPayment(c, "authorized"));
        } else if (event.kind === "order" && c.paymentStatus === "VOIDED") {
            await replacePayments(c.merchantReference, [montonioPayment(c, "cancelled")]);
            await setPaymentStatus(c.merchantReference, "unpaid"); // and stop fulfilment
        } else if (event.kind === "refund" && c.refundStatus === "SUCCESSFUL") {
            // the refund token has no merchantReference: read the Montonio order (dedupe on c.refundUuid)
            const order = await montonio<any>(`/orders/${c.orderUuid}`);
            await addPayment(order.merchantReference, {
                provider: "montonio",
                method: "refund",
                transactionId: c.refundUuid,
                amount: c.refundAmount, // major units
                createdAt: new Date(c.iat * 1000).toISOString(),
                meta: [
                    { key: "type", value: "refund" },
                    { key: "state", value: "refunded" },
                ],
            });
            await setPaymentStatus(
                order.merchantReference,
                order.paymentStatus === "REFUNDED" ? "refunded" : "partiallyRefunded",
            );
        }
        return Response.json({ ok: true }); // 200 or 201
    } catch {
        return Response.json({ error: "retry" }, { status: 500 });
    }
}
```

The signature is inside the JWT, so the raw body only has to be valid JSON. Pin `algorithms`. Use
`paymentStatus` and `merchantReference`; the snake_case duplicates (`payment_status`, …) are being
removed. A failure (not 200/201) is retried over 48 hours ("13 times"). Deduplicate on the order `uuid` +
status, or the refund `uuid`.

| Token status                   | Crystallize ([paymentStatus](../SKILL.md#paymentstatus))                          |
| ------------------------------ | --------------------------------------------------------------------------------- |
| order `PAID`                   | `createOrderOnce(cartId, 'paid', …)`, `state=captured`                            |
| order `AUTHORIZED` (opt-in)    | `createOrderOnce(cartId, 'unpaid', …)`, `state=authorized`                        |
| `PAID` after `AUTHORIZED`      | `replacePayments` `state=captured`; `setPaymentStatus` `paid`                     |
| order `VOIDED` (bank rejected) | `replacePayments` `state=cancelled`; `setPaymentStatus` `unpaid`; stop fulfilment |
| refund `SUCCESSFUL`            | `addPayment` `type=refund`; `setPaymentStatus` `partiallyRefunded`/`refunded`     |
| refund `REJECTED`              | Alert a human (`refundStatusDescription`)                                         |
| order `PENDING`, `ABANDONED`   | No order (`ABANDONED` after `expiresIn`, 30 min)                                  |

## Capture, refund, cancel

There is no capture or void: bank payments, cards and wallets settle at `PAID`. Refunds:

```ts
import { randomUUID } from "node:crypto";

// optional pre-check: GET /orders/{uuid} → availableForRefund, isRefundableType
await montonio(`/refunds`, {
    orderUuid: transactionId, // the Montonio order uuid from the payment record
    amount: 25.0, // major units, ≥ 0.05 EUR, total ≤ grandTotal
    idempotencyKey: randomUUID(), // required; store it and reuse it only to retry the same refund
    iat: Math.floor(Date.now() / 1000), // required for refunds
});
```

Write nothing to Crystallize here: the refund is only done when the `refundToken` webhook says
`SUCCESSFUL` (it can sit in `PENDING` and retry), and the route above then calls `addPayment` and
`setPaymentStatus` ([helpers](../SKILL.md#creating-the-order-exactly-once)).

## Mapping

```ts
import type { Payment } from "@/lib/crystallize-payments";

function montonioPayment(c: any, state: "captured" | "authorized" | "cancelled" = "captured"): Payment {
    return {
        provider: "montonio",
        method: c.paymentMethod, // 'paymentInitiation' | 'cardPayments' | 'applePay' | 'mobilePay' | …
        transactionId: c.uuid, // Montonio order uuid — refunds and GET /orders/{uuid} use it
        amount: Number(c.grandTotal), // already major units
        createdAt: new Date(c.iat * 1000).toISOString(),
        meta: [
            { key: "state", value: state },
            { key: "type", value: "payment" },
            ...(c.paymentProviderName ? [{ key: "bank", value: c.paymentProviderName }] : []),
        ],
    };
}
```

## Gotchas

- Amounts are **major** units, unlike most providers. Do not multiply by 100; round to 2 decimals.
- EUR and PLN only. There is no NOK, SEK or DKK — Montonio is not an option for NO/SE/DK shoppers.
- Refunds only work once the money has reached the Montonio settlement account (≈ 1 business day).
  Bank-payment refunds are EUR-only and must be enabled in the Partner System. Minimum 0.05 €.
- `VOIDED` can follow `PAID` for bank payments (rare; Montonio also emails the merchant), so allow a
  paid order to become unpaid. `ABANDONED` exists by default only for stores created after 2023-08-29.
- `preferredCountry` must match the bank list you showed (matters for Revolut, N26, Wise).
- The JWT `exp` for an order token must be short (docs: 10 minutes). The order's own lifetime is
  `expiresIn`.
- The legacy UMD SDK and the old embedded (Stripe) card flow are being retired in 2026.
- Shipping is out of scope here. Montonio's Shipping API **v2** (`https://shipping.montonio.com/api/v2`,
  same keys, JWT-signed webhooks) replaced the old `api.shipping.montonio.com` endpoints. Create shipments
  after `PAID` from a pipeline step, not inside the payment webhook.
- In the old furniture boilerplates:
    - Payments use the deprecated **V1** flow: a `payment_token` JWT appended to `payments.montonio.com`,
      with snake_case fields (`merchant_reference`, `preselected_aspsp`) and no API call.
    - The webhook read `payment_token` from the **query string** and checked `status === 'finalized'`
      and `payment_uuid` / `customer_iban`. Stargate POSTs `{ orderToken }` with `paymentStatus: 'PAID'`.
    - No `accessKey` check, no algorithm pinning, no idempotency: every notification called `pushOrder`,
      so a later refund notification would create a second order.
    - The bank list came from the old `/pis/v2/merchants/payment_methods`. The UI was hard-wired to `EE`
      and Omniva.
    - Shipments and labels (old shipping API) were created synchronously inside the payment webhook with
      errors swallowed (`.catch(console.log)`), and used a hard-coded dummy sender and phone number.

[overview]: https://docs.montonio.com/api/stargate/overview
[reference]: https://docs.montonio.com/api/stargate/reference
[orders]: https://docs.montonio.com/api/stargate/guides/orders
[webhooks]: https://docs.montonio.com/api/stargate/guides/webhooks
[refunds]: https://docs.montonio.com/api/stargate/guides/refunds
[methods]: https://docs.montonio.com/api/stargate/guides/payment-methods
[embedded]: https://docs.montonio.com/api/stargate/guides/embedded-cards
