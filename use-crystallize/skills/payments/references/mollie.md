# Mollie with Crystallize

Mollie is a Dutch payment service provider for merchants incorporated in the EEA, the UK and Switzerland: cards,
Apple Pay, Google Pay, PayPal and local methods such as iDEAL, Bancontact, Klarna, Billie, Riverty, in3, TWINT, Vipps,
MobilePay and SEPA bank transfer, in EUR and 27 other currencies depending on the method. Integrate it by creating a
payment with the Payments API (`POST /v2/payments`) from the placed cart and redirecting the shopper to the hosted
Mollie Checkout (`_links.checkout.href`). The webhook receives only an unsigned payment id, so it fetches the payment
from Mollie before creating the order. Capture is automatic (`paid`) by default. With `captureMode: "manual"`, cards,
Klarna, Billie, PayPal, Vipps and MobilePay stop at `authorized` and are captured on shipment; Riverty and Billink
always work that way.

> Verification: Written from Mollie's official docs, checked 2026-10-06. Not run end-to-end.
> Official docs: [Accepting payments][accepting], [Create payment][create], [Webhooks][webhooks],
> [API idempotency][idempotency], [Payment status][status], [Place a hold][hold], [Refunds][refunds],
> [Testing][testing], [Multicurrency][currencies], [Authentication][auth]. Every page is also served as Markdown
> (append `.md`); index: [llms.txt][llms].

## At a glance

| Topic                     | Mollie                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Markets & currencies      | Merchants in the [EEA, UK, Switzerland][countries]; EUR + 27 currencies, per method      |
| Recommended integration   | Payments API `POST /v2/payments`, redirect to Mollie Checkout (`_links.checkout.href`)   |
| Alternative               | Mollie Components card form (`cardToken`). The Orders API is no longer recommended       |
| API version               | `v2`, `https://api.mollie.com/v2` for test and live: the key's prefix picks the mode     |
| SDKs                      | `fetch` here. Node: [`mollie-api-typescript`][sdk] 1.12; legacy `@mollie/api-client` 4.6 |
| Amount units              | `{ currency, value }`, `value` a string in **major** units: `"10.00"`, JPY/ISK `"1000"`  |
| Capture                   | Automatic → `paid`; `captureMode: "manual"` → `authorized` (Riverty, Billink: always)    |
| Authorization lifetime    | Visa/Amex 7 d, Mastercard 30 d, Klarna/Billie/Billink 28 d, Riverty 30 d, PayPal 29 d    |
| Cart id field             | `metadata: { cartId }` (about 1 kB of JSON); `description` ≤ 255 chars                   |
| One session per cart      | `Idempotency-Key` derived from the cart id — Mollie caches it for **1 hour** only        |
| Notification verification | Unsigned: `webhookUrl` receives `id=tr_…` → `GET /v2/payments/{id}` with your key        |

The legacy [`@mollie/api-client`][legacy-sdk] goes maintenance-only: its README says migrate by 17 November 2026, the
new SDK's README says 10 February 2027. MobilePay authorizations last 14 days, Vipps 180; every authorized payment
carries `captureBefore`, which cannot be extended.

## Credentials and setup

The crystallize.com page names one credential, the **apiKey**:

1. Sign up at [my.mollie.com](https://my.mollie.com) and create a **website profile** (your web store). Keys, payment
   methods and checkout branding belong to it.
2. **API key**: Developers → API keys. Each profile has a **Test API key** (`test_…`) and a **Live API key**
   (`live_…`); build with the test key first. A key is shown once, at creation. Server only.
3. **Payment methods**: activate at least one, or checkout has nothing to offer. The crystallize.com page says
   Settings → Website profiles → Payment methods; today's Web app has it under Organization settings → Profiles → your
   web store → the method → Activate ([troubleshooting][troubleshoot]).
4. **Currency**: Mollie accepts ISO 4217 codes only. A Crystallize price variant's currency can be named anything (€,
   Euro, EURO, EUR): name it `EUR`, since `placed.total.currency` goes to Mollie unchanged. Address countries are ISO
   3166-1 alpha-2 (`NL`).

```bash
MOLLIE_API_KEY=test_...                  # live_... in production
MOLLIE_CAPTURE_MODE=manual               # authorize now, capture on shipment; omit to capture at once
PUBLIC_BASE_URL=https://shop.example     # redirect and webhook URLs; your tunnel URL in development
```

- **Test mode** swaps the hosted pages for a test checkout where you pick the outcome (paid, authorized, failed,
  canceled, expired), with real webhooks. **EUR only.** Cards: Visa `4543 4740 0224 9996`, Mastercard
  `2223 0000 1047 9399`, Amex `3782 822463 10005`, any expiry and CVV; amounts €1,001.00 to €1,011.00 forced to
  `failed` give a chosen `failureReason`. A paid test payment's `_links.changePaymentState` creates a refund or
  chargeback.
- **Localhost**: a `localhost` `webhookUrl` is refused ("The webhook location is invalid"). Run ngrok or cloudflared
  and point `PUBLIC_BASE_URL` at the tunnel.

## Create the payment

Call it from the "Pay" route right after `place` ([SKILL.md](../SKILL.md#lock-the-cart-before-you-charge)). The body
comes from the placed cart only, so every call for one cart sends the same bytes: Mollie answers a reused
`Idempotency-Key` carrying a **different** body with `400`.

```ts
// lib/mollie.ts
import { type PlacedCart } from "@/lib/crystallize-payments";

type Money = { currency: string; value: string };
export type MollieRefund = { id: string; amount: Money; createdAt: string; status?: string }; // re_… or chb_…
export type MolliePayment = {
    id: string; // tr_…
    mode: "live" | "test";
    status: "open" | "pending" | "authorized" | "paid" | "canceled" | "expired" | "failed";
    amount: Money;
    amountCaptured?: Money;
    method: string | null; // ideal, creditcard, klarna, bancontact, banktransfer, …
    metadata: { cartId?: string } | null;
    createdAt: string;
    captureBefore?: string;
    _links: { checkout?: { href: string } };
    _embedded?: { refunds?: MollieRefund[]; chargebacks?: MollieRefund[] };
};

type Call = { method?: string; body?: unknown; idempotencyKey?: string };
async function mollieFetch(path: string, call: Call = {}, attempt = 0): Promise<{ json: any; replayed: boolean }> {
    const res = await fetch(`https://api.mollie.com/v2${path}`, {
        method: call.method ?? (call.body ? "POST" : "GET"),
        headers: {
            Authorization: `Bearer ${process.env.MOLLIE_API_KEY}`,
            "Content-Type": "application/json",
            ...(call.idempotencyKey ? { "Idempotency-Key": call.idempotencyKey } : {}),
        },
        body: call.body ? JSON.stringify(call.body) : undefined,
    });
    if (res.status === 409 && attempt < 3) {
        // this Idempotency-Key is still being processed (two tabs at once): wait, then get the replay
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        return mollieFetch(path, call, attempt + 1);
    }
    const text = await res.text(); // release-authorization answers 202 without a body
    if (!res.ok) throw Object.assign(new Error(`Mollie ${path} ${res.status}: ${text}`), { status: res.status });
    return { json: text ? JSON.parse(text) : undefined, replayed: res.headers.get("idempotent-replayed") === "true" };
}
export const mollie = async <T>(path: string, call?: Call) => (await mollieFetch(path, call)).json as T;

// A string in major units with the currency's decimals; JPY and ISK have none.
const decimals = (currency: string) => (currency === "JPY" || currency === "ISK" ? 0 : 2);
export const minor = (major: number, currency: string) => Math.round(major * 10 ** decimals(currency));
export const money = (minorUnits: number, currency: string): Money => ({
    currency,
    value: (minorUnits / 10 ** decimals(currency)).toFixed(decimals(currency)),
});

/** Every tab and every click gets the same live payment for this cart (within Mollie's one-hour key cache). */
export async function createMolliePayment(placed: PlacedCart): Promise<MolliePayment> {
    const body = await paymentBody(placed);
    let key = `cart-${placed.id}`;
    for (let attempt = 0; attempt < 5; attempt++) {
        const { json, replayed } = await mollieFetch("/payments", { body, idempotencyKey: key });
        // A replay is the response cached at creation, still "open": read the payment as it is now.
        const payment: MolliePayment = replayed ? await mollie<MolliePayment>(`/payments/${json.id}`) : json;
        if (!["canceled", "expired", "failed"].includes(payment.status)) return payment;
        key = `cart-${placed.id}-after-${payment.id}`; // dead: every tab derives the same next key
    }
    throw new Error(`cart ${placed.id}: five dead Mollie payments in a row`);
}

async function paymentBody(placed: PlacedCart) {
    const currency = placed.total.currency; // ISO 4217: "EUR", never "€"
    const base = process.env.PUBLIC_BASE_URL; // fixed: a varying Host header would change the body
    const customer = placed.customer; // customer and addresses were set with setCustomer before place
    const address = (type: string) => {
        const a = customer?.addresses?.find((x) => x.type === type);
        if (!a) return undefined;
        return clean({
            givenName: a.firstName ?? customer?.firstName,
            familyName: a.lastName ?? customer?.lastName,
            organizationName: customer?.companyName, // required for Billie (B2B)
            streetAndNumber: [a.street, a.streetNumber].filter(Boolean).join(" "),
            streetAdditional: a.street2,
            postalCode: a.postalCode,
            city: a.city,
            country: a.country, // ISO 3166-1 alpha-2
            email: a.email ?? customer?.email,
        });
    };
    return {
        amount: money(minor(placed.total.gross, currency), currency), // the PLACED total, never the browser's
        description: `Order ${placed.id}`, // the order id is the cart id
        redirectUrl: `${base}/checkout/mollie/return?cart=${placed.id}`,
        cancelUrl: `${base}/checkout?payment=cancelled`,
        webhookUrl: `${base}/api/payments/mollie/webhook`,
        metadata: { cartId: placed.id },
        locale: placed.meta?.locale, // e.g. "nl_NL", put on the cart before place
        method: placed.meta?.mollieMethod, // optional preselection, see Provider specifics
        captureMode: process.env.MOLLIE_CAPTURE_MODE === "manual" ? "manual" : undefined,
        billingAddress: address("billing"),
        shippingAddress: address("delivery"),
        lines: mollieLines(placed),
    };
}
const clean = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ""));

// Required for Klarna, Billie, in3, Riverty, Billink and vouchers; Mollie recommends them on every payment.
function mollieLines(placed: PlacedCart) {
    const cur = placed.total.currency;
    let sum = 0;
    const lines: Record<string, unknown>[] = placed.items.map((item) => {
        const total = minor(item.price.gross, cur); // line total, VAT and discounts included
        const rate = item.price.taxPercent ?? 0;
        let [quantity, unit] = [
            item.quantity,
            minor(item.variant?.price.gross ?? item.price.gross / item.quantity, cur),
        ];
        if (unit * quantity < total) [quantity, unit] = [1, total]; // never a negative discount
        sum += total;
        return {
            type: item.type === "shipping" ? "shipping_fee" : item.type === "digital" ? "digital" : "physical",
            description: quantity === item.quantity ? item.name : `${item.quantity} × ${item.name}`,
            quantity,
            sku: item.variant?.sku?.slice(0, 64) || undefined,
            unitPrice: money(unit, cur), // VAT included
            ...(unit * quantity > total ? { discountAmount: money(unit * quantity - total, cur) } : {}),
            totalAmount: money(total, cur), // = unitPrice × quantity − discountAmount, exactly
            vatRate: rate.toFixed(2), // a string: "21.00"
            vatAmount: money(Math.round((total * rate) / (100 + rate)), cur), // Mollie checks this formula
        };
    });
    const rest = minor(placed.total.gross, cur) - sum; // Σ totalAmount must equal amount
    const adjust = {
        description: "Adjustment",
        quantity: 1,
        unitPrice: money(rest, cur),
        totalAmount: money(rest, cur),
    };
    if (rest) lines.push({ type: rest < 0 ? "discount" : "surcharge", ...adjust });
    return lines;
}
```

**After the hour.** Mollie forgets an `Idempotency-Key` after one hour, and [`GET /v2/payments`][list-payments] has no
filter on `metadata` (it only pages through the profile's payments, newest first). So the one-hour window is the
guarantee: a click after it creates a second payment while the first may still be `open`. If both get paid,
`createOrderOnce` records the second with `attention=duplicate-payment` for someone to refund
([SKILL.md](../SKILL.md#one-payment-per-cart)). Keys are tied to the API key, so rotating it resets them too.

## Client

Redirect the browser to the checkout URL with a **GET** (Mollie warns that POSTing to it breaks some methods):

```ts
// app/api/checkout/pay/route.ts — continues SKILL.md's route after `place`
const payment = await createMolliePayment(placed);
const url =
    payment._links.checkout?.href ?? // open: Mollie Checkout
    `${process.env.PUBLIC_BASE_URL}/checkout/mollie/return?cart=${placed.id}`; // already paid, authorized or pending
return Response.redirect(url, 303); // called with fetch(): return { url } and window.location.assign(url) instead
```

- Mollie sends the shopper to `redirectUrl` whatever happened, without a status. The return page only reads the cart
  ([SKILL.md](../SKILL.md#the-return-page)) and shows nothing personal: anyone holding the URL can open it.
- Without a preselected `method`, a failed attempt returns the shopper to Mollie Checkout to retry, and the payment
  stays `open`. Cancelling there leads to `cancelUrl`: offer "Pay again" (the same route; the canceled payment is dead,
  so the next key creates a fresh one) or "Change cart" (a new cart, as SKILL.md says).
- SEPA bank transfer: the shopper returns **before** paying, and the payment stays `open` for 12 (+2) days. After a
  few seconds of "confirming", say the order is confirmed when the transfer arrives.

## Webhook

Mollie POSTs `id=tr_…` (form-encoded) to the payment's `webhookUrl` on `pending`, `authorized`, `paid`, `canceled`,
`expired` and `failed` (never on `open`), when a refund reaches `processing`, `refunded` or `failed`, and on a
chargeback. Nothing is signed: the id is a hint, and the payment you `GET` with your own key is the proof.

```ts
// app/api/payments/mollie/webhook/route.ts
import { createOrderOnce, readOrder, recordPayment, updatePayment, withMeta } from "@/lib/crystallize-payments";
import { mollie, molliePayment, mollieRefund, type MolliePayment } from "@/lib/mollie";

export async function POST(req: Request) {
    const id = new URLSearchParams(await req.text()).get("id") ?? "";
    if (!/^tr_\w+$/.test(id)) return new Response("ignored"); // 200 even for junk: tell a prober nothing
    try {
        const p = await mollie<MolliePayment>(`/payments/${id}?embed=refunds,chargebacks`).catch((error) => {
            if (error.status === 404) return null; // not yours, or from the other mode
            throw error;
        });
        const cartId = p?.metadata?.cartId;
        if (!p || !cartId) return new Response("ignored");
        if (p.status === "paid" || p.status === "authorized") {
            await createOrderOnce(cartId, p.status === "paid" ? "paid" : "unpaid", molliePayment(p));
        }
        await syncOrder(cartId, p);
        return new Response("ok");
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 }); // Mollie retries: 10 attempts over 26 hours
    }
}

/** Later changes to an existing order: a capture or release made anywhere, expiry, refunds, chargebacks. */
async function syncOrder(cartId: string, p: MolliePayment) {
    const order = await readOrder(cartId);
    if (!order) return; // pending, or dead before paying: no order, nothing to do
    const state = (id: string) => order.payments?.find((r) => r.transactionId === id)?.meta?.state;
    if (state(p.id) === "authorized") {
        const captured = Number(p.amountCaptured?.value ?? (p.status === "paid" ? p.amount.value : 0));
        if (captured > 0) await updatePayment(cartId, p.id, (r) => withMeta(r, { state: "captured" }, captured));
        else if (p.status === "canceled" || p.status === "expired") {
            await updatePayment(cartId, p.id, (r) => withMeta(r, { state: "cancelled" })); // released or lapsed
        }
    }
    for (const r of [...(p._embedded?.refunds ?? []), ...(p._embedded?.chargebacks ?? [])]) {
        const known = state(r.id);
        const status = r.status ?? "chargeback";
        if (!known && status !== "failed" && status !== "canceled") await recordPayment(cartId, mollieRefund(r, p.id));
        else if (known && known !== status) await updatePayment(cartId, r.id, (x) => withMeta(x, { state: status }));
    }
}
```

| Mollie payment `status` (from your `GET`) | Crystallize ([paymentStatus](../SKILL.md#paymentstatus))                 |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `paid`                                    | `createOrderOnce(cartId, 'paid', …)`, `state=captured`                   |
| `authorized` (manual capture)             | `createOrderOnce(cartId, 'unpaid', …)`, `state=authorized`               |
| `paid` after `authorized`                 | `updatePayment` → `state=captured`, amount = `amountCaptured`            |
| `open`, `pending`                         | Nothing: Mollie calls again when it settles                              |
| `failed`, `canceled`, `expired`, no order | Nothing; the cart stays placed and the next "Pay" makes a fresh payment  |
| `canceled`, `expired` after `authorized`  | `updatePayment` → `state=cancelled`; move the order to a cancelled stage |
| a refund in `_embedded.refunds`           | `recordPayment`, `transactionId` = `re_…`, `meta type=refund`            |
| a chargeback in `_embedded.chargebacks`   | `recordPayment`, `transactionId` = `chb_…`, `meta type=refund`           |

Answer within **15 seconds**; later counts as failed. Retries follow after 1, 2, 4, 8, 16 and 29 minutes, then 1, 2
and 22 hours. A `301`/`302` turns the POST into a GET and loses the `id`: keep the route clear of trailing-slash,
locale and auth redirects. Don't allowlist Mollie's IPs (they change); your `GET` already authenticates the data.

## Capture, refund, cancel

```ts
// lib/mollie.ts (continued). `capture` is captureByProvider.mollie in SKILL.md's pipeline-stage handler.
import { recordPayment, updatePayment, withMeta } from "@/lib/crystallize-payments";

export async function capture(transactionId: string, amount: number): Promise<number | null> {
    const p = await mollie<MolliePayment>(`/payments/${transactionId}`);
    if (p.status === "paid") return Number(p.amountCaptured?.value ?? p.amount.value); // captured already
    if (p.status !== "authorized") throw new Error(`Mollie ${transactionId} is ${p.status}: nothing to capture`);
    const cur = p.amount.currency;
    const [wanted, full] = [minor(amount, cur), minor(Number(p.amount.value), cur)];
    if (wanted < full && ["riverty", "billink"].includes(p.method ?? "")) throw new Error(`${p.method}: full only`);
    const c = await mollie<{ id: string; status: string; amount?: Money }>(`/payments/${transactionId}/captures`, {
        body: wanted < full ? { amount: money(wanted, cur) } : {}, // no amount = the whole authorization
        idempotencyKey: `capture-${transactionId}-${wanted}`,
    });
    if (c.status === "failed") throw new Error(`Mollie capture ${c.id} failed`);
    return null; // pending → succeeded is asynchronous: the webhook's "paid after authorized" row records it
}

/** `refundId` is yours (a return number…): it makes the Idempotency-Key, so a retry never refunds twice. */
export async function refund(cartId: string, paymentId: string, amount: number, currency: string, refundId: string) {
    const value = money(minor(amount, currency), currency);
    const r = await mollie<MollieRefund>(`/payments/${paymentId}/refunds`, {
        body: { amount: value, description: `Refund ${refundId}`, metadata: { cartId } },
        idempotencyKey: `refund-${refundId}`,
    });
    await recordPayment(cartId, mollieRefund(r, paymentId)); // the webhook then only updates its state
}

/** Releases what is still authorized: always the whole remainder. */
export async function cancel(cartId: string, transactionId: string) {
    const path = `/payments/${transactionId}/release-authorization`;
    await mollie(path, { body: {}, idempotencyKey: `release-${transactionId}` }); // 202, asynchronous
    await updatePayment(cartId, transactionId, (p) => withMeta(p, { state: "cancelled" }));
}
```

- A full capture moves the payment to `paid` and calls the webhook. Partial: Klarna and Billie keep the rest
  authorized for later captures; cards release it (unless Mollie enables multicapture for you); Riverty and Billink
  capture in full only. An `authorized` payment cannot be refunded (release it); a captured one cannot be released.
- Refunds run about two hours later and wait as `queued` when your Mollie balance is short. Mollie rejects a second
  refund of the same amount on a payment within an hour; the idempotency key makes a timed-out call safe to repeat in
  that hour. After it, check `GET /v2/payments/{id}/refunds` before trying again.

## Mapping

```ts
// lib/mollie.ts (continued)
import type { Payment } from "@/lib/crystallize-payments";

export const molliePayment = (p: MolliePayment): Payment => ({
    provider: "mollie",
    method: p.method ?? undefined, // ideal, creditcard, klarna, …
    transactionId: p.id, // tr_… — capture, refund and release need it
    amount: Number(p.amount.value), // already major units
    createdAt: p.createdAt,
    meta: [
        { key: "state", value: p.status === "paid" ? "captured" : "authorized" },
        { key: "cartId", value: p.metadata!.cartId! },
        ...(p.captureBefore ? [{ key: "captureBefore", value: p.captureBefore }] : []), // capture by then
        { key: "mode", value: p.mode }, // "test" must never reach a production order
    ],
});

/** Refunds (re_…) and chargebacks (chb_…) alike: money going back, never a second order. */
export const mollieRefund = (r: MollieRefund, paymentId: string): Payment => ({
    provider: "mollie",
    method: r.id.startsWith("chb_") ? "chargeback" : "refund",
    transactionId: r.id,
    amount: Number(r.amount.value),
    createdAt: r.createdAt,
    meta: [
        { key: "type", value: "refund" },
        { key: "state", value: r.status ?? "chargeback" }, // queued | pending | processing | refunded | …
        { key: "paymentId", value: paymentId },
    ],
});
```

Mollie spells its status `canceled`; the record's `state` uses SKILL.md's `cancelled`.

## Provider specifics

**Choosing a method in your own checkout.** `GET /v2/methods` lists what the profile accepts for an amount, sorted
and translated for a locale; `billingCountry` tells whether Klarna is offered. Store the choice on the cart **before**
`place`; `paymentBody` sends it as `method`, and the shopper skips Mollie's method screen.

```ts
// lib/mollie.ts (continued)
export async function mollieMethods(gross: number, currency: string, locale: string, billingCountry: string) {
    const q = new URLSearchParams({ locale, billingCountry, "amount[currency]": currency });
    q.set("amount[value]", money(minor(gross, currency), currency).value);
    type Methods = { _embedded: { methods: { id: string; description: string; image: { size2x: string } }[] } };
    return (await mollie<Methods>(`/methods?${q}`))._embedded.methods;
}
// shopper picks `id` → await carts.setMeta(cartId, { meta: [{ key: "mollieMethod", value: id }], merge: true });
```

With a single method, a failed or canceled attempt returns the shopper to your site instead of Mollie Checkout; the
next "Pay" makes a fresh payment.

**Buy now, pay later.** Klarna, Billie, in3, Riverty and Billink need `lines` and a `billingAddress` with
`givenName`, `familyName`, `streetAndNumber`, `postalCode`, `city`, `country` and `email` (Billie also
`organizationName`), so the customer and addresses must be on the cart before `place`. On the Payments API, Klarna
and Billie are **captured at once** (`paid`) unless `captureMode` is `manual`; Riverty and Billink require `manual`.
in3 is NL only (EUR 50 to 5,000); Riverty is NL, BE, DE, AT in EUR; [Klarna][klarna] takes EUR, DKK, SEK, NOK, CHF,
GBP, PLN, CZK, RON or HUF depending on the country.

**Bank transfer** stays `open` up to 12 (+2) days; with `billingAddress.email` set, Mollie emails the instructions.
The key lasts an hour, so a "Pay" days later makes a second payment: disable `banktransfer` if that is a problem.

**After payment** (prose only): capture before `captureBefore`, or the payment turns `expired` (`paid` if partly
captured). A refund can be cancelled while `queued` or `pending` (`DELETE /v2/payments/{id}/refunds/{refundId}`). A
chargeback shows in `amountChargedBack` and, if reversed, gets `reversedAt`. Paysafecard and gift cards cannot be
refunded.

## Going further

- **[Mollie Components][components]**, an embedded card form: load `https://js.mollie.com/v1/mollie.js`, call
  `Mollie(profileId, { locale, testmode })` and `createComponent('card')`; `createToken()` returns a `cardToken`
  (valid 1 hour) that the server sends with `method: 'creditcard'`, then redirects to `_links.checkout` for 3-D
  Secure. Each attempt has a new token, so key on cart id + token. The wider Components checkout and the Sessions API
  are in private beta.
- **[Next-gen webhooks][webhooks-new]**: organization-level subscriptions signed with
  `X-Mollie-Signature: sha256=<hex HMAC-SHA256 of the raw body>`; Mollie still recommends `webhookUrl` for payments.
- **Recurring**: create a Mollie customer once per Crystallize customer (`POST /v2/customers`), take a first payment
  with `customerId` and `sequenceType: 'first'`, then read its mandate (`GET /v2/customers/{id}/mandates`; valid once
  that payment is paid). Store the customer and mandate ids on the Crystallize subscription contract. Charge with
  `sequenceType: 'recurring'` + `mandateId` (always with an Idempotency-Key), or `POST /v2/customers/{id}/subscriptions`
  (`amount`, `interval`, `description` unique per customer, `startDate` as `YYYY-MM-DD`, `mandateId`, `webhookUrl`).
  See [Recurring payments][recurring].
- **Single-click cards**: the same `customerId` on later payments lets Mollie Checkout offer saved cards.
- **QR codes**: `?include=details.qrCode` on create, for iDEAL, Bancontact and bank transfer.
- **Cancel an open payment**: `DELETE /v2/payments/{id}` while `isCancelable`, e.g. when the shopper starts a new cart.
- **Digital goods VAT**: `restrictPaymentMethodsToCountry: 'NL'` keeps methods to the customer's country.
- **Express Component** (private beta) collects the address during payment. That address, and any shipping cost, is
  then **not** on the placed cart: Mollie charges more than the cart and the order lacks the shipping line. Choose
  shipping in the storefront before `place`.
- **Orders API** integrations: shipments become captures, order cancel becomes release-authorization, order lines
  become payment `lines` ([migration guide][migrate-orders]).
- Advanced access tokens and OAuth must send `profileId` (and `testmode: true` to test); an API key sends neither.

## Common mistakes

- Creating the order when the shopper clicks "Pay": every abandoned payment leaves an unpaid order. Create it from the
  webhook once the payment is `paid` or `authorized`.
- Creating a Mollie customer on every checkout: create one per Crystallize customer, for recurring or saved cards.
- Updating the order whatever status the fetched payment has: `open`, `pending`, `failed`, `canceled` and `expired`
  create nothing.
- Placeholder names and addresses in `billingAddress`, or tax sent as `0`: take both from the cart.
- `gross.toFixed(2)` for every currency (JPY and ISK have no decimals), and unrounded `gross * 100` in line maths.
- Taking the redirect to `redirectUrl` as proof of payment, or looking for a signature on the classic webhook.
- Answering `4xx` for unknown ids, or letting middleware redirect the webhook route.
- Changing the create body under the same `Idempotency-Key` (locale from the request, origin from `Host`, a
  timestamp) → `400`; trusting a replayed response's `status`; counting on the key after an hour.
- `vatRate` as a number, a `vatAmount` that is not `totalAmount × rate / (100 + rate)`, lines that do not sum to
  `amount`, or negative `physical` / `shipping_fee` lines.
- A price variant currency named `€` or `Euro`, or country names instead of ISO alpha-2 codes.
- Expecting Klarna or Billie to stop at `authorized` without `captureMode: 'manual'`, or calling the Orders API.
- A subscription `startDate` with a time in it (it is `YYYY-MM-DD`), or before the first payment is paid.

[accepting]: https://docs.mollie.com/docs/accepting-payments
[create]: https://docs.mollie.com/reference/create-payment
[webhooks]: https://docs.mollie.com/reference/webhooks
[webhooks-new]: https://docs.mollie.com/reference/webhooks-new
[idempotency]: https://docs.mollie.com/reference/api-idempotency
[status]: https://docs.mollie.com/docs/handling-payment-status
[hold]: https://docs.mollie.com/docs/place-a-hold-for-a-payment
[refunds]: https://docs.mollie.com/docs/refunds
[testing]: https://docs.mollie.com/reference/testing
[currencies]: https://docs.mollie.com/docs/multicurrency
[auth]: https://docs.mollie.com/reference/authentication
[llms]: https://docs.mollie.com/llms.txt
[countries]: https://help.mollie.com/hc/en-us/articles/115002116105-Can-I-use-Mollie-s-services-in-my-country
[sdk]: https://github.com/mollie/mollie-api-typescript
[legacy-sdk]: https://github.com/mollie/mollie-api-node
[troubleshoot]: https://docs.mollie.com/docs/troubleshoot-common-issues
[list-payments]: https://docs.mollie.com/reference/list-payments
[klarna]: https://docs.mollie.com/docs/klarna
[components]: https://docs.mollie.com/docs/mollie-components
[recurring]: https://docs.mollie.com/docs/recurring-payments
[migrate-orders]: https://docs.mollie.com/docs/migrating-from-orders-to-payments
