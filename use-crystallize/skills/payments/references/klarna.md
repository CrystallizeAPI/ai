# Klarna with Crystallize

> Verification: Written from Klarna's official docs, checked 2026-09-29. Not run end-to-end.
> Official docs: [Hosted Payment Page][hpp], [Order Management API][om]. Docs now live under
> `docs.klarna.com/acquirer/klarna/…`; old `klarna-payments/…` URLs redirect or 404.

[hpp]: https://docs.klarna.com/acquirer/klarna/web-payments/integrate-with-klarna-payments/integrate-via-hpp/
[om]: https://docs.klarna.com/acquirer/klarna/api/ordermanagement/
[markets]: https://docs.klarna.com/acquirer/klarna/get-started/data-requirements/puchase-countries-currencies-locales/
[tax]: https://docs.klarna.com/acquirer/klarna/web-payments/additional-resources/error-handling-and-validations/tax-handling/

This covers **Klarna Payments**. Klarna Checkout (KCO v3) was sold and is now **Kustom**, a separate provider that
this skill doesn't cover. OM's `/acknowledge` ("Acknowledge a Kustom checkout order") is not needed here.

## At a glance

|              |                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| Markets      | 26 countries: EU, UK, CH, NO, US, CA, MX, AU, NZ ([table][markets]); local currency, contract per country |
| Recommended  | KP session → **Hosted Payment Page** redirect, `place_order_mode: PLACE_ORDER`                            |
| Alternative  | Embedded KP widget (`x.klarnacdn.net/kp/lib/v1/api.js`) + server-side authorization callback              |
| API version  | Payments `v1`, HPP `v1`, Order Management `v1`                                                            |
| SDKs         | No official server SDK (use `fetch` + Basic auth); no client SDK needed for HPP                           |
| Amounts      | Integer **minor units** (`2500` = 25.00)                                                                  |
| Capture      | Manual, on shipment. Authorization lasts 28 days (up to 180 by contract); extendable                      |
| Cart id      | `merchant_reference1` (≤255, shown to the shopper as the order number; the Shop order id is the cart id)  |
| Verification | Unsigned. HMAC token in the `status_update` URL, then re-read the HPP session and order from Klarna       |

## Setup

- **Test account:** docs.klarna.com → Log in → region → **Playground** → Sign up. Then Merchant Portal → Payment
  settings → Klarna API keys → Generate: key id = username, secret = password (shown once; playground only).
- **Base URL** (keys are per region): `api.klarna.com`, `api-na.…`, `api-oc.…`; test `api.playground.klarna.com`.
- **Callbacks:** `merchant_urls` must match `^https://`: tunnel localhost (ngrok, cloudflared). Nothing to register.

```bash
KLARNA_API_URL=https://api.playground.klarna.com
KLARNA_USERNAME=…            # API key id
KLARNA_PASSWORD=…            # API key secret
KLARNA_CALLBACK_SECRET=…     # random 32+ bytes, used to sign callback URLs
PUBLIC_URL=https://….ngrok.app
```

## Create the session

A KP session with the **placed** cart (Shop `/cart`), then an HPP session pointing at it. This code assumes
`item.price` is the line total and `variant.price` the unit price (verified on live carts).

```ts
// lib/klarna.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { addPayment, createOrderOnce, replacePayments, setPaymentStatus } from "@/lib/crystallize-payments";

type PlacedCart = {
    id: string;
    total: { gross: number; currency: string };
    items: {
        name: string;
        quantity: number;
        type?: string | null;
        variant: { sku: string | null };
        price: { gross: number; taxPercent: number };
    }[];
};

const KLARNA = process.env.KLARNA_API_URL!;
const auth = "Basic " + btoa(`${process.env.KLARNA_USERNAME}:${process.env.KLARNA_PASSWORD}`);
const minor = (major: number) => Math.round(major * 100);

export async function klarna<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(KLARNA + path, {
        ...init,
        headers: { Authorization: auth, "Content-Type": "application/json", ...init.headers },
    });
    if (!res.ok) throw new Error(`Klarna ${path} ${res.status}: ${await res.text()}`); // body has correlation_id
    // 201/204 carry no body; OM returns the new ids as Capture-Id / Refund-Id headers
    return (res.status === 201 || res.status === 204 ? Object.fromEntries(res.headers) : await res.json()) as T;
}

export const sign = async (value: string) =>
    // hex HMAC-SHA256 of the cart id
    createHmac("sha256", process.env.KLARNA_CALLBACK_SECRET!).update(value).digest("hex");

function orderLine(item: PlacedCart["items"][number]) {
    const total = minor(item.price.gross);
    const taxRate = Math.round(item.price.taxPercent * 100); // 25% → 2500
    const unit = Math.ceil(total / item.quantity); // unit_price excludes discount
    return {
        type: item.type === "shipping" ? "shipping_fee" : "physical",
        reference: item.variant.sku ?? undefined,
        name: item.name,
        quantity: item.quantity,
        unit_price: unit,
        total_discount_amount: unit * item.quantity - total, // ≥ 0 by construction
        total_amount: total,
        tax_rate: taxRate,
        total_tax_amount: total - Math.round((total * 10000) / (10000 + taxRate)), // the ±1 rule, exactly
    };
}

export async function createKlarnaSession(cart: PlacedCart, market: { country: string; locale: string }) {
    const order_lines = cart.items.map(orderLine);
    const order_amount = order_lines.reduce((sum, l) => sum + l.total_amount, 0);
    if (order_amount !== minor(cart.total.gross)) throw new Error("Lines do not add up to the placed cart total");

    const kp = await klarna<{ session_id: string }>("/payments/v1/sessions", {
        method: "POST",
        body: JSON.stringify({
            acquiring_channel: "ECOMMERCE",
            intent: "buy",
            purchase_country: market.country, // must match the shopper's billing country
            purchase_currency: cart.total.currency.toUpperCase(),
            locale: market.locale, // e.g. nb-NO; must be a pair Klarna lists for the country
            order_amount,
            order_tax_amount: order_lines.reduce((sum, l) => sum + l.total_tax_amount, 0),
            order_lines,
            merchant_reference1: cart.id,
            merchant_data: JSON.stringify({ crystallizeCartId: cart.id }),
        }),
    });

    const [q, base] = [`cart=${cart.id}&sig=${await sign(cart.id)}`, process.env.PUBLIC_URL];
    const hpp = await klarna<{ redirect_url: string }>("/hpp/v1/sessions", {
        method: "POST",
        body: JSON.stringify({
            payment_session_url: `${KLARNA}/payments/v1/sessions/${kp.session_id}`,
            merchant_urls: {
                success: `${base}/checkout/klarna/return?${q}&sid={{session_id}}`,
                cancel: `${base}/checkout`,
                back: `${base}/checkout`,
                failure: `${base}/checkout?failed=klarna`,
                status_update: `${base}/api/payments/klarna/webhook?${q}`,
            },
            options: { place_order_mode: "PLACE_ORDER" }, // Klarna places the order, so no 60-minute token race
        }),
    });
    return { redirectUrl: hpp.redirect_url };
}
```

- US: send no `tax_rate`. Put tax on its own `type: 'sales_tax'` line named "Sales Tax" ([tax handling][tax]).
- The KP session lives 48 h, and the HPP session expires 1 h before it. HPP collects the customer data.

## Client

Redirect to `redirectUrl` (Klarna prefers this to the popup widget on mobile). The `success` page shows "Thank you"
and polls the Shop order ([SKILL.md](../SKILL.md#the-payment-step)). Server-side it may also run `verifyKlarna` and
`handleKlarnaSession(sid, cart)`: they trust only the signed cart id, so this covers a lost callback.

## Webhook

HPP POSTs `{ event_id, session: { session_id, status, order_id?, klarna_reference? } }` to `status_update` on every
status change: `IN_PROGRESS`, `COMPLETED`, `FAILED`, `CANCELLED`, `BACK`, `TIMEOUT`. There is no signature. It expects
a 2xx within 3 s and otherwise retries up to 3 more times.

```ts
// lib/klarna.ts (continued). Keep helpers out of route.ts: Next only allows HTTP-method exports there.
export async function verifyKlarna(req: Request) {
    const q = new URL(req.url).searchParams,
        cart = q.get("cart") ?? "";
    const [got, want] = [Buffer.from(q.get("sig") ?? ""), Buffer.from(await sign(cart))];
    return got.length === want.length && timingSafeEqual(got, want) ? cart : null;
}

export async function handleKlarnaSession(hppSessionId: string, cartId: string) {
    const s = await klarna<{ status: string; order_id?: string }>(`/hpp/v1/sessions/${hppSessionId}`); // or session_url
    if (s.status !== "COMPLETED" || !s.order_id) return null;
    const o = await klarna<KlarnaOrder>(`/ordermanagement/v1/orders/${s.order_id}`);
    if (o.merchant_reference1 !== cartId) throw new Error("Klarna order belongs to another cart");
    return createOrderOnce(cartId, "unpaid", toPayment(o, "authorized"));
}

// app/api/payments/klarna/webhook/route.ts
import { handleKlarnaSession, verifyKlarna } from "@/lib/klarna";

export async function POST(req: Request) {
    const cartId = await verifyKlarna(req);
    if (!cartId) return new Response("bad signature", { status: 401 });
    const { session } = JSON.parse(await req.text());
    try {
        await handleKlarnaSession(session.session_id, cartId);
        return new Response(null, { status: 204 });
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 }); // Klarna retries; createOrderOnce dedupes
    }
}
```

| Klarna                                          | Crystallize ([SKILL.md](../SKILL.md#paymentstatus))                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| HPP `COMPLETED`, order `fraud_status: ACCEPTED` | `createOrderOnce(cartId, 'unpaid', …state=authorized)`                              |
| `fraud_status: PENDING`                         | Same, but don't capture until OM `fraud_status` is `ACCEPTED`. Check before capture |
| `FAILED`, `CANCELLED`, `BACK`, `TIMEOUT`        | No order. The shopper retries with a new cart and session                           |
| OM order `EXPIRED` or `CANCELLED`               | `replacePayments` with `state=cancelled`; cancelled stage                           |

## Capture, refund, cancel

`Klarna-Idempotency-Key` (UUID v4): make one per operation and reuse it on retry. The 201 is the confirmation (don't
poll `getOrder`). Crystallize writes use the [SKILL.md helpers](../SKILL.md#creating-the-order-exactly-once).

```ts
async function klarnaMoney(orderId: string, op: "captures" | "refunds", amount: number, key: string) {
    const field = op === "captures" ? "captured_amount" : "refunded_amount";
    return klarna<Record<string, string>>(`/ordermanagement/v1/orders/${orderId}/${op}`, {
        method: "POST",
        headers: { "Klarna-Idempotency-Key": key },
        body: JSON.stringify({ [field]: minor(amount) }), // add order_lines (and shipping_info on capture)
    });
}

// `captured` / `refunded` are the running totals in major units, including this call
export async function captureKlarna(cartId: string, o: KlarnaOrder, amount: number, captured: number, key: string) {
    await klarnaMoney(o.order_id, "captures", amount, key);
    await replacePayments(cartId, [{ ...toPayment(o, "captured"), amount: captured }]);
    await setPaymentStatus(cartId, minor(captured) >= o.order_amount ? "paid" : "partiallyPaid");
}

export async function refundKlarna(cartId: string, o: KlarnaOrder, amount: number, refunded: number, key: string) {
    const headers = await klarnaMoney(o.order_id, "refunds", amount, key);
    await addPayment(cartId, {
        provider: "klarna",
        method: "refund",
        transactionId: headers["refund-id"],
        amount,
        createdAt: new Date().toISOString(),
        meta: [
            { key: "type", value: "refund" },
            { key: "klarnaOrderId", value: o.order_id },
        ],
    });
    await setPaymentStatus(cartId, minor(refunded) >= o.order_amount ? "refunded" : "partiallyRefunded");
}

// Cancel (nothing captured): POST …/orders/{id}/cancel, then
// replacePayments(cartId, [toPayment(o, 'cancelled')]); the order stays unpaid → move it to a cancelled stage.
// Also: …/release-remaining-authorization after a partial capture, …/extend-authorization-time.
```

## Mapping

```ts
export type KlarnaOrder = {
    order_id: string;
    order_amount: number;
    merchant_reference1: string;
    fraud_status: string;
    klarna_reference: string;
    initial_payment_method?: { type: string };
    created_at: string;
};
const toPayment = (o: KlarnaOrder, state: "authorized" | "captured" | "cancelled") => ({
    provider: "klarna",
    method: o.initial_payment_method?.type?.toLowerCase() ?? "klarna", // invoice, pay_in_x, card, direct_debit…
    transactionId: o.order_id, // every Order Management call uses this
    amount: o.order_amount / 100, // major units
    createdAt: o.created_at,
    meta: [
        { key: "state", value: state },
        { key: "fraudStatus", value: o.fraud_status },
        { key: "klarnaReference", value: o.klarna_reference },
    ], // the short id Klarna's customer service uses
});
```

Region and environment come from env, not meta ([record rules](../SKILL.md#the-payment-record)).

## Gotchas

- `order_amount` must equal Σ `total_amount` (shipping and discount lines included). Tax is checked per line (±1)
  and per order (±the number of lines). Derive it from `total_amount` as above, not from Crystallize's `taxAmount`.
- `unit_price` excludes discounts (max 200000000); max 1000 lines. Country, currency and locale must be a listed pair.
- HPP `status_update` is best effort (4 calls in total). Keep the return-page reconciliation.
- Embedded widget alternative:
    - Call `authorize()` directly in the click handler. Any `await` before it blocks the popup.
    - Send `Cross-Origin-Opener-Policy: same-origin-allow-popups` (Helmet's `same-origin` breaks it) and Klarna's CSP.
    - The authorization callback has a 2 s timeout and at-least-once delivery. Store the token, return 204, place the
      order asynchronously, and answer duplicates with 2xx, never 409.
- In the old furniture boilerplates (`furniture-remix/application/src/use-cases/payments/klarna/*`):
    - `@crystallize/node-service-api-request-handlers` + `pushOrder`; `gross * 100` unrounded; no tax fields sent.
    - `unit_price = (gross / quantity + discount) * 100` adds the whole line discount to each unit (wrong at qty > 1).
    - The country comes from the currency, with every non-NOK/USD currency mapped to `FR` and `en-FR`.
    - The authorization callback places the Klarna order and pushes the Crystallize order inside the 2 s window,
      with no idempotency, on a guessable unsigned `…/klarna/$cartId` route. No capture code: orders expire unpaid.
    - `authorize()` runs in the `load()` callback after `await placeCart()`, without a user gesture, so the popup is
      blocked. Per-category buttons are outdated; sessions usually return a single `klarna` category.
