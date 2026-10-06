# Two with Crystallize

Two (two.inc, formerly Tillit) is a B2B "buy now, pay later" provider: a registered business buys on invoice, Two
takes the credit and fraud risk, sends the invoice (email, or e-invoice such as EHF in Norway), collects it and pays the
merchant. It sells to business buyers in the Nordics, the UK, other EU countries and the US. The recommended
integration is Two's Order API with plain `fetch`: find the buyer company with the Company API, pre-check credit with an
order intent, create the Two order from the placed cart, send the buyer's representative to Two's hosted verification
page, and create the Crystallize order from the signed `order.verified.v1` webhook. Capture is fulfilment:
`POST /v1/order/{id}/fulfillments` issues the invoice and triggers the payout, within a 21-day credit guarantee.

> Verification: Written from Two's official docs, checked 2026-10-06. Not run end-to-end.
> Official docs: [Order creation path][path], [Create order][create], [Company API][company], [Order intent][intent],
> [Order validation][validate], [Order states][states], [Webhooks][webhooks] (sent by Svix: [verifying][svix],
> [retries][retries]), [Sandbox][sandbox], [OpenAPI specs][spec].

## At a glance

|                      |                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Markets & currencies | 19 markets (Nordics, UK, EU, US); currencies CHF CZK DKK EUR GBP INR MXN NOK PLN RON SEK USD  |
| Recommended          | Company API → order intent → `POST /v1/order` → hosted `payment_url` → `order.verified.v1`    |
| Alternative          | No embedded checkout. `POST /v1/order/{id}/notify` texts or emails the verification link      |
| API version          | Order API `/v1` (spec 1.0), Company API `/companies/v2` (spec 0.9.0), events `order.*.v1`     |
| SDKs                 | None for Node: `fetch` + `X-Api-Key`. Svix check by hand, or the `svix` npm package (2.7)     |
| Amounts              | Decimal strings, major units, ≤ 2 decimals (`"1499.00"`); `tax_rate` a fraction (`"0.25"`)    |
| Capture              | On fulfilment, async (`order.fulfilled.v1`). Credit guaranteed 21 days, then `/renew`         |
| Authorization window | `payment_url` valid 24 h once opened; `UNVERIFIED` orders auto-cancel after 48 h              |
| Cart id              | `merchant_order_id` (string, no documented limit; the cart UUID fits), in every order webhook |
| One session per cart | No create idempotency: under `withCartLock`, `GET /v1/order/merchant-order-id/{cartId}` first |
| Notification check   | Svix HMAC-SHA256 over `svix-id`, `svix-timestamp`, raw body; fresh timestamp; re-GET order    |

## Credentials and setup

- **API keys.** The crystallize.com page's "test credentials" (emailed at sign-up, or in "Developer tools") now
  live in the Two Merchant Portal: **Settings → Integration** → Sandbox or Production tab → **Create key**
  ([guide][keys]). The `secret_test_…` / `secret_prod_…` key is shown once. Production keys need an approved
  account: ask integration@two.inc. Admins create production keys, developers sandbox keys. Server-side only.
- **Webhook secret.** Merchant Portal → **Integrations → Manage webhook subscriptions** opens the Svix portal: add
  `https://<host>/api/payments/two/webhook`, subscribe to `order.verified.v1`, `order.fulfilled.v1`,
  `order.cancelled.v1`, `order.rejected.v1`, `order.refunded.v1`, copy the signing secret.

```bash
TWO_API_URL=https://api.sandbox.two.inc   # production https://api.two.inc (sandbox.api.two.inc does not resolve)
TWO_API_KEY=secret_test_…                 # Merchant Portal → Settings → Integration
TWO_WEBHOOK_SECRET=whsec_…                # Svix portal → endpoint → signing secret
```

- **Sandbox companies** (search returns real registry data; the org number sets the behaviour, [tables][sandbox] for
  SE, FI, DK, NL, US too). GB: `15717462` credit never used up, `10200123` zero credit (intent declined), `13333334`
  fraud reject, `14553414` verification declined; < £5 000 skips verification, ≥ £30 000 needs open banking. NO:
  `922934479` credit never used up, `922422508` zero credit, `983772102` fraud, `920245404` verification declined;
  < 5 000 kr skips, ≥ 50 000 kr needs Vipps + legal representative. Test orders use up sandbox credit: cancel them.
- **Webhooks without an order:** Svix portal → Endpoints → Testing → **Send Example**.
- **Localhost:** `merchant_urls` are browser redirects (localhost works). Svix needs a tunnel (ngrok, cloudflared).

## Create the payment

Before `place` the storefront stored the company, the representative and the intent's `tracking_id` on the cart
([Provider specifics](#provider-specifics)). SKILL.md's [Pay route](../SKILL.md#lock-the-cart-before-you-charge) calls
`createTwoOrder(placed, origin)` and redirects to `redirectUrl`; on `declined` it offers another method for the same
placed cart; on `RetryLater` (another tab holds the lock) it answers 409.

```ts
// lib/two.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { carts, createOrderOnce, PLACED_CART, readCart, recordPayment } from "@/lib/crystallize-payments";
import { updatePayment, withCartLock, withMeta, type Payment, type PlacedCart } from "@/lib/crystallize-payments";

export async function two<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(process.env.TWO_API_URL + path, {
        ...init,
        headers: { "X-Api-Key": process.env.TWO_API_KEY!, "Content-Type": "application/json", ...init.headers },
    });
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`Two ${path} ${res.status}: ${text}`), { status: res.status });
    return (text ? JSON.parse(text) : null) as T;
}

type Str<K extends string> = Record<K, string>;
type Opt<K extends string> = Partial<Record<K, string | null>>;
export type TwoRefund = Str<"id" | "total_amount" | "credit_note_number"> & Opt<"refund_date">;
export type TwoOrder = Str<"id" | "merchant_order_id" | "currency" | "gross_amount" | "status" | "state"> &
    Opt<"root_order_id" | "payment_url" | "invoice_url" | "decline_reason" | "date_created"> & {
        refunds?: TwoRefund[];
    };

const cents = (major: number) => Math.round(major * 100);
const dec = (minor: number) => (minor / 100).toFixed(2);
const TYPES: Record<string, string> = { shipping: "SHIPPING_FEE", service: "SERVICE", digital: "DIGITAL" };
type Person = { firstName?: string; lastName?: string; email?: string; phone?: string };
const rep = (p: Person) => ({ first_name: p.firstName, last_name: p.lastName, email: p.email, phone_number: p.phone });

/** Two's maths: net = qty × unit_price − discount, tax = net × rate, gross = net + tax; totals = sums of lines. */
export function amounts(cart: PlacedCart) {
    const total = { net: 0, tax: 0, gross: 0 };
    const brackets = new Map<string, { net: number; tax: number }>();
    const line_items = cart.items.map(({ type, name, quantity, variant, price }) => {
        const [gross, net] = [cents(price.gross), cents(price.net)]; // line totals, discounts included
        const tax = gross - net;
        const rate = String(+(price.taxPercent / 100).toFixed(6)); // 25 → "0.25", never "25"
        const b = brackets.get(rate) ?? { net: 0, tax: 0 };
        brackets.set(rate, { net: b.net + net, tax: b.tax + tax });
        Object.assign(total, { net: total.net + net, tax: total.tax + tax, gross: total.gross + gross });
        const sku = variant?.sku ?? ""; // external items (shipping, fee, promotion) may have no variant
        return {
            type: TYPES[type ?? ""] ?? (type && type !== "standard" ? "OTHER" : "PHYSICAL"), // fee, promotion → OTHER
            name,
            description: name,
            line_item_reference: /^[\w-]+$/.test(sku) ? sku : undefined, // Two accepts [A-Za-z0-9_-] only
            quantity: String(quantity),
            quantity_unit: "pcs",
            unit_price: (net / 100 / quantity).toFixed(6), // net unit price, so discount_amount stays 0
            net_amount: dec(net),
            tax_amount: dec(tax),
            gross_amount: dec(gross),
            tax_rate: rate,
            tax_class_name: `VAT ${price.taxPercent}%`,
        };
    });
    if (total.gross !== cents(cart.total.gross)) throw new Error(`Two lines do not add up to cart ${cart.id}`);
    const subs = [...brackets].map(([r, b]) => ({ tax_rate: r, taxable_amount: dec(b.net), tax_amount: dec(b.tax) }));
    const sums = { net_amount: dec(total.net), tax_amount: dec(total.tax), gross_amount: dec(total.gross) };
    return { currency: cart.total.currency.toUpperCase(), ...sums, line_items, tax_subtotals: subs };
}

export const getTwoOrder = (id: string) => two<TwoOrder>(`/v1/order/${id}`);
export const findTwoOrders = (cartId: string) =>
    two<TwoOrder[]>(`/v1/order/merchant-order-id/${cartId}`).catch((e) => (e.status === 404 ? [] : Promise.reject(e)));

export async function createTwoOrder(placed: PlacedCart, origin: string) {
    const returnUrl = `${origin}/checkout/two/return?cart=${placed.id}`;
    // No idempotency key on create: look the cart up first, under the lock (two tabs, double clicks).
    return withCartLock(placed.id, async () => {
        const live = (await findTwoOrders(placed.id)).find((o) => o.state !== "CANCELLED");
        if (live && live.status !== "APPROVED" && live.status !== "PARTIAL") return { declined: live.decline_reason };
        if (live?.state === "UNVERIFIED") return { redirectUrl: (await getTwoOrder(live.id)).payment_url }; // fresh URL
        if (live) return { redirectUrl: returnUrl }; // verified already
        const { meta, customer } = placed;
        const billing = customer?.addresses?.find((a) => a.type === "billing");
        if (!meta?.twoCompanyId || !customer?.companyName || !customer.phone || !customer.email || !billing) {
            throw new Error(`cart ${placed.id} was placed without a Two company or representative`);
        }
        const order = await two<TwoOrder>("/v1/order", {
            method: "POST",
            body: JSON.stringify({
                merchant_order_id: placed.id,
                ...amounts(placed),
                // canonical id alone: that form forbids other company fields. All four representative fields required.
                buyer: { company: { company_canonical_id: meta.twoCompanyId }, representative: rep(customer) },
                billing_address: {
                    organization_name: customer.companyName,
                    street_address: billing.street, // the registered address, from the Company API
                    postal_code: billing.postalCode,
                    city: billing.city,
                    country: billing.country,
                },
                buyer_purchase_order_number: meta.poNumber || undefined, // printed on the invoice
                tracking_id: meta.twoTrackingId || undefined, // links the order intent
                merchant_urls: {
                    merchant_confirmation_url: returnUrl,
                    merchant_cancel_order_url: `${origin}/checkout/two/cancel?cart=${placed.id}`,
                },
            }),
        });
        if (order.status !== "APPROVED") return { declined: order.decline_reason };
        return { redirectUrl: order.state === "UNVERIFIED" ? order.payment_url : returnUrl };
    });
}
```

- Two tolerates ±0.02 on a line's net and ±1.00 on a tax subtotal ([validation][validate]); `tax_subtotals` is
  required. Lines built from the placed line totals (shipping, fees and promotions included) keep the Two order equal
  to `placed.total.gross`; if they do not add up, `amounts` throws rather than invoice another amount.
- `status` is the credit decision, made again here (the intent was only a signal): not `APPROVED` → no redirect.
  `state` stays `UNVERIFIED` until the representative verifies.

## Client

Redirect with `window.location.assign(redirectUrl)`; there is no embedded form. Two's page picks the verification from
the buyer, the person and the amount: an email or SMS code, open banking, or an eID (Vipps, backed by BankID, in Norway;
BankID in Sweden, MitID in Denmark). When the shopper clicks Pay again, `createTwoOrder` re-reads the order, which
hands back a fresh `payment_url`.

The return page (`merchant_confirmation_url`) takes the cart id from its own URL (`?cart=`, set above), not only from
the cookie, and only reads: `readCart(cartId)` → `ordered`: show the confirmation and clear the cart cookie; still
`placed`: "We are confirming your order…" and refresh every few seconds. It may also call
`POST /v1/order/{id}/confirm` when `findTwoOrders(cartId)` shows `VERIFIED`: that moves the order to `CONFIRMED`,
which only tells Two the buyer is back (both states can be fulfilled). It never creates the order.

The cancel page (`merchant_cancel_order_url`) changes nothing at Two: the order stays `UNVERIFIED` and holds the
buyer's credit until the 48-hour auto-cancel. Call `POST /v1/order/{id}/cancel` while it is `UNVERIFIED`, then offer
another payment method for the same placed cart, or a new cart if the shopper wants to change it.

## Webhook

Svix sends a CloudEvents envelope `{ id, type, time, data: { order_id, root_order_id, merchant_order_id, state, … } }`
at least once, and retries after 5 s, 5 min, 30 min, 2 h, 5 h, 10 h and 10 h unless it gets a 2xx within 15 s (a 3xx
is a failure).

```ts
// lib/two.ts (continued)
export function verifyTwo(headers: Headers, body: string) {
    const [id, ts, signatures] = ["svix-id", "svix-timestamp", "svix-signature"].map((h) => headers.get(h) ?? "");
    const t = Number(ts);
    if (!id || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return false; // 5 min, as Svix's libraries
    const key = Buffer.from(process.env.TWO_WEBHOOK_SECRET!.replace(/^whsec_/, ""), "base64");
    const want = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
    return signatures.split(" ").some((entry) => {
        const [version, sig = ""] = entry.split(","); // "v1,<base64> v1,<base64>" while a secret rotates
        const got = Buffer.from(sig, "base64");
        return version === "v1" && got.length === want.length && timingSafeEqual(got, want);
    });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TWO_EVENTS = /^order\.(verified|fulfilled|cancelled|rejected|refunded)\.v1$/;

export async function handleTwoEvent(type: string, data: { order_id: string; root_order_id?: string | null }) {
    const order = await getTwoOrder(data.root_order_id ?? data.order_id); // act on Two's state, not on the event
    const cartId = order.merchant_order_id;
    if (!UUID.test(cartId)) return; // made in Two's Merchant Portal, not from a cart
    if (type === "order.verified.v1") {
        if (order.status !== "APPROVED" || !["VERIFIED", "CONFIRMED", "FULFILLING", "FULFILLED"].includes(order.state))
            return;
        await createOrderOnce(cartId, "unpaid", toPayment(order, "authorized"));
    } else if (type === "order.fulfilled.v1" && ["FULFILLED", "REFUNDED"].includes(order.state)) {
        const invoice: Record<string, string> = order.invoice_url ? { invoiceUrl: order.invoice_url } : {};
        await updatePayment(cartId, order.id, (p) =>
            withMeta(p, { state: "captured", ...invoice }, Number(order.gross_amount)),
        );
    } else if (type === "order.refunded.v1") {
        for (const r of order.refunds ?? []) await recordPayment(cartId, toRefund(order, r)); // skips known ids
    } else if (/cancelled|rejected/.test(type) && (await readCart(cartId))?.state === "ordered") {
        await updatePayment(cartId, order.id, (p) => withMeta(p, { state: "cancelled" }));
    } // not ordered (or a partial fulfilment): nothing to do, the cart stays as it is
}

// app/api/payments/two/webhook/route.ts
import { handleTwoEvent, TWO_EVENTS, verifyTwo } from "@/lib/two";

export async function POST(req: Request) {
    const body = await req.text();
    if (!verifyTwo(req.headers, body)) return new Response("bad signature", { status: 401 });
    const event = JSON.parse(body) as { type: string; data: { order_id: string; root_order_id?: string | null } };
    if (!TWO_EVENTS.test(event.type)) return new Response("ignored"); // reconciliation, customer events…
    try {
        await handleTwoEvent(event.type, event.data);
        return new Response("ok");
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 }); // Svix retries; createOrderOnce and recordPayment dedupe
    }
}
```

| Two (re-fetched order)                      | Crystallize ([SKILL.md](../SKILL.md#paymentstatus))                  |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `order.verified.v1`, `APPROVED`, `VERIFIED` | `createOrderOnce(cartId, 'unpaid', …state=authorized)`               |
| `UNVERIFIED` (no event)                     | Nothing: the return page waits; Two cancels it after 48 h            |
| `order.fulfilled.v1`, `FULFILLED`           | `updatePayment` → `state=captured`, `invoiceUrl`                     |
| `order.refunded.v1`                         | `recordPayment` per `order.refunds` entry (`type=refund`)            |
| `order.cancelled.v1`, `order.rejected.v1`   | Ordered: `updatePayment` → `state=cancelled`, cancelled stage        |
| Verified, cart already ordered another way  | `createOrderOnce` flags `attention=duplicate-payment`: cancel at Two |

## Capture, refund, cancel

Fulfilment is the capture: it issues the invoice, starts the buyer's payment term and the payout. `Idempotency-Key`
(≤ 100 chars) exists on fulfil and refund only; cancel answers 202 when already cancelled.

```ts
// lib/two.ts (continued). SKILL.md's stage handler calls captureByProvider["two"] = capture.
export async function capture(transactionId: string, amount: number): Promise<number | null> {
    const { state } = await getTwoOrder(transactionId);
    if (state !== "FULFILLING" && state !== "FULFILLED") {
        // No body = the whole order; `amount` is unused (a partial fulfilment sends `partial` with lines).
        await two(`/v1/order/${transactionId}/fulfillments`, {
            method: "POST",
            headers: { "Idempotency-Key": `fulfil-${transactionId}` }, // a redelivered stage event cannot fulfil twice
        });
    }
    return null; // asynchronous: FULFILLING now; order.fulfilled.v1 flips the record to captured
}

type Part = { amount: number; tax_subtotals: { tax_rate: string; taxable_amount: string; tax_amount: string }[] };

/** A credit note: no `part` = refund the rest. `key`: one per refund, reused on retry. */
export async function refund(cartId: string, twoOrderId: string, key: string, part?: Part) {
    const order = await getTwoOrder(twoOrderId);
    const body = part
        ? { amount: part.amount.toFixed(2), currency: order.currency, tax_subtotals: part.tax_subtotals }
        : {};
    const r = await two<TwoRefund>(`/v1/order/${order.root_order_id ?? order.id}/refund`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(body),
    });
    await recordPayment(cartId, toRefund(order, r)); // order.refunded.v1 then finds the same id and skips it
}

/** Before fulfilment only; after it, refund. */
export async function cancel(cartId: string, twoOrderId: string) {
    await two(`/v1/order/${twoOrderId}/cancel`, { method: "POST" });
    await updatePayment(cartId, twoOrderId, (p) => withMeta(p, { state: "cancelled" }));
}
```

- **21 days.** Fulfil within 21 days of verification, or call `POST /v1/order/{id}/renew` first (re-runs the credit
  check; 400 if refused).
- `capture` returns `null`, so SKILL.md's stage handler leaves the record `authorized`; the webhook sets `captured`
  (and the invoice link) once Two reports `FULFILLED`, usually within minutes.
- Partial refund: `amount` (gross), `currency`, `tax_subtotals` required; `line_items`, `reason`, `refund_reference`
  optional. Refunds before the payout reduce it; later ones are netted from future payouts.

## Mapping

```ts
// lib/two.ts (continued)
export const toPayment = (o: TwoOrder, state: "authorized" | "captured" | "cancelled"): Payment => ({
    provider: "two",
    method: "invoice",
    transactionId: o.id, // the root order id: GET, fulfil, cancel and refund use it
    amount: Number(o.gross_amount), // decimal string → major units
    createdAt: o.date_created ?? undefined,
    meta: [
        { key: "state", value: state },
        { key: "cartId", value: o.merchant_order_id },
    ],
});

export const toRefund = (o: TwoOrder, r: TwoRefund): Payment => ({
    provider: "two",
    method: "credit_note",
    transactionId: r.id,
    amount: Number(r.total_amount), // payable + prepaid
    createdAt: r.refund_date ?? undefined,
    meta: [
        { key: "type", value: "refund" },
        { key: "cartId", value: o.merchant_order_id },
        { key: "creditNote", value: r.credit_note_number },
    ],
});
```

`paymentStatus` stays `unpaid` (set once by `createFromCart`): the buyer pays Two later, on the invoice terms. The
record's `state` and the pipeline stage track the order; Two's reconciliation webhooks track the invoice.

## Provider specifics

At checkout, while the cart is still a `cart`: the shopper picks a country (from the market, never from the currency),
searches their company, picks it and enters the representative. `chooseCompany` stores it all on the cart and runs the
credit pre-check that decides whether to show "Pay by invoice with Two".

```ts
// lib/two.ts (continued)
type Address = Opt<"type" | "street_address" | "postal_code" | "city" | "country">;
type Company = Str<"name" | "canonical_id"> & { national_identifier?: { id: string }; addresses?: Address[] };
type Intent = { approved?: boolean; tracking_id?: string; decline_reason?: string };

/** No key needed and CORS-open (the browser may call it). `lookup_id` is temporary: never store it. */
export const searchCompanies = (q: string, country: string) =>
    two<{ items: { name: string; lookup_id: string; additional_information?: string }[]; degraded?: boolean }>(
        `/companies/v2/company?${new URLSearchParams({ q, country, limit: "10" })}`, // q: name or org number
    ); // `degraded: true` with no items = search is down, not "no such company"

export async function chooseCompany(cartId: string, lookupId: string, person: Required<Person>) {
    const cart = (await carts.fetch(cartId, { state: true, ...PLACED_CART })) as unknown as PlacedCart & {
        state: string;
    };
    if (cart.state !== "cart") throw new Error(`cart ${cartId} is ${cart.state}`); // writes to a placed cart are lost
    const co = await two<Company>(`/companies/v2/company/${encodeURIComponent(lookupId)}`);
    const a = co.addresses?.find((x) => x.type === "BUSINESS_ADDRESS"); // registered address = billing address
    const [street, postalCode, city, country] = [a?.street_address, a?.postal_code, a?.city, a?.country].map(
        (v) => v ?? undefined,
    );
    await carts.setCustomer(cartId, {
        ...person, // firstName, lastName, email, phone: Two requires all four
        isGuest: false, // true skips the Core customer
        identifier: person.email, // or your signed-in customer's identifier
        type: "organization",
        companyName: co.name,
        taxNumber: co.national_identifier?.id, // the organisation number
        addresses: [{ type: "billing", street, postalCode, city, country }], // replaces all addresses: add delivery too
    });
    const { tax_subtotals: _, ...money } = amounts(cart); // the current cart: a pre-check, not a charge
    const buyer = { company: { company_canonical_id: co.canonical_id }, representative: rep(person) };
    const intent = await two<Intent>("/v1/order_intent", { method: "POST", body: JSON.stringify({ ...money, buyer }) });
    const meta = { twoCompanyId: co.canonical_id, twoCountry: country ?? "", twoTrackingId: intent.tracking_id ?? "" };
    await carts.setMeta(cartId, { merge: true, meta: Object.entries(meta).map(([key, value]) => ({ key, value })) });
    return { approved: intent.approved === true, declineReason: intent.decline_reason }; // false → hide Two
}

// app/api/payments/two/company/route.ts
import { chooseCompany, searchCompanies } from "@/lib/two";

export async function GET(req: Request) {
    const q = new URL(req.url).searchParams;
    return Response.json(await searchCompanies(q.get("q") ?? "", q.get("country") ?? ""));
}
export async function POST(req: Request) {
    const { lookupId, representative } = await req.json(); // + your validation
    return Response.json(await chooseCompany(getCartIdFromCookie(req), lookupId, representative));
}
```

- An approved intent is a strong signal for this checkout session, not a guarantee: run it again if the cart changes
  much, and show a [decline reason][decline] message with other payment methods when it is refused.
- PO number (`poNumber` above), `buyer_reference` (≤ 140 chars), `buyer_project`, `buyer_department` print on the
  invoice: collect them into cart meta before `place`. Show your contract's terms ("Pay by invoice, 30 days").
- E-invoicing (EHF in Norway, per the crystallize.com page) depends on your setup with Two;
  `electronic_invoice_recipient` and `preferred_distribution_method` steer it per order.
- **The crystallize.com page, updated.** Two is no longer "UK and Norway, Sweden soon" (see markets above). The
  per-country Search API (`no.search.two.inc/search`, `gb.…`, with `limit`, `offset`, `q`) is no longer in Two's docs
  (it still answered on 2026-10-06): use `searchCompanies`. The order example posts to `sandbox.api.two.inc` (does not
  resolve) and sends `invoice_type` (set by your contract now) and order-level `tax_rate`/`discount_*`; its lines do
  not add up (`unit_price: '0.00'`, 0.1 labelled "VAT 25%", three 200.00 lines for 400), `tax_subtotals` is missing
  and the GB company has a Norwegian address: use `createTwoOrder`. Its confirm call is optional; the Crystallize
  order comes from `order.verified.v1`, not from confirm's answer.

## Going further

- Partial fulfilment: `partial` (lines, amounts, `tax_subtotals`) creates a fulfilled child order and sets the root's
  status to `PARTIAL`; `…/fulfillments/complete_partial` cancels the rest ([child orders][child]). The webhook above
  then leaves the record `authorized`: sum `GET …/fulfillments` and `updatePayment` the captured amount yourself.
- Edit before fulfilment with `PUT /v1/order/{id}`: lower amounts keep `APPROVED`; a higher one after verification is
  likely `REJECTED` (cancel, then a new cart and order).
- `disallow_portal_mutation: true` on create keeps staff from fulfilling, cancelling or refunding in the portal.
- PDFs: `invoice_url`, `credit_note_url`, `GET /v1/invoice/{order_id}/pdf`. `order.reconciliation.*` webhooks report
  the buyer's payments to Two.
- Payment terms: `terms` (`NET_TERMS` with `duration_days`, beta; `INSTALMENTS`), billing accounts ([terms][terms]).
- Buyer fee: `POST /v1/pricing/order/fee` → `buyer_fee_share`; add it as an external item before `place`.
- Trade accounts for one-click buyers (`merchant_user_id`, [guide][trade]); credit limits `GET /limits/v1/company/…`;
  Norwegian branches `GET /companies/v2/company/{canonical_id}/branches`.
- Merchant Portal **Order Creator** and `POST /v1/order/{id}/notify` for phone and email sales.

## Common mistakes

- Creating the order on the confirmation page after a browser-triggered confirm, with no webhook: a closed tab loses
  it, and anyone can load the page. Create it from `order.verified.v1`.
- Faking amounts to fit a currency (scaling totals by a "currency factor"), or hardcoding currency, country or
  `merchant_order_id`: the invoice must be the placed cart.
- No lookup before `POST /v1/order`: a double click creates two Two orders and two credit reservations.
- Never fulfilling: no invoice, no payout, and the guarantee lapses after 21 days.
- An unencoded search term; the old `tillit.ai` or `search.two.inc` hosts; `sandbox.api.two.inc`.
- `tax_rate` as a percentage, numbers instead of decimal strings, `invoice_type` in the body, no `tax_subtotals`.
- Company fields next to `company_canonical_id` (that form forbids them), or storing the temporary `lookup_id`.
- Setting the company or representative after `place` (silently lost), or without phone and email.
- Treating `merchant_cancel_order_url` as a cancellation: the order stays `UNVERIFIED` and holds the buyer's credit.
- Verifying Svix over re-serialized JSON, only the first signature, or without the timestamp; acting on the event body.
- Refunding a child order id, or cancelling after fulfilment (refund instead).
- Older docs' names: `/fulfilled` and `/refunds` (spec: `/fulfillments`, `/refund`), `original_order_id`
  (`root_order_id`), `merchant_short_name` (`merchant_id`), `due_in_days` (`terms`), webhook `gross_amount`
  (`payable_amount`).

[path]: https://docs.two.inc/docs/guides/path-to-order-creation/
[create]: https://docs.two.inc/docs/api/checkout/create-order-handler-post/
[company]: https://docs.two.inc/docs/guides/identifying-companies-with-company-api/
[intent]: https://docs.two.inc/docs/guides/using-order-intent/
[validate]: https://docs.two.inc/docs/guides/validating-orders-page/
[states]: https://docs.two.inc/docs/guides/order-states-page/
[webhooks]: https://docs.two.inc/docs/guides/order-webhooks-api-page/
[svix]: https://docs.svix.com/receiving/verifying-payloads/how-manual
[retries]: https://docs.svix.com/retries
[sandbox]: https://docs.two.inc/docs/guides/sandbox-behaviour-page/
[spec]: https://docs.two.inc/docs/guides/api-spec-downloads-page/
[keys]: https://docs.two.inc/docs/guides/getting-api-keys-page/
[decline]: https://docs.two.inc/docs/guides/decline-reasons-page/
[child]: https://docs.two.inc/docs/guides/child-orders-page/
[terms]: https://docs.two.inc/docs/guides/setting-repayment-terms/
[trade]: https://docs.two.inc/docs/guides/path-to-trade-account-onboarding/
