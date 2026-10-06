# Montonio with Crystallize

Montonio is an Estonian payment and shipping platform for merchants in Estonia, Latvia, Lithuania, Finland and Poland:
bank payments from every major Baltic, Finnish and Polish bank, plus cards, Apple Pay, Google Pay, MobilePay, BLIK and
financing, in EUR and PLN only, with parcel-machine and courier shipping from the same account. The recommended
integration lets the shopper pick a bank (and a parcel machine) in your checkout, creates a Stargate order from the
placed cart with the bank preselected, redirects to its `paymentUrl`, and creates the Crystallize order from the signed
`orderToken` webhook. There is no capture: a `PAID` order is final, and money goes back only through refunds.

> Verification: Written from Montonio's official docs, checked 2026-10-06. Not run end-to-end.
> Official docs: [Payments overview][overview], [API reference][reference], [Create and validate an Order][orders],
> [Display payment methods][methods], [Webhooks][webhooks], [Refunds][refunds], [Shipping v2][shipping]. Montonio asks
> agents to start from <https://docs.montonio.com/llms.txt> (all of it inlined: `/llms-full.txt`).

## At a glance

|                      |                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Markets & currencies | Estonia, Latvia, Lithuania, Finland, Poland. **EUR and PLN only** (no NOK, SEK, DKK)       |
| Recommended          | Stargate `POST /orders` with the bank preselected, then redirect to `paymentUrl`           |
| Alternative          | Embedded cards (`POST /sessions` + `@montonio/montonio-js`), payment links                 |
| API version          | Stargate (unversioned) `https://stargate.montonio.com/api`; Shipping `…/api/v2`            |
| SDKs                 | No server SDK: `jsonwebtoken@9` + `fetch`. Browser `@montonio/montonio-js@1` (cards only)  |
| Amount units         | **Major** units, 2 decimals (`grandTotal: 99.99`), like Crystallize — never × 100          |
| Capture              | None: `PENDING → PAID` is final. Opt-in `AUTHORIZED` is a bank still settling, not a hold  |
| Cart id              | `merchantReference` (required, unique per store), echoed in every order token              |
| One session per cart | Montonio enforces it: re-posting a `merchantReference` replaces the unpaid order           |
| Verification         | Webhook body `{ orderToken }` / `{ refundToken }`: an HS256 JWT signed with the Secret Key |

## Credentials and setup

- **Access Key** (identifies your calls) and **Secret Key** (signs every request and verifies every webhook; keep it on
  the server), as the crystallize.com page names them. Register at montonio.com, then in the Partner System
  (<https://partner.montonio.com>) open **Stores** → your store → **API Keys** tab. Sandbox keys work at once,
  production keys after Montonio approves the business; generating new keys invalidates the old ones.
- **Shipping** uses the same store keys (both APIs point to the same [API keys][keys]). Activate carriers in the
  Partner System; in sandbox, switch on test mode and activate carriers with dummy credentials — carrier calls and
  labels are mocked ([sandbox][ship-sandbox]).
- **Test data** (sandbox): cards `5577 0000 5577 0004` (success) and `5454 5454 5454 5454` (3DS), `03/30`, CVC `737`;
  `billingAddress.email = redirect-3ds-test@montonio.com` forces the redirect 3DS flow. BLIK `777 123` succeeds. The
  sandbox bank list comes from `GET /stores/payment-methods`; how its test banks behave is not documented (unconfirmed).
- **Webhooks** need no registration: each order carries its `notificationUrl`, and refund webhooks go to the same URL.
  They come from `35.156.245.42` and `35.156.159.169` with User-Agent `MontonioWebhooks/1.0` — allowlist them in a
  WAF or Cloudflare. Localhost: ngrok, or webhook.site to inspect payloads.

```bash
MONTONIO_ACCESS_KEY=…
MONTONIO_SECRET_KEY=…
MONTONIO_API_URL=https://sandbox-stargate.montonio.com/api            # prod: https://stargate.montonio.com/api
MONTONIO_SHIPPING_URL=https://sandbox-shipping.montonio.com/api/v2    # prod: https://shipping.montonio.com/api/v2
PUBLIC_URL=https://shop.example                                       # the tunnel in development
```

## Create the payment

Authentication is a JWT signed HS256 with the Secret Key and carrying `accessKey`. Stargate takes it as
`Authorization: Bearer` on GET, and on POST the **payload itself** is the JWT, sent as `{ data }` (10-minute `exp`).
Shipping v2 takes a Bearer JWT on every call and plain JSON bodies. The bank and parcel machine were stored on the cart
before place ([Provider specifics](#provider-specifics)); the Pay route calls this after `place`
([SKILL.md](../SKILL.md#lock-the-cart-before-you-charge)).

```ts
// lib/montonio.ts
import jwt from "jsonwebtoken";
import type { Payment, PlacedCart } from "@/lib/crystallize-payments";

const ACCESS = process.env.MONTONIO_ACCESS_KEY!;
const SECRET = process.env.MONTONIO_SECRET_KEY!;
const round2 = (major: number) => Math.round(major * 100) / 100; // major units, 2 decimals
const sign = (payload: object, expiresIn: "10m" | "1h") =>
    jwt.sign({ ...payload, accessKey: ACCESS }, SECRET, { algorithm: "HS256", expiresIn }); // adds iat

/** Stargate. 401 STORE_NOT_FOUND = wrong access key or environment, 403 = wrong secret key. */
export async function montonio<T>(path: string, payload?: object): Promise<T> {
    const init: RequestInit = payload
        ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ data: sign(payload, "10m") }),
          }
        : { headers: { Authorization: `Bearer ${sign({}, "1h")}` } };
    const res = await fetch(`${process.env.MONTONIO_API_URL}${path}`, init);
    if (!res.ok) throw new Error(`Montonio ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
}

/** Shipping v2. */
export async function shipping<T>(path: string, body?: object): Promise<T> {
    const res = await fetch(`${process.env.MONTONIO_SHIPPING_URL}${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${sign({}, "1h")}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Montonio shipping ${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
}

type Options = { origin: string; locale: string; letShopperPickBank?: boolean };

export async function createMontonioOrder(placed: PlacedCart, { origin, locale, letShopperPickBank }: Options) {
    const m = placed.meta ?? {};
    const c = placed.customer;
    const a = c?.addresses?.find((x) => x.type === "billing") ?? c?.addresses?.[0];
    const grandTotal = round2(placed.total.gross);
    const method = m.montonioMethod || "paymentInitiation";
    const order = await montonio<{ uuid: string; paymentUrl: string }>("/orders", {
        merchantReference: placed.id, // unique per store: a second POST replaces the unpaid order, never adds one
        returnUrl: `${origin}/checkout/montonio/return?cart=${placed.id}`, // + &order-token=<JWT>, paid or cancelled
        notificationUrl: `${process.env.PUBLIC_URL}/api/payments/montonio/webhook`,
        currency: placed.total.currency, // EUR or PLN
        grandTotal,
        locale, // de, en, et, fi, lt, lv, pl, ru
        billingAddress: {
            firstName: c?.firstName,
            lastName: c?.lastName,
            email: c?.email,
            addressLine1: a?.street,
            locality: a?.city,
            postalCode: a?.postalCode,
            country: a?.country,
        },
        // unit price incl. tax; Montonio does not enforce that the lines add up to grandTotal
        lineItems: placed.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            finalPrice: round2(i.price.gross / i.quantity),
        })),
        payment: {
            method, // paymentInitiation, cardPayments, applePay, googlePay, mobilePay, blik, bnpl, hirePurchase
            amount: grandTotal, // must equal grandTotal
            currency: placed.total.currency,
            methodOptions:
                method === "paymentInitiation"
                    ? {
                          preferredProvider: letShopperPickBank ? undefined : m.montonioBank || undefined, // LHVBEE22
                          preferredCountry: m.montonioBankCountry || undefined, // the list the shopper saw
                      }
                    : undefined,
        },
        expiresIn: 30, // minutes until ABANDONED (5 to 44 640)
    });
    return { url: order.paymentUrl };
}
// app/api/checkout/pay/route.ts, after place: return Response.json(await createMontonioOrder(placed, opts));
```

Re-posting a `merchantReference` replaces an **unpaid** order and returns a new `paymentUrl`; a **paid** one answers an
error ([merchantReference][mref]). The placed cart cannot change, so the amount never does.

## Client

Redirect to `paymentUrl` (`location.href = url`, or `redirect()` from a Server Action). With `preferredProvider` the
shopper goes straight to their bank. They come back to the `returnUrl` with `order-token=<JWT>` added, after success
**or** cancellation — maybe in another browser, so the page takes the cart id from its own `?cart=`. It only reads
([SKILL.md](../SKILL.md#the-return-page)), verifying the token on the server (`verifyMontonio` below) just to pick the
message: `PAID` → "thank you" while the cart turns `ordered`; `AUTHORIZED` → "your bank is processing the payment";
anything else → "payment not completed" and "Try again", which calls the Pay route with `letShopperPickBank: true`
(same order, new URL, Montonio's own bank list). It never creates the order.

## Webhook

Montonio POSTs `{ "orderToken": "<JWT>" }` when an order's `paymentStatus` changes and `{ "refundToken": "<JWT>" }`
when a refund's does, to the same `notificationUrl` ([webhooks][webhooks]). The signature is inside the JWT, so the
body only has to be read and parsed; pin the algorithm and check `accessKey`. Use the camelCase fields: the snake_case
copies (`payment_status`, …) are being removed. Anything but `200`/`201` is retried 13 times over 48 hours.

```ts
// lib/montonio.ts (continued)
export type Claims = Record<string, any>;

export function verifyMontonio(token: unknown): Claims {
    if (typeof token !== "string") throw new Error("no token");
    const claims = jwt.verify(token, SECRET, { algorithms: ["HS256"] }) as Claims; // signature and exp
    if (claims.accessKey !== ACCESS) throw new Error("token for another store");
    return claims;
}
```

```ts
// app/api/payments/montonio/webhook/route.ts
import { createOrderOnce, readCart, recordPayment, updatePayment, withMeta } from "@/lib/crystallize-payments";
import { montonio, montonioPayment, verifyMontonio, type Claims } from "@/lib/montonio";

export async function POST(req: Request) {
    const raw = await req.text();
    let body: { orderToken?: string; refundToken?: string };
    let c: Claims;
    try {
        body = JSON.parse(raw);
        c = verifyMontonio(body.orderToken ?? body.refundToken);
    } catch {
        return Response.json({ error: "invalid token" }, { status: 401 });
    }
    try {
        if (body.orderToken && c.paymentStatus === "PAID") {
            await createOrderOnce(c.merchantReference, "paid", montonioPayment(c));
        } else if (body.orderToken && c.paymentStatus === "VOIDED") {
            // the bank rejected the payment; after PAID (rare, Montonio also e-mails you) the order must not ship
            if ((await readCart(c.merchantReference))?.state === "ordered") {
                await updatePayment(c.merchantReference, c.uuid, (p) => withMeta(p, { state: "cancelled" }));
                console.error(`[montonio] ${c.merchantReference} VOIDED after PAID: stop fulfilment`);
            }
        } else if (body.refundToken && c.refundStatus === "SUCCESSFUL") {
            // the refund token carries no merchantReference: read it from the Montonio order
            const order = await montonio<{ merchantReference: string; paymentMethodType: string }>(
                `/orders/${c.orderUuid}`,
            );
            await recordPayment(order.merchantReference, {
                provider: "montonio",
                method: order.paymentMethodType,
                transactionId: c.refundUuid,
                amount: Number(c.refundAmount), // major units
                createdAt: new Date(c.iat * 1000).toISOString(),
                meta: [
                    { key: "type", value: "refund" },
                    { key: "cartId", value: order.merchantReference },
                ],
            });
        } else if (body.refundToken && c.refundStatus === "REJECTED") {
            console.error(`[montonio] refund ${c.refundUuid} rejected: ${c.refundStatusDescription}`); // a human acts
        }
        return Response.json({ ok: true }); // PENDING, AUTHORIZED, ABANDONED: nothing yet
    } catch (error) {
        console.error(error);
        return Response.json({ error: "retry" }, { status: 500 });
    }
}
```

| Token status                     | Crystallize ([paymentStatus](../SKILL.md#paymentstatus))                    |
| -------------------------------- | --------------------------------------------------------------------------- |
| order `PAID`                     | `createOrderOnce(cartId, 'paid', …)`, `state=captured`                      |
| order `AUTHORIZED` (opt-in)      | Nothing yet: the bank is still settling; `PAID` or `VOIDED` follows         |
| order `VOIDED`                   | After `PAID`: `updatePayment` → `state=cancelled`, stop. Else no order      |
| order `PENDING`, `ABANDONED`     | No order (`ABANDONED` after `expiresIn`; on by default since 2023-08-29)    |
| order `REFUNDED`, `PARTIALLY_…`  | Nothing: the refund token records it                                        |
| refund `SUCCESSFUL` / `REJECTED` | `recordPayment` (`type=refund`) / alert a human (`refundStatusDescription`) |

Redeliveries are harmless (`createOrderOnce` and `recordPayment` dedupe on the UUIDs). Whether late retries carry a
fresh token is unconfirmed: if they fail on `exp`, verify with `ignoreExpiration: true` — the handlers are idempotent.

## Capture, refund, cancel

There is nothing to capture or void: bank payments, cards and wallets settle at `PAID`. Refunds go through
`POST /refunds`, and Crystallize is written only when the `refundToken` says `SUCCESSFUL` (a refund can wait in
`PENDING`, e.g. on insufficient settlement funds). Cancelling a paid order means refunding it in full
(`availableForRefund` from `GET /orders/{uuid}`).

```ts
// lib/montonio.ts (continued)
/** captureByProvider.montonio — no-op: PAID is final, the whole amount is already captured. */
export const capture = async (_orderUuid: string, amount: number): Promise<number | null> => amount;

/** `refundId` is yours (a return or credit-note id); Montonio refuses a second refund with the same key. */
export async function refund(orderUuid: string, amount: number, refundId: string) {
    try {
        await montonio("/refunds", { orderUuid, amount: round2(amount), idempotencyKey: `refund-${refundId}` });
    } catch (error) {
        if (!String(error).includes("same idempotency key")) throw error; // else: a retry of a refund already made
    }
}
```

Refund rules ([refunds][refunds]): to the original payer only, at least 0.05 €, in total at most `grandTotal`, and only
once the money reached the Montonio settlement account (about one business day). Bank-payment refunds are EUR only and
must be enabled in the Partner System; cards, wallets, BLIK and financing are refundable by default.

## Mapping

```ts
// lib/montonio.ts (continued)
export const montonioPayment = (c: Claims): Payment => ({
    provider: "montonio",
    method: c.paymentMethod, // paymentInitiation, cardPayments, applePay, googlePay, mobilePay, blik, bnpl …
    transactionId: c.uuid, // the Montonio order UUID: refunds, GET /orders/{uuid} and shipments take it
    amount: Number(c.grandTotal), // already major units
    createdAt: new Date(c.iat * 1000).toISOString(),
    meta: [
        { key: "state", value: "captured" },
        { key: "cartId", value: c.merchantReference },
        ...(c.paymentProviderName ? [{ key: "bank", value: String(c.paymentProviderName) }] : []),
    ],
});
```

A refund is a second record, from the webhook: `transactionId` = refund UUID, `amount` = `refundAmount`, `meta
type=refund` and `cartId` ([the payment record](../SKILL.md#the-payment-record)).

## Provider specifics

**Bank picker.** Montonio wants the method, and for bank payments the bank, chosen in your checkout before the order
exists ([methods][methods]). `GET /stores/payment-methods` lists the enabled methods, and the banks per country under
`paymentInitiation.setup[country].paymentMethods` (`code`, `name`, `logoUrl`, `supportedCurrencies`, `uiPosition`).
Revolut, N26 and Wise share one code across countries: send the country whose list the shopper saw as
`preferredCountry`. Montonio's bank widget lives in its legacy SDK, retired in 2026: render the list yourself.

**Pickup points.** Shipping v2 lists the carriers per destination country (`GET /shipping-methods`) and their pickup
points (`GET /shipping-methods/pickup-points?carrierCode=&countryCode=&type=`, types `parcelMachine`, `parcelShop`,
`postOffice`) ([shipping methods][ship-methods]). The chosen point is **required before Pay** and goes on the cart with
the bank, next to the shipping line the storefront added as an external item.

```ts
// lib/montonio.ts (continued)
export type Bank = { code: string; name: string; logoUrl: string; supportedCurrencies: string[]; uiPosition?: number };
export type PickupPoint = { id: string; name: string; streetAddress: string; locality: string; carrierCode: string };
type StoreMethods = { paymentMethods: { paymentInitiation?: { setup: Record<string, { paymentMethods: Bank[] }> } } };

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value as T;
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return value;
}

export async function listBanks(country: string, currency: string): Promise<Bank[]> {
    const store = await cached("methods", 3_600_000, () => montonio<StoreMethods>("/stores/payment-methods"));
    const banks = store.paymentMethods.paymentInitiation?.setup[country]?.paymentMethods ?? [];
    return banks
        .filter((b) => b.supportedCurrencies.includes(currency))
        .sort((x, y) => (x.uiPosition ?? 99) - (y.uiPosition ?? 99));
}

export async function listPickupPoints(carrier: string, country: string): Promise<PickupPoint[]> {
    const q = new URLSearchParams({ carrierCode: carrier, countryCode: country, type: "parcelMachine" });
    const load = () => shipping<{ pickupPoints: PickupPoint[] }>(`/shipping-methods/pickup-points?${q}`);
    return cached(`points:${q}`, 86_400_000, async () => (await load()).pickupPoints);
}
```

```ts
// app/api/checkout/montonio/choice/route.ts — the bank and the parcel machine go on the cart BEFORE place
import { carts, PLACED_CART, type PlacedCart } from "@/lib/crystallize-payments";
import { listBanks, listPickupPoints } from "@/lib/montonio";

type Choice = { bankCountry: string; bank: string; shipTo: string; carrier: string; pickupPoint: string };

export async function POST(req: Request) {
    const cartId = getCartIdFromCookie(req); // your session handling
    const choice = (await req.json()) as Choice;
    const cart = (await carts.fetch(cartId, { state: true, ...PLACED_CART })) as unknown as PlacedCart & {
        state: string;
    };
    if (cart.state !== "cart") return Response.json({ error: "placed" }, { status: 409 }); // the write would be lost
    const banks = await listBanks(choice.bankCountry, cart.total.currency);
    const bank = banks.find((b) => b.code === choice.bank)?.code ?? "";
    const point = (await listPickupPoints(choice.carrier, choice.shipTo)).find((p) => p.id === choice.pickupPoint);
    const meta = {
        montonioMethod: "paymentInitiation",
        montonioBank: bank,
        montonioBankCountry: choice.bankCountry,
        montonioCarrier: choice.carrier,
        montonioPickupPoint: point?.id ?? "",
        montonioPickupPointName: point ? `${point.name}, ${point.streetAddress}, ${point.locality}` : "",
    };
    await carts.setMeta(cartId, { meta: Object.entries(meta).map(([key, value]) => ({ key, value })), merge: true });
    return Response.json({ banks, ready: !!point }); // ready: Pay may be enabled
}
// app/api/checkout/pay/route.ts, before place: no parcel machine, no Pay
// if (!cart.meta?.montonioPickupPoint) return Response.json({ error: "choose a parcel machine" }, { status: 400 });
```

The checkout shows the `banks` this route returns as a logo grid under a country selector (`EE`, `LV`, `LT`, `FI`,
`PL`), and the pickup points (a GET route around `listPickupPoints`) as a searchable `<select>` grouped by `locality`;
it posts every change here and keeps Pay disabled until `ready`.

**After payment: shipment and label** (no code), from your "Ready to ship" stage in the
[pipeline-stage hook](../SKILL.md#capture-on-shipment-from-fulfilment-pipelines), never inside the payment webhook:

1. Read the pickup point (`meta`) and receiver (`customer`) from the placed cart (`carts.fetch(cartId, PLACED_CART)`).
   If the payment record already has `meta montonioShipmentId`, stop: the shipment exists.
2. `POST {MONTONIO_SHIPPING_URL}/shipments` with `merchantReference` (cart id), `montonioOrderUuid` (the payment's
   `transactionId`), `receiver` (`name`, `phoneCountryCode` such as `372`, `phoneNumber` without it — both required —
   and `email`), `shippingMethod: { type: "pickupPoint", id }`, `parcels: [{ weight }]` (kg; dimensions when the
   method's `constraints.parcelDimensionsRequired`), optional `products` (`sku`, `name`, `quantity`, `price`) for pick
   lists and the tracking page, and `synchronous: true`. Without `sender`, the store's sender details are used.
3. `registered` → `updatePayment(cartId, orderUuid, (p) => withMeta(p, { montonioShipmentId: id }))`;
   `registrationFailed` (often a bad phone number) → `PATCH /shipments/{id}` with the fix registers it again.
4. `POST /label-files` with `{ shipmentIds: [id], pageSize: "A6", labelsPerPage: 1, synchronous: true }` returns
   `labelFileUrl`, a PDF; `GET /label-files/{id}` fetches it again later ([labels][labels]).

At volume, keep the asynchronous default and register one shipping webhook (`POST /webhooks` with `url` and
`enabledEvents` such as `shipment.registered`, `shipment.registrationFailed`, `labelFile.ready`; 10 per store at most).
Its body is `{ "payload": "<JWT>" }` signed with the Secret Key, with an `eventType` ([webhooks][ship-webhooks]).

## Going further

- **Embedded cards** (Sessions flow): `POST /sessions` → `new MontonioCheckout({ sessionUuid, environment })`,
  `initialize(container)`, `validateOrReject()`, create the order **with `sessionUuid`**, `submitPayment()`; call
  `destroy()` before re-initialising. `cardPayments.processor === "stripe"` means the store is still on the legacy
  embedded flow ([embedded cards][embedded]). Embedded BLIK exists for PLN.
- **Payment links** (`POST /payment-links`) for phone or e-mail orders, and **financing** (`bnpl`, `hirePurchase`,
  EUR) through the same order call ([financing][financing]).
- **Shipping prices** for the storefront's shipping line: `POST /shipping-methods/rates` (Montonio contracts only).
  **Courier delivery**: `GET /shipping-methods/courier-services`, `shippingMethod.type: "courier"`; cash on
  delivery and age verification as `additionalServices` where listed. Payout reports: [payouts][payouts].

## Common mistakes

- Multiplying by 100: Montonio takes **major** units, so the shopper is charged a hundred times the price.
- Building on the deprecated Payments V1 flow: a `payment_token` appended to the gateway URL, snake_case fields
  (`preselected_aspsp`), a notification read from the query string with `status === 'finalized'`, banks from
  `/pis/v2/merchants/payment_methods`, shipping on `api.shipping.montonio.com`.
- Verifying without pinning `algorithms` or checking `accessKey`, or creating the order from the `returnUrl` token.
- Calling the order-creation step with its arguments swapped: nothing is created, and the webhook still answers 200.
- Treating every notification as a payment: refund webhooks reach the same URL, and one became a second order.
- Losing the pickup point between checkout and shipment, or letting the shopper pay without one.
- Creating the shipment and label inside the payment webhook with errors swallowed, reading the shipment id from a
  failed response, or a hard-coded dummy sender and phone number.
- Hard-wiring the bank list to Estonia and the carrier to one company; or offering Montonio in NOK, SEK or DKK.

[overview]: https://docs.montonio.com/api/stargate/overview
[reference]: https://docs.montonio.com/api/stargate/reference
[orders]: https://docs.montonio.com/api/stargate/guides/orders
[methods]: https://docs.montonio.com/api/stargate/guides/payment-methods
[webhooks]: https://docs.montonio.com/api/stargate/guides/webhooks
[refunds]: https://docs.montonio.com/api/stargate/guides/refunds
[embedded]: https://docs.montonio.com/api/stargate/guides/embedded-cards
[financing]: https://docs.montonio.com/api/stargate/guides/financing
[payouts]: https://docs.montonio.com/api/stargate/guides/payouts
[mref]: https://help.montonio.com/en/articles/253363-how-to-use-the-merchantreference-parameter-when-creating-orders
[keys]: https://docs.montonio.com/introduction#api-keys
[shipping]: https://docs.montonio.com/api/shipping-v2/overview
[ship-sandbox]: https://docs.montonio.com/api/shipping-v2/guides/sandbox
[ship-methods]: https://docs.montonio.com/api/shipping-v2/guides/shipping-methods
[labels]: https://docs.montonio.com/api/shipping-v2/guides/labels
[ship-webhooks]: https://docs.montonio.com/api/shipping-v2/guides/webhooks
