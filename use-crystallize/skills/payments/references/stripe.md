# Stripe with Crystallize

Stripe is a global payment platform — cards, Apple Pay, Google Pay, Link, Klarna and local methods such as iDEAL, SEPA
Direct Debit, MobilePay and Swish, in 135+ currencies. The recommended integration is a **Checkout Session** created on
the server from the placed cart and paid inline with the Payment Element (`ui_mode: 'elements'`, or `hosted_page` to
redirect to Stripe), with the order created from the `checkout.session.completed` webhook. Capture is automatic by
default; `capture_method: 'manual'` authorizes at checkout (cards: 7 days) and captures from the Shipped pipeline stage.

> Verification: Written from Stripe's official docs, checked 2026-10-06. Not run end-to-end.
> Official docs: [Accept a payment (Elements + Checkout Sessions)][accept], [Create a Checkout Session][cs-api],
> [Fulfill orders][fulfill], [Webhooks][webhooks], [Place a hold][hold], [Refunds][refunds], [Idempotency][idem],
> [Currencies][currencies], [Endive changelog][endive]. Every docs page is served as Markdown (append `.md`); Stripe's
> own agent skills: <https://docs.stripe.com/skills>.

## At a glance

| Topic                | Stripe                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Markets & currencies | Global, 135+ currencies. Nordics: cards, wallets, Klarna, MobilePay, Swish, Vipps (preview)   |
| Recommended          | Checkout Sessions API, `ui_mode: 'elements'` + Payment Element on your checkout page          |
| Alternative          | `hosted_page` (redirect, least code); also `embedded_page`, `form` (embedded form, preview)   |
| API version          | `2026-09-30.endive` (Endive: breaking changes; the last Dahlia was `2026-08-26.dahlia`)       |
| SDKs                 | `stripe@23` (pins `2026-09-30.endive`, Node 20+), `@stripe/stripe-js@10`, `react-stripe-js@7` |
| Amount units         | Integer minor units, lowercase currency. Zero-decimal: JPY, KRW, …; ISK and UGX sent ×100     |
| Capture              | Default `automatic_async`. Manual: cards 7 days (Visa MIT 4 d 18 h), Klarna 28 d, PayPal 20   |
| Cart id              | `client_reference_id` (≤ 200 chars) + `payment_intent_data.metadata` (values ≤ 500 chars)     |
| One session per cart | Idempotency key `checkout-<cartId>` + live status; `expired` → successor; > 24 h: Search      |
| Verification         | `Stripe-Signature: t=…,v1=…`: HMAC-SHA256 of `${t}.${rawBody}` with `whsec_…`, 5-min window   |

## Credentials and setup

The crystallize.com page names three keys, all in the Stripe Dashboard once the account exists:

- **Public key** — the publishable key `pk_test_…` / `pk_live_…`, Dashboard → [API keys][keys]. Safe in the browser.
- **Secret key** — `sk_…`, same page, server only. Stripe now advises a restricted key `rk_…` for new code, with write
  access to Checkout Sessions, PaymentIntents and Refunds (+ Customers if you reuse them; permission names unconfirmed).
- **Signing secret** — `whsec_…`, one per webhook endpoint and per mode: Workbench → Webhooks → **Create an event
  destination** → Your account → API version `2026-09-30.endive` (the SDK's, so payloads match its types) → events
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `payment_intent.succeeded`,
  `payment_intent.canceled`, `refund.created`, `refund.failed` → Webhook endpoint
  `https://<host>/api/payments/stripe/webhook` (snapshot payloads) → **Reveal secret**.

```bash
STRIPE_SECRET_KEY=sk_test_...                 # or rk_test_... (restricted key)
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
PUBLIC_STORE_URL=https://shop.example.com     # fixed origin for return_url (idempotent retries need identical params)
```

- **Sandbox**: account picker → Sandboxes. Agents can create an anonymous one with keys: `npm i -g @stripe/cli` then
  `stripe sandbox create --help`. Enable payment methods in Settings → Payment methods (dynamic payment methods);
  `payment_method_types` is gone from Checkout Sessions on Endive (400) — narrow with `allowed_payment_method_types`.
- **Test data** ([Testing][testing]): `4242 4242 4242 4242` succeeds, `4000 0025 0000 3155` asks for 3D Secure,
  `4000 0000 0000 9995` is declined (any future expiry, any CVC). SEPA IBAN `AT321904300235473204` stays `processing`
  ~3 minutes then succeeds; `AT861904300235473202` fails. Redirect methods offer **Complete / Fail test payment**.
- **Localhost**: `stripe listen --forward-to localhost:3000/api/payments/stripe/webhook` prints its **own** `whsec_…`;
  use that one locally. `stripe trigger` fixtures carry no cart id (the handler ignores them): test a real checkout.

## Create the payment

Call `createStripeSession` from the Pay route right after `place`
([SKILL.md](../SKILL.md#lock-the-cart-before-you-charge)). Put what the session needs on the cart **before** `place`,
so the parameters are identical on every retry: the email (`setCustomer`; a session needs one) and the shopper's
locale as cart meta (`carts.setMeta(id, { meta: [{ key: 'locale', value }], merge: true })`). Leave Stripe Tax,
promotion codes, shipping options, adjustable quantities and Adaptive Pricing off: Stripe must charge exactly the
placed `total.gross`.

```ts
// lib/stripe.ts
import Stripe from "stripe";
import { recordPayment, updatePayment, withMeta, type Payment, type PlacedCart } from "@/lib/crystallize-payments";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!); // stripe@23 pins 2026-09-30.endive: no apiVersion

// docs.stripe.com/currencies#zero-decimal. ISK and UGX are zero-decimal but still sent ×100, so they are not listed.
const ZERO_DECIMAL = new Set("bif clp djf gnf jpy kmf krw mga pyg rwf vnd vuv xaf xof xpf".split(" "));
export const toMinor = (major: number, currency: string) =>
    ZERO_DECIMAL.has(currency.toLowerCase()) ? Math.round(major) : Math.round(major * 100);
export const toMajor = (minor: number, currency: string) =>
    ZERO_DECIMAL.has(currency.toLowerCase()) ? minor : minor / 100;

function sessionParams(placed: PlacedCart): Stripe.Checkout.SessionCreateParams {
    const currency = placed.total.currency.toLowerCase(); // from the market, never hardcoded
    const unit_amount = toMinor(placed.total.gross, currency);
    const metadata = { crystallize_cart_id: placed.id };
    const returnPage = `${process.env.PUBLIC_STORE_URL}/${placed.meta?.locale ?? "en"}/checkout/stripe/return`;
    return {
        mode: "payment",
        ui_mode: "elements",
        client_reference_id: placed.id,
        metadata,
        // Session metadata is NOT copied to the PaymentIntent; capture, cancel and refund events need the cart id.
        payment_intent_data: { metadata }, // + capture_method: "manual" → authorize now, capture on shipment
        // One line for the placed total. Per-item lines (max 100, shipping = the `type: 'shipping'` item) are
        // optional, but must then add up to it exactly.
        line_items: [{ quantity: 1, price_data: { currency, unit_amount, product_data: { name: "Your order" } } }],
        customer_email: placed.customer?.email, // read-only in the form; without it, render <ContactDetailsElement />
        adaptive_pricing: { enabled: false }, // the Crystallize market owns the currency
        return_url: `${returnPage}?cart=${placed.id}&session_id={CHECKOUT_SESSION_ID}`,
    };
}

/** One Checkout Session per placed cart: every tab, reload and retry gets the same one. */
export async function createStripeSession(placed: PlacedCart): Promise<{ clientSecret: string } | { paid: true }> {
    // Idempotency keys may be pruned after 24 h: first look for a payment that already went through.
    // Search lags up to a minute (the key covers that window) and is not available to accounts in India.
    const { data } = await stripe.paymentIntents.search({ query: `metadata['crystallize_cart_id']:'${placed.id}'` });
    if (data.some((pi) => ["succeeded", "processing", "requires_capture"].includes(pi.status))) return { paid: true };

    const params = sessionParams(placed); // a reused key with other params fails with an idempotency_error
    let key = `checkout-${placed.id}`;
    for (let attempt = 0; attempt < 3; attempt++) {
        const { id } = await stripe.checkout.sessions.create(params, { idempotencyKey: key });
        // A replayed create returns the original (stale) response: read the live status.
        const session = await stripe.checkout.sessions.retrieve(id, { expand: ["payment_intent"] });
        const pi = session.payment_intent as Stripe.PaymentIntent | null;
        const failed = pi?.status === "requires_payment_method" || pi?.status === "canceled"; // e.g. a bounced debit
        if (session.status === "open") return { clientSecret: session.client_secret! };
        if (session.status === "complete" && !failed) return { paid: true }; // paid, held or processing
        key = `checkout-${placed.id}-after-${session.id}`; // expired or failed: exactly one successor per session
    }
    throw new Error(`no open Checkout Session for cart ${placed.id}`);
}
```

The Pay route answers `createStripeSession(placed)` as JSON: `{ clientSecret }` mounts the form, `{ paid: true }` sends
the shopper to the return page. A session expires 24 h after creation by default (`expires_at`: 30 min to 24 h).

## Client

```tsx
// app/[locale]/checkout/stripe/stripe-pay.tsx
"use client";
import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { CheckoutElementsProvider, PaymentElement, useCheckoutElements } from "@stripe/react-stripe-js/checkout";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!); // module scope, not per render

export function StripePay({ clientSecret }: { clientSecret: string }) {
    return (
        <CheckoutElementsProvider stripe={stripePromise} options={{ clientSecret }}>
            <PayForm />
        </CheckoutElementsProvider>
    );
}

function PayForm() {
    const state = useCheckoutElements();
    const [error, setError] = useState<string>();
    if (state.type === "loading") return <p>Loading…</p>;
    if (state.type === "error") return <p>{state.error.message}</p>;
    const pay = async () => {
        const result = await state.checkout.confirm(); // on success Stripe sends the shopper to return_url
        if (result.type === "error") setError(result.error.message); // declined: retry in the same session
    };
    return (
        <>
            <PaymentElement />
            <button disabled={!state.checkout.canConfirm} onClick={pay}>
                Pay {state.checkout.total.total.amount}
            </button>
            {error && <p role="alert">{error}</p>}
        </>
    );
}
```

`confirm()` redirects to `return_url` by default; `confirm({ redirect: 'if_required' })` keeps card payers on the page.
**The return page only reads.** Take the cart id from the URL's `cart` (a bank app may reopen the page in another
browser, without your cookie) and fetch the cart: `ordered` → confirmation (order id = cart id), clear the cookie.
Still `placed` → retrieve the session from `session_id` server-side and check its `client_reference_id` is that cart:
`open` → the payment failed or was cancelled, back to Pay (same session); `complete` → "Confirming your payment…",
refresh every few seconds. Bank debits stay `processing` for days: say you will email.

## Webhook

```ts
// app/api/payments/stripe/webhook/route.ts
import type Stripe from "stripe";
import { createOrderOnce, readOrder, recordPayment, updatePayment, withMeta } from "@/lib/crystallize-payments";
import { refundRecord, stripe, toMajor } from "@/lib/stripe";

export const runtime = "nodejs";

/** HMAC-SHA256 over `${t}.${body}`, timing-safe; throws on a bad signature or a timestamp older than 5 minutes. */
function verifyStripe(body: string, signature: string | null): Stripe.Event {
    return stripe.webhooks.constructEvent(body, signature ?? "", process.env.STRIPE_WEBHOOK_SECRET!);
}

export async function POST(req: Request) {
    const body = await req.text(); // raw bytes first: never JSON.stringify(await req.json())
    let event: Stripe.Event;
    try {
        event = verifyStripe(body, req.headers.get("stripe-signature"));
    } catch {
        return new Response("bad signature", { status: 400 });
    }
    try {
        if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
            await onSessionPaid(event.data.object.id);
        } else if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.canceled") {
            await onHoldSettled(event.data.object);
        } else if (event.type === "refund.created" || event.type === "refund.failed") {
            await onRefund(event.data.object.id);
        }
        return new Response("ok");
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 }); // live: Stripe retries for up to 3 days; sandbox: 3 times
    }
}

async function onSessionPaid(sessionId: string) {
    // Re-read: act on the PaymentIntent's live status, not on the event snapshot.
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge"] });
    const pi = session.payment_intent as Stripe.PaymentIntent | null;
    const cartId = session.client_reference_id;
    if (!cartId || !pi) return; // not one of ours (e.g. `stripe trigger` fixtures)
    const captured = pi.status === "succeeded";
    if (!captured && pi.status !== "requires_capture") return; // processing: async_payment_succeeded follows
    const charge = pi.latest_charge as Stripe.Charge | null;
    await createOrderOnce(cartId, captured ? "paid" : "unpaid", {
        provider: "stripe",
        method: charge?.payment_method_details?.type ?? "card",
        transactionId: pi.id,
        amount: toMajor(captured ? pi.amount_received : pi.amount, pi.currency),
        createdAt: new Date(pi.created * 1000).toISOString(),
        meta: [
            { key: "state", value: captured ? "captured" : "authorized" },
            { key: "cartId", value: cartId },
            { key: "checkoutSessionId", value: session.id },
        ],
    });
}

/** A hold captured or voided outside capture()/cancel(): in the Dashboard, or an authorization that expired. */
async function onHoldSettled(pi: Stripe.PaymentIntent) {
    const cartId = pi.metadata.crystallize_cart_id;
    if (!cartId) return;
    const record = (await readOrder(cartId))?.payments?.find((p) => p.transactionId === pi.id);
    if (record?.meta?.state !== "authorized") return; // no order yet (onSessionPaid reads the live status) or done
    await updatePayment(cartId, pi.id, (p) =>
        pi.status === "succeeded"
            ? withMeta(p, { state: "captured" }, toMajor(pi.amount_received, pi.currency))
            : withMeta(p, { state: "cancelled" }),
    );
}

async function onRefund(refundId: string) {
    const refund = await stripe.refunds.retrieve(refundId, { expand: ["payment_intent"] }); // events come in any order
    const pi = refund.payment_intent as Stripe.PaymentIntent | null;
    const cartId = pi?.metadata.crystallize_cart_id;
    if (!pi || !cartId) return;
    if (refund.status === "failed" || refund.status === "canceled") {
        console.error(`[payments] refund ${refund.id} on order ${cartId} is ${refund.status}: pay the shopper back`);
        return updatePayment(cartId, refund.id, (p) => withMeta(p, { state: "failed" })); // no-op if never recorded
    }
    await recordPayment(cartId, refundRecord(refund, cartId, pi.id)); // a refund made by refund() is already there
}
```

| Stripe event, live PaymentIntent status          | Crystallize ([SKILL.md](../SKILL.md#paymentstatus))          |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `checkout.session.completed`, `succeeded`        | `createOrderOnce(…, 'paid')`, `state=captured`               |
| `checkout.session.completed`, `requires_capture` | `createOrderOnce(…, 'unpaid')`, `state=authorized`           |
| `checkout.session.completed`, `processing`       | Nothing yet (bank debits): `async_payment_succeeded` follows |
| `checkout.session.async_payment_succeeded`       | Same as the first two rows                                   |
| `checkout.session.async_payment_failed`          | No order; the next Pay creates a successor session           |
| `payment_intent.succeeded`, record `authorized`  | `updatePayment` → `state=captured`, `amount_received`        |
| `payment_intent.canceled`, record `authorized`   | `updatePayment` → `state=cancelled`; cancelled stage         |
| `refund.created`                                 | `recordPayment` with the refund record (`type=refund`)       |
| `refund.failed`                                  | Alert a human; the refund record gets `state=failed`         |

Stripe delivers at least once, sometimes concurrently and out of order; `createOrderOnce` and `recordPayment` absorb it.

## Capture, refund, cancel

Register `capture` as `captureByProvider.stripe` for SKILL.md's
[pipeline-stage handler](../SKILL.md#capture-on-shipment-from-fulfilment-pipelines), which then calls `updatePayment`.
Stripe captures synchronously, so it always returns the captured amount, never `null`.

```ts
// lib/stripe.ts (continued)
/** Captures a held PaymentIntent (at most `amount`, major units); returns the captured amount in major units. */
export async function capture(transactionId: string, amount: number): Promise<number> {
    const pi = await stripe.paymentIntents.retrieve(transactionId);
    if (pi.status === "succeeded") return toMajor(pi.amount_received, pi.currency); // already captured
    if (pi.status !== "requires_capture") throw new Error(`${pi.id} is ${pi.status}: nothing to capture`);
    const amount_to_capture = Math.min(toMinor(amount, pi.currency), pi.amount_capturable); // less releases the rest
    const key = { idempotencyKey: `capture-${pi.id}` };
    const done = await stripe.paymentIntents.capture(pi.id, { amount_to_capture }, key);
    return toMajor(done.amount_received, done.currency);
}

/** Refunds a captured payment, fully or partly. `refundRef` is yours (return number): a retry never refunds twice. */
export async function refund(cartId: string, transactionId: string, amount: number, refundRef: string) {
    const pi = await stripe.paymentIntents.retrieve(transactionId);
    const created = await stripe.refunds.create(
        { payment_intent: pi.id, amount: toMinor(amount, pi.currency), metadata: { crystallize_cart_id: cartId } },
        { idempotencyKey: `refund-${pi.id}-${refundRef}` },
    );
    await recordPayment(cartId, refundRecord(created, cartId, pi.id));
}

/** Voids a hold you will not capture. A captured payment needs refund() instead. */
export async function cancel(cartId: string, transactionId: string) {
    const pi = await stripe.paymentIntents.retrieve(transactionId);
    if (pi.status === "requires_capture") {
        await stripe.paymentIntents.cancel(pi.id, {}, { idempotencyKey: `cancel-${pi.id}` });
    } else if (pi.status !== "canceled") throw new Error(`${pi.id} is ${pi.status}: refund it instead`);
    await updatePayment(cartId, pi.id, (p) => withMeta(p, { state: "cancelled" }));
}
```

Most payments allow **one** capture (multicapture is opt-in, for some cards); an uncaptured PaymentIntent is cancelled
when the hold expires → `payment_intent.canceled`. Refunds need a captured payment, may be partial and repeated up to
the captured amount, are paid from your Stripe balance and reach the shopper in about 5–10 business days. A Checkout
Session's PaymentIntent can only be cancelled in `requires_capture`; before that, expire the session.

## Mapping

The payment record is the one `onSessionPaid` passes to `createOrderOnce`: `provider: 'stripe'`, `method` from
`latest_charge.payment_method_details.type` (`card`, `klarna`, `link`, `mobilepay`, `swish`, `sepa_debit`, …),
`transactionId` = the PaymentIntent id (`pi_…`, used by capture, cancel and refund), `amount` in **major** units
(`amount_received` when captured, `amount` when held), and meta `state` (`authorized` | `captured` | `cancelled`),
`cartId` and `checkoutSessionId` (`cs_…`). The refund record:

```ts
// lib/stripe.ts (continued)
export const refundRecord = (r: Stripe.Refund, cartId: string, paymentIntentId: string): Payment => ({
    provider: "stripe",
    transactionId: r.id, // re_…
    amount: toMajor(r.amount, r.currency),
    createdAt: new Date(r.created * 1000).toISOString(),
    meta: [
        { key: "type", value: "refund" },
        { key: "cartId", value: cartId },
        { key: "paymentIntentId", value: paymentIntentId },
    ],
});
```

## Provider specifics

**Hold only what can be held.** Cards, Klarna, PayPal and Affirm support manual capture; iDEAL, SEPA and ACH debits do
not. Hold per method so the others still capture at checkout (the webhook decides by the PaymentIntent status anyway):
`payment_method_options: { card: { capture_method: 'manual' }, klarna: { capture_method: 'manual' } }`. Eligible
online card holds can be extended to 30 days ([extended authorization][extended]); see also [multicapture][multi],
[overcapture][over] and `automatic_delayed` capture (private preview).

**Redirect instead of inline.** `ui_mode: 'hosted_page'` takes `success_url` (same `{CHECKOUT_SESSION_ID}` template)
and an optional `cancel_url` instead of `return_url`; return `session.url` and send the browser there. Stripe waits up
to 10 seconds for your `checkout.session.completed` endpoint before redirecting the shopper — answer fast.

**Reuse a Stripe Customer and save the card.** Look the shopper up with `customers.list({ email, limit: 1 })` (exact,
case-sensitive) or create one with an idempotency key such as `customer-<cartId>`, and pass `customer: 'cus_…'` instead
of `customer_email`; Checkout then prefills the last saved card (Stripe now recommends customer-configured Accounts,
`customer_account`, for new integrations). To keep the card for later, set `setup_future_usage: 'off_session'` in
`payment_intent_data` (Checkout shows a notice) or enable `saved_payment_method_options.payment_method_save` (a consent
checkbox), and record the shopper's agreement. A renewal is then a server-side `paymentIntents.create` with `customer`,
`payment_method`, `off_session: true`, `confirm: true` and an idempotency key per period; an `authentication_required`
decline means bringing the shopper back on-session. Keep the `customer` and `payment_method` ids on the Crystallize
**subscription contract** — recurring payments are outside this skill ([saving cards][save]).

**Expire an abandoned session.** When the shopper goes back and you hydrate a new cart, the old session stays payable
until it expires — consistent, but a second purchase. Keep its id next to the cart id (cookie) and call
`stripe.checkout.sessions.expire(id)` (only `open` sessions can be expired).

## Going further

- **Embedded page or embedded form**: `ui_mode: 'embedded_page'` (`createEmbeddedCheckoutPage`) or `'form'` (public
  preview; `CheckoutFormProvider` / `useCheckoutForm`; Adaptive Pricing on by default — keep it disabled).
- **PaymentIntents API directly**: create the PaymentIntent from the placed cart (`automatic_payment_methods`,
  `metadata.crystallize_cart_id`, idempotency key per cart), confirm with `confirmPayment`, create the order on
  `payment_intent.succeeded`. Stripe advises Checkout Sessions unless you need it ([guide][pi-flow]).
- **Thin events** (GA for v1 resources in Endive): small, version-independent payloads; fetch the object yourself, on
  a separate endpoint ([event destinations][thin]).
- **Receipts**: Dashboard → Settings → Business → Customer emails, or `payment_intent_data.receipt_email`;
  `invoice_creation` adds a paid invoice (priced separately). **Disputes**: alert a human on `charge.dispute.created`.
- **Shipping, tax or promotion codes in Stripe** (`shipping_options`, `automatic_tax`, `allow_promotion_codes`): Stripe
  then charges more or less than the placed cart, and the order lacks those lines. Choose shipping in the storefront
  before `place`, as an external item. A billing address typed into the Payment Element only reaches
  `latest_charge.billing_details`: collect addresses with `setCustomer` before `place`.
- **Express Checkout Element** (Apple Pay / Google Pay buttons) is in `@stripe/react-stripe-js/checkout` (the payment
  request button is deprecated in Endive); it still needs a placed cart and a session. **Marketplaces**: Connect via
  `payment_intent_data.application_fee_amount`, `transfer_data`, `on_behalf_of`.

## Common mistakes

- Verifying over `JSON.stringify(await req.json())`, or passing the parsed object as the raw body: verification never
  passes — and switching it off "to make it work" lets anyone post a paid event.
- A webhook handler that is never routed or registered: payments succeed and no order ever appears.
- Creating the order in the browser when `confirm()` resolves, without a webhook or a status check: closed tabs lose
  orders and a forged call creates unpaid ones.
- Reading `paymentIntent.charges.data[0]` (removed in `2022-11-15`) or pinning an old `apiVersion` in code: use
  `latest_charge`, and keep the SDK and the webhook endpoint on the same API version.
- `cart.total.gross * 100` without `Math.round`, or treating JPY or KRW as two-decimal.
- A random idempotency key per request (two tabs, two sessions, two payments), or the cart's key with parameters that
  change between calls (request origin, locale, email) → `idempotency_error`.
- The cart id only on the session `metadata`: PaymentIntent and refund events do not carry it.
- Deciding by `session.payment_status` alone: the PaymentIntent status tells a hold (`requires_capture`) from a
  capture (`succeeded`) and a debit that is still `processing`.
- `return_url` built as `'http://' + host`, or without the locale prefix.
- Legacy `CardElement` + `confirmCardPayment`, `payment_method_types` (400 on Endive), `ui_mode` `custom` / `hosted` /
  `embedded` (renamed in Dahlia) or `initCheckout` (now `initCheckoutElementsSdk`).
- Refunding a payment that is only held (cancel it instead), or never capturing before the hold expires.
- Auth or i18n middleware answering the webhook with a 3xx: Stripe counts it as a failed delivery.

[accept]: https://docs.stripe.com/payments/accept-a-payment?payment-ui=elements&api-integration=checkout
[cs-api]: https://docs.stripe.com/api/checkout/sessions/create
[fulfill]: https://docs.stripe.com/checkout/fulfillment
[webhooks]: https://docs.stripe.com/webhooks
[hold]: https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
[refunds]: https://docs.stripe.com/refunds
[idem]: https://docs.stripe.com/api/idempotent_requests
[currencies]: https://docs.stripe.com/currencies
[endive]: https://docs.stripe.com/changelog/endive
[keys]: https://dashboard.stripe.com/apikeys
[testing]: https://docs.stripe.com/testing
[extended]: https://docs.stripe.com/payments/extended-authorization
[save]: https://docs.stripe.com/payments/save-during-payment?payment-ui=embedded-components
[pi-flow]: https://docs.stripe.com/payments/accept-a-payment?payment-ui=elements&api-integration=paymentintents
[thin]: https://docs.stripe.com/event-destinations
[multi]: https://docs.stripe.com/payments/multicapture
[over]: https://docs.stripe.com/payments/overcapture
