# Adyen with Crystallize

Adyen is a Dutch global payment platform (cards, Apple Pay, Google Pay and local methods such as iDEAL, Klarna, Vipps,
MobilePay, Swish, Trustly) that onboards merchants per legal entity and sells in most currencies. The recommended
integration is the Sessions flow: one server-side `/sessions` call from the placed cart (Checkout API v72), the Web
Drop-in (`@adyen/adyen-web` v6) on the checkout page, and the order created from the HMAC-signed `AUTHORISATION`
webhook. Capture is automatic by default; for methods that support separate capture, manual capture (authorize now,
capture on shipment) or a delayed automatic capture is set per merchant account or per session.

> Verification: Written from Adyen's official docs, checked 2026-10-06. Not run end-to-end.
> Official docs: [Sessions flow][sessions], [Checkout API v72][v72], [Web v6][web6], [Handle webhooks][handle],
> [Verify HMAC][hmac], [Capture][capture], [Refund][refund], [Cancel][cancel], [Currency codes][currency]. Every page
> is served as Markdown (append `.md`); the index is [llms.txt](https://docs.adyen.com/llms.txt).

## At a glance

|                           |                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markets & currencies      | Global; any currency in Adyen's [table][currency]. Payment methods are enabled per merchant account                                                                                |
| Recommended integration   | Sessions flow: `POST /sessions` on the server + Web Drop-in v6 on the page (it handles 3D Secure and redirects)                                                                    |
| Alternative               | Hosted Checkout: the same `/sessions` with `mode: "hosted"` + `themeId`, then redirect to the returned `url` ([guide][hosted])                                                     |
| API version               | Checkout API **v72** (April 2026: validates `reference`, `returnUrl`, `shopperEmail`, postal codes; enhanced scheme data moved)                                                    |
| SDKs                      | Browser `@adyen/adyen-web@6.46` (v6 needs API ≥ v69). Server `@adyen/api-library@32` (v72, Node ≥ 18) or plain `fetch`, shown here                                                 |
| Amount units              | Integer minor units by **Adyen's** table: JPY, KRW, IDR, CVE… 0; BHD, KWD, JOD, OMR, TND… 3; ISK and CLP **2** (ISO says 0)                                                        |
| Capture                   | Auto by default; manual, or delayed (`captureDelayHours` ≤ 672). Adyen expires authorisations after 28 days; Visa e-commerce 10, Mastercard final 7, Amex 7 ([validity][validity]) |
| Cart id                   | `reference` (≥ 3, ≤ 80 chars; a cart UUID is 36), echoed as the webhook's `merchantReference`                                                                                      |
| One session per cart      | `Idempotency-Key: session-<cartId>` (≤ 64 chars, remembered 7–14 days). Adyen does not refuse a repeated `reference`                                                               |
| Notification verification | Basic auth on the endpoint + HMAC-SHA256 of each item (8 fields, hex key), Base64 in `additionalData.hmacSignature`                                                                |

## Credentials and setup

- **Test account**: sign up at adyen.com for a test Customer Area (<https://ca-test.adyen.com>). The crystallize.com
  page names two values, both under **Developers → API credentials** → your credential ([docs][credentials]):
    - **API key** (Server settings → Authentication → Generate API key): server only, sent as `X-API-Key`; shown
      once.
    - **Client key** (Client settings → Authentication, `test_…` / `live_…`): public, for Drop-in. Add **allowed
      origins** there (`http://localhost:3000` works in test; live needs `https`) or Drop-in will not load.
- **Merchant account**: its name goes in every request (`YourCompanyECOM`). Add the payment methods you want to it.
  Capture mode: **Settings → Account settings → Capture delay** (immediate, 1–7 days, Manual).
- **HMAC key**: **Developers → Webhooks → Create new webhook → Standard webhook** (company level, limited to your
  merchant account), URL `https://<host>/api/payments/adyen/webhook`, method JSON, **Basic authentication** user and
  password, **HMAC key → Generate** (hex). Live has its own webhook, HMAC key, API key and client key.
- **Test data** ([cards][test-cards]): `4111 1111 1111 1111`, `03/2030`, `737`; 3DS2-enrolled `4917 6100 0000 0000`;
  holder name `DECLINED` forces a refusal (show the field with `hasHolderName: true`) ([result codes][test-results]).
- **Reaching localhost**: the webhook URL must be public and must not redirect (test: HTTP on 80/8080/8888 or HTTPS on
  443/8443/8843; live: HTTPS only). Use a tunnel (ngrok, cloudflared); **Test configuration** sends sample events.

```bash
ADYEN_API_KEY=AQE…
ADYEN_CHECKOUT_URL=https://checkout-test.adyen.com/v72  # live: https://<prefix>-checkout-live.adyenpayments.com/…/v72
ADYEN_MERCHANT_ACCOUNT=YourCompanyECOM
ADYEN_HMAC_KEY=44782DEF…
ADYEN_WEBHOOK_USERNAME=…
ADYEN_WEBHOOK_PASSWORD=…
PUBLIC_URL=https://shop.example                          # the tunnel in development
NEXT_PUBLIC_ADYEN_CLIENT_KEY=test_…
NEXT_PUBLIC_ADYEN_ENVIRONMENT=test                       # live, live-us, live-au, live-nea, live-in: prefix's region
```

Live base URL: `https://<prefix>-checkout-live.adyenpayments.com/checkout/v72`, the prefix from the live Customer
Area's **Developers → API URLs** ([live endpoints][live]).

## Create the payment

Call it from the Pay route right after `place`, which makes the cart immutable
([SKILL.md](../SKILL.md#lock-the-cart-before-you-charge)). The amount is the placed total, the `reference` the cart id.
`countryCode` filters the payment methods: take it from the cart's delivery address or the market the cart was priced
in, never from the currency. Klarna, Riverty, Afterpay, Affirm, Ratepay and Oney require `lineItems` that add up to
the amount exactly.

```ts
// lib/adyen.ts
import type { PlacedCart } from "@/lib/crystallize-payments";

export const MERCHANT = process.env.ADYEN_MERCHANT_ACCOUNT!;
/** Authorize at checkout, capture when the order ships. Keep it in step with the Customer Area's capture delay. */
export const CAPTURE_ON_SHIPMENT = true;

// Adyen's decimals win over ISO 4217 (ISK and CLP have 2 at Adyen).
const ZERO = ["CVE", "DJF", "GNF", "IDR", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"];
const THREE = ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"];
const exp = (c: string) => (ZERO.includes(c.toUpperCase()) ? 0 : THREE.includes(c.toUpperCase()) ? 3 : 2);
export const toMinor = (major: number, currency: string) => Math.round(major * 10 ** exp(currency));
export const toMajor = (minor: number, currency: string) => minor / 10 ** exp(currency);

/** POST to the Checkout API. A repeated key returns the first result; "704 in progress" and transient errors retry. */
export async function adyen<T>(path: string, body: object, idempotencyKey: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${process.env.ADYEN_CHECKOUT_URL}${path}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": process.env.ADYEN_API_KEY!,
                "Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify(body),
        });
        if (res.ok) return (await res.json()) as T;
        const text = await res.text();
        const retry = res.headers.get("transient-error") === "true" || /"errorCode"\s*:\s*"704"/.test(text);
        if (!retry || attempt === 3) throw new Error(`Adyen ${path} ${res.status}: ${text}`);
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
}

/** Unit amounts × quantity add up to the placed total; a line whose discount does not split per unit stays whole. */
function lineItems(placed: PlacedCart) {
    const c = placed.total.currency;
    const lines = placed.items.map((item) => {
        const gross = toMinor(item.price.gross, c); // line totals
        const net = toMinor(item.price.net, c);
        const qty = gross % item.quantity === 0 && net % item.quantity === 0 ? item.quantity : 1;
        return {
            id: item.variant?.sku ?? item.lineId ?? item.name,
            description: qty === item.quantity ? item.name : `${item.quantity} × ${item.name}`,
            quantity: qty,
            amountIncludingTax: gross / qty,
            amountExcludingTax: net / qty,
            taxAmount: (gross - net) / qty,
            taxPercentage: Math.round(item.price.taxPercent * 100), // basis points: 2500 = 25 %
        };
    });
    const rest = toMinor(placed.total.gross, c) - lines.reduce((s, l) => s + l.amountIncludingTax * l.quantity, 0);
    if (rest !== 0)
        lines.push({
            id: "adjustment",
            description: "Adjustment",
            quantity: 1,
            amountIncludingTax: rest,
            amountExcludingTax: rest,
            taxAmount: 0,
            taxPercentage: 0,
        });
    return lines;
}

type CartAddress = NonNullable<NonNullable<PlacedCart["customer"]>["addresses"]>[number];
const toAddress = (a?: CartAddress) =>
    // Adyen wants all five fields; postalCode ≤ 10 chars
    a?.street && a.city && a.postalCode && a.country
        ? {
              street: a.street,
              houseNumberOrName: a.streetNumber ?? "",
              postalCode: a.postalCode,
              city: a.city,
              country: a.country,
          }
        : undefined;

export async function createAdyenSession(
    placed: PlacedCart,
    market: { origin: string; country: string; locale: string }, // resolved on the server, not sent by the browser
) {
    const currency = placed.total.currency.toUpperCase();
    const c = placed.customer;
    const delivery = c?.addresses?.find((a) => a.type === "delivery");
    const countryCode = (delivery?.country ?? market.country).toUpperCase();
    const session = await adyen<{ id: string; sessionData: string }>(
        "/sessions",
        {
            merchantAccount: MERCHANT,
            amount: { currency, value: toMinor(placed.total.gross, currency) }, // the PLACED total
            reference: placed.id,
            returnUrl: `${market.origin}/order/cart/${placed.id}`, // ≤ 1024 chars, no PII
            countryCode, // Drop-in reads it, the amount and the locale from the session
            shopperLocale: market.locale, // e.g. nb-NO
            channel: "Web",
            shopperEmail: c?.email, // risk checks and 3DS; v72 rejects a malformed one
            lineItems: lineItems(placed), // with the four below, what Klarna, Riverty and Afterpay need
            shopperName: c?.firstName && c.lastName ? { firstName: c.firstName, lastName: c.lastName } : undefined,
            telephoneNumber: c?.phone?.startsWith("+") ? c.phone : undefined,
            deliveryAddress: toAddress(delivery),
            billingAddress: toAddress(c?.addresses?.find((a) => a.type === "billing")),
            ...(placed.meta?.paymentMethod ? { allowedPaymentMethods: [placed.meta.paymentMethod] } : {}),
            ...(CAPTURE_ON_SHIPMENT && { additionalData: { manualCapture: "true" } }), // a string, not a boolean
        },
        `session-${placed.id}`, // one session per cart: a second tab gets the same session back
    );
    return { id: session.id, sessionData: session.sessionData }; // all the page needs; nothing secret
}
```

The Pay route answers `Response.json(await createAdyenSession(placed, { origin: process.env.PUBLIC_URL!, ...market }))`.
A session lives 1 hour (`expiresAt`, at most 24): a shopper who comes back later gets a new cart, as in
[SKILL.md](../SKILL.md#lock-the-cart-before-you-charge), never a second key for the same placed cart.

## Client

Initialise Drop-in once, client side, on a ref (not with selectors, not in an iframe on another domain).
`@adyen/adyen-web/auto` shows every method enabled on the merchant account; import from `@adyen/adyen-web` and pass
`paymentMethodComponents: [Card, …]` to `Dropin` for a smaller bundle.

```tsx
// app/checkout/adyen.tsx
"use client";
import { useEffect, useRef } from "react";
import { AdyenCheckout, Dropin, type CoreConfiguration } from "@adyen/adyen-web/auto";
import "@adyen/adyen-web/styles/adyen.css";

const config = {
    environment: (process.env.NEXT_PUBLIC_ADYEN_ENVIRONMENT ?? "test") as CoreConfiguration["environment"],
    clientKey: process.env.NEXT_PUBLIC_ADYEN_CLIENT_KEY!,
};

export function AdyenDropin({ cartId, session }: { cartId: string; session: { id: string; sessionData: string } }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        let dropin: Dropin | undefined;
        let gone = false; // React strict mode mounts twice
        AdyenCheckout({
            ...config,
            session, // v6 requires a countryCode: with a session it comes from /sessions, like amount and locale
            onPaymentCompleted: () => location.assign(`/order/cart/${cartId}`), // Authorised, Pending, Received
            onPaymentFailed: (r) => console.warn(r?.resultCode), // Refused, Cancelled, Error: the shopper can retry
            onError: (e) => console.error(e.name, e.message),
        }).then((checkout) => {
            if (!gone && ref.current) dropin = new Dropin(checkout).mount(ref.current);
        });
        return () => {
            gone = true;
            dropin?.unmount();
        };
    }, [cartId, session]);
    return <div ref={ref} />;
}

/** On the return page, once, after a redirect (iDEAL, Vipps, MobilePay, some 3D Secure): completes the payment. */
export async function finishAdyenRedirect(onResult: (resultCode?: string) => void) {
    const q = new URLSearchParams(location.search);
    const [sessionId, redirectResult] = [q.get("sessionId"), q.get("redirectResult")];
    if (!sessionId || !redirectResult) return;
    history.replaceState(null, "", location.pathname); // a reload must not submit it twice
    const checkout = await AdyenCheckout({
        ...config,
        session: { id: sessionId },
        onPaymentCompleted: (r) => onResult(r.resultCode),
        onPaymentFailed: (r) => onResult(r?.resultCode),
    });
    checkout.submitDetails({ details: { redirectResult } });
}
```

`/order/cart/[cartId]` is the [return page](../SKILL.md#the-return-page): it takes the cart id from its own URL (a
redirect can land in another browser, without your cookie), only reads the cart and waits until it is `ordered`. It
calls `finishAdyenRedirect` in an effect, so a redirect method completes and a refusal shows at once ("try again"
leads back to the same placed cart and session) instead of waiting forever.

## Webhook

Adyen signs each `NotificationRequestItem`, not the body: HMAC-SHA256 with the hex-decoded key over
`pspReference:originalReference:merchantAccountCode:merchantReference:value:currency:eventCode:success` (empty string
for a missing field), Base64 in `additionalData.hmacSignature`. It does not cover `paymentMethod`, `eventDate` or
`additionalData`; basic auth and TLS protect those. (`hmacValidator` in `@adyen/api-library` does the same check.)
Keep accepting the previous key for a while after rotating it.

```ts
// lib/adyen.ts (continued)
import { createHmac, timingSafeEqual } from "node:crypto";

export type AdyenItem = {
    eventCode: string;
    success: "true" | "false";
    pspReference: string;
    originalReference?: string;
    merchantAccountCode: string;
    merchantReference: string;
    amount: { value: number; currency: string };
    eventDate: string;
    paymentMethod?: string;
    reason?: string;
    additionalData?: Record<string, string>;
};
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

function validHmac(i: AdyenItem, hexKey: string) {
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
    const expected = createHmac("sha256", Buffer.from(hexKey, "hex")).update(signed, "utf8").digest();
    return same(Buffer.from(i.additionalData?.hmacSignature ?? "", "base64"), expected);
}

/** Basic auth, then the HMAC of EVERY item. null → answer 401. */
export function verifyAdyen(authorization: string | null, raw: string): AdyenItem[] | null {
    const user = Buffer.from(`${process.env.ADYEN_WEBHOOK_USERNAME}:${process.env.ADYEN_WEBHOOK_PASSWORD}`);
    if (!same(Buffer.from(authorization ?? ""), Buffer.from(`Basic ${user.toString("base64")}`))) return null;
    let items: AdyenItem[];
    try {
        const body = JSON.parse(raw) as { notificationItems?: { NotificationRequestItem: AdyenItem }[] };
        items = (body.notificationItems ?? []).map((n) => n.NotificationRequestItem);
    } catch {
        return null;
    }
    const keys = [process.env.ADYEN_HMAC_KEY, process.env.ADYEN_HMAC_KEY_PREVIOUS].filter((k): k is string => !!k);
    return items.length > 0 && items.every((i) => keys.some((k) => validHmac(i, k))) ? items : null;
}
```

On a successful `AUTHORISATION`, `createOrderOnce` does what the crystallize.com page lists: it creates the customer in
Crystallize if missing, creates the order, and moves the cart from `placed` to `ordered`, which releases the waiting
order page.

```ts
// app/api/payments/adyen/webhook/route.ts
import { createOrderOnce, recordPayment, updatePayment, withMeta } from "@/lib/crystallize-payments";
import { CAPTURE_ON_SHIPMENT, MERCHANT, toMajor, verifyAdyen, type AdyenItem } from "@/lib/adyen";

export const runtime = "nodejs";
const CART_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_SEPARATE_CAPTURE = new Set(["ideal", "swish", "trustly"]); // captured at authorisation even when manual

export async function POST(req: Request) {
    const raw = await req.text();
    const items = verifyAdyen(req.headers.get("authorization"), raw);
    if (!items) return new Response("unauthorized", { status: 401 });
    try {
        for (const item of items) await handle(item); // every item, not only the first
        return new Response("[accepted]"); // any 2xx, within 10 seconds
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 }); // Adyen retries, then queues for up to 30 days
    }
}

async function handle(i: AdyenItem) {
    // A company-level webhook also carries other merchant accounts and POS payments with non-cart references.
    if (i.merchantAccountCode !== MERCHANT || !CART_ID.test(i.merchantReference)) return;
    const cartId = i.merchantReference;
    const ok = i.success === "true";
    const amount = toMajor(i.amount.value, i.amount.currency);
    const payment = i.originalReference ?? i.pspReference; // the authorisation = the record's transactionId
    const set = (values: Record<string, string>, to?: number) =>
        updatePayment(cartId, payment, (p) => withMeta(p, values, to));
    const log = () => console.error(`[adyen] ${i.eventCode} ${i.success} ${payment} cart ${cartId}: ${i.reason}`);
    const action = i.additionalData?.["modification.action"]; // CANCEL_OR_REFUND (from /reversals): cancel | refund
    const event = i.eventCode === "CANCEL_OR_REFUND" ? `REVERSAL_${action}` : i.eventCode;

    if (event === "AUTHORISATION" && ok) {
        const later = CAPTURE_ON_SHIPMENT && !NO_SEPARATE_CAPTURE.has(i.paymentMethod ?? "");
        return createOrderOnce(cartId, later ? "unpaid" : "paid", {
            provider: "adyen",
            method: i.paymentMethod ?? "unknown",
            transactionId: i.pspReference,
            amount,
            createdAt: i.eventDate,
            meta: [
                { key: "state", value: later ? "authorized" : "captured" },
                { key: "cartId", value: cartId },
                { key: "currency", value: i.amount.currency }, // capture() needs it
            ],
        });
    }
    if (event === "CAPTURE" && ok) return set({ state: "captured" }, amount);
    if (event === "CAPTURE" || event === "CAPTURE_FAILED") {
        log(); // a refused capture: the money is still only authorized
        return set({ state: "authorized", attention: "capture-failed" });
    }
    if (["CANCELLATION", "EXPIRE", "REVERSAL_cancel"].includes(event)) return ok ? set({ state: "cancelled" }) : log();
    if (event === "REFUND" || event === "REVERSAL_refund") {
        if (!ok) return log();
        return recordPayment(cartId, {
            provider: "adyen",
            method: i.paymentMethod,
            transactionId: i.pspReference, // the refund's own pspReference
            amount,
            createdAt: i.eventDate,
            meta: [
                { key: "type", value: "refund" },
                { key: "cartId", value: cartId },
                { key: "paymentPspReference", value: payment },
            ],
        });
    }
    if (["REFUND_FAILED", "REFUNDED_REVERSED", "CHARGEBACK", "NOTIFICATION_OF_CHARGEBACK"].includes(event)) log();
    // AUTHORISATION success=false: refused — no order, the placed cart stays, the shopper retries. Others: ignored.
}
```

| Adyen `eventCode`                                     | Crystallize ([SKILL.md](../SKILL.md#paymentstatus))                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AUTHORISATION` `true`, auto capture or iDEAL/Swish…  | `createOrderOnce(…, 'paid', …)`, `state=captured`                                        |
| `AUTHORISATION` `true`, manual or delayed capture     | `createOrderOnce(…, 'unpaid', …)`, `state=authorized`                                    |
| `AUTHORISATION` `false`, `OFFER_CLOSED` (opt-in)      | Nothing; answer 2xx (a non-2xx makes Adyen retry for 30 days)                            |
| `CAPTURE` `true`                                      | `updatePayment` → `state=captured`, captured amount. Not sent for immediate auto-capture |
| `CAPTURE` `false`, `CAPTURE_FAILED`                   | `updatePayment` → `state=authorized`, `attention=capture-failed`; a human retries        |
| `CANCELLATION`, `EXPIRE`, `CANCEL_OR_REFUND` (cancel) | `updatePayment` → `state=cancelled`; move the order to your cancelled stage              |
| `REFUND` `true`, `CANCEL_OR_REFUND` (refund)          | `recordPayment` with `meta type=refund`                                                  |
| `REFUND_FAILED`, `REFUNDED_REVERSED`, `CHARGEBACK`…   | Log for a human; answer 2xx                                                              |

Duplicates share `eventCode` and `pspReference` and may arrive out of order (`eventDate` tells); every write above is
idempotent. JSON webhooks carry one item today (SOAP up to six): loop anyway. Past 10 seconds the event goes to the
retry queue — safe, for the same reason.

## Capture, refund, cancel

Each call answers `"status": "received"`; the outcome arrives by webhook. Pass the cart id as `reference`: Adyen's
refund example echoes a modification's `reference` as the webhook's `merchantReference` (for modifications made in the
Customer Area without a reference this is unconfirmed — the `CART_ID` check then skips them).

```ts
// lib/adyen.ts (continued)
/** captureByProvider.adyen. Adyen needs the currency: pass the payment record (meta `currency`, `cartId`). */
export async function capture(transactionId: string, amount: number, record?: Record<string, string>) {
    const currency = record?.currency;
    if (!currency) throw new Error(`Adyen capture ${transactionId}: the record has no currency`);
    const value = toMinor(amount, currency);
    const body = { merchantAccount: MERCHANT, amount: { currency, value }, reference: record?.cartId };
    await adyen(`/payments/${transactionId}/captures`, body, `capture-${transactionId}`);
    return null; // asynchronous: the CAPTURE webhook writes state=captured, or flags capture-failed
}

/** `n` numbers your refunds of this payment: a retry with the same n never refunds twice. */
export async function refund(cartId: string, transactionId: string, amount: number, currency: string, n = 1) {
    const value = toMinor(amount, currency);
    const res = await adyen<{ pspReference: string }>(
        `/payments/${transactionId}/refunds`,
        { merchantAccount: MERCHANT, amount: { currency, value }, reference: cartId },
        `refund-${transactionId}-${n}`,
    );
    return res.pspReference; // the REFUND webhook records it
}

/** Before capture (a "Cancelled" stage). Use /reversals when you do not know whether it was captured. */
export async function cancel(cartId: string, transactionId: string) {
    await adyen(
        `/payments/${transactionId}/cancels`,
        { merchantAccount: MERCHANT, reference: cartId },
        `cancel-${transactionId}`,
    ); // the CANCELLATION webhook sets state=cancelled
}
```

The [pipeline handler](../SKILL.md#capture-on-shipment-from-fulfilment-pipelines) must call
`captureByProvider.adyen(authorized.transactionId, Number(authorized.amount), authorized)`: the third argument
carries the currency. `capture` returns `null`, so the handler writes nothing; the `CAPTURE` webhook sets
`state=captured`, and a redelivered stage webhook re-sends the same idempotency key, which never captures twice. A
**partial** capture cancels the rest of the authorisation unless Adyen Support enables multiple partial captures.
Refunds may be partial and repeated, never above the captured amount, and take up to 40 business days to reach the
shopper. For delayed automatic capture, send `captureDelayHours` (or set 1–7 days in the Customer Area) instead of
`manualCapture`, keep `CAPTURE_ON_SHIPMENT` so the order starts `authorized`, do not capture those orders from the
pipeline, and enable the `CAPTURE` event under **Developers → Webhooks → Settings** and on the Standard webhook: its
`CAPTURE` webhook flips the record.

## Mapping

```ts
{
    provider: 'adyen',
    method: item.paymentMethod,         // visa, mc, amex, applepay, klarna, vipps, mobilepay, swish, ideal, …
    transactionId: item.pspReference,   // the authorisation's pspReference: capture, refund and cancel take it
    amount: toMajor(item.amount.value, item.amount.currency), // MAJOR units
    createdAt: item.eventDate,
    meta: [{ key: 'state', value: 'authorized' },  // authorized | captured | cancelled
        { key: 'cartId', value: cartId }, { key: 'currency', value: 'NOK' }],
}
```

Refund record: `transactionId` = the `REFUND` webhook's `pspReference`, `amount` = refunded major amount, meta
`type=refund`, `cartId`, `paymentPspReference` ([the payment record](../SKILL.md#the-payment-record)).

## Provider specifics

**A payment method chosen before `place`.** If the storefront has its own "Card / Vipps / Klarna" chooser, store the
choice on the cart before `place`; `createAdyenSession` turns it into `allowedPaymentMethods`. Values are Adyen's
[types][pm-types]: `scheme` (cards), `applepay`, `googlepay`, `klarna`, `klarna_account`, `klarna_paynow`, `vipps`,
`mobilepay`, `swish`, `ideal`, `trustly`.

```ts
await carts.setMeta(cartId, { meta: [{ key: "paymentMethod", value: "vipps" }], merge: true }); // before place
```

**Nordic and local methods** run inside Drop-in (redirect, app switch or QR) once added to the merchant account: Vipps
needs `NO`/NOK, MobilePay `DK` or `FI` with DKK/EUR, Swish `SE`/SEK, iDEAL `NL`/EUR. Vipps, MobilePay and Klarna
support separate capture; iDEAL, Swish and Trustly do not, so the webhook records them as captured.

**Klarna, Riverty, Afterpay** refuse a session without `lineItems`, `shopperName`, `telephoneNumber` (with `+`) and
the addresses: `createAdyenSession` sends them from the customer set on the cart before `place`.

**3D Secure** runs natively in Drop-in. A strict Content-Security-Policy blocks its challenge: allow it, or send
`authenticationData: { threeDSRequestData: { nativeThreeDS: "disabled" } }` on `/sessions` to use a redirect.

**Stored cards and recurring** (after payment): `/sessions` with a non-PII `shopperReference`,
`storePaymentMethodMode: "askForConsent"` and `recurringProcessingModel` (`CardOnFile`, `Subscription`,
`UnscheduledCardOnFile`). The token comes in the Recurring tokens life cycle webhook, signed over the **raw body** in an
`hmacsignature` header; charge it with `POST /payments`, `storedPaymentMethodId`, `shopperInteraction: "ContAuth"`
([tokenization][tokenization]).

## Going further

- **Hosted Checkout**: `/sessions` with `mode: "hosted"` and a `themeId`, redirect to `url`; webhook, capture and refund
  stay the same ([guide][hosted]). **Advanced flow** (`/paymentMethods`, `/payments`, `/payments/details`) for control
  between steps ([advanced flow][advanced]).
- **Express checkout** (Apple Pay, Google Pay, PayPal with shipping in the wallet sheet): the shopper picks shipping at
  Adyen, so Adyen charges more than the placed cart and the order has no shipping line. Choose shipping in the
  storefront before `place` unless you rebuild that flow deliberately.
- **Gift cards and partial payments**: one cart is paid by several `AUTHORISATION`s and closed by `ORDER_CLOSED`;
  `createOrderOnce` would flag the second as a duplicate. Create the order on `ORDER_CLOSED` `success=true` instead
  ([partial payments][partial]).
- **Changing the amount after the session** (`payable: false`, then `PATCH /sessions/{id}`, v72): with Crystallize,
  place the final cart instead. **Authorisation adjustment** for goods shipped after the scheme's validity
  ([validity][validity]).
- **Pay by Link** (`POST /paymentLinks`) for call-centre orders, with a placed cart id as `reference`.
- **Webhook hardening**: OAuth 2.0 instead of basic auth, Adyen's IP ranges in an allowlist ([secure webhooks][secure]).
- **Go live**: new API key, client key, webhook and HMAC key; the live URL prefix; a Drop-in `environment` matching the
  prefix's region, and every call of a session on that region. **Disputes**: dispute webhooks and the Disputes API.

## Common mistakes

- Accepting the webhook without checking basic auth **and** every item's `hmacSignature`: anyone could POST
  `AUTHORISATION success=true` and get an order.
- Handling only the first item of `notificationItems` (a `return` inside the loop).
- Answering 403 or another non-2xx to a refused payment (Adyen retries it for 30 days), answering with the created
  order as the body, or working past 10 seconds: refusals get a 2xx and no order, everything gets `[accepted]` fast.
- Guessing `countryCode` from the currency (`NOK → NO`, else `FR`): it hides payment methods and breaks Vipps, Swish,
  Klarna. Use the delivery address or the market.
- `cart.total.gross * 100` without `Math.round`, and two decimals for every currency (JPY has 0, KWD 3).
- Creating the session even though `place` failed, or a new session on every render or cart change.
- Web v5 code (`import AdyenCheckout from '@adyen/adyen-web'`, `checkout.create('dropin')`, no `countryCode`): v6 uses
  named imports, `new Dropin(checkout)` and `onPaymentFailed` for failures.
- A return page that never calls `submitDetails` with `redirectResult`, or that creates the order from `resultCode`.
- `manualCapture: true` as a boolean, or never capturing (authorisations expire); recording iDEAL, Swish or Trustly
  payments as "authorized" when they were captured at once.
- Reading `operations` from the `AUTHORISATION` webhook to decide anything: Adyen marks it experimental.

[sessions]: https://docs.adyen.com/online-payments/build-your-integration/sessions-flow
[v72]: https://docs.adyen.com/online-payments/upgrade-your-integration/upgrade-to-checkout-api-v72
[web6]: https://docs.adyen.com/online-payments/upgrade-your-integration/upgrade-to-web-v6
[handle]: https://docs.adyen.com/development-resources/webhooks/handle-webhook-events
[hmac]: https://docs.adyen.com/development-resources/webhooks/secure-webhooks/verify-hmac-signatures
[secure]: https://docs.adyen.com/development-resources/webhooks/secure-webhooks
[capture]: https://docs.adyen.com/online-payments/capture
[refund]: https://docs.adyen.com/online-payments/refund
[cancel]: https://docs.adyen.com/online-payments/cancel
[currency]: https://docs.adyen.com/development-resources/currency-codes
[validity]: https://docs.adyen.com/online-payments/adjust-authorisation#validity
[hosted]: https://docs.adyen.com/standard/integration/hosted-checkout
[advanced]: https://docs.adyen.com/online-payments/build-your-integration/advanced-flow
[partial]: https://docs.adyen.com/online-payments/partial-payments
[credentials]: https://docs.adyen.com/development-resources/api-credentials
[live]: https://docs.adyen.com/development-resources/live-endpoints
[test-cards]: https://docs.adyen.com/development-resources/test-cards-and-credentials/test-card-numbers
[test-results]: https://docs.adyen.com/development-resources/testing/result-codes
[pm-types]: https://docs.adyen.com/payment-methods/payment-method-types
[tokenization]: https://docs.adyen.com/online-payments/tokenization
