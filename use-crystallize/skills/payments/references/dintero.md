# Dintero with Crystallize

> Verification: Written from Dintero's official docs, checked 2026-09-29. Not run end-to-end.
> Official docs: [Dintero Checkout][docs], [API reference][api]. Every docs page is also served as markdown (append
> `.md`), and the index is at [llms.txt](https://docs.dintero.com/llms.txt).

[docs]: https://docs.dintero.com/docs/checkout/quickstart
[api]: https://docs.dintero.com/api-reference/session/checkout_session_profile_post
[after]: https://docs.dintero.com/docs/checkout/after-payment
[sig]: https://docs.dintero.com/docs/checkout/validating-callbacks
[tm]: https://docs.dintero.com/docs/checkout/transaction-management
[cards]: https://docs.dintero.com/docs/checkout/testdata/dintero-psp/checkout-dintero-cards-testdata

## At a glance

|              |                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| Markets      | Nordics: NO, SE, DK (NOK, SEK, DKK, EUR). **UNVERIFIED:** Dintero publishes no official list; no US      |
| Recommended  | Checkout session from a **payment profile** (`sessions-profile`), shown by **redirect** or embedded      |
| Alternative  | Embedded iframe with `@dintero/checkout-web-sdk` (`embed({ container, sid })`)                           |
| API version  | `https://api.dintero.com/v1/accounts/{aid}/payments/…` (the old `checkout.dintero.com/v1` still works)   |
| SDKs         | `@dintero/node-sdk@1` (typed client). `fetch` shown here. `@dintero/checkout-web-sdk@0.14`               |
| Amounts      | Integer **minor units**. `items[].amount` is the line total incl. VAT and discounts                      |
| Capture      | Manual by default (or `auto_capture`). Cards hold ~7 days, Klarna 28, Walley 90 ([knowledge base][auth]) |
| Cart id      | `order.merchant_reference` (required; ≤35 chars only with Kravia invoice). Echoed on every callback      |
| Verification | `Dintero-Signature` HMAC-SHA256 over the callback URL, **plus** a mandatory transaction re-fetch         |

[auth]: https://www.dintero.com/knowledge-base/authorizations

## Setup

- **Sign up** at onboarding.dintero.com. Each account has a `T…` (sandbox) and `P…` (live) id on the same hosts.
  Backoffice → Settings → API clients → **Checkout client** on the T account (the secret is shown once).
- **Payment methods** come from the payment profile (Backoffice → Settings → Payment profiles; `default` exists).
- **Callback signing:** create the secret once with `POST /v1/admin/signature` ([validating callbacks][sig]). From
  then on, callbacks carry `Dintero-Signature`.
- **Reaching localhost:** the `callback_url` must be public HTTPS, and `https://localhost` is rejected, so tunnel
  (ngrok, cloudflared). Backoffice shows each transaction's callbacks sent and the responses received.

```bash
DINTERO_ACCOUNT_ID=T12345678
DINTERO_CLIENT_ID=…
DINTERO_CLIENT_SECRET=…
DINTERO_CALLBACK_SECRET=…     # from POST /v1/admin/signature
DINTERO_PROFILE_ID=default
PUBLIC_URL=https://….ngrok.app
```

## Create the session

The session is created from the **placed** cart (Shop `/cart`). `item.price` is the line total
(verified on live carts). Cache the token: it is valid for 4 h.

```ts
// lib/dintero.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { addPayment, replacePayments, setPaymentStatus } from "@/lib/crystallize-payments";

type PlacedCart = {
    id: string;
    total: { gross: number; currency: string };
    items: {
        lineId?: string | null;
        name: string;
        quantity: number;
        variant: { sku: string | null };
        price: { gross: number; taxAmount: number; taxPercent: number };
    }[];
};

const AID = process.env.DINTERO_ACCOUNT_ID!;
const API = `https://api.dintero.com/v1/accounts/${AID}`;
const minor = (major: number) => Math.round(major * 100);
let token: { value: string; expires: number } | undefined;

async function accessToken() {
    if (token && token.expires > Date.now() + 60_000) return token.value;
    const basic = btoa(`${process.env.DINTERO_CLIENT_ID}:${process.env.DINTERO_CLIENT_SECRET}`);
    const res = await fetch(`${API}/auth/token`, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", audience: API }), // audience = the account URL
    });
    if (!res.ok) throw new Error(`Dintero auth ${res.status}`);
    const { access_token, expires_in } = await res.json();
    token = { value: access_token, expires: Date.now() + expires_in * 1000 };
    return access_token as string;
}

export async function dintero<T>(path: string, body?: object, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${API}/payments${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Dintero ${path} ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
}

export async function createDinteroSession(cart: PlacedCart) {
    const items = cart.items.map((item, i) => ({
        id: item.variant.sku ?? `line-${i}`,
        line_id: item.lineId ?? String(i + 1), // unique; capture and refund refer to it
        description: item.name,
        quantity: item.quantity,
        amount: minor(item.price.gross), // line total incl. VAT
        vat_amount: minor(item.price.taxAmount), // display only
        vat: item.price.taxPercent, // 25, not 0.25
    }));
    const base = process.env.PUBLIC_URL;
    const session = await dintero<{ id: string; url: string }>(
        "/sessions-profile",
        {
            profile_id: process.env.DINTERO_PROFILE_ID ?? "default",
            url: {
                return_url: `${base}/checkout/dintero/return`,
                callback_url: `${base}/api/payments/dintero/webhook`, // GET; Dintero appends transaction_id etc.
            },
            order: {
                amount: minor(cart.total.gross), // must equal Σ items.amount under strict-session-amounts
                currency: cart.total.currency.toUpperCase(),
                merchant_reference: cart.id,
                items,
            },
        },
        { "Dintero-Feature-Toggles": "strict-session-amounts" },
    );
    return { sid: session.id, url: session.url };
}
```

- Max 100 items. Shipping can be a normal item (as here) or `order.shipping_option`. The latter becomes an item on
  the transaction, and you capture it by its `line_id`.

## Client

Redirect with `location.href = url`, or embed:

```ts
import { embed } from "@dintero/checkout-web-sdk";
await embed({ container, sid, language: "no" }); // no handlers: the SDK itself redirects to return_url
```

Iframe → SDK events are **not guaranteed** (with Vipps the return URL can open in a new tab). The `return_url` gets
`transaction_id`, `merchant_reference` and maybe `error` (`cancelled`, `authorization`, `failed`, `capture`). It shows
a confirmation and polls the Shop order ([SKILL.md](../SKILL.md#the-payment-step)), and never creates the order.

## Webhook

The `callback_url` is a GET with `transaction_id`, `session_id`, `merchant_reference` and `time` in the query
([handling payment][after]). It fires on `AUTHORIZED`, or after `CAPTURED` when auto-capture is on, and fires again
when an `ON_HOLD` transaction resolves. It is retried 20 times on 5xx, timeouts (10 s) and connection errors. **Any 4xx
is a permanent failure**, so answer 5xx for your own errors.

The signature ([validating callbacks][sig]) is `Dintero-Signature: t=<unix>,v0-hmac-sha256=<hex>` over
`` `${t}\n${accountId}\n${METHOD}\n${hostname}\n${pathname}\n${sortedQuery}` `` (spaces as `+`). It covers the URL, not
a body. Reject `t` older than 5 minutes, and use the **public** hostname (behind a tunnel `req.url` may differ).
Dintero also requires re-fetching the transaction before you update the order.

```ts
// lib/dintero.ts (continued)
export function verifyDintero(req: Request) {
    const header = req.headers.get("dintero-signature") ?? "";
    const t = Number(/t=(\d+)/.exec(header)?.[1]);
    if (!t || Date.now() / 1000 - t > 300) return false;
    const url = new URL(req.url);
    url.searchParams.sort(); // URLSearchParams.toString() encodes spaces as '+'
    const host = new URL(process.env.PUBLIC_URL!).hostname;
    const payload = `${t}\n${AID}\n${req.method}\n${host}\n${url.pathname}\n${url.searchParams.toString()}`;
    const mac = createHmac("sha256", process.env.DINTERO_CALLBACK_SECRET!).update(payload, "utf8").digest("hex");
    const [got, want] = [Buffer.from(header), Buffer.from(`t=${t},v0-hmac-sha256=${mac}`)];
    return got.length === want.length && timingSafeEqual(got, want);
}

// app/api/payments/dintero/webhook/route.ts (helpers stay in lib: Next allows only HTTP-method exports here)
import { createOrderOnce } from "@/lib/crystallize-payments";
import { dintero, toPayment, verifyDintero, type DinteroTx } from "@/lib/dintero";

export async function GET(req: Request) {
    if (!verifyDintero(req)) return new Response("bad signature", { status: 401 });
    const q = new URL(req.url).searchParams;
    try {
        const tx = await dintero<DinteroTx>(`/transactions/${q.get("transaction_id")}`); // mandatory re-fetch
        const cartId = tx.merchant_reference;
        if (tx.status === "AUTHORIZED") await createOrderOnce(cartId, "unpaid", toPayment(tx, "authorized"));
        if (tx.status === "CAPTURED") await createOrderOnce(cartId, "paid", toPayment(tx, "captured"));
        return new Response(null, { status: 200 }); // ON_HOLD: a second callback follows; FAILED/DECLINED: no order
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 503 }); // never 4xx: Dintero would stop retrying
    }
}
```

| Transaction status        | Crystallize ([SKILL.md](../SKILL.md#paymentstatus))       |
| ------------------------- | --------------------------------------------------------- |
| `AUTHORIZED`              | `createOrderOnce(cartId, 'unpaid', …state=authorized)`    |
| `CAPTURED` (auto-capture) | `createOrderOnce(cartId, 'paid', …state=captured)`        |
| `ON_HOLD`                 | Nothing yet. Another callback follows (or poll hourly)    |
| `FAILED`, `DECLINED`      | No order. The shopper retries with a new cart and session |

For captures made in Backoffice, subscribe to the `checkout_transaction` webhook (`event-signature`: HMAC-**SHA1**
over the raw body).

## Capture, refund, cancel

The responses are synchronous and return the updated transaction, so write Crystallize right after
([transaction management][tm]). Check the returned status: "captures might fail". No idempotency header is
documented, so re-read the transaction before retrying a capture.

```ts
const statusOf: Record<string, "paid" | "partiallyPaid" | "refunded" | "partiallyRefunded"> = {
    CAPTURED: "paid",
    PARTIALLY_CAPTURED: "partiallyPaid",
    REFUNDED: "refunded",
    PARTIALLY_REFUNDED: "partiallyRefunded",
    PARTIALLY_CAPTURED_REFUNDED: "partiallyRefunded",
};

// `captured` = running total captured so far in major units, including this call
export async function captureDintero(txId: string, amount: number, captured: number) {
    const tx = await dintero<DinteroTx>(`/transactions/${txId}/capture`, { amount: minor(amount) }); // + items
    if (!statusOf[tx.status]) throw new Error(`Capture not applied: ${tx.status}`);
    await replacePayments(tx.merchant_reference, [{ ...toPayment(tx, "captured"), amount: captured }]);
    await setPaymentStatus(tx.merchant_reference, statusOf[tx.status]);
}

export async function refundDintero(txId: string, amount: number, reason: string) {
    const tx = await dintero<DinteroTx>(`/transactions/${txId}/refund`, { amount: minor(amount), reason });
    await addPayment(tx.merchant_reference, {
        provider: "dintero",
        method: "refund",
        amount,
        createdAt: new Date().toISOString(),
        transactionId: `${tx.id}:refund:${tx.events?.at(-1)?.id ?? Date.now()}`, // UNVERIFIED: event id field
        meta: [{ key: "type", value: "refund" }],
    });
    await setPaymentStatus(tx.merchant_reference, statusOf[tx.status] ?? "partiallyRefunded");
}

// Void before capture: POST /transactions/{id}/void → status AUTHORIZATION_VOIDED
// → replacePayments(cartId, [toPayment(tx, 'cancelled')]); stays unpaid; cancelled stage
```

## Mapping

```ts
export type DinteroTx = {
    id: string;
    status: string;
    amount: number;
    merchant_reference: string;
    created_at: string;
    payment_product_type: string;
    events?: { id?: string }[];
};
export const toPayment = (tx: DinteroTx, state: "authorized" | "captured" | "cancelled") => ({
    provider: "dintero",
    method: tx.payment_product_type, // dintero_psp.creditcard, vipps, klarna.klarna, collector.invoice …
    transactionId: tx.id, // e.g. T12345678.465Uf… — capture, refund and void use it
    amount: tx.amount / 100, // major units
    createdAt: tx.created_at,
    meta: [{ key: "state", value: state }],
});
```

Nothing else is needed later: the items (by `line_id`) can be re-read from the transaction
([record rules](../SKILL.md#the-payment-record)).

## Gotchas

- Round every amount; `strict-session-amounts` makes a mismatch fail at creation rather than at capture.
- `method=POST` on the callback URL switches to POST with the transaction in the body. The signature still doesn't
  cover the body, so re-fetch anyway.
- Also handle `CAPTURED` in the callback. With auto-capture (set on the session or the payment profile), no
  `AUTHORIZED` callback ever comes.
- Test cards ([PSP test data][cards]), any future expiry and CVC: Visa 4000 0000 0000 0002 (no 3DS challenge),
  4000 1000 0000 0000 (challenge), Mastercard 5200 0000 0000 0007, declined 4100 0000 0000 0076. Klarna via
  Dintero (NO): `customer@email.no`, +4740123456.
- In the old furniture boilerplates (`furniture-remix/application/src/use-cases/payments/dintero/*`):
    - It uses `@crystallize/node-service-api-request-handlers` + `pushOrder` with a `provider: 'custom'` payment and
      free-text properties, instead of `createOrderOnce` and a real `provider: 'dintero'` record.
    - A new token on every call; `gross * 100` unrounded; no per-item `vat`. Items send `discounts`, **UNVERIFIED**
      as still accepted (the spec now has `discount_lines`).
    - Only `AUTHORIZED` creates an order, so with auto-capture no order is ever created. There is no signature check
      and no idempotency.
    - A missing cart throws a 404, a 4xx that Dintero never retries.
    - Express shipping is hardcoded (Bring pick-up, 39 NOK, NO only) with stale 2023–2025 ETA dates.
