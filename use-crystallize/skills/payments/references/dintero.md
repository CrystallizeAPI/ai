# Dintero with Crystallize

Dintero is a Norwegian payment company whose Dintero Checkout puts cards, Vipps, MobilePay, Swish, Apple Pay, Google
Pay, Klarna, Walley, Two and Kravia invoices behind one session API, for Nordic merchants selling in NOK, SEK, DKK and
EUR to consumers (B2C) and companies (B2B). The recommended integration creates a checkout session from a payment
profile on the server, from the placed cart, shows it with `@dintero/checkout-web-sdk` (embedded, or a redirect to the
hosted page), and creates the order from the signed `callback_url` after re-fetching the transaction. Payments are
authorized at checkout and captured when the goods ship (manual capture by default; auto-capture is optional).

> Verification: Written from Dintero's official docs, checked 2026-10-06. Not run end-to-end.
> Official docs: [Quickstart][quickstart], [Create session API][api-session], [Handling payment][after], [Validating
> callbacks][sig], [Transaction management][tm], [Web SDK][websdk]. Every docs page is also served as Markdown (append
> `.md`); the index is [llms.txt](https://docs.dintero.com/llms.txt).

## At a glance

|                      |                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------- |
| Markets & currencies | Nordics: NOK, SEK, DKK, EUR; Vipps (NO), Swish (SE), MobilePay (DK) (list unconfirmed)  |
| Recommended          | `POST …/payments/sessions-profile` (methods from a payment profile), embedded Web SDK   |
| Alternative          | Redirect to the hosted page: `redirect({ sid })` or the session `url`                   |
| API version          | `api.dintero.com/v1/accounts/{aid}/payments/…`; the old `checkout.dintero.com/v1` works |
| SDKs                 | Browser `@dintero/checkout-web-sdk@0.14`; server `@dintero/node-sdk@1` (optional)       |
| Amount units         | Integer **minor** units (`29990` = 299.90 NOK); `items[].amount` = line total incl. VAT |
| Capture              | Manual (default). Authorization: cards ~7 days, Vipps 5–30, Klarna 28+, Walley 90 days  |
| Cart id              | `order.merchant_reference`, on every transaction and callback (≤ 35 chars with Kravia)  |
| One session per cart | No idempotency key: find the cart's open session and reuse it                           |
| Verification         | Signed **GET** `callback_url` (`Dintero-Signature`, HMAC-SHA256 of the URL) + re-fetch  |

## Credentials and setup

- **Sign up** at <https://onboarding.dintero.com>. The crystallize.com page names three values, all in Backoffice
  (<https://backoffice.dintero.com>) → **Settings**: the **client id** and **client secret** (API clients → Create new
  API client → **Checkout client**; the secret is shown **once**, [API client][client]) and the **account id**, which
  differs between test and production: `T12345678` is the sandbox, `P12345678` is live (Dintero's quickstart creates
  new credentials on the `P` account to go live).
- **Profile id**: Settings → Payment profiles; new accounts have `default`. Payment methods, their order and the theme
  live on the profile, so enabling a method needs no deploy ([payment profiles][profiles]).
- **Signature secret**, once per account: `POST https://checkout.dintero.com/v1/admin/signature` with a bearer token
  returns `signature.secret` ([API][signature-api]); from then on every callback carries `Dintero-Signature`.
- **Test data** ([cards][cards]), any future expiry and CVC: Visa `4000 0000 0000 0002` (no 3DS challenge),
  `4000 1000 0000 0000` (challenge), Mastercard `5200 0000 0000 0007`, declined `4100 0000 0000 0076`, capture
  time-out `4100 0000 0000 0019`. Klarna, Norway: `customer@email.no`, `+4740123456` ([Klarna test data][klarna-test]).
- **Reaching localhost**: `callback_url` must be public HTTPS (`https://localhost` is refused): use a tunnel as
  `PUBLIC_URL`. Backoffice shows each transaction's callbacks and your answers. Callbacks come from `34.241.230.119`
  and `34.242.13.162`.

```bash
DINTERO_ACCOUNT_ID=T12345678            # P12345678 in production
DINTERO_CLIENT_ID=…
DINTERO_CLIENT_SECRET=…
DINTERO_PROFILE_ID=default
DINTERO_SIGNATURE_SECRET=…              # signature.secret from POST /v1/admin/signature
PUBLIC_URL=https://shop.example         # the tunnel in development: Dintero signs this host
```

## Create the payment

Call it from the Pay route right after `place` ([SKILL.md](../SKILL.md#lock-the-cart-before-you-charge)). The token
lasts 4 hours: cache it. With `Dintero-Feature-Toggles: strict-session-amounts`, Dintero refuses a session whose lines
do not add up to `order.amount` instead of failing at capture. A session yields at most one transaction, so reusing the
cart's open session keeps two tabs on one payment. Only the older base lists sessions (`search` matches
`merchant_reference`); how soon a new session becomes searchable is unconfirmed, so two clicks in the same instant can still open two
sessions; the duplicate-payment flag in `createOrderOnce` covers that.

```ts
// lib/dintero.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { recordPayment, updatePayment, withMeta } from "@/lib/crystallize-payments";
import type { Payment, PlacedCart } from "@/lib/crystallize-payments";

const AID = process.env.DINTERO_ACCOUNT_ID!;
const API = `https://api.dintero.com/v1/accounts/${AID}`;
const minor = (major: number) => Math.round(major * 100); // NOK, SEK, DKK, EUR: 2 decimals
let token: { value: string; expiresAt: number } | undefined;

async function accessToken() {
    if (token && token.expiresAt - Date.now() > 60_000) return token.value;
    const basic = btoa(`${process.env.DINTERO_CLIENT_ID}:${process.env.DINTERO_CLIENT_SECRET}`);
    const res = await fetch(`${API}/auth/token`, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", audience: API }), // audience = the account URL
    });
    if (!res.ok) throw new Error(`Dintero auth ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return token.value;
}

/** `path` is under …/payments, or a full URL on the older base. A body makes it a POST. */
export async function dintero<T>(path: string, body?: object, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(path.startsWith("https://") ? path : `${API}/payments${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Dintero ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
}

export type DinteroTx = {
    id: string;
    status: string;
    amount: number;
    merchant_reference: string;
    payment_product_type: string;
    created_at: string;
    items?: { line_id: string; quantity: number; amount: number }[];
    events?: { event: string; success: boolean; amount?: number; event_reference?: string }[];
};
type Session = { id: string; transaction_id?: string; expires_at?: string; cancelled_at?: string; order: Order };
type Order = { amount: number; merchant_reference: string };
const PAID = ["ON_HOLD", "AUTHORIZED", "CAPTURED", "PARTIALLY_CAPTURED"];

/** Lines add up exactly to what place returned (max 100 lines). */
function dinteroOrder(placed: PlacedCart) {
    const items = placed.items.map((item, i) => ({
        id: item.variant?.sku ?? `line-${i + 1}`, // external items (shipping, fees) may have no variant
        line_id: item.lineId ?? String(i + 1), // unique; capture and refund name lines by it
        type: item.type === "shipping" ? "shipping" : undefined,
        description: item.name,
        quantity: item.quantity,
        amount: minor(item.price.gross), // the line total, incl. VAT and discounts
        vat_amount: minor(item.price.taxAmount), // "display only", but never 0 on a taxed line
        vat: item.price.taxPercent, // 25, not 0.25
    }));
    const amount = minor(placed.total.gross);
    items[items.length - 1].amount += amount - items.reduce((s, l) => s + l.amount, 0); // rounding cents
    const vat_amount = items.reduce((s, l) => s + l.vat_amount, 0); // order.vat_amount = Σ items.vat_amount
    return { amount, vat_amount, currency: placed.total.currency.toUpperCase(), items };
}

export async function createDinteroSession(
    placed: PlacedCart,
    origin: string,
): Promise<{ sid: string } | { paid: true }> {
    // No idempotency key on create: reuse the cart's live session (two tabs, double clicks). A click in the
    // same instant can still open a second session; the duplicate-payment flag in createOrderOnce covers it.
    const order = dinteroOrder(placed);
    const search = `https://checkout.dintero.com/v1/sessions?search=${encodeURIComponent(placed.id)}&limit=10`;
    for (const s of await dintero<Session[]>(search)) {
        if (s.order.merchant_reference !== placed.id || s.cancelled_at) continue;
        if (s.transaction_id) {
            const tx = await dintero<DinteroTx>(`/transactions/${s.transaction_id}`);
            if (PAID.includes(tx.status)) return { paid: true }; // send the shopper to the return page
        } else if (s.order.amount === order.amount && Date.parse(s.expires_at ?? "") > Date.now() + 120_000) {
            return { sid: s.id }; // the same session for every tab
        }
    }
    const parties = dinteroParties(placed); // customer, billing address, B2B or B2C: Provider specifics
    const session = await dintero<{ id: string; url: string }>(
        "/sessions-profile",
        {
            profile_id: process.env.DINTERO_PROFILE_ID ?? "default",
            url: {
                return_url: `${origin}/checkout/dintero/return?cart=${placed.id}`, // works in another browser
                callback_url: `${process.env.PUBLIC_URL}/api/payments/dintero/webhook`, // called with GET
            },
            customer: parties.customer,
            order: { ...order, billing_address: parties.billing, merchant_reference: placed.id },
            configuration: { default_customer_type: parties.type },
        },
        { "Dintero-Feature-Toggles": "strict-session-amounts" },
    );
    return { sid: session.id };
}
```

## Client

Embed the session, or redirect to Dintero's page; both need only the `sid`:

```tsx
// app/checkout/dintero/checkout.tsx
"use client";
import { embed } from "@dintero/checkout-web-sdk";
import { useEffect, useRef } from "react";

export function DinteroCheckout({ sid, language }: { sid: string; language: string }) {
    const container = useRef<HTMLDivElement>(null);
    useEffect(() => {
        // No onPayment* handlers: the SDK then sends the shopper to return_url itself.
        const checkout = embed({ container: container.current!, sid, language });
        return () => void checkout.then((c) => c.destroy());
    }, [sid, language]);
    return <div ref={container} />;
}
// Redirect instead: import { redirect } from "@dintero/checkout-web-sdk"; redirect({ sid });
```

Iframe events are **not guaranteed**: after paying in the Vipps app the `return_url` can open in a new tab, or in
another browser. So the page takes the cart id from its own `?cart=`; Dintero adds `transaction_id`,
`merchant_reference` and, on failure, `error` (`cancelled`, `authorization`, `failed`, `capture`). The page only reads
([SKILL.md](../SKILL.md#the-return-page)): `ordered` → confirmation; `placed` without `error` → "confirming your
payment…" and refresh; `error` → say so and offer "Try again", which calls the Pay route and gets the same open
session back.

## Webhook

Dintero calls `callback_url` with **GET** and the query `transaction_id`, `session_id`, `merchant_reference`, `time`
([handling payment][after]). There is no body to read: the signature covers the timestamp, account id, method, host,
path and **sorted** query of the URL it called ([validating callbacks][sig]), so rebuild that URL on the public host
(behind a proxy `req.url` differs). Then re-fetch the transaction, as Dintero requires, and take the cart id from it.
Retries: 20 times on 1xx/5xx, a 10-second timeout or a connection error; **any 4xx is final**.

```ts
// lib/dintero.ts (continued)
export function verifyDintero(req: Request): boolean {
    const header = req.headers.get("dintero-signature") ?? ""; // t=<unix>,v0-hmac-sha256=<hex>
    const t = /t=(\d+)/.exec(header)?.[1];
    const given = /v0-hmac-sha256=([0-9a-f]+)/.exec(header)?.[1];
    if (!t || !given || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // replay window: 5 minutes
    const called = new URL(req.url);
    const url = new URL(called.pathname + called.search, process.env.PUBLIC_URL);
    url.searchParams.sort(); // toString() then encodes spaces as "+", as Dintero does
    const payload = [t, AID, req.method, url.hostname, url.pathname, url.searchParams.toString()].join("\n");
    const want = createHmac("sha256", process.env.DINTERO_SIGNATURE_SECRET!).update(payload, "utf8").digest();
    const got = Buffer.from(given, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
}
```

```ts
// app/api/payments/dintero/webhook/route.ts — GET: a POST-only route never receives a callback
import { createOrderOnce } from "@/lib/crystallize-payments";
import { dintero, toPayment, verifyDintero, type DinteroTx } from "@/lib/dintero";

export async function GET(req: Request) {
    if (!verifyDintero(req)) return new Response("bad signature", { status: 401 });
    const transactionId = new URL(req.url).searchParams.get("transaction_id");
    if (!transactionId) return new Response("ignored");
    try {
        const tx = await dintero<DinteroTx>(`/transactions/${encodeURIComponent(transactionId)}`);
        const cartId = tx.merchant_reference; // from Dintero, not from the query string
        if (tx.status === "AUTHORIZED") await createOrderOnce(cartId, "unpaid", toPayment(tx, "authorized"));
        if (tx.status === "CAPTURED") await createOrderOnce(cartId, "paid", toPayment(tx, "captured"));
        return new Response("ok"); // ON_HOLD: a second callback follows. FAILED, DECLINED: no order
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 503 }); // never 4xx for your own failure: Dintero would stop
    }
}
```

| Transaction status                 | Crystallize ([paymentStatus](../SKILL.md#paymentstatus))                       |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `AUTHORIZED`                       | `createOrderOnce(cartId, 'unpaid', …)`, `state=authorized`                     |
| `CAPTURED` (auto-capture, Swish)   | `createOrderOnce(cartId, 'paid', …)`, `state=captured` (no `AUTHORIZED` first) |
| `ON_HOLD` (manual review)          | Nothing yet: another callback comes when it turns `AUTHORIZED` or `FAILED`     |
| `FAILED`, `DECLINED`               | No order. The cart stays placed; the shopper retries                           |
| `PARTIALLY_CAPTURED`, `REFUNDED` … | Only after your own calls below, which write Crystallize themselves            |

A redelivery for a transaction already on the order is a no-op (`recordPayment` dedupes on `transactionId`). A second
paid session for the same cart is recorded with `attention=duplicate-payment`: void it.

## Capture, refund, cancel

The calls answer with the updated transaction ([transaction management][tm]); `202` means still processing. Dintero
documents **no idempotency key**, so each function re-reads the transaction first, and refunds carry your
`refund_reference`. "Captures might fail": check the returned status.

```ts
// lib/dintero.ts (continued)
const captured = (tx: DinteroTx) =>
    (tx.events ?? []).filter((e) => e.event === "CAPTURE" && e.success).reduce((s, e) => s + (e.amount ?? 0), 0);

/** captureByProvider.dintero — the captured amount in major units. Never null: a `202` throws and is retried. */
export async function capture(transactionId: string, amount: number): Promise<number | null> {
    const before = await dintero<DinteroTx>(`/transactions/${transactionId}`);
    if (before.status === "CAPTURED") return captured(before) / 100; // a retry after a capture that went through
    if (before.status !== "AUTHORIZED") throw new Error(`Dintero ${transactionId} is ${before.status}`);
    const lines = minor(amount) === before.amount ? before.items : undefined; // Instabank needs the lines
    const tx = await dintero<DinteroTx>(`/transactions/${transactionId}/capture`, {
        amount: minor(amount),
        items: lines?.map(({ line_id, quantity, amount }) => ({ line_id, quantity, amount })),
    });
    if (!tx.status.endsWith("CAPTURED")) throw new Error(`Dintero capture: ${tx.status}`); // 202: retried later
    return captured(tx) / 100;
}

/** A return. `refundId` is yours (return or credit-note id): a retry with it never refunds twice. */
export async function refund(cartId: string, transactionId: string, amount: number, refundId: string) {
    const done = (tx: DinteroTx) =>
        tx.events?.some((e) => e.event === "REFUND" && e.success && e.event_reference === refundId);
    let tx = await dintero<DinteroTx>(`/transactions/${transactionId}`);
    if (!done(tx)) {
        const body = { amount: minor(amount), refund_reference: refundId };
        tx = await dintero<DinteroTx>(`/transactions/${transactionId}/refund`, body);
        if (!done(tx)) throw new Error(`Dintero refund ${refundId}: ${tx.status}`);
    }
    await recordPayment(cartId, {
        provider: "dintero",
        method: tx.payment_product_type,
        transactionId: `${transactionId}:${refundId}`,
        amount,
        createdAt: new Date().toISOString(),
        meta: [
            { key: "type", value: "refund" },
            { key: "cartId", value: cartId },
        ],
    });
}

/** Before capture only (a "Cancelled" stage): releases the reservation. */
export async function cancel(cartId: string, transactionId: string) {
    let tx = await dintero<DinteroTx>(`/transactions/${transactionId}`);
    if (tx.status !== "AUTHORIZATION_VOIDED") tx = await dintero<DinteroTx>(`/transactions/${transactionId}/void`, {});
    if (tx.status !== "AUTHORIZATION_VOIDED") throw new Error(`Dintero void: ${tx.status}`);
    await updatePayment(cartId, transactionId, (p) => withMeta(p, { state: "cancelled" }));
}
```

The [pipeline handler](../SKILL.md#capture-on-shipment-from-fulfilment-pipelines) calls `capture` before the
authorization lapses ([durations][auth]). Void, never refund, an authorized transaction; to drop lines, capture less.
That a refund event carries `refund_reference` as `event_reference` is read from the API schema (unconfirmed).

## Mapping

```ts
// lib/dintero.ts (continued)
export const toPayment = (tx: DinteroTx, state: "authorized" | "captured"): Payment => ({
    provider: "dintero",
    method: tx.payment_product_type, // dintero_psp.creditcard, vipps, swish.swish, klarna.klarna, two.invoice_b2b …
    transactionId: tx.id, // "T12345678.465Uf…": capture, refund and void take it
    amount: tx.amount / 100, // major units
    createdAt: tx.created_at,
    meta: [
        { key: "state", value: state },
        { key: "cartId", value: tx.merchant_reference },
    ],
});
```

A refund is a second record: `transactionId` = `<transaction id>:<your refund id>`, the refunded `amount`, `meta
type=refund` and `cartId` ([the payment record](../SKILL.md#the-payment-record)). Lines stay on the transaction.

## Provider specifics

**B2B and B2C.** One profile serves both. `configuration.default_customer_type` (`b2c` | `b2b`) preselects the type,
and the company the buyer gave your storefront — on the cart **before** place (`setCustomer` with type `organization`,
`companyName`, `taxNumber`, addresses) — prefills the billing address. Two (`two.invoice_b2b`) requires names,
`address_line`, `postal_code`, `country`, `phone_number`, `email`, `business_name` and `organization_number` (9 digits
in Norway, 10 or 12 in Sweden) ([Two via Dintero][two]).

```ts
// lib/dintero.ts (continued)
function dinteroParties(placed: PlacedCart) {
    const c = placed.customer;
    const b2b = c?.type === "organization" || !!c?.companyName;
    const a = c?.addresses?.find((x) => x.type === "billing") ?? c?.addresses?.[0];
    const phone = (a?.phone ?? c?.phone)?.startsWith("+") ? (a?.phone ?? c?.phone) : undefined; // E.123: +47…
    const billing = a && {
        first_name: a.firstName ?? c?.firstName,
        last_name: a.lastName ?? c?.lastName,
        address_line: [a.street, a.streetNumber].filter(Boolean).join(" "),
        postal_code: a.postalCode,
        postal_place: a.city,
        country: a.country, // ISO 3166 alpha-2
        email: a.email ?? c?.email,
        phone_number: phone,
        ...(b2b ? { business_name: c?.companyName, organization_number: c?.taxNumber } : {}),
    };
    return { type: b2b ? "b2b" : "b2c", customer: { email: c?.email, phone_number: phone }, billing };
}
```

**Checkout Express for B2B.** Dintero's company lookup (registries in Norway and Denmark; Walley's own for Walley
B2B, which needs it) runs in Checkout Express ([express][express]): add `express: { shipping_options: [],
shipping_mode: "shipping_not_required", customer_types: ["b2b"] }` — no Dintero-side shipping — and, for Walley, send
only `shipping_address.country` and `organization_number` ([Walley B2B][walley]). The confirmed company is then on the
**transaction**, while the order's customer comes from the cart: compare `organization_number` in the webhook.

**After payment** (no code): set `merchant_reference_2` to the Core order id for reconciliation
(`PUT /transactions/{id}`); raise a Klarna or Billie authorization before capture
(`POST /transactions/{id}/authorization`, new `amount` and all `items`). A Two or Walley `CAPTURED` means an invoice
was sent, not that money arrived.

## Going further

- **Dintero-side shipping** (Express `shipping_options`, `shipping_address_callback_url`, pick-up points) and Express
  discount codes — **warning:** Dintero then charges more (or less) than the placed cart, and the Crystallize order
  has no shipping line. Choose shipping in the storefront before `place` ([shipping options][shipping-options]).
- **Account-wide webhooks**: subscribe to `checkout_transaction` (Backoffice → Settings → Webhooks, or
  `POST /v1/accounts/{aid}/hooks/subscriptions`) to hear about captures, refunds and voids made in Backoffice.
  Deliveries carry `event-signature`, HMAC-**SHA1** of the raw body; trust an event's `correction.status` over its
  `success` ([checkout webhook][checkout-webhook]). Or add `report_event=CAPTURE` (`REFUND`, `VOID`) to `callback_url`.
- **Auto-capture** (`configuration.auto_capture`, or on the profile): only for goods handed over at once; Dintero
  retries it for 48 h, calls back only once `CAPTURED`, and keeps the fee on refunds ([auto-capture][auto-capture]).
- **Cancel the old session** when the shopper goes back and builds a new cart: `POST /sessions/{id}/cancel` (optional:
  a paid old session still pays exactly the old placed cart).
- **Recurring payments**: card tokens and merchant-initiated `POST /sessions/pay` ([tokenization][tokenization]). Also:
  payment links by SMS or e-mail, split payments for marketplaces, Kravia invoices, in-person terminals.

## Common mistakes

- A callback route that only accepts POST: Dintero calls `callback_url` with GET, so no order is ever created.
- Trusting the callback's query, or passing the whole request as the transaction id, instead of re-fetching
  `/transactions/{transaction_id}` and reading `merchant_reference` from it; or no `Dintero-Signature` check at all.
- Creating the order only on `AUTHORIZED`: with auto-capture or Swish the one callback says `CAPTURED`.
- Comparing against `AUTHORISED` (British spelling): the API's status is `AUTHORIZED`.
- Answering a 4xx for your own problem (an unknown cart → 404): Dintero never retries a 4xx.
- `gross * 100` without rounding, `vat_amount: 0` on taxed lines, or lines that do not add up to `order.amount`.
- Letting Express checkout pick (hard-coded) shipping: the shipping cost never reaches the Crystallize order.
- Overwriting the order's customer with the transaction's shipping address after payment.
- A new access token on every call (it lasts 4 hours), or a new session on every click.
- A 36-character cart UUID as `merchant_reference` with Kravia enabled: set a shorter `merchant_reference_2`.
- Refunding an authorized transaction (void it), or never capturing: card authorizations lapse after about a week.

[quickstart]: https://docs.dintero.com/docs/checkout/quickstart
[api-session]: https://docs.dintero.com/api-reference/session/checkout_session_profile_post
[after]: https://docs.dintero.com/docs/checkout/after-payment
[sig]: https://docs.dintero.com/docs/checkout/validating-callbacks
[tm]: https://docs.dintero.com/docs/checkout/transaction-management
[auth]: https://docs.dintero.com/docs/integrations/support/duration-of-authorizations
[websdk]: https://github.com/Dintero/Dintero.Checkout.Web.SDK
[client]: https://docs.dintero.com/docs/checkout/checkout-client
[profiles]: https://docs.dintero.com/docs/checkout/payment-profiles
[signature-api]: https://docs.dintero.com/checkout-api/secrets/admin_signature_post
[cards]: https://docs.dintero.com/docs/checkout/testdata/dintero-psp/checkout-dintero-cards-testdata
[klarna-test]: https://docs.dintero.com/docs/checkout/testdata/other/checkout-klarna-testdata
[two]: https://docs.dintero.com/docs/checkout/two
[express]: https://docs.dintero.com/docs/checkout/express
[walley]: https://docs.dintero.com/docs/checkout/walley-b2b
[shipping-options]: https://docs.dintero.com/docs/checkout/shipping-options
[checkout-webhook]: https://docs.dintero.com/docs/checkout/checkout-webhooks
[auto-capture]: https://docs.dintero.com/docs/integrations/support/auto-capture
[tokenization]: https://docs.dintero.com/docs/checkout/tokenization
