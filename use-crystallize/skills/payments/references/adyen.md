# Adyen with Crystallize

> Verification: Written from Adyen's official docs, checked 2026-09-29. Not run end-to-end.
> Official docs: [Sessions flow][sessions], [Hosted Checkout][hosted], [Upgrade to Checkout API v72][v72],
> [Upgrade to Web v6][web6], [Webhooks][webhooks], [Verify HMAC][hmac], [Capture][capture], [Refund][refund],
> [Currency codes][currency]. Every docs page is served as Markdown (append `.md`); index at
> <https://docs.adyen.com/llms.txt>. OpenAPI: [CheckoutService-v72.json][openapi].

## At a glance

| Topic                   | Adyen                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| Markets & currencies    | Global, enterprise onboarding. Nordics: cards, Vipps, MobilePay, Swish, Klarna, Trustly             |
| Recommended integration | Sessions flow + Web Drop-in v6 (inline; handles 3DS and redirects)                                  |
| Alternative             | Hosted Checkout: `/sessions` with `mode: 'hosted'` + `themeId`, redirect to `response.url`          |
| API version             | Checkout API **v72** (breaking: stricter field validation)                                          |
| Server SDK              | `@adyen/api-library@32` (Node ≥ 18)                                                                 |
| Client SDK              | `@adyen/adyen-web@6` (needs Checkout API ≥ v69)                                                     |
| Amount units            | Minor units. Adyen's own exponents: JPY 0, IDR 0, **ISK 2**, CLP 2, BHD/KWD 3                       |
| Capture                 | Auto by default. Manual: `additionalData.manualCapture: 'true'` (Vipps/MobilePay/Klarna; not Swish) |
| Cart id                 | `reference` (≤ 80 chars, echoed as `merchantReference`) + `metadata` (20 keys, 20/80 chars)         |
| Webhook verification    | HMAC-SHA256 of 8 colon-joined fields, hex key, Base64 in `additionalData.hmacSignature`             |

## Setup

- Test Customer Area (ca-test.adyen.com): **Developers → API credentials** → create a credential; copy the
  **API key** and **Client key**, and add `http://localhost:3000` plus preview domains to **allowed
  origins** (otherwise Drop-in fails to load). Note the **merchant account** name.
- Enable payment methods per merchant account (Vipps, MobilePay, Swish, Klarna must be added).
- Webhook: **Developers → Webhooks → Standard webhook** at company level. URL
  `https://<host>/api/payments/adyen/webhook` — public, **no redirects**. Set Basic auth (or OAuth 2.0),
  generate an **HMAC key**. Live has different keys. "Test configuration" sends sample events.
- Localhost: no CLI forwarder — use a tunnel (ngrok, cloudflared) and point the test webhook at it.
- Live: `liveEndpointUrlPrefix` on the server, `environment: 'live'`/`'live-us'`/… on the client, one region.

```bash
ADYEN_API_KEY=AQE...
ADYEN_MERCHANT_ACCOUNT=YourCompanyECOM
ADYEN_HMAC_KEY=44782DEF...            # hex string from the webhook page
ADYEN_WEBHOOK_USER=...
ADYEN_WEBHOOK_PASSWORD=...
ADYEN_ENVIRONMENT=TEST                # LIVE also needs ADYEN_LIVE_PREFIX
NEXT_PUBLIC_ADYEN_CLIENT_KEY=test_...
```

## Create the session

After `place` ([SKILL.md](../SKILL.md#the-payment-step)):

```ts
import { CheckoutAPI, Client, EnvironmentEnum, Types } from "@adyen/api-library";

const client = new Client({
    apiKey: process.env.ADYEN_API_KEY!,
    environment: process.env.ADYEN_ENVIRONMENT === "LIVE" ? EnvironmentEnum.LIVE : EnvironmentEnum.TEST,
    liveEndpointUrlPrefix: process.env.ADYEN_LIVE_PREFIX,
});
export const checkout = new CheckoutAPI(client);

const EXPONENT: Record<string, number> = { JPY: 0, IDR: 0, BHD: 3, KWD: 3 }; // default 2; see currency codes
const exp = (c: string) => EXPONENT[c.toUpperCase()] ?? 2;
export const toMinor = (major: number, c: string) => Math.round(major * 10 ** exp(c));
export const toMajor = (minor: number, c: string) => minor / 10 ** exp(c);

type PlacedCart = { id: string; total: { gross: number; net: number; currency: string } };

export async function createAdyenSession(
    cart: PlacedCart,
    origin: string,
    shopper: {
        country: string;
        locale: string;
        email?: string;
    },
) {
    const currency = cart.total.currency.toUpperCase();
    const request: Types.checkout.CreateCheckoutSessionRequest = {
        merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT!,
        amount: { currency, value: toMinor(cart.total.gross, currency) },
        reference: cart.id, // ≤ 80 chars; comes back as merchantReference
        metadata: { crystallizeCartId: cart.id }, // key ≤ 20, value ≤ 80 chars
        returnUrl: `${origin}/checkout/adyen/return?cartId=${cart.id}`, // ≤ 1024 chars, no PII
        countryCode: shopper.country, // shipping country — it filters payment methods
        shopperLocale: shopper.locale, // e.g. 'nb-NO'
        channel: Types.checkout.CreateCheckoutSessionRequest.ChannelEnum.Web,
        shopperEmail: shopper.email, // risk checks and 3DS; shopperReference: 3–256 chars
        // lineItems (Klarna, Riverty, Afterpay): { id, sku, description, quantity, amountIncludingTax,
        //   amountExcludingTax, taxAmount, taxPercentage } — minor units; taxPercentage 2500 = 25 %
        // additionalData: { manualCapture: 'true' },    // authorize now, capture on shipment
    };
    const session = await checkout.PaymentsApi.sessions(request, { idempotencyKey: `session-${cart.id}` });
    return { id: session.id, sessionData: session.sessionData }; // + session.url when mode: 'hosted'
}
```

## Client

```tsx
"use client";
import { useEffect, useRef } from "react";
import { AdyenCheckout, Dropin } from "@adyen/adyen-web/auto";
import "@adyen/adyen-web/styles/adyen.css";

export function AdyenPay({ session, cartId, amount, country, locale }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        // initialise once, client side only
        let dropin: Dropin | undefined;
        AdyenCheckout({
            session,
            amount,
            countryCode: country,
            locale, // countryCode is mandatory in v6
            environment: "test",
            clientKey: process.env.NEXT_PUBLIC_ADYEN_CLIENT_KEY!,
            onPaymentCompleted: (r) => location.assign(`/order/cart/${cartId}?rc=${r.resultCode}`),
            onPaymentFailed: (r) => alert(r.resultCode), // Refused | Cancelled | Error
        }).then((checkout) => {
            dropin = new Dropin(checkout).mount(ref.current!);
        });
        return () => dropin?.unmount();
    }, []);
    return <div ref={ref} />;
}
```

Redirect methods (Vipps, MobilePay, some 3DS) return to `returnUrl?sessionId=…&redirectResult=…`: create
`AdyenCheckout({ session: { id: sessionId }, … })`, call `checkout.submitDetails({ details: { redirectResult } })`
for a display `resultCode`, and **poll for the order** — the webhook creates it.

## Webhook

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

type Item = {
    pspReference: string;
    originalReference?: string;
    merchantAccountCode: string;
    eventDate: string;
    merchantReference: string;
    amount: { value: number; currency: string };
    eventCode: string;
    success: "true" | "false";
    paymentMethod?: string;
    additionalData?: Record<string, string>;
};

export async function verifyAdyen(req: Request): Promise<Item[]> {
    const basic = "Basic " + btoa(`${process.env.ADYEN_WEBHOOK_USER}:${process.env.ADYEN_WEBHOOK_PASSWORD}`);
    if (req.headers.get("authorization") !== basic) throw new Error("bad basic auth");
    const body = JSON.parse(await req.text()) as { notificationItems: { NotificationRequestItem: Item }[] };
    const key = Buffer.from(process.env.ADYEN_HMAC_KEY!, "hex");
    return body.notificationItems.map(({ NotificationRequestItem: i }) => {
        const signed = [
            i.pspReference,
            i.originalReference ?? "",
            i.merchantAccountCode,
            i.merchantReference,
            i.amount.value,
            i.amount.currency,
            i.eventCode,
            i.success,
        ].join(":");
        const expected = createHmac("sha256", key).update(signed, "utf8").digest();
        const received = Buffer.from(i.additionalData?.hmacSignature ?? "", "base64");
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("bad hmac");
        return i;
    });
}
```

The HMAC covers these fields, not the body bytes (`hmacValidator().validateHMAC(item, key)` does the same).
Header-signed webhooks (`hmacsignature`, e.g. `recurring.token.created`) sign the **raw body** instead.

```ts
// app/api/payments/adyen/webhook/route.ts
import { createOrderOnce } from "@/lib/crystallize-payments"; // from SKILL.md
import { toMajor, verifyAdyen } from "@/lib/adyen";

export const runtime = "nodejs";
const CAPTURES_LATER = false; // true when manualCapture or captureDelayHours is used

export async function POST(req: Request) {
    const items = await verifyAdyen(req).catch(() => null);
    if (!items) return new Response("unauthorized", { status: 401 });
    try {
        for (const i of items) {
            // a delivery can hold several items — handle all of them
            if (i.eventCode !== "AUTHORISATION" || i.success !== "true") continue; // refusals: 2xx, no order
            await createOrderOnce(i.merchantReference, CAPTURES_LATER ? "unpaid" : "paid", {
                provider: "adyen",
                method: i.paymentMethod ?? "unknown",
                transactionId: i.pspReference,
                amount: toMajor(i.amount.value, i.amount.currency),
                createdAt: i.eventDate,
                meta: [
                    { key: "state", value: CAPTURES_LATER ? "authorized" : "captured" },
                    { key: "checkoutSessionId", value: i.additionalData?.checkoutSessionId ?? "" },
                ],
            });
            // CAPTURE / CANCELLATION / REFUND: see the table and "Capture, refund, cancel".
        }
        return new Response("[accepted]"); // any 2xx; must arrive within 10 s
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 }); // retry queue: up to 30 days
    }
}
```

| Adyen `eventCode`                            | Crystallize ([SKILL.md](../SKILL.md#paymentstatus))                        |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `AUTHORISATION` `success=true`, auto capture | `createOrderOnce(…, 'paid', state=captured)`                               |
| `AUTHORISATION` `success=true`, manual       | `createOrderOnce(…, 'unpaid', state=authorized)`                           |
| `AUTHORISATION` `success=false`              | No order; answer 2xx (a 4xx/5xx makes Adyen retry for 30 days)             |
| `OFFER_CLOSED`                               | No order; shopper abandoned (card offers close after 12 h)                 |
| `CAPTURE` `success=true`                     | `setPayments` state=captured; Core `paymentStatus: paid` / `partiallyPaid` |
| `CAPTURE_FAILED`                             | Keep `unpaid`; alert a human                                               |
| `CANCELLATION` / `CANCEL_OR_REFUND`          | `setPayments` state=cancelled (or refund row if it was captured)           |
| `REFUND` `success=true`                      | `addPayments` type=refund; `partiallyRefunded` / `refunded`                |
| `REFUND_FAILED`, `CHARGEBACK`                | Alert a human                                                              |

Duplicates share `eventCode` + `pspReference`; order is not guaranteed — compare `eventDate`.

## Capture, refund, cancel

Pass `reference: cartId` on every modification. **UNVERIFIED:** Adyen's docs do not state that a
modification webhook's `merchantReference` echoes that reference. Do not depend on it: the webhook's
`originalReference` is the authorization's `pspReference`, which is the Crystallize payment's
`transactionId`. Store it on the order with `setMeta` (keys `adyenPspReference` and `cartId`) and, when
`merchantReference` is not a cart id, find the order with Core
`orders(filter: { meta: [{ key: "adyenPspReference", value: originalReference }] })` and read its
`cartId` meta — the Shop API order id the helpers take. All results arrive **asynchronously** by webhook.

```ts
const merchantAccount = process.env.ADYEN_MERCHANT_ACCOUNT!,
    amount = { value: toMinor(major, currency), currency };
// Capture (manual capture). A partial capture cancels the remainder unless Adyen enabled multiple partial captures.
await checkout.ModificationsApi.captureAuthorisedPayment(
    psp,
    { merchantAccount, amount, reference: cartId },
    { idempotencyKey: `capture-${psp}` },
); // → CAPTURE → setPayments + Core paymentStatus
// Refund a captured payment (partial allowed; up to 40 business days to reach the shopper).
await checkout.ModificationsApi.refundCapturedPayment(
    psp,
    { merchantAccount, amount, reference: cartId },
    { idempotencyKey: `refund-${psp}-${refundNo}` },
); // → REFUND → addPayments type=refund
// Cancel an uncaptured authorization; use /reversals when unsure whether it was captured.
await checkout.ModificationsApi.cancelAuthorisedPaymentByPspReference(
    psp,
    { merchantAccount, reference: cartId },
    { idempotencyKey: `cancel-${psp}` },
); // → CANCELLATION → setPayments state=cancelled
```

Delayed auto-capture: `captureDelayHours` (≤ 672) + the `CAPTURE` event. See [SKILL.md](../SKILL.md#paymentstatus).

## Mapping

```ts
{
    provider: 'adyen',
    method: item.paymentMethod,        // visa, mc, amex, vipps, mobilepay, klarna, swish, applepay, googlepay, …
    transactionId: item.pspReference,  // the payment's PSP reference — capture, cancel and refund use it
    amount: toMajor(item.amount.value, item.amount.currency), // MAJOR units
    createdAt: item.eventDate,
    meta: [{ key: 'state', value: 'captured' }, // authorized | captured | cancelled
        { key: 'checkoutSessionId', value: item.additionalData?.checkoutSessionId ?? '' }],
}
```

Refund record: `transactionId` = the REFUND webhook's `pspReference`, `amount` = refunded major amount,
`meta: [{ key: 'type', value: 'refund' }, { key: 'paymentPspReference', value: item.originalReference }]`.

## Gotchas

- v72 rejects `reference` > 80 chars, `metadata` key > 20 / value > 80, `returnUrl` > 1024 chars, postal
  codes > 10 chars, and moved enhanced scheme data from `additionalData` to `enhancedSchemeData`.
- `success`, `live`, `manualCapture` are **strings**. Answer within **10 s** or events pile into the retry queue.
- Initialise Drop-in once, client side, on a ref, not in an iframe. `countryCode` = shipping country.
- Web v6 removed `checkout.create('dropin')` and the default import; `onPaymentCompleted` no longer fires
  for failures (`onPaymentFailed` does); `setStatusAutomatically` is gone (`disableFinalAnimation`).
- In the old furniture boilerplates:
    - `receivePaymentEvent.ts` + `handleAdyenWebhookRequestPayload` **verify nothing** (the code's own TODO
      says so): anyone could POST `AUTHORISATION success=true` and get an order.
    - It `return`s inside the `notificationItems` loop (only the first item is handled) and throws on
      `success !== 'true'`, so Adyen retries refusals for 30 days.
    - `countryCode` is guessed from currency (`NOK→NO, USD→US, else FR`); no `shopperEmail` or `lineItems`
      (blocks Klarna); `amount.value: cart.total.gross * 100` is unrounded.
    - `adyen.tsx` uses Web v5 (`AdyenCheckout(...)` default import, `checkout.create('dropin')`); furnitut
      pins `@adyen/adyen-web@^5.69`. The return page never calls `submitDetails`.
    - Orders use `provider: 'custom', custom: { properties }` via the deprecated request handlers.

[sessions]: https://docs.adyen.com/online-payments/build-your-integration/sessions-flow
[hosted]: https://docs.adyen.com/online-payments/build-your-integration/?platform=Web&integration=Hosted+Checkout
[v72]: https://docs.adyen.com/online-payments/upgrade-your-integration/upgrade-to-checkout-api-v72
[web6]: https://docs.adyen.com/online-payments/upgrade-your-integration/upgrade-to-web-v6
[webhooks]: https://docs.adyen.com/development-resources/webhooks/handle-webhook-events
[hmac]: https://docs.adyen.com/development-resources/webhooks/secure-webhooks/verify-hmac-signatures
[capture]: https://docs.adyen.com/online-payments/capture
[refund]: https://docs.adyen.com/online-payments/refund
[currency]: https://docs.adyen.com/development-resources/currency-codes
[openapi]: https://github.com/Adyen/adyen-openapi/blob/main/json/CheckoutService-v72.json
