# Qliro with Crystallize

> Verification: Written from Qliro's official docs, checked 2026-09-29. Not run end-to-end.
> Official docs: [Qliro Checkout][docs] (formerly "Qliro One"), [API reference][api] (embedded OpenAPI). No llms.txt.

[docs]: https://developers.qliro.com/docs/qliro-checkout
[api]: https://developers.qliro.com/docs/api
[notify]: https://developers.qliro.com/docs/qliro-checkout/get-started/notifications-checkout
[auth]: https://developers.qliro.com/docs/qliro-checkout/get-started/authorization
[test]: https://developers.qliro.com/docs/qliro-checkout/get-started/testing

## At a glance

|              |                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| Markets      | SE, NO, FI, DK (SEK, NOK, EUR, DKK). **UNVERIFIED** beyond the Nordics; no US                            |
| Recommended  | Qliro Checkout **embedded**: create order → GetOrder → inject `OrderHtmlSnippet`                         |
| Alternative  | Payment Link: the create response's `PaymentLink` as a redirect (`PaymentId` preselects a method)        |
| API / SDK    | Merchant API `v1`, Admin API `v2`. No server SDK (`fetch`); the browser uses the snippet + `q1Ready`     |
| Amounts      | **Decimal major units**, 0–2 decimals (`375.55`). There is no order total: Qliro sums the items          |
| Capture      | Manual: `MarkItemsAsShipped`, with the result pushed asynchronously. Reservation lifetime **UNVERIFIED** |
| Cart id      | `MerchantProvidedMetadata` `{ Key ≤50, Value ≤250 }`; `MerchantReference` (≤25 chars) is too short       |
| Verification | Unauthenticated by design. HMAC token in the push URL, then re-fetch the order                           |

## Setup

- No self-serve sandbox: test `MerchantApiKey` and secret come from Qliro onboarding (integration@qliro.com).
- **Base URLs:** test `https://pago.qit.nu`, live `https://payments.qit.nu`. **UNVERIFIED** in Qliro's docs; taken
  from Qliro's own Magento-2 plugin (`QLIRO_SANDBOX_API_URL` / `QLIRO_PROD_API_URL`) and Krokedil's WooCommerce plugin.
- **Auth** ([authorization][auth]): `Authorization: Qliro base64(sha256(<exact JSON body> + secret))`; `''` for GET.
  The body also carries `MerchantApiKey`. Serialize once, then hash and send that same string.
- **Push URLs** travel with each order. They and the confirmation URL must be public HTTPS: tunnel localhost.

```bash
QLIRO_API_URL=https://pago.qit.nu
QLIRO_API_KEY=…
QLIRO_API_SECRET=…
QLIRO_CALLBACK_SECRET=…     # random 32+ bytes, used to sign push URLs
PUBLIC_URL=https://….ngrok.app
```

## Create the session

Create the Qliro order from the **placed** cart (Shop `/cart`); `item.price` is the line total (verified on
live carts). Qliro identifies a line by `MerchantReference` + `PricePerItemIncVat`: keep references unique.

```ts
// lib/qliro.ts
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { addPayment, replacePayments, setPaymentStatus } from "@/lib/crystallize-payments";

type PlacedCart = {
    id: string;
    total: { gross: number; currency: string };
    items: {
        lineId?: string | null;
        name: string;
        quantity: number;
        type?: string | null;
        variant: { sku: string | null };
        price: { gross: number; net: number };
    }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100; // Qliro takes at most 2 decimals
export const sign = (v: string) => createHmac("sha256", process.env.QLIRO_CALLBACK_SECRET!).update(v).digest("hex");

export async function qliro<T>(path: string, payload?: object): Promise<T> {
    const body = payload ? JSON.stringify({ ...payload, MerchantApiKey: process.env.QLIRO_API_KEY }) : "";
    const token = createHash("sha256")
        .update(body + process.env.QLIRO_API_SECRET)
        .digest("base64");
    const res = await fetch(`${process.env.QLIRO_API_URL}/${path}`, {
        method: payload ? "POST" : "GET",
        headers: { Authorization: `Qliro ${token}`, "Content-Type": "application/json" },
        body: body || undefined,
    });
    if (!res.ok) throw new Error(`Qliro ${path} ${res.status}: ${await res.text()}`); // ErrorCode, ErrorReference
    return res.json() as Promise<T>;
}

export async function createQliroSession(cart: PlacedCart, market: { country: string; language: string }) {
    const OrderItems = cart.items.map((item, i) => ({
        MerchantReference: `${item.variant.sku ?? "line"}-${item.lineId ?? i}`.slice(0, 200),
        Description: item.name,
        Type: item.type === "shipping" ? "Shipping" : item.type === "fee" ? "Fee" : "Product",
        Quantity: item.quantity,
        PricePerItemIncVat: r2(item.price.gross / item.quantity),
        PricePerItemExVat: r2(item.price.net / item.quantity),
    }));
    // Per-unit rounding can drift from the placed total: absorb the cents in one line
    const drift = r2(cart.total.gross - OrderItems.reduce((s, l) => s + l.PricePerItemIncVat * l.Quantity, 0));
    if (drift !== 0)
        OrderItems.push({
            MerchantReference: "rounding",
            Description: "Rounding",
            Quantity: 1,
            Type: drift < 0 ? "Discount" : "Fee",
            PricePerItemIncVat: drift,
            PricePerItemExVat: drift,
        });

    const [q, base] = [`cart=${cart.id}&sig=${sign(cart.id)}`, process.env.PUBLIC_URL];
    const { OrderId } = await qliro<{ OrderId: number; PaymentLink: string }>("checkout/merchantapi/orders", {
        MerchantReference: crypto.randomUUID().replace(/-/g, "").slice(0, 25), // unique, fits the pattern
        MerchantProvidedMetadata: [{ Key: "crystallizeCartId", Value: cart.id }],
        Country: market.country, // SE | NO | FI | DK
        Currency: cart.total.currency.toUpperCase(),
        Language: market.language, // sv-se, nb-no, fi-fi, da-dk, en-us …
        MerchantTermsUrl: `${base}/terms`,
        MerchantConfirmationUrl: `${base}/checkout/qliro/return?cart=${cart.id}`,
        MerchantCheckoutStatusPushUrl: `${base}/api/payments/qliro/webhook?${q}`, // Completed / OnHold / Refused
        MerchantOrderManagementStatusPushUrl: `${base}/api/payments/qliro/webhook?${q}`, // capture, refund …
        OrderItems,
    });
    const order = await qliro<{ OrderHtmlSnippet: string }>(`checkout/merchantapi/orders/${OrderId}`);
    return { qliroOrderId: OrderId, snippet: order.OrderHtmlSnippet };
}
```

- `Product`, `Fee` and `Shipping` ≥ 0, `Discount` ≤ 0, `IncVat ≥ ExVat`; anything else is `INVALID_INPUT`.
- Optional `MerchantOrderValidationUrl` (POST at "Complete purchase"): answer 200, or 400 `{ DeclineReason:
'OutOfStock' }`. **No answer within 5 s approves the order.**

## Client

```tsx
"use client";
import { useEffect, useRef } from "react";

export function QliroCheckout({ snippet }: { snippet: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        (window as any).q1Ready = (q1: any) => q1.onPaymentDeclined((reason: string) => console.warn(reason));
        const el = ref.current!;
        el.innerHTML = snippet; // innerHTML does not run <script>: re-create each one
        el.querySelectorAll("script").forEach((old) => {
            const s = document.createElement("script");
            for (const a of Array.from(old.attributes)) s.setAttribute(a.name, a.value);
            s.text = old.text;
            old.replaceWith(s);
        });
    }, [snippet]);
    return <div ref={ref} />;
}
```

On completion Qliro redirects to `MerchantConfirmationUrl`. That page re-runs GetOrder server-side, renders its new
`OrderHtmlSnippet` (the thank-you page) and polls the Shop order ([SKILL.md](../SKILL.md#the-payment-step)).

## Webhook

Both push URLs hit one route. There is no signature: verify the URL's HMAC, then **re-fetch** the order
([notifications][notify]). Answer `200 {"CallbackResponse":"received"}`, or Qliro retries (immediately, then 10 times
over ~3 days). Pushes repeat; `createOrderOnce` and the recomputed sums make that harmless.

```ts
// lib/qliro.ts (continued)
export function verifyQliro(req: Request) {
    const q = new URL(req.url).searchParams,
        cart = q.get("cart") ?? "";
    const [got, want] = [Buffer.from(q.get("sig") ?? ""), Buffer.from(sign(cart))];
    return got.length === want.length && timingSafeEqual(got, want) ? cart : null;
}

// app/api/payments/qliro/webhook/route.ts (helpers stay in lib: Next allows only HTTP-method exports here)
import { createOrderOnce } from "@/lib/crystallize-payments";
import { applyOrderManagementPush, qliro, toPayment, verifyQliro, type QliroOrder } from "@/lib/qliro";

const received = () => Response.json({ CallbackResponse: "received" });
export async function POST(req: Request) {
    const cartId = verifyQliro(req);
    if (!cartId) return new Response("bad signature", { status: 401 });
    const push = JSON.parse(await req.text());
    try {
        const order = await qliro<QliroOrder>(`checkout/merchantapi/orders/${push.OrderId}`);
        const meta = order.MerchantProvidedMetadata.find((m) => m.Key === "crystallizeCartId");
        if (meta?.Value !== cartId) return (console.error("push for another cart", push), received());

        if (push.NotificationType === "CustomerCheckoutStatus" && order.CustomerCheckoutStatus === "Completed") {
            await createOrderOnce(cartId, "unpaid", toPayment(order, "authorized", push.PaymentTransactionId));
        } else if (push.PaymentType && push.Status === "Success") {
            await applyOrderManagementPush(cartId, order, push); // Capture / Refund, below
        }
        return received(); // OnHold, Refused, Preauthorization and Upsell pushes: acknowledge only
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 });
    }
}
```

| Qliro push                                   | Crystallize ([SKILL.md](../SKILL.md#paymentstatus))                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `CustomerCheckoutStatus` `Completed`         | `createOrderOnce(cartId, 'unpaid', …state=authorized)`                              |
| `OnHold`                                     | Nothing yet. A `Completed` or `Refused` push follows                                |
| `Refused`                                    | No order. The shopper retries with a new cart                                       |
| OM `PaymentType: Capture`, `Status: Success` | `replacePayments` captured; `paid` or `partiallyPaid`                               |
| OM `Refund` `Success`                        | `addPayment` refund; `partiallyRefunded` or `refunded`                              |
| OM `Status: Error`                           | Log `ErrorCode` and alert; retry later on `PAYMENT_ONHOLD` / "Another transaction…" |

**Never create an order from an OM push.** The old code did, which duplicated orders.

## Capture, refund, cancel

Admin calls answer `{ PaymentTransactionId, Status: 'Created' }` at once. The outcome arrives on the OM push, so write
Crystallize **in the webhook**, not after the call. `RequestId` is the idempotency key: a GUID Qliro rejects if repeated
within 7 days. Make one per operation and reuse it on retry.

```ts
type Line = { MerchantReference: string; Type: string; Quantity: number; PricePerItemIncVat: number };

export const captureQliro = (orderId: number, currency: string, items: Line[], requestId: string) =>
    qliro("checkout/adminapi/v2/markitemsasshipped", {
        RequestId: requestId,
        OrderId: orderId,
        Currency: currency,
        Shipments: [{ OrderItems: items }], // partial capture = send only the shipped lines
    });

export const refundQliro = (orderId: number, currency: string, captureTxId: number, items: Line[], id: string) =>
    qliro("checkout/adminapi/v2/returnitems", {
        RequestId: id,
        OrderId: orderId,
        Currency: currency,
        Returns: [{ PaymentTransactionId: captureTxId, OrderItems: items }], // the capture's transaction id
    });

// Before shipping: …/cancelorder { RequestId, OrderId } → replacePayments(cartId, [toPayment(o, 'cancelled')])

// Called from the webhook with a verified, re-fetched order. Sums come from the Admin API's PaymentTransactions.
export async function applyOrderManagementPush(cartId: string, order: QliroOrder, push: QliroOmPush) {
    const { PaymentTransactions: txs } = await qliro<{ PaymentTransactions: QliroTx[] }>(
        `checkout/adminapi/v2/orders/${order.OrderId}`,
    );
    const sum = (type: string) =>
        txs.reduce((n, t) => (t.Type === type && t.Status === "Success" ? n + t.Amount : n), 0);
    if (push.PaymentType === "Capture") {
        const p = toPayment(order, "captured", push.PaymentTransactionId); // its meta holds this capture's txn id
        await replacePayments(cartId, [{ ...p, amount: sum("Capture") }]);
        await setPaymentStatus(cartId, sum("Capture") >= order.TotalPrice ? "paid" : "partiallyPaid");
    } else if (push.PaymentType === "Refund") {
        await addPayment(cartId, {
            provider: "qliro",
            method: "refund",
            amount: push.Amount,
            transactionId: String(push.PaymentTransactionId),
            createdAt: new Date().toISOString(),
            meta: [
                { key: "type", value: "refund" },
                { key: "qliroOrderId", value: String(order.OrderId) },
            ],
        });
        await setPaymentStatus(cartId, sum("Refund") >= sum("Capture") ? "refunded" : "partiallyRefunded");
    } // PaymentType for cancelorder: UNVERIFIED (Krokedil handles Preauthorization, Capture, Reversal, Refund)
}
```

`ReturnItems` works only after capture (before: `cancelorder`). Take the `Line`s from the completed GetOrder
`OrderItems`: that is what the shopper paid for.

## Mapping

```ts
export type QliroOrder = {
    OrderId: number;
    TotalPrice: number;
    CustomerCheckoutStatus: string;
    PaymentMethod: { PaymentMethodName: string };
    MerchantProvidedMetadata: { Key: string; Value: string }[];
};
type QliroOmPush = { PaymentType: string; Status: string; Amount: number; PaymentTransactionId: number };
type QliroTx = { Type: string; Status: string; Amount: number };

export const toPayment = (o: QliroOrder, state: string, txId?: number) => ({
    provider: "qliro",
    method: o.PaymentMethod.PaymentMethodName.toLowerCase(), // e.g. CREDITCARDS → creditcards
    transactionId: String(o.OrderId), // every Admin API call uses OrderId
    amount: o.TotalPrice, // already major units
    createdAt: new Date().toISOString(),
    // after capture this is the capture's txn id, which ReturnItems needs
    meta: [
        { key: "state", value: state },
        { key: "paymentTransactionId", value: String(txId ?? "") },
    ],
});
```

A refund is its own record (`type=refund`, `transactionId` = the refund's `PaymentTransactionId`)
([record rules](../SKILL.md#the-payment-record)).

## Gotchas

- `MerchantReference` is `^[A-Za-z0-9_|-]{1,25}$`, so a UUID fails; `adminapi/v2/updatemerchantreference` can change it.
- Hash the **exact** body string you send; re-serializing (key order, spacing) gives 401.
- An order can have many `PaymentTransactionId`s (upsell, updates, Trustly cancel); refund with the capture's id.
- Test SSNs ([testing][test]) approve / OnHold / deny: SE 790625-5307 / 770530-1773 / 750420-8104, NO 22034149589 /
  23034114714 / 23034114986 (FI, DK, B2B on the same page).
- In the old furniture boilerplates (`nextjs-furnitut/use-cases/payments/qliro.ts`, `app/api/payments/qliro-webhook`):
    - **Duplicate orders.** Both push URLs hit one handler that calls `pushCrystallizeOrder` whenever the order is
      `Completed`, so every OM push (Preauthorization, Capture, Refund) and every repeat creates another order.
    - No token on the push URLs. The payment is `provider: 'custom'` with no Qliro `OrderId`: nothing to capture with.
    - Legacy `fetchOrderIntent` / `pushCrystallizeOrder`; `MerchantReference: cartId.substring(0, 25)` may collide.
    - `Country: 'NO'`, `Currency: 'NOK'` and `Language: 'en-us'` are hardcoded; no shipping or discount lines.
    - `storage.setCartId('')` runs at session creation (an abandoned payment loses the cart); `QLIRO_BASE_URL` must
      become `https://payments.qit.nu` for live.
