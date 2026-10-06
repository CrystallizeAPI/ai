# QuickPay with Crystallize

QuickPay (Quickpay) is a Danish payment gateway for merchants in Denmark and the rest of the Nordics and EU: cards
(Visa, Mastercard, Dankort, Amex) through the merchant's acquirer, plus MobilePay, Vipps, Apple Pay, Google Pay,
Klarna, PayPal, ViaBill, Anyday, Swish and Trustly in one hosted payment window. The recommended integration is a
**Quickpay Link**: create a QuickPay payment for the placed cart, put a link on it, redirect the shopper, and create
the order from QuickPay's checksum-signed callback. Payments are **authorized only** by default and captured later
through the API (capture on shipment); `auto_capture` captures at once for digital goods.

> Verification: Written from QuickPay's official docs, checked 2026-10-06. Not run end-to-end.
> Official docs: [API introduction][api], [Callback][callback], [Quickpay Link][link], [Payments guide][guide],
> [API services][services], [Test data][test], [Errors and codes][errors], [Payment methods][methods],
> [Acquirer details][acquirers], [Integration setup][setup]. Machine-readable spec:
> <https://api.quickpay.net/docs/v10/merchant/api/payments.json>. Crystallize page: [QuickPay][crystallize].

## At a glance

| Topic                     | QuickPay                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Markets & currencies      | Danish PSP for DK, Nordic and EU merchants; currencies per acquirer (DKK, EUR, SEK, …) |
| Recommended integration   | Quickpay Link: `POST /payments` → `PUT /payments/{id}/link` → redirect to its `url`    |
| Alternative               | The same link in an iframe (`framed: true`); Quickpay Form (legacy HTML POST)          |
| API version               | `v10` in the `Accept-Version` header; only the two newest versions are served          |
| SDKs                      | No Node SDK (official clients: Ruby, PHP, Python, .NET): use `fetch`                   |
| Amount units              | Integer **minor** units (`amount: 100` = 1.00 DKK)                                     |
| Capture + auth lifetime   | Manual by default (`auto_capture: false`); lifetime per acquirer; `40002` = expired    |
| Cart id field             | `order_id` (4–20 chars, unique per merchant) = hash of cart id; full id in `variables` |
| One session per cart      | `order_id` from the cart id; `GET /payments?order_id=` before creating; link reusable  |
| Notification verification | `QuickPay-Checksum-Sha256`: hex HMAC-SHA256 of the raw body, merchant private key      |

## Credentials and setup

The crystallize.com page names two credentials. Both are in the [Quickpay Manager][manager] under **Settings →
Integration** (the crystallize.com page says Settings → Merchant → Merchant Settings; the Manager now lists the
Merchant ID, the private key and each user's API key on the Integration page):

- **API key** — authenticates every API call (HTTP Basic, empty username, the key as password). Use the key of the
  **API user**, or of a dedicated system user (Settings → Users) allowed to create, capture, refund and cancel
  payments. The built-in "Payment Window" user is restricted.
- **Merchant private key** — "not an API key": the account's **Private key** that signs callbacks. Server-side only.

```bash
QUICKPAY_API_KEY=...         # API user's key — Basic auth ":<key>"
QUICKPAY_PRIVATE_KEY=...     # merchant Private key — callback checksum
QUICKPAY_CALLBACK_URL=https://shop.example/api/payments/quickpay/webhook
QUICKPAY_ACCEPT_TEST=false   # true only outside production
```

- **No sandbox host.** Test cards work on the live account and the payment carries `test_mode: true`; test
  transactions can be disabled per merchant (Settings → Integration) — do that, or filter `test_mode`, in production.
- **Test cards** (any plausible expiry and CVD; a CVD such as `752` sets the issuing country): Visa `1000 0000 0000
  0008` approved, `…0016` rejected, `…0024` expired, `…0032` capture rejected, `…0040` refund rejected, `…0057` cancel
  rejected, `…0073` 3-D Secure required (`30100`), `…0099` delayed 60 s; Mastercard `1000 0100 0000 0007`, Dankort
  `1000 0200 0000 0006` approved.
- **Localhost:** QuickPay must reach the callback URL. Run a tunnel (cloudflared, ngrok) and pass its URL as the
  link's `callback_url` — each link carries its own, so every developer can use their own tunnel.

## Create the payment

Call this from the pay route in [SKILL.md](../SKILL.md#lock-the-cart-before-you-charge), with the **placed** cart.
`order_id` is unique per merchant and at most 20 characters, so it is a hash of the cart id; looking it up first is
what keeps two tabs on one QuickPay payment. A link can be reopened until the payment is authorized, and a declined
card can retry in the same window.

```ts
// lib/quickpay.ts
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Payment, PlacedCart } from "@/lib/crystallize-payments";

export async function quickpay<T>(path: string, init: { method?: string; body?: unknown; headers?: object } = {}) {
    const res = await fetch(`https://api.quickpay.net${path}`, {
        method: init.method ?? "GET",
        headers: {
            Authorization: `Basic ${btoa(`:${process.env.QUICKPAY_API_KEY}`)}`, // empty username
            "Accept-Version": "v10",
            Accept: "application/json",
            "Content-Type": "application/json",
            ...init.headers,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) throw new Error(`QuickPay ${init.method ?? "GET"} ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
}

// 4–20 chars, unique per merchant; hex also fits Swish's a-zA-Z0-9- rule
export const quickPayOrderId = (cartId: string) => createHash("sha256").update(cartId).digest("hex").slice(0, 20);
const findPayment = async (orderId: string) => (await quickpay<QuickPayPayment[]>(`/payments?order_id=${orderId}`))[0];

export async function createQuickPayPayment(placed: PlacedCart, origin: string, language = "en") {
    const orderId = quickPayOrderId(placed.id);
    let payment = await findPayment(orderId); // one payment per cart: the other tab may have created it
    const returnUrl = `${origin}/checkout/confirmation?cart=${placed.id}`; // a wallet app may open another browser
    if (payment?.accepted) return { url: returnUrl }; // already paid: just wait for the webhook
    payment ??= await quickpay<QuickPayPayment>("/payments", {
        method: "POST",
        body: { order_id: orderId, currency: placed.total.currency, variables: { cartId: placed.id } },
    }).catch(async (error) => (await findPayment(orderId)) ?? Promise.reject(error)); // lost the race: reuse
    const link = await quickpay<{ url: string }>(`/payments/${payment.id}/link`, {
        method: "PUT",
        body: {
            amount: Math.round(placed.total.gross * 100), // placed total, minor units, never from the browser
            continue_url: returnUrl, // not proof of payment
            cancel_url: `${origin}/checkout?payment=cancelled`,
            callback_url: process.env.QUICKPAY_CALLBACK_URL,
            language, // two-letter code from the storefront locale
            auto_capture: false, // physical goods: capture on shipment
            auto_fee: false, // never add the acquirer fee: charge exactly the placed total
            customer_email: placed.customer?.email, // PayPal requires it
            payment_methods: placed.meta?.quickpayMethods, // chosen before place, see Provider specifics
        },
    });
    return { url: link.url };
}
```

`origin` is your public URL from configuration, not the request's `Host` header. QuickPay needs no order lines,
except for Klarna and Resurs ([Provider specifics](#provider-specifics)). QuickPay does not document zero-decimal
currencies (ISK, JPY): `* 100` assumes two decimals, as for DKK, EUR, SEK and NOK (unconfirmed for others).

## Client

Redirect the browser to the link (`location.assign(url)` after the pay route answers, or a `303` from a form POST).
Cards, 3-D Secure and the wallets run in QuickPay's hosted window at `payment.quickpay.net`. `continue_url` is the
return page from [SKILL.md](../SKILL.md#the-return-page): it reads the cart named in its URL (MobilePay or Vipps can
come back in another browser, without your cookie) and shows "confirming your payment…" until the cart is
`ordered` — it never creates the order. `cancel_url` lands on checkout with the cart still placed; **Pay** again
reuses the same payment and link, and changing the cart means a new cart.

## Webhook

QuickPay POSTs the whole payment (the same body as `GET /payments/{id}`) after **every** operation: authorize,
capture, refund, cancel — from your code or from the Manager. Callbacks for one payment arrive in operation order.

```ts
// lib/quickpay.ts (continued)
export type QuickPayOperation = {
    id: number;
    type: string; // authorize | capture | refund | cancel | renew | …
    amount: number; // minor units
    pending: boolean;
    qp_status_code: string; // "20000" approved; 40000 rejected (see aq_status_msg); 40002 authorization expired
    aq_status_msg: string | null;
    created_at: string;
};
export type QuickPayPayment = {
    id: number;
    order_id: string;
    type: string; // "Payment"
    accepted: boolean;
    currency: string;
    test_mode: boolean;
    variables: { cartId?: string };
    metadata: { type?: string; brand?: string } | null;
    link: { auto_capture?: boolean | null } | null;
    operations: QuickPayOperation[];
};
export const isApproved = (op: QuickPayOperation) => !op.pending && op.qp_status_code === "20000";
export const approved = (p: QuickPayPayment, type: string) =>
    p.operations.filter((op) => op.type === type && isApproved(op));
export const total = (ops: QuickPayOperation[]) => ops.reduce((sum, op) => sum + op.amount, 0);

export function verifyQuickPay(raw: string, checksum: string | null) {
    const expected = createHmac("sha256", process.env.QUICKPAY_PRIVATE_KEY!).update(raw).digest();
    const received = Buffer.from(checksum ?? "", "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
}
```

```ts
// app/api/payments/quickpay/webhook/route.ts
import { createOrderOnce, recordPayment, updatePayment, withMeta } from "@/lib/crystallize-payments";
import { approved, isApproved, quickPayPayment, quickPayRefund, total, verifyQuickPay } from "@/lib/quickpay";
import type { QuickPayPayment } from "@/lib/quickpay";

export async function POST(req: Request) {
    const raw = await req.text(); // the exact bytes QuickPay signed
    if (!verifyQuickPay(raw, req.headers.get("quickpay-checksum-sha256"))) {
        return new Response("bad checksum", { status: 401 });
    }
    const p = JSON.parse(raw) as QuickPayPayment;
    const cartId = p.variables?.cartId;
    if (p.type !== "Payment" || !cartId) return new Response("ignored");
    if (p.test_mode && process.env.QUICKPAY_ACCEPT_TEST !== "true") return new Response("test payment ignored");
    const auth = approved(p, "authorize").at(-1); // the latest approved authorize
    if (!p.accepted || !auth) return new Response("not authorized"); // declined or pending: no order
    const captured = total(approved(p, "capture"));
    if (p.link?.auto_capture && !captured) return new Response("waiting for the capture callback");
    try {
        await createOrderOnce(cartId, captured ? "paid" : "unpaid", quickPayPayment(p));
        // Operations after the order exists (capture() below, or the Manager); all of these are idempotent
        const last = p.operations.at(-1)!;
        const update = (state: string, amount?: number) =>
            updatePayment(cartId, String(p.id), (r) => withMeta(r, { state }, amount ?? r.amount));
        if (isApproved(last) && last.type === "capture") await update("captured", captured / 100);
        if (isApproved(last) && last.type === "cancel") await update("cancelled");
        for (const op of approved(p, "refund")) await recordPayment(cartId, quickPayRefund(p, op));
        return new Response("ok");
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 }); // RetryLater and real failures alike
    }
}
```

QuickPay counts **2xx, 302 and 303** as delivered and follows 301/307 to the `Location`. A redirect from auth or i18n
middleware on this route therefore swallows the callback: exclude the route from that middleware. Anything else fails
and is retried — the docs say both "up to 24 times, with gradually increasing delays" and "after an hour", so do not
rely on the timing. Never answer 2xx to a bad checksum.

| Payment in the callback                  | Crystallize ([paymentStatus](../SKILL.md#paymentstatus))       |
| ---------------------------------------- | -------------------------------------------------------------- |
| `accepted`, latest `authorize` approved  | `createOrderOnce(cartId, 'unpaid', …)`, `state=authorized`     |
| Approved `capture`, `auto_capture: true` | `createOrderOnce(cartId, 'paid', …)`, `state=captured`         |
| Latest operation an approved `capture`   | `updatePayment` → `state=captured`, `amount` = captured sum    |
| Approved `refund` operations             | `recordPayment` for each, `meta type=refund` (deduped by id)   |
| Latest operation an approved `cancel`    | `updatePayment` → `state=cancelled`; move to a cancelled stage |
| Declined or pending `authorize`          | Nothing: the shopper retries in the same window                |
| `test_mode: true` in production          | 200 and ignore (or disable test transactions)                  |

## Capture, refund, cancel

The operation endpoints take a `QuickPay-Callback-Url` header (else the account's default callback URL is used) and
a `?synchronized` query flag that waits and returns the payment with the finished operation instead of `202` and a
later callback. `capture()` uses it, so it normally returns the captured amount; if the operation is still pending it
returns `null` and the capture callback flips the record (the webhook above). QuickPay documents **no idempotency
key**: read the payment and its `operations` before acting, so a retried stage webhook never captures twice.

```ts
// lib/quickpay.ts (continued) — captureByProvider.quickpay = capture
async function operate(id: string, op: "capture" | "refund" | "cancel", body?: object) {
    const headers = { "QuickPay-Callback-Url": process.env.QUICKPAY_CALLBACK_URL! };
    const p = await quickpay<QuickPayPayment>(`/payments/${id}/${op}?synchronized`, { method: "POST", body, headers });
    const last = p.operations.at(-1)!; // 40000: see aq_status_msg; 40002: authorization expired
    if (!last.pending && !isApproved(last))
        throw new Error(`QuickPay ${op} ${last.qp_status_code}: ${last.aq_status_msg}`);
    return p;
}

/** The captured total in major units, or null while QuickPay is still processing (its callback updates the record). */
export async function capture(transactionId: string, amount: number): Promise<number | null> {
    let p = await quickpay<QuickPayPayment>(`/payments/${transactionId}`);
    const target = Math.round(amount * 100);
    const done = total(approved(p, "capture"));
    const pending = p.operations.some((o) => o.type === "capture" && o.pending);
    if (done < target && !pending) p = await operate(transactionId, "capture", { amount: target - done });
    if (p.operations.some((o) => o.type === "capture" && o.pending)) return null;
    return total(approved(p, "capture")) / 100; // also covers a retry after a capture that already went through
}

/**
 * `refundedBefore` = the refunds already recorded on the Crystallize order (major units). More at QuickPay means
 * this refund went through and its callback has not been recorded yet. The webhook records it (recordPayment),
 * so refunds made in the Manager are recorded too.
 */
export async function refund(transactionId: string, amount: number, refundedBefore: number) {
    const p = await quickpay<QuickPayPayment>(`/payments/${transactionId}`);
    if (total(approved(p, "refund")) > Math.round(refundedBefore * 100)) return;
    await operate(transactionId, "refund", { amount: Math.round(amount * 100) }); // partial refunds allowed
}

/** Voids an uncaptured authorization; its callback sets `state=cancelled` on the record (webhook above). */
export const cancel = (transactionId: string) => operate(transactionId, "cancel");
```

- Captures can be partial (several `capture` operations); the record's `amount` becomes the captured sum.
- An authorization lives as long as the acquirer and card scheme allow — commonly about 7 days for cards
  (unconfirmed per acquirer). `POST /payments/{id}/renew` renews it; capture fails with `40002` once it has expired.
- HTTP 429 means "Too Many 4XX Requests" and carries `Retry-After`: a burst of bad calls throttles the account.

## Mapping

```ts
// lib/quickpay.ts (continued)
export function quickPayPayment(p: QuickPayPayment): Payment {
    const auth = approved(p, "authorize").at(-1)!;
    const captured = total(approved(p, "capture"));
    return {
        provider: "quickpay",
        method: p.metadata?.brand ?? p.metadata?.type ?? "card", // visa, dankort, mobilepay, …
        transactionId: String(p.id), // the QuickPay payment id: capture, refund and cancel use it
        amount: (captured || auth.amount) / 100, // MAJOR units
        createdAt: auth.created_at,
        meta: [
            { key: "state", value: captured ? "captured" : "authorized" },
            { key: "cartId", value: p.variables.cartId! },
            { key: "quickpayOrderId", value: p.order_id },
        ],
    };
}

export const quickPayRefund = (p: QuickPayPayment, op: QuickPayOperation): Payment => ({
    provider: "quickpay",
    method: p.metadata?.brand ?? p.metadata?.type ?? "card",
    transactionId: `${p.id}-${op.id}`, // payment id + operation id: unique per refund
    amount: op.amount / 100,
    createdAt: op.created_at,
    meta: [
        { key: "type", value: "refund" },
        { key: "cartId", value: p.variables.cartId! },
    ],
});
```

## Provider specifics

**Payment method chosen in the storefront.** `payment_methods` restricts the window (`creditcard`, `dankort`,
`mobilepay`, `vipps`, `apple-pay`, `google-pay`, `klarna-payments`, `swish`, …; `!brand` excludes; `3d-` and a country
suffix narrow cards). Store the shopper's choice on the cart **before** `place` —
`carts.setMeta(id, { meta: [{ key: "quickpayMethods", value: "mobilepay" }], merge: true })` — and the link reads it
from `placed.meta`. Listing methods excludes every other one.

**Klarna and Resurs need a basket** whose total (plus `shipping.amount`) equals the payment amount; `item_price` is
per unit including VAT in minor units, `vat_rate` a fraction (`0.25`). Resurs also needs `invoice_address` (name,
street, city, zip, `country_code` as **ISO 3166-1 alpha-3**, email, phone) — map it from the billing entry of
`placed.customer.addresses`. Send both in the `POST /payments` body. Shipping is already a cart line (`type:
"shipping"`, an external item without a variant), so leave `shipping.amount` out:

```ts
// lib/quickpay.ts (continued)
export function quickPayBasket(placed: PlacedCart) {
    const basket = placed.items.map((item) => {
        const line = Math.round(item.price.gross * 100);
        const unit = line / item.quantity;
        const base = { item_no: item.variant?.sku ?? item.lineId ?? item.name, vat_rate: item.price.taxPercent / 100 };
        return Number.isInteger(unit)
            ? { ...base, qty: item.quantity, item_name: item.name, item_price: unit }
            : { ...base, qty: 1, item_name: `${item.quantity} × ${item.name}`, item_price: line }; // keep the sum exact
    });
    const rest = Math.round(placed.total.gross * 100) - basket.reduce((s, l) => s + l.qty * l.item_price, 0);
    // a cart-level discount or rounding; whether QuickPay/Klarna accept a negative line is unconfirmed
    if (rest !== 0) {
        basket.push({ item_no: "adjustment", vat_rate: 0, qty: 1, item_name: "Adjustment", item_price: rest });
    }
    return basket; // POST /payments body: { order_id, currency, variables, basket, invoice_address? }
}
```

**Embedded window.** `framed: true` on the link allows it in an iframe with `sandbox="allow-same-origin allow-scripts
allow-forms"`; the flow and the webhook are unchanged.

**After payment (prose only).** `PATCH /payments/{id}` adds `shipping[tracking_number]` / `shipping[tracking_url]`
once the goods ship; `POST /payments/{id}/renew` renews an authorization; `POST /payments/{id}/fraud-report` reports
fraud; `text_on_statement` (Clearhaus only, 22 ASCII chars) and `branding_id` shape what the shopper sees.

## Going further

- **Subscriptions and saved cards:** `POST /subscriptions`, `PUT /subscriptions/{id}/link`,
  `POST /subscriptions/{id}/recurring`, and `/cards` for card-on-file tokens; MobilePay Subscriptions has a 600 s
  link deadline. Keep the agreement on a Crystallize subscription contract — recurring charges are not covered here.
- **Wallet addresses:** `invoice_address_selection` / `shipping_address_selection` (MobilePay, PayPal) put the
  address on the QuickPay payment, not on the cart. Collect addresses in the storefront before `place`.
- **`auto_fee`** adds the acquirer fee to the amount: the shopper is then charged more than the placed cart. Leave it
  off, or add the fee as an external item before `place`.
- **Acquirers:** with several, QuickPay picks the cheapest; prioritise in Settings → Acquirers or force one with
  `acquirer`. MobilePay Checkout through QuickPay ended on 2024-03-12.
- **Several shops on one callback URL:** the `QuickPay-Account-ID` header tells them apart.
- **Payouts**, **Quickpay Form** (legacy HTML POST) and the full [API services][services] list.
- The crystallize.com page's flow — lock the cart, create the payment and link server-to-server, redirect, wait on
  the return page while the callback creates the customer (if missing) and the order — is this reference.

## Common mistakes

- Computing the checksum over `JSON.stringify(await req.json())` — QuickPay's own Node sample does it. Hash the raw
  text; key order and unicode escaping break the re-serialised version.
- Checking the checksum with the API key: callbacks are signed with the merchant **private key**.
- Answering a bad checksum with 200 (or `{}`), or letting middleware answer 302/303: QuickPay treats both as
  delivered, so a forged callback is "accepted" and a real one is never retried.
- Creating an order when `accepted` is `false` (stored as a refused order), for a pending authorize, or on every
  callback — capture and refund callbacks carry the same payment and created extra orders.
- Ignoring `test_mode`: test cards work on the live account, so a test payment ships real goods.
- Creating a new QuickPay payment on every click: a second `POST /payments` with the same `order_id` fails, and a
  random `order_id` lets one cart be paid twice. Look the payment up by `order_id` first.
- `cart.total.gross * 100` without `Math.round`.
- Never capturing: `auto_capture` defaults to `false`, so nothing is settled and authorizations expire (`40002`).
- Retrying a capture or refund blindly — there is no idempotency key; read `operations` (including pending ones) first.
- Placing the cart and creating the link from the browser: do both in the server's pay route, from the placed cart.

[api]: https://learn.quickpay.net/tech-talk/api/
[callback]: https://learn.quickpay.net/tech-talk/api/callback/
[link]: https://learn.quickpay.net/tech-talk/payments/link/
[guide]: https://learn.quickpay.net/tech-talk/guides/payments/
[services]: https://learn.quickpay.net/tech-talk/api/services/
[test]: https://learn.quickpay.net/tech-talk/appendixes/test/
[errors]: https://learn.quickpay.net/tech-talk/appendixes/errors/
[methods]: https://learn.quickpay.net/tech-talk/appendixes/payment-methods/
[acquirers]: https://learn.quickpay.net/tech-talk/appendixes/acquirer-details/
[setup]: https://quickpay.net/helpdesk/integration-setup/
[manager]: https://manage.quickpay.net/
[crystallize]: https://crystallize.com/docs/developer/integrations/payment-gateways/quickpay
