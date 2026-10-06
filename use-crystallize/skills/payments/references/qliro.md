# Qliro with Crystallize

Qliro is a Swedish payment provider for the Nordics (Sweden, Norway, Finland, Denmark). Its embedded checkout,
**Qliro Checkout** (formerly Qliro One), puts pay later (invoice, part payment), card payments and other Nordic methods
such as Trustly in one iframe. The recommended integration is the embedded checkout: create a Qliro order from the
placed cart (a signed server-to-server call), render the `OrderHtmlSnippet` it returns, and create the Crystallize
order from Qliro's checkout-status push — which is unsigned, so the server re-fetches the order before acting. The
purchase only **reserves** the money: `MarkItemsAsShipped` captures it when the goods ship, and Qliro reports the
outcome asynchronously on a separate order-management push.

> Verification: Written from Qliro's official docs, checked 2026-10-06. Not run end-to-end.
> Official docs: [Qliro Checkout][docs], [Authorization][auth], [Load checkout][load], [Notifications][notify],
> [Render thank-you page][thanks], [Listeners][listeners], [Order management][om], [Testing][test], [API
> reference][api] (Merchant API v1 and Admin API v2 as OpenAPI). Crystallize page: [Qliro][crystallize].

## At a glance

| Topic                     | Qliro                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Markets & currencies      | SE, NO, FI, DK (SEK, NOK, EUR, DKK); checkout in sv-se, nb-no, fi-fi, da-dk, en-us, de-de, fr-fr, nl-nl    |
| Recommended integration   | Qliro Checkout embedded: `CreateOrder` → `GetOrder` → inject `OrderHtmlSnippet`                            |
| Alternative               | Payment link: redirect to the `PaymentLink` that `CreateOrder` returns (hosted by Qliro)                   |
| API version               | Merchant API `v1` (`/checkout/merchantapi`), Admin API `v2` (`/checkout/adminapi/v2`)                      |
| SDKs                      | None: `fetch` + a signed header. The browser runs the snippet; `q1Ready` exposes the Frontend API          |
| Amount units              | Decimal **major** units, 0–2 decimals, **per item**; no order total is sent: Qliro sums the items          |
| Capture + auth lifetime   | Manual: `MarkItemsAsShipped`, result on the OM push. Session 90 min, order 48 h; reservation (unconfirmed) |
| Cart id field             | `MerchantReference` (≤ 25, `[A-Za-z0-9_\|-]`): first 25 chars of the cart id; full id in metadata          |
| One session per cart      | Deterministic `MerchantReference`; `GET …/orders?merchantReference=` before creating                       |
| Notification verification | None by design: an HMAC token in each push URL, then `GetOrder` / `GetPaymentTransaction`                  |

## Credentials and setup

Contact Qliro to open a merchant account (your onboarding agent, or integration@qliro.com). You get a test account
and environment first. The crystallize.com page names three settings:

- **API key** — identifies the store. It goes in the **body** of every request that has one (order creation, Admin
  API calls) as `MerchantApiKey`.
- **API secret** — server-side only. It signs every request: `Authorization: Qliro <token>`, where the token is
  Base64(SHA-256(JSON body + secret)) and a `GET` hashes the secret alone ([authorization][auth]). Hash the exact
  string you send; re-serialising (key order, spaces) gives `401`.
- **Base URL** — `https://pago.qit.nu` (test), `https://payments.qit.nu` (production).

```bash
QLIRO_BASE_URL=https://pago.qit.nu   # https://payments.qit.nu in production
QLIRO_API_KEY=...                     # MerchantApiKey
QLIRO_API_SECRET=...                  # signs requests
QLIRO_PUSH_SECRET=...                 # 32+ random bytes: signs your push URLs
PUBLIC_URL=https://shop.example       # the tunnel URL in development
```

- **URLs Qliro needs:** the page embedding the iframe, `MerchantConfirmationUrl`, `MerchantTermsUrl`,
  `MerchantCheckoutStatusPushUrl` and `MerchantOrderManagementStatusPushUrl` (both required, unless Qliro configures
  them for you). They travel with each order. Everything is HTTPS, and push URLs must be reachable from the internet:
  tunnel localhost (ngrok, cloudflared).
- **Test identities** ([testing][test]) — personal / organisation numbers, Ok · OnHold · Denied:

| Country | B2C                                     | B2B                                     |
| ------- | --------------------------------------- | --------------------------------------- |
| Sweden  | 790625-5307 · 770530-1773 · 750420-8104 | 556001-1982 · 556006-1912 · 556010-2005 |
| Norway  | 22034149589 · 23034114714 · 23034114986 | 123456785 · 123123123 · 987654325       |
| Finland | 201042-9991 · 040842-922L · 030842-921X | 2678277-6 · 2194504-6 · 2392384-4       |
| Denmark | 0208429205 · 0408429226 · 0308429210    | 35168184 · 20578912 · 12655568          |

## Create the payment

Call this from the pay route in [SKILL.md](../SKILL.md#lock-the-cart-before-you-charge) with the **placed** cart.
Qliro takes a price **per item** with at most 2 decimals and sums the items itself, so each cart line is split into at
most two Qliro items whose totals equal the line exactly, and the sum is checked against `placed.total.gross`.

```ts
// lib/qliro.ts
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
    carts,
    createOrderOnce,
    PLACED_CART,
    readOrder,
    recordPayment,
    RetryLater,
    updatePayment,
    withMeta,
} from "@/lib/crystallize-payments";
import type { Payment, PlacedCart } from "@/lib/crystallize-payments";

const cents = (major: number) => Math.round(major * 100);

export async function qliro<T>(path: string, payload?: object, method = payload ? "POST" : "GET"): Promise<T> {
    const body = payload ? JSON.stringify({ MerchantApiKey: process.env.QLIRO_API_KEY, ...payload }) : "";
    const token = createHash("sha256")
        .update(body + process.env.QLIRO_API_SECRET)
        .digest("base64"); // the bytes sent
    const res = await fetch(`${process.env.QLIRO_BASE_URL}/checkout/${path}`, {
        method,
        headers: { Authorization: `Qliro ${token}`, "Content-Type": "application/json" },
        body: body || undefined,
    });
    if (res.status === 404 && path.includes("merchantReference=")) return null as T; // no order for this cart yet
    if (!res.ok) throw new Error(`Qliro ${method} ${path} ${res.status}: ${await res.text()}`); // ErrorCode, …
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
}

// Pushes are unauthenticated: an HMAC of (push type, cart id) in each URL proves the URL is yours
const sign = (type: string, cartId: string) =>
    createHmac("sha256", process.env.QLIRO_PUSH_SECRET!).update(`${type}:${cartId}`).digest("hex");
const pushUrl = (type: "checkout" | "om", cartId: string) =>
    `${process.env.PUBLIC_URL}/api/payments/qliro/webhook?type=${type}&cart=${cartId}&token=${sign(type, cartId)}`;
export function verifyPush(url: string) {
    const q = new URL(url).searchParams;
    const [type, cartId] = [q.get("type"), q.get("cart") ?? ""];
    if (type !== "checkout" && type !== "om") return null;
    const [got, want] = [Buffer.from(q.get("token") ?? ""), Buffer.from(sign(type, cartId))];
    return got.length === want.length && timingSafeEqual(got, want) ? { type, cartId } : null;
}

const TYPE: Record<string, string> = { shipping: "Shipping", fee: "Fee", promotion: "Discount" }; // else Product
const reference = (s: string) => s.replace(/[^\p{L}\s(.)'\-_&,/–+0-9:|]/gu, "-").slice(0, 200); // Qliro's pattern

export function orderItems(placed: PlacedCart) {
    const items = placed.items.flatMap((item, i) => {
        const [total, q, rate] = [cents(item.price.gross), item.quantity, item.price.taxPercent];
        const unit = Math.floor(total / q);
        const extra = total - unit * q; // 0 ≤ extra < q: that many units cost one cent more, so the line is exact
        const line = (Quantity: number, c: number) => ({
            MerchantReference: reference(item.variant?.sku ?? item.lineId ?? `line-${i}`),
            Description: item.name,
            Type: TYPE[item.type ?? ""] ?? "Product",
            Quantity,
            PricePerItemIncVat: c / 100,
            PricePerItemExVat: Math.round(c / (1 + rate / 100)) / 100,
            VatRate: rate, // 25 = 25 %
        });
        return extra ? [line(q - extra, unit), line(extra, unit + 1)] : [line(q, unit)];
    });
    const drift = cents(placed.total.gross) - items.reduce((s, l) => s + cents(l.PricePerItemIncVat) * l.Quantity, 0);
    if (Math.abs(drift) > placed.items.length) throw new Error(`Items miss ${drift} cents of cart ${placed.id}`);
    if (drift) {
        const price = drift / 100; // cents lost when line totals carry more than 2 decimals
        items.push({
            MerchantReference: "rounding",
            Description: "Rounding",
            Type: drift < 0 ? "Discount" : "Fee",
            Quantity: 1,
            PricePerItemIncVat: price,
            PricePerItemExVat: price,
            VatRate: 0,
        });
    }
    return items;
}

export type QliroItem = { MerchantReference: string; Type: string; Quantity: number; PricePerItemIncVat: number };
export type QliroOrder = {
    OrderId: number;
    MerchantReference: string;
    TotalPrice: number;
    Currency: string;
    CustomerCheckoutStatus: "InProcess" | "OnHold" | "Completed" | "Refused";
    OrderHtmlSnippet: string;
    PaymentLink?: string;
    PaymentMethod?: { PaymentMethodName: string };
    MerchantProvidedMetadata: { Key: string; Value: string }[];
    OrderItems: QliroItem[]; // filled once Completed/OnHold
};
export type QliroMarket = { country: string; language: string }; // from the Crystallize market, e.g. SE + sv-se

export const merchantReference = (cartId: string) => cartId.slice(0, 25); // Qliro's maximum length

export async function createQliroCheckout(placed: PlacedCart, market: QliroMarket) {
    const ref = merchantReference(placed.id);
    // a second tab finds the first tab's order; a click in the same instant can still create a second one,
    // and the duplicate-payment flag in createOrderOnce covers it
    const found = await qliro<QliroOrder | null>(`merchantapi/orders?merchantReference=${ref}`);
    if (found) return found;
    const c = placed.customer;
    const a = c?.addresses?.find((x) => x.type === "billing") ?? c?.addresses?.[0];
    const company = c?.type === "organization";
    const { OrderId } = await qliro<{ OrderId: number; PaymentLink: string }>("merchantapi/orders", {
        MerchantReference: ref,
        MerchantProvidedMetadata: [{ Key: "cartId", Value: placed.id }], // the full id (Value ≤ 250)
        Country: market.country,
        Currency: placed.total.currency.toUpperCase(),
        Language: market.language,
        MerchantTermsUrl: `${process.env.PUBLIC_URL}/terms`,
        MerchantConfirmationUrl: `${process.env.PUBLIC_URL}/checkout/confirmation?cart=${placed.id}`,
        MerchantCheckoutStatusPushUrl: pushUrl("checkout", placed.id),
        MerchantOrderManagementStatusPushUrl: pushUrl("om", placed.id),
        OrderItems: orderItems(placed),
        CustomerInformation: {
            // prefill: the shopper does not type it again
            Email: c?.email,
            MobileNumber: c?.phone,
            JuridicalType: company ? "Company" : "Physical",
            Address: a && {
                FirstName: a.firstName,
                LastName: a.lastName,
                CompanyName: c?.companyName,
                Street: [a.street, a.streetNumber].filter(Boolean).join(" "),
                PostalCode: a.postalCode,
                City: a.city,
            },
        },
        ...(company && { EnforcedJuridicalType: "Company" }), // B2B chosen in the storefront, before place
    });
    return qliro<QliroOrder>(`merchantapi/orders/${OrderId}`); // GetOrder carries the HTML snippet
}
```

The pay route returns `OrderHtmlSnippet` when the order is `InProcess`. A found order that is `Completed` or `OnHold`
is already submitted: send the shopper to the confirmation page. `Refused` cannot be paid again: start a new cart.

- **Lifetimes:** a checkout session lasts 90 minutes and a Qliro order 48 hours. When the session expires Qliro shows
  a dialog and reloads the page; to resume an older `InProcess` order, renew it with `UpdateOrder`
  (`PUT merchantapi/orders/{OrderId}` with the same `OrderItems`, through `qliro(path, body, "PUT")`) before
  `GetOrder`. Past 48 hours, start a new cart.
- **Item rules** (else `INVALID_INPUT`): `PricePerItemIncVat` ≥ `PricePerItemExVat`; `Product`, `Fee` and `Shipping`
  ≥ 0; `Discount` ≤ 0 (for a taxed discount the first rule presumably compares absolute values: unconfirmed). Qliro
  identifies an item by `MerchantReference` + `PricePerItemIncVat`.

## Client

```tsx
// app/checkout/qliro-checkout.tsx
"use client";
import { useEffect, useRef } from "react";

type Q1 = { onPaymentDeclined(cb: (reason: string, message?: string) => void): void };
declare global {
    interface Window {
        q1Ready?: (q1: Q1) => void;
    }
}

export function QliroCheckout({ snippet }: { snippet: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        window.q1Ready = (q1) => q1.onPaymentDeclined((reason) => console.warn("Qliro declined:", reason));
        const el = ref.current!;
        el.innerHTML = snippet; // a <script> set through innerHTML never runs: re-create each one
        for (const old of Array.from(el.querySelectorAll("script"))) {
            const s = document.createElement("script");
            for (const attr of Array.from(old.attributes)) s.setAttribute(attr.name, attr.value);
            s.text = old.text;
            old.replaceWith(s);
        }
    }, [snippet]);
    return <div ref={ref} />;
}
```

When the purchase is `Completed` or `OnHold`, Qliro redirects to `MerchantConfirmationUrl` — the return page from
[SKILL.md](../SKILL.md#the-return-page). It reads the cart named by `cart` in its URL: `ordered` → confirmation and
clear the cart cookie; still `placed` → "confirming your payment…" and refresh. Qliro also wants a call from this
page: a new `GetOrder` (`merchantapi/orders?merchantReference=…`) returns Qliro's thank-you page as a new
`OrderHtmlSnippet`; render it with the same component ([render thank-you page][thanks]), and say "under review" while
the status is `OnHold`. The page still never creates the order: the push does.

## Webhook

Both push URLs point to one route, but the **signed `type`** in each URL keeps them apart: only a checkout-status
push can reach `createOrderOnce`, and an order-management push (capture, refund, cancel results) never creates an
order. Qliro signs nothing, so both re-read Qliro before acting. The answer must be the JSON
`{ "CallbackResponse": "received" }`; anything else is retried at once, then after 2 s, 5 s, 10 s, 30 s, 1 min, 2 min,
30 min, 1 h, 24 h and 3 days ([notifications][notify]). The same push can also arrive several times.

```ts
// lib/qliro.ts (continued). Keep helpers here: a Next route file may only export HTTP methods.
type CheckoutPush = { OrderId: number; Status: string; NotificationType: string; Timestamp: string };
type OmPush = { OrderId: number; PaymentTransactionId: number; PaymentType: string; Status: string };
export type QliroTx = {
    PaymentTransactionId: number;
    OrderId: number;
    Type: string;
    Status: string;
    Amount: number;
    Timestamp: string;
    ErrorCode?: string;
};
type AdminOrder = { PaymentTransactions: QliroTx[] }; // Admin API GetOrder

export async function onCheckoutStatus(cartId: string, push: CheckoutPush) {
    if (push.NotificationType !== "CustomerCheckoutStatus") return; // UpsellStatus pushes share this URL
    const order = await qliro<QliroOrder>(`merchantapi/orders/${push.OrderId}`); // the push is only a hint
    if (order.MerchantProvidedMetadata.find((m) => m.Key === "cartId")?.Value !== cartId) {
        throw new Error(`Qliro order ${push.OrderId} is not cart ${cartId}'s`);
    }
    if (order.CustomerCheckoutStatus !== "Completed") return; // InProcess; OnHold (another push follows); Refused
    // Qliro's items are what the shopper paid for: they must be the placed cart, or the order would ship something else
    const placed = (await carts.fetch(cartId, PLACED_CART)) as unknown as PlacedCart;
    if (cents(order.TotalPrice) !== cents(placed.total.gross)) {
        throw new Error(`Qliro order ${order.OrderId}: ${order.TotalPrice}, cart ${cartId}: ${placed.total.gross}`);
    }
    await createOrderOnce(cartId, "unpaid", toPayment(order, cartId)); // a repeated push is absorbed here
}

export async function onOrderManagementStatus(cartId: string, push: OmPush) {
    const tx = await qliro<QliroTx>(`adminapi/v2/paymentTransactions/${push.PaymentTransactionId}`); // re-read
    if (!["Capture", "Refund", "Reversal"].includes(tx.Type)) return; // Preauthorization, Debit, UpdateInvoice, …
    if (["Created", "InProcess", "OnHold"].includes(tx.Status)) return; // another push follows
    const id = String(tx.OrderId);
    const order = await readOrder(cartId);
    if (!order?.payments?.some((p) => p.provider === "qliro" && p.transactionId === id)) {
        throw new RetryLater(`order ${cartId} has no Qliro payment ${id} yet`);
    }
    if (tx.Status !== "Success") {
        // Error or Cancelled: no money moved
        console.error(`[qliro] ${tx.Type} ${tx.PaymentTransactionId} on ${id}: ${tx.Status} ${tx.ErrorCode ?? ""}`);
        return updatePayment(cartId, id, (p) => withMeta(p, { attention: `${tx.Type.toLowerCase()}-failed` }));
    }
    if (tx.Type === "Capture") {
        const { PaymentTransactions: all } = await qliro<AdminOrder>(`adminapi/v2/orders/${id}`);
        const ok = all.filter((t) => t.Type === "Capture" && t.Status === "Success");
        const captured = ok.reduce((sum, t) => sum + t.Amount, 0); // several partial captures add up
        const values = { state: "captured", captureTransactionId: String(tx.PaymentTransactionId) }; // for ReturnItems
        await updatePayment(cartId, id, (p) => withMeta(p, values, captured));
    } else if (tx.Type === "Refund") {
        await recordPayment(cartId, {
            provider: "qliro",
            method: "refund",
            transactionId: String(tx.PaymentTransactionId),
            amount: tx.Amount,
            createdAt: tx.Timestamp,
            meta: [
                { key: "type", value: "refund" },
                { key: "cartId", value: cartId },
                { key: "qliroOrderId", value: id },
            ],
        });
    } // Reversal = cancelorder went through: cancel() already set state=cancelled
}
```

```ts
// app/api/payments/qliro/webhook/route.ts — both push URLs, told apart by the signed `type`
import { onCheckoutStatus, onOrderManagementStatus, verifyPush } from "@/lib/qliro";

export async function POST(req: Request) {
    const body = await req.text();
    const push = verifyPush(req.url);
    if (!push) return new Response("bad token", { status: 401 });
    try {
        if (push.type === "checkout") await onCheckoutStatus(push.cartId, JSON.parse(body));
        else await onOrderManagementStatus(push.cartId, JSON.parse(body)); // never creates an order
        return Response.json({ CallbackResponse: "received" });
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 }); // not "received": Qliro retries for up to 3 days
    }
}
```

| Qliro (re-read)                                    | Crystallize ([paymentStatus](../SKILL.md#paymentstatus))                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Checkout push, `CustomerCheckoutStatus: Completed` | `createOrderOnce(cartId, 'unpaid', …)`, `state=authorized`                        |
| `InProcess`                                        | Nothing: the shopper is still in the checkout                                     |
| `OnHold`                                           | Nothing yet: Qliro pushes again when it turns `Completed` or `Refused`            |
| `Refused`                                          | No order. The placed cart cannot be paid with this Qliro order: new cart          |
| OM push, `Capture` `Success`                       | `updatePayment` → `state=captured`, amount = captured sum, `captureTransactionId` |
| OM push, `Refund` `Success`                        | `recordPayment`, `meta type=refund` (deduped by `PaymentTransactionId`)           |
| OM push, `Reversal` `Success` (`cancelorder`)      | Nothing more: `cancel()` set `state=cancelled`                                    |
| OM push, `Error` / `Cancelled`                     | `meta attention=<type>-failed` and an alert; a failed capture stays `authorized`  |

Things to keep in mind, from the crystallize.com page and Qliro's docs:

- **Push notifications are not authenticated.** Always re-fetch (`GetOrder`, `GetPaymentTransaction`) before acting.
  Qliro suggests a short-lived token in the push URL; the HMAC token here does not expire on purpose, because
  order-management pushes arrive days or weeks later. It proves the URL is yours; the re-fetch proves the content.
- **Duplicates and retries** (up to 3 days): discard duplicates by `OrderId`, status and `Timestamp`, or check that
  the cart has not already become an order. `createOrderOnce`, `recordPayment` (by transaction id) and
  `updatePayment` make every push safe to repeat.
- **`GetOrder`'s items are the source of truth** for what the shopper paid for; here they must equal the placed cart.
- **Push URLs** must be HTTPS and reachable from the internet; tunnel localhost while developing.

## Capture, refund, cancel

Admin API calls answer at once with `{ PaymentTransactions: [{ PaymentTransactionId, Status: "Created" }] }`; the
outcome arrives on the order-management push, so Crystallize is written **in the webhook**. `RequestId` is a GUID
that Qliro **refuses** to run twice within 7 days — a repeat is denied, not replayed — so check before you send.
`capture()` returns `null`: the stage handler in [SKILL.md](../SKILL.md#capture-on-shipment-from-fulfilment-pipelines)
then leaves the record alone, and the `Capture` push flips it to `captured`.

```ts
// lib/qliro.ts (continued) — captureByProvider.qliro = capture
export async function capture(transactionId: string): Promise<number | null> {
    const { PaymentTransactions } = await qliro<AdminOrder>(`adminapi/v2/orders/${transactionId}`);
    const pending = PaymentTransactions.some((t) => t.Type === "Capture" && !["Error", "Cancelled"].includes(t.Status));
    if (pending) return null; // a redelivered stage webhook: the first capture is under way or done
    const order = await qliro<QliroOrder>(`merchantapi/orders/${transactionId}`);
    await qliro("adminapi/v2/markitemsasshipped", {
        RequestId: randomUUID(),
        OrderId: order.OrderId,
        Currency: order.Currency,
        Shipments: [
            {
                OrderItems: order.OrderItems.map(({ MerchantReference, Type, Quantity, PricePerItemIncVat }) => ({
                    MerchantReference,
                    Type,
                    Quantity,
                    PricePerItemIncVat,
                })),
            },
        ], // a partial capture sends fewer
    });
    return null; // asynchronous: the OM push sets state=captured
}

/** After capture only (before it: cancel). `items` as GetOrder lists them; `requestId`: a GUID kept for this refund. */
export async function refund(cartId: string, qliroOrderId: string, items: QliroItem[], requestId: string) {
    const record = (await readOrder(cartId))?.payments?.find((p) => p.transactionId === qliroOrderId);
    const captureTx = record?.meta?.captureTransactionId;
    if (!captureTx) throw new Error(`Qliro order ${qliroOrderId} is not captured: cancel it instead`);
    const { Currency } = await qliro<QliroOrder>(`merchantapi/orders/${qliroOrderId}`);
    await qliro("adminapi/v2/returnitems", {
        RequestId: requestId,
        OrderId: Number(qliroOrderId),
        Currency,
        Returns: [{ PaymentTransactionId: Number(captureTx), OrderItems: items }], // the capture's id, not the order's
    }); // the Refund push records it
}

/** Before shipping: releases the reservation. */
export async function cancel(cartId: string, qliroOrderId: string) {
    await qliro("adminapi/v2/cancelorder", { RequestId: randomUUID(), OrderId: Number(qliroOrderId) });
    await updatePayment(cartId, qliroOrderId, (p) => withMeta(p, { state: "cancelled" })); // a failed Reversal flags it
}
```

- Admin API errors worth a retry later: `PAYMENT_ONHOLD`, and `OPERATION_NOT_SUPPORTED` with "Another transaction is
  already in process"; `INVALID_REQUEST_TOTAL_AMOUNT` / `EXCEEDING_QUANTITY` mean the items do not match the order.
- `ReturnItems` works only after capture; return fees go in `Fees`, extra discounts in `Discounts`. Cancelling a
  Trustly payment creates an extra `Refund` transaction, which the webhook records as a refund — correct, since
  Trustly had already moved the money.
- One order can have many `PaymentTransactionId`s (upsell, updates); Qliro advises using the latest successful one.
  After several partial captures, refund each item against the capture that shipped it.
- How long a reservation stays capturable depends on the payment method (unconfirmed: Qliro does not publish it).

## Mapping

```ts
// lib/qliro.ts (continued)
export const toPayment = (o: QliroOrder, cartId: string): Payment => ({
    provider: "qliro",
    method: o.PaymentMethod?.PaymentMethodName.toLowerCase() ?? "qliro", // e.g. CREDITCARDS → creditcards
    transactionId: String(o.OrderId), // every Admin API call takes the OrderId
    amount: o.TotalPrice, // already major units
    createdAt: new Date().toISOString(),
    meta: [
        { key: "state", value: "authorized" },
        { key: "cartId", value: cartId },
    ], // the Capture push adds captureTransactionId
});
```

A refund is its own record: `transactionId` = the refund's `PaymentTransactionId`, `amount` in major units,
`meta` `type=refund`, `cartId`, `qliroOrderId` (written by the webhook above).

## Provider specifics

- **B2B:** a company chosen in the storefront is on the cart customer (`type: "organization"`) before `place`; the
  create call then sends `JuridicalType: "Company"` and `EnforcedJuridicalType: "Company"` (only companies may
  complete). For a company, Qliro reads `CustomerInformation.PersonalNumber` as the organisation number and
  `VatNumber` as the VAT number — send them if your cart customer carries them.
- **Prefill and lock:** `CustomerInformation` (`Email`, `MobileNumber`, `PersonalNumber`, `Address`, `ShippingAddress`
  for B2B) plus `LockCustomerEmail`, `LockCustomerMobileNumber`, `LockCustomerPersonalNumber`, `LockCustomerAddress` or
  `LockCustomerInformation` keep what the storefront collected; locking can disable Qliro's own payment methods.
- **A method chosen before `place`:** `POST merchantapi/PaymentOptions` lists the payment ids; store the choice on the
  cart (`carts.setMeta(id, { meta: [{ key: "qliroPaymentId", value }], merge: true })`) and send it as `PaymentId` to
  open the checkout on that method.
- **Frontend listeners** (inside `q1Ready`): `onCheckoutLoaded`, `onCustomerInfoChanged`, `onPaymentMethodChanged`,
  `onShippingMethodChanged`, `onShippingPriceChanged`, `onPaymentDeclined`, `onPaymentProcess`, `onSessionExpired`,
  `onCustomerDeauthenticating`, and `lock()` / `unlock()` / `onOrderUpdated()` around an `UpdateOrder`. The placed
  cart never changes, so you only need them to mirror Qliro's state in your page.
- **After payment (prose only):** `checkout/adminapi/v2/updateitems` (change items before shipping),
  `…/additemstoinvoice` (discounts on an invoice after capture), `…/updatemerchantreference`,
  `…/retryreversalpaymenttransaction`, `GET …/paymentTransactions/{id}`; settlements under `…/settlements`;
  upsell on the thank-you page (`POST merchantapi/Upsell`, an `UpsellStatus` push); saved cards and recurring orders
  (`MerchantSavedCreditCardPushUrl`, `adminapi/v2/merchantpayment`) for subscription contracts — not covered here.

## Going further

Everything Qliro Checkout offers beyond the flow above, from the crystallize.com page and Qliro's docs:

- **Order management** from Crystallize fulfilment pipelines: this reference's `capture()`, `refund()` and `cancel()`,
  driven by a stage webhook, with results on `MerchantOrderManagementStatusPushUrl`. The Qliro `OrderId` is the
  payment record's `transactionId`. See [order management][om].
- **Order validation:** `MerchantOrderValidationUrl` makes Qliro POST the order (items, customer, addresses, payment
  method) when the shopper clicks "Complete purchase". Answer `200` to accept, or `400` with
  `{ "DeclineReason": "OutOfStock" }` (or `PostalCodeIsNotSupported`, `ShippingIsNotSupportedForPostalCode`,
  `CashOnDeliveryIsNotSupportedForShippingMethod`, `IdentityNotVerified`, `Other` + `DeclineReasonMessage` ≤ 150
  chars). **No answer within 5 s approves the order** unless Qliro configures auto-reject. Protect it like a push URL.
- **Shipping in the checkout:** a static `AvailableShippingMethods` list, a dynamic
  `MerchantOrderAvailableShippingMethodsUrl` (5 s to answer), or integrations such as Ingrid and Unifaun (nShift)
  through `ShippingConfiguration`, plus `MerchantOrderAvailableShippingAddressesUrl` and `MerchantNotificationUrl`
  for the provider's data. **Warning:** shipping chosen inside Qliro is charged by Qliro on top of the placed cart, so
  the shopper pays more than the cart and the Crystallize order has no shipping line — the webhook above refuses such
  orders. Choose shipping in the storefront, as an external item, before `place`.
- **Thank-you page:** after completion `GetOrder` returns Qliro's thank-you snippet ([Client](#client));
  `q1.excludeResultModules(["HEADER", "TOTAL_PRICE", "CUSTOMER_DETAILS", "SHIPPING_METHOD"])` hides parts of it.
- **Customer and B2B options:** `LockCustomerEmail`, `LockCustomerAddress` and the other lock flags;
  `EnforcedJuridicalType` for companies only; `RequireIdentityVerification` for BankID in Sweden; `MinimumCustomerAge`.
- **Look and feel:** `PrimaryColor`, `CallToActionColor`, `CallToActionHoverColor`, `BackgroundColor` (saturation
  ≤ 10 %), `CornerRadius`, `ButtonCornerRadius`; also `AskForNewsletterSignup`, `MerchantProvidedQuestion`,
  `ShippingAdditionalHeader`, `MerchantIntegrityPolicyUrl`.
- **Payment link:** instead of the iframe, redirect the shopper to `PaymentLink` (in the `CreateOrder` and `GetOrder`
  responses); `MerchantCancelUrl` adds a cancel link. Pushes, confirmation page and webhook stay the same.
- **Frontend listeners:** Qliro's Frontend API keeps your page in sync with the iframe ([listeners][listeners]).
- **Markets:** country, currency and language come from the cart's market and locale, never a fixed `NO` / `NOK` /
  `en-us`.

## Common mistakes

- Sending both push types to one handler that creates an order whenever `GetOrder` says `Completed`: every capture,
  refund or repeated push then creates another order. Keep the signed `type`, check `NotificationType`, and let only
  the checkout push call `createOrderOnce`.
- Push URLs without a token, or trusting the push body instead of re-fetching.
- Recording the payment without Qliro's `OrderId` (e.g. a bare "custom" payment): nothing to capture or refund with.
- Never calling the Admin API: reservations are never captured and nothing is paid.
- Hardcoding `Country: "NO"`, `Currency: "NOK"`, `Language: "en-us"`.
- Leaving out shipping or discount lines, or rounding `line / quantity` to 2 decimals: Qliro then charges a different
  amount than the placed cart.
- Clearing the cart cookie when the Qliro order is created: an abandoned payment loses the cart. Clear it on the
  confirmation page once the cart is `ordered`.
- Setting the snippet with `innerHTML` and stopping there: the scripts never run and the iframe never appears.
- Hashing a re-serialised body (`401`), or forgetting `MerchantApiKey` in Admin API bodies.
- Answering a push with anything but `{"CallbackResponse":"received"}`: Qliro retries for 3 days.
- Treating the Admin API's `Created` as done; using `ReturnItems` before capture; refunding against the order's
  first transaction id instead of the capture's.
- Going live with `https://pago.qit.nu`.

[docs]: https://developers.qliro.com/docs/qliro-checkout
[auth]: https://developers.qliro.com/docs/qliro-checkout/get-started/authorization
[load]: https://developers.qliro.com/docs/qliro-checkout/get-started/load-checkout
[notify]: https://developers.qliro.com/docs/qliro-checkout/get-started/notifications-checkout
[thanks]: https://developers.qliro.com/docs/qliro-checkout/get-started/render-thank-you-page
[listeners]: https://developers.qliro.com/docs/qliro-checkout/frontend-features/listeners
[om]: https://developers.qliro.com/docs/qliro-checkout/order-management
[test]: https://developers.qliro.com/docs/qliro-checkout/get-started/testing
[api]: https://developers.qliro.com/docs/api
[crystallize]: https://crystallize.com/docs/developer/integrations/payment-gateways/qliro
