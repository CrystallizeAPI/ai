# Vipps MobilePay with Crystallize

Vipps MobilePay is the Nordic mobile wallet: Vipps in Norway (also used by Swedes), MobilePay in Denmark and Finland.
Any Nordic user can pay any Nordic merchant, in the currency of the merchant's sales unit (NOK, DKK or EUR). Integrate
it with the **ePayment API**: create a `WALLET` payment from the placed cart with the cart id as `reference`, open the
returned `redirectUrl` from the Widget SDK button (app switch on phones, landing page on desktop, QR on kiosk screens),
and create the order from the HMAC-signed `authorized` webhook. Every ePayment payment is reserve-capture: authorized
at checkout, captured when the goods ship.

> Verification: Written from Vipps MobilePay's official docs, checked 2026-10-06. Not run end-to-end.
> Official docs: [ePayment API][epayment], [Create payment][create], [Concepts][concepts], [Webhooks API][webhooks],
> [Webhook HMAC][hmac], [Capture][capture-kb], [Test environment][test], [Widget SDK][widget], [OpenAPI 1.8.5][spec].
> Vipps publishes an agent plugin (`claude plugin marketplace add vippsas/agent-toolkit`, then
> `claude plugin install vipps-developer@agent-toolkit`; [agent-toolkit][toolkit]) and serves every docs page as `.md`,
> indexed at <https://developer.vippsmobilepay.com/llms.txt>.

## At a glance

| Topic                     | Vipps MobilePay                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------- |
| Markets & currencies      | NO (Vipps, NOK), DK (MobilePay, DKK), FI (MobilePay, EUR); currency = the sales unit's  |
| Recommended integration   | ePayment API, `paymentMethod: WALLET`, `userFlow: WEB_REDIRECT`, Widget SDK button      |
| Alternative               | `QR` for customer-facing screens; `CARD` (Vipps card page, `WEB_REDIRECT`, not in test) |
| Not for new work          | eCom API v2 (Norway only, replaced); Checkout API v3 (sold to Kustom, May 2026)         |
| API version               | `/epayment/v1` (spec 1.8.5), `/webhooks/v1`, `POST /accesstoken/get`                    |
| SDKs                      | Server: none maintained (`@vippsmobilepay/sdk` 2.4.2 is from 2024): `fetch`. Widget SDK |
| Amount units              | Integer minor units. Min NOK 100, DKK 1, EUR 1; max 65 000 000                          |
| Capture + auth lifetime   | Always manual. NO 180 days, DK/FI 14; guaranteed until `captureGuaranteedUntil`         |
| Cart id field (+ max)     | `reference` = cart id (36 chars); `^[a-zA-Z0-9-]{8,64}$`, unique per sales unit (MSN)   |
| One session per cart      | Vipps refuses a reused `reference` (4150); `Idempotency-Key: create-<cartId>`           |
| Notification verification | Webhooks API HMAC-SHA256 over method, path, `x-ms-date`, host, `x-ms-content-sha256`    |

## Credentials and setup

The crystallize.com page lists four credentials, all in the [business portal][portal] → _For developers_ → _Test_ or
_Production_ → your sales unit → _Show keys_. Its "Vipps Express account" is outdated: order _Payment integration_
(ePayment) on vippsmobilepay.com, which comes with a test sales unit. Test and production keys differ, and each
country is its own sales unit: a shop selling in NOK and DKK has two MSNs and picks one by the placed cart's currency.

- **client id** and **client secret**: exchanged at `POST /accesstoken/get` for a Bearer token (1 h in test, 24 h in
  production; cache it). The page calls the client id public: keep all four on the server anyway.
- **merchant serial number** (MSN), sent as `Merchant-Serial-Number`; **subscription key**, `Ocp-Apim-Subscription-Key`.
- **Test app on a phone**: the orange MT app — iOS via [TestFlight](https://testflight.apple.com/join/hTAYrwea);
  Android: join the Google group `vipps-mobilepay-test-app`, then install `no.dnb.vipps.mt` with the same account. Make
  a test user (phone + national identity number, the sales unit's country) under _For developers_ → _Test users_; OTP
  `0000`/`000000`, PIN `1236`. Push is flaky in MT: open _Payments_ and pull to refresh.
- **Test data**: `POST /epayment/v1/test/payments/{reference}/approve` approves without the app (MT only, once the
  test user has approved one payment by hand). Amounts in øre/cents: `151` insufficient funds, `182` refused, `186`
  expired card, `201` unknown result for 1 h; a refund of `124` fails. In production, smoke-test with 2 NOK, not 1.
- **Webhook**: register **once** per environment, one registration for all events (Vipps orders deliveries per
  registration), and store the `secret` (shown once; lost → delete and register again). HTTPS, no redirects, a common
  port. Calls come from `callback-mt-1/2.vipps.no` (test) and `callback-[dr-]1..4.vipps.no` (production): allowlist
  hostnames, not IPs.
- **Localhost**: register a tunnel URL (cloudflared, ngrok) as an extra webhook (25 per event per MSN); delete it after.

```bash
# Register: vipps("POST", "/webhooks/v1/webhooks", { url: VIPPS_WEBHOOK_URL, events }) → { id, secret }, with events
# "epayments.payment.<name>.v1" for authorized, aborted, expired, terminated, captured, cancelled, refunded
VIPPS_BASE_URL=https://apitest.vipps.no      # production: https://api.vipps.no
VIPPS_CLIENT_ID=...
VIPPS_CLIENT_SECRET=...
VIPPS_SUBSCRIPTION_KEY=...
VIPPS_MSN=...
VIPPS_WEBHOOK_URL=https://shop.example/api/payments/vipps/webhook
VIPPS_WEBHOOK_SECRET=...
PUBLIC_URL=https://shop.example
```

## Create the payment

Call it after `place`, with the placed cart ([SKILL.md](../SKILL.md#lock-the-cart-before-you-charge)). The cart id is
the `reference`, so a cart gets **one** Vipps payment: a second tab gets the same live payment back. A declined card
is retried inside the app, in the same payment; once the payment is aborted, expired or terminated (going back from
the landing page cancels it), the shopper continues with a new cart holding the same items.

```ts
// lib/vipps.ts — server only
import type { PlacedCart } from "@/lib/crystallize-payments";

type Money = { currency: string; value: number }; // minor units
export type VippsPayment = {
    reference: string;
    state: "CREATED" | "AUTHORIZED" | "ABORTED" | "EXPIRED" | "TERMINATED"; // stays AUTHORIZED after capture
    amount: Money;
    aggregate: { authorizedAmount: Money; capturedAmount: Money; refundedAmount: Money; cancelledAmount: Money };
    paymentMethod: { type: "WALLET" | "CARD" };
    redirectUrl?: string;
    captureGuaranteedUntil?: string;
};

let token = { value: "", expiresAt: 0 }; // 1 h in test, 24 h in production

/** One Vipps API call: null on 404, throws otherwise (never log the headers). */
export async function vipps<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string) {
    const base = process.env.VIPPS_BASE_URL;
    const headers = {
        "Ocp-Apim-Subscription-Key": process.env.VIPPS_SUBSCRIPTION_KEY!,
        "Merchant-Serial-Number": process.env.VIPPS_MSN!,
        "Vipps-System-Name": "crystallize", // with -Version, -Plugin-Name, -Plugin-Version; each ≤ 30 chars
    };
    if (token.expiresAt - Date.now() < 60_000) {
        const secrets = { client_id: process.env.VIPPS_CLIENT_ID!, client_secret: process.env.VIPPS_CLIENT_SECRET! };
        const res = await fetch(`${base}/accesstoken/get`, { method: "POST", headers: { ...headers, ...secrets } });
        if (!res.ok) throw new Error(`Vipps access token: ${res.status}`);
        const json = (await res.json()) as { access_token: string; expires_on: string };
        token = { value: json.access_token, expiresAt: Number(json.expires_on) * 1000 };
    }
    const res = await fetch(`${base}${path}`, {
        method,
        headers: {
            ...headers,
            Authorization: `Bearer ${token.value}`,
            "Content-Type": "application/json",
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}), // ≤ 50 chars
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Vipps ${method} ${path} ${res.status}: ${await res.text()}`); // see ErrorCode
    return (await res.json()) as T;
}

export const getPayment = (reference: string) => vipps<VippsPayment>("GET", `/epayment/v1/payments/${reference}`);

export async function createVippsPayment(
    placed: PlacedCart,
    returnUrl: string, // carries the cart id, never a status
    userFlow: "WEB_REDIRECT" | "QR" | "NATIVE_REDIRECT" = "WEB_REDIRECT",
): Promise<Pick<VippsPayment, "state" | "redirectUrl">> {
    const reference = placed.id;
    const existing = await getPayment(reference);
    if (existing) return existing; // the caller decides by its state
    const body = {
        amount: { currency: placed.total.currency, value: Math.round(placed.total.gross * 100) }, // must match the MSN
        paymentMethod: { type: "WALLET" }, // or "CARD"
        reference,
        userFlow,
        returnUrl,
        paymentDescription: `Order ${reference.slice(0, 8)}`, // 3–100 chars, shown in the app
        ...(userFlow === "QR" ? { qrFormat: { format: "IMAGE/SVG+XML" } } : {}),
        // receipt: { orderLines, bottomLine }: order lines in the app, see Provider specifics
    };
    try {
        const res = await vipps<{ redirectUrl?: string }>("POST", "/epayment/v1/payments", body, `create-${reference}`);
        return { state: "CREATED", redirectUrl: res?.redirectUrl };
    } catch (error) {
        const raced = await getPayment(reference); // another tab created it first (4150)
        if (raced) return raced;
        throw error;
    }
}
```

The storefront's pay route is SKILL.md's; after `place` it ends with:

```ts
// app/api/checkout/pay/route.ts
const returnUrl = `${process.env.PUBLIC_URL}/checkout/vipps/return?cartId=${placed.id}`;
const payment = await createVippsPayment(placed, returnUrl);
if (payment.state === "CREATED") return Response.json({ redirectUrl: payment.redirectUrl });
if (payment.state === "AUTHORIZED") return Response.json({ redirectUrl: returnUrl }); // already paid
return Response.json({ error: "start-over" }, { status: 409 }); // spent: a new cart with the same items
```

## Client

Use the [Widget SDK][widget]: app switch on phones, the landing page in a Vipps dialog on desktop. The switch only
works when `redirectUrl` opens unchanged from the shopper's click, within about 3 seconds — never rewrite it, frame
it, open it from an effect or timer, or detect the app. The SDK's `success` event proves nothing.

```tsx
"use client";
import Script from "next/script";

export function VippsButton({ brand }: { brand: "vipps" | "mobilepay" }) {
    // brand: the sales unit's country — "vipps" for NO, "mobilepay" for DK and FI
    const mount = () => {
        const vipps = (window as any).vipps;
        vipps.consent({ rememberMe: false, analytics: false }); // then follow your cookie banner
        vipps.host().start(); // desktop dialog instead of a full-page redirect
        const pay = async () => {
            const res = await fetch("/api/checkout/pay", { method: "POST" });
            const { redirectUrl, error } = await res.json();
            if (!res.ok) throw new Error(error); // "start-over": copy the items into a new cart, then pay again
            return redirectUrl;
        };
        vipps.trigger(pay).button().brand(brand).mount("#vipps-button");
    };
    const src = "https://cdn.vippsmobilepay.com/js/widget-sdk/vipps-widget.js"; // not on npm; no SRI hash
    return (
        <>
            <Script src={src} data-vipps-widget-sdk onReady={mount} />
            <div id="vipps-button" />
        </>
    );
}
```

Closing the desktop dialog cancels the payment (`cancelPaymentOnClose: false` keeps it). After paying, the phone opens
`returnUrl` in its **default** browser, possibly without your cookie: the [return page](../SKILL.md#the-return-page)
takes the cart id from the URL (check it against `^[a-zA-Z0-9-]{8,64}$`) and polls a read-only endpoint every 2
seconds that answers `paid` when `readCart` says `ordered`, `failed` when `getPayment` says `ABORTED`, `EXPIRED` or
`TERMINATED` (offer a new cart), and `pending` otherwise (`AUTHORIZED` means the webhook is on its way).

## Webhook

Verify the HMAC over the raw body, then act on the event (`VippsEvent` in [Mapping](#mapping)). It has no
`paymentMethod`, so the `AUTHORIZED` branch fetches the payment.

```ts
// lib/vipps-webhook.ts
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const same = (a: string, b: string) =>
    Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function verifyVippsWebhook(req: Request, raw: string): boolean {
    const date = req.headers.get("x-ms-date") ?? "";
    const hash = req.headers.get("x-ms-content-sha256") ?? "";
    if (!same(createHash("sha256").update(raw, "utf8").digest("base64"), hash)) return false;
    const url = new URL(process.env.VIPPS_WEBHOOK_URL!); // the REGISTERED host and path, not req.url behind a proxy
    const signed = `POST\n${url.pathname}${url.search}\n${date};${url.host};${hash}`; // \n, never \r\n
    const sig = createHmac("sha256", process.env.VIPPS_WEBHOOK_SECRET!).update(signed, "utf8").digest("base64");
    const expected = `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${sig}`;
    return same(expected, req.headers.get("authorization") ?? "");
}
```

```ts
// app/api/payments/vipps/webhook/route.ts
import { createOrderOnce, recordPayment } from "@/lib/crystallize-payments";
import { getPayment, syncVippsRecord, vippsRecord, vippsRefund, type VippsEvent } from "@/lib/vipps";
import { verifyVippsWebhook } from "@/lib/vipps-webhook";

export async function POST(req: Request) {
    const raw = await req.text();
    if (!verifyVippsWebhook(req, raw)) return new Response("invalid signature", { status: 401 });
    const event = JSON.parse(raw) as VippsEvent;
    const cartId = event.reference;
    try {
        if (!event.success) return new Response("ignored"); // a failed operation changed nothing
        if (event.name === "AUTHORIZED") {
            const payment = await getPayment(cartId);
            if (payment?.state !== "AUTHORIZED") throw new Error(`Vipps ${cartId} is ${payment?.state}`);
            await createOrderOnce(cartId, "unpaid", vippsRecord(payment));
        } else if (event.name === "CAPTURED" || event.name === "CANCELLED") {
            await syncVippsRecord(cartId); // also catches captures and cancels made in the business portal
        } else if (event.name === "REFUNDED") {
            await recordPayment(cartId, vippsRefund(event)); // takes the cart lock itself
        } // ABORTED, EXPIRED, TERMINATED: no order
        return new Response("ok");
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 });
    }
}
```

Vipps retries any 4xx/5xx or an answer slower than **10 s**, backing off for 7 days; delivery is ordered per payment
per registration (a failing `AUTHORIZED` holds back its `CAPTURED`); a registration failing for 2 weeks is deleted —
watch _Webhook errors_ in the portal. Vipps also asks for polling as a backup: a scheduled job, not a request, that
calls `getPayment` for carts you sent to Vipps still `placed` after ~15 minutes and runs the `AUTHORIZED` branch. A
payment has 10 minutes to be approved: while it is `CREATED`, never cancel it or show "failed".

| `epayments.payment.<name>.v1`      | Crystallize ([paymentStatus](../SKILL.md#paymentstatus))                    |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `authorized`                       | `createOrderOnce(cartId, 'unpaid', …)` with `state=authorized`              |
| `captured`                         | `updatePayment` → `state=captured`, `amount` = `aggregate.capturedAmount`   |
| `cancelled`                        | `updatePayment` → `state=cancelled` (stays `captured` if part was captured) |
| `refunded`                         | `recordPayment`, `type=refund`, `transactionId` = event `pspReference`      |
| `aborted`, `expired`, `terminated` | No order; the cart's payment is spent: the shopper goes on with a new cart  |
| any event with `success: false`    | Nothing                                                                     |

## Capture, refund, cancel

The payment `state` stays `AUTHORIZED`; the money is in `aggregate` (minor units), returned by `GET` and by every
modification. Capture and refund take an `Idempotency-Key`, reused only to retry that same operation; cancel takes
none. Capture when the goods ship, and trust `capturedAmount`, not the HTTP status.

```ts
// lib/vipps.ts (continued)
import { updatePayment, withMeta } from "@/lib/crystallize-payments";

async function modify(op: "capture" | "refund", reference: string, amount: number, key: string) {
    const { currency } = (await getPayment(reference))!.amount;
    const modificationAmount = { currency, value: Math.round(amount * 100) };
    const path = `/epayment/v1/payments/${reference}/${op}`;
    return (await vipps<VippsPayment>("POST", path, { modificationAmount }, key))!;
}

/** captureByProvider["vipps-mobilepay"]. Returns the captured total in major units. */
export async function capture(transactionId: string, amount: number): Promise<number> {
    const key = `capture-${transactionId}`; // partial captures: one key per part, e.g. `capture-${transactionId}-2`
    const { aggregate } = await modify("capture", transactionId, amount, key);
    if (aggregate.capturedAmount.value < Math.round(amount * 100)) throw new Error("Vipps capture short: do not ship");
    return aggregate.capturedAmount.value / 100;
}

/** Up to the captured amount, within 365 days. `refundId` is yours (a return id, ≤ 43 chars). */
export const refund = (transactionId: string, amount: number, refundId: string) =>
    modify("refund", transactionId, amount, `refund-${refundId}`); // the `refunded` webhook records it

/** Releases everything not captured, as soon as you know you will not ship it. */
export async function cancel(transactionId: string) {
    await vipps("POST", `/epayment/v1/payments/${transactionId}/cancel`, {}).catch(async (error) => {
        const p = await getPayment(transactionId); // repeating a cancel that went through is fine
        if (!p || (p.aggregate.cancelledAmount.value === 0 && p.state !== "TERMINATED")) throw error;
    });
    await syncVippsRecord(transactionId);
}

/** Copies Vipps' aggregate onto the order's record (order id = cart id = reference). */
export async function syncVippsRecord(cartId: string) {
    const { aggregate } = (await getPayment(cartId))!;
    const captured = aggregate.capturedAmount.value;
    if (captured === 0 && aggregate.cancelledAmount.value === 0) return; // still only authorized
    await updatePayment(cartId, cartId, (p) =>
        captured > 0 ? withMeta(p, { state: "captured" }, captured / 100) : withMeta(p, { state: "cancelled" }),
    );
}
```

The [pipeline-stage handler](../SKILL.md#capture-on-shipment-from-fulfilment-pipelines) calls `capture`, then
`updatePayment`; a "Cancelled" stage calls `cancel`. DK/FI sales units must ask for partial capture. Capture attempts
are allowed for 180 days (NO) or 14 (DK/FI; _late capture_ on request) but only guaranteed until
`captureGuaranteedUntil`: Visa holds last 5–7 days, BankAxept 7 — capture the day you ship. A capture still failing
30 days after authorization will not succeed: contact the shopper.

## Mapping

```ts
// lib/vipps.ts (continued)
import type { Payment } from "@/lib/crystallize-payments";

export type VippsEvent = {
    reference: string; // = cart id
    name: "AUTHORIZED" | "CAPTURED" | "CANCELLED" | "REFUNDED" | "ABORTED" | "EXPIRED" | "TERMINATED" | "CREATED";
    amount: Money; // of this operation
    pspReference: string; // unique per event
    timestamp: string;
    success: boolean;
};

export const vippsRecord = (p: VippsPayment): Payment => ({
    provider: "vipps-mobilepay", // the captureByProvider key
    method: p.paymentMethod.type === "CARD" ? "card" : "wallet",
    transactionId: p.reference, // = cart id; capture, refund and cancel are keyed on it
    amount: p.amount.value / 100, // major units (NOK, DKK and EUR have 2 decimals)
    createdAt: new Date().toISOString(),
    meta: [
        { key: "state", value: "authorized" },
        { key: "cartId", value: p.reference },
        { key: "captureGuaranteedUntil", value: p.captureGuaranteedUntil ?? "" },
    ],
});

export const vippsRefund = (e: VippsEvent): Payment => ({
    provider: "vipps-mobilepay",
    method: "refund",
    transactionId: e.pspReference, // per event; the refund call's response carries the payment's pspReference
    amount: e.amount.value / 100,
    createdAt: e.timestamp,
    meta: [
        { key: "type", value: "refund" },
        { key: "cartId", value: e.reference },
    ],
});
```

## Provider specifics

**Choosing the user flow.** `WEB_REDIRECT` fits every website. The pay route may take a flow from the storefront —
never an amount — instead of the fixed `returnUrl` above:

```ts
const site = process.env.PUBLIC_URL;
const flows = {
    web: ["WEB_REDIRECT", `${site}/checkout/vipps/return`],
    qr: ["QR", `${site}/checkout/vipps/return`], // kiosk or in-store screen
    app: ["WEB_REDIRECT", `${site}/app/vipps-return`], // a universal link your app claims
    native: ["NATIVE_REDIRECT", "myshop://vipps-return"], // only for an app with no website
} as const;
const [userFlow, base] = flows[new URL(req.url).searchParams.get("flow") as keyof typeof flows] ?? flows.web;
const payment = await createVippsPayment(placed, `${base}?cartId=${placed.id}`, userFlow);
```

- **QR**: `redirectUrl` is then a link to the QR image (`IMAGE/SVG+XML`; `IMAGE/PNG` with `size` 100–2000;
  `TEXT/TARGETURL` to draw it yourself), dead with the payment after 10 minutes. Render
  `<img src={redirectUrl} width={280} height={280} alt="Scan with Vipps or MobilePay" />` and poll the status endpoint;
  in a store, also send `customerInteraction: "CUSTOMER_PRESENT"`.
- **Native app switch**: `POST /api/checkout/pay?flow=app`, then `await Linking.openURL(redirectUrl)` (React Native) —
  the operating system switches to Vipps or MobilePay; never a WebView. `returnUrl` brings the shopper back: a
  universal link (preferred) or, for apps without a website, your custom scheme with `NATIVE_REDIRECT`.
- **`PUSH_MESSAGE`** skips the landing page and needs `customer.phoneNumber` (`4712345678`). It requires approval and
  is only allowed on devices the shopper does not own (POS, vending) — not in a web shop.

**After payment:**

- **Receipts (order lines in the app)**: `POST /order-management/v2/ecom/receipts/{reference}` (`ecom` covers
  ePayment; immutable once sent, 409), or the same object as `receipt` in the create call ([order details][receipt]),
  which Vipps recommends. Body: `orderLines[]` with `name`, `id`, `totalAmount`, `totalAmountExcludingTax`,
  `totalTaxAmount`, `taxRate` (25 % → `2500`; `taxPercentage` 0–100 is deprecated), `unitInfo` (`unitPrice`, `quantity`
  as a string), `discount`, `isShipping` (your shipping external item), and `bottomLine` (`currency`, `receiptNumber`).
  Every amount is in minor units, taken from the placed cart's lines (`price.gross`, `price.taxAmount`); the lines must
  sum exactly to the payment amount — put the rounding drift on the last line — or the app shows none of them. A link
  button in the app: `PUT /order-management/v2/ecom/categories/{reference}` with `category` (`ORDER_CONFIRMATION`,
  `DELIVERY`, `RECEIPT`, …) and `orderDetailsUrl`. Read both back with `GET /order-management/v2/ecom/{reference}`.
- **Vipps MobilePay Login** (OpenID Connect; enable Login on the sales unit and register the exact `redirect_uri`):
  discovery at `{VIPPS_BASE_URL}/access-management-1.0/access/.well-known/openid-configuration`. Redirect to its
  `authorization_endpoint` with `client_id`, `response_type=code`, `scope=openid name email phoneNumber address`,
  `redirect_uri`, PKCE `S256` and a **random `state` per login** (≥ 8 chars, kept in an httpOnly cookie, compared on
  return — never a constant). Exchange the code at the `token_endpoint` (`client_secret_basic` by default), read
  `GET /vipps-userinfo-api/userinfo` with that token, and keep `sub` as the stable user id. Put the profile on the
  cart's customer **before** `place`.

## Going further

- **Vipps Checkout v3** — deprecated, sold to Kustom (May 2026): `POST /checkout/v3/session` returns `token`,
  `checkoutFrontendUrl` and `pollingUrl` for `checkout.vipps.no/vippsCheckoutSDK.js`. Its callbacks carry your
  `callbackAuthorizationToken` as `Authorization` (compare it timing-safe); capture, refund and cancel use the ePayment
  API with the same `reference`. It collects shipping itself — same warning as Express. ([Checkout API][checkout])
- **Express / buy now from the product page**: ePayment `shipping.fixedOptions` (or `dynamicOptions`, whose callback
  must check `callbackAuthorizationToken`) with `address` in `profile.scope`; needs sales unit approval; the choice
  comes back as `shippingDetails`. **Warning:** the shopper picks shipping in the app, so Vipps authorizes more than the
  placed cart and the order has no shipping line — choose shipping in the storefront before `place`. eCom v2 Express
  (`/ecomm/v2/payments`, `staticShippingDetails`) is deprecated. ([Express][express])
- More create-payment options ([features][features]): `paymentMethod.type: "CARD"` (card page for shoppers without the
  app), `profile.scope` (profile sharing), `minimumUserAge`, `expiresAt` (long-living, 10 min–60 days, approval and
  `receipt` required), `merchantLegalLinks`.
- `GET /epayment/v1/payments/{reference}/events` is the authoritative history — build support tools on it; the
  business portal is not meant for customer support. Subscriptions use the [Recurring API][recurring], not ePayment.

## Common mistakes

- Capturing, refunding or cancelling ePayment payments through eCom v2 (`/ecomm/v2/payments/…`) with
  `client_id`/`client_secret` headers instead of a Bearer token: pipeline capture and refund never worked.
- Polling `GET /payments/{reference}` every 2 seconds for up to an hour inside one request; a webhook route that read
  the JSON twice and verified nothing.
- The cart id as the `Idempotency-Key` of every call, so a second partial capture or refund is a "duplicate".
- `gross * 100` unrounded (4040); `NOK` hardcoded (5040 on DK/FI sales units).
- Receipt `unitPrice` in major units and `taxPercentage = tax / gross`: amounts are minor units, `taxRate` = % × 100.
- Checkout callbacks without the `callbackAuthorizationToken` check; an unauthenticated Express shipping callback.
- A constant `state` in the Login redirect: no CSRF protection.
- Recording refunds under the refund response's `pspReference` — the payment's, identical for every refund, so the
  second one is dropped as a redelivery.
- Ignoring `success: false`; verifying the HMAC against `req.url` behind a proxy.
- Rewriting, framing or effect-opening `redirectUrl`; trusting the cart cookie on the return page.
- Shipping before `capturedAmount` confirms the capture.

[epayment]: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/README.md
[create]: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/api-guide/operations/create.md
[concepts]: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/api-guide/concepts.md
[features]: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/api-guide/features/README.md
[express]: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/api-guide/features/express.md
[receipt]: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/api-guide/features/pre-built-order-management-api-integration.md
[webhooks]: https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/api-guide.md
[hmac]: https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/request-authentication.md
[capture-kb]: https://developer.vippsmobilepay.com/docs/knowledge-base/reserve-and-capture.md
[test]: https://developer.vippsmobilepay.com/docs/knowledge-base/test-environment.md
[widget]: https://developer.vippsmobilepay.com/docs/knowledge-base/widget.md
[checkout]: https://developer.vippsmobilepay.com/docs/APIs/checkout-api/README.md
[recurring]: https://developer.vippsmobilepay.com/docs/APIs/recurring-api/README.md
[spec]: https://developer.vippsmobilepay.com/redocusaurus/epayment-swagger-id.yaml
[toolkit]: https://github.com/vippsas/agent-toolkit
[portal]: https://portal.vippsmobilepay.com
