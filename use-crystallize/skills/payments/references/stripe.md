# Stripe with Crystallize

> Verification: Written from Stripe's official docs, checked 2026-09-29. Not run end-to-end.
> Official docs: [Accept a payment (Elements + Checkout Sessions)][accept], [Checkout Session API][cs-api],
> [Fulfill orders][fulfill], [Webhooks][webhooks], [Place a hold][hold], [Refunds][refunds],
> [Currencies][currencies], [Dahlia changelog][dahlia]. Stripe publishes agent skills at
> <https://docs.stripe.com/skills> and serves every docs page as Markdown (append `.md`).

## At a glance

| Topic                   | Stripe                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Markets & currencies    | Global, 135+ currencies. Nordics: cards, Apple/Google Pay, Klarna, Vipps, MobilePay, Swish |
| Recommended integration | Checkout Sessions API, `ui_mode: 'elements'` + Payment Element (inline on your page)       |
| Alternative             | `ui_mode: 'hosted_page'` — redirect to checkout.stripe.com, least code                     |
| API version             | `2026-08-26.dahlia` (Dahlia began `2026-03-25.dahlia` with breaking changes)               |
| Server SDK              | `stripe@22` — pins `2026-08-26.dahlia`; do not set `apiVersion`                            |
| Client SDK              | `@stripe/stripe-js@9` + `@stripe/react-stripe-js@6` (Checkout Elements need ≥ 8 / ≥ 5)     |
| Amount units            | Integer minor units, lowercase currency. Zero-decimal: JPY, KRW, …; ISK/UGX sent as ×100   |
| Capture                 | Automatic by default. Manual: card holds valid 7 days (Visa MIT 5), Klarna 28 days         |
| Cart id                 | `client_reference_id` (≤ 200 chars) + `metadata` (50 keys, key ≤ 40, value ≤ 500 chars)    |
| Webhook verification    | `Stripe-Signature`: HMAC-SHA256 of `${t}.${rawBody}` with `whsec_…`, 5-minute tolerance    |

## Setup

- Keys: Dashboard → Sandboxes → API keys (`pk_test_…`, `sk_test_…`). Agents can provision an anonymous
  sandbox with the CLI: `npm i -g @stripe/cli && stripe sandbox create --help`.
- Enable payment methods in Dashboard → Settings → Payment methods; do not hardcode `payment_method_types`.
- Webhook: Workbench → Webhooks → Create an event destination → your account, API version
  `2026-08-26.dahlia`, **snapshot** events, URL `https://<host>/api/payments/stripe/webhook`. Copy `whsec_…`.
- Localhost: `stripe listen --forward-to localhost:3000/api/payments/stripe/webhook` prints its **own**
  `whsec_…`. `stripe trigger checkout.session.completed` sends fixtures **without** your cart id.

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

## Create the session

Call this after `place`, with the placed cart ([SKILL.md](../SKILL.md#the-payment-step)). One line item for
the cart total keeps Stripe's total identical to Crystallize's; per-item lines are prettier but must
sum to `cart.total.gross` exactly, including shipping and discounts. Leave Stripe Tax off — Crystallize
owns pricing.

```ts
import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const ZERO_DECIMAL = new Set([
    "bif",
    "clp",
    "djf",
    "gnf",
    "jpy",
    "kmf",
    "krw",
    "mga",
    "pyg",
    "rwf",
    "vnd",
    "vuv",
    "xaf",
    "xof",
    "xpf",
]); // check https://docs.stripe.com/currencies#zero-decimal
export const toMinor = (major: number, currency: string) =>
    ZERO_DECIMAL.has(currency.toLowerCase()) ? Math.round(major) : Math.round(major * 100);
export const toMajor = (minor: number, currency: string) =>
    ZERO_DECIMAL.has(currency.toLowerCase()) ? minor : minor / 100;

type PlacedCart = { id: string; total: { gross: number; net: number; currency: string } };

export async function createStripeSession(cart: PlacedCart, origin: string, email?: string) {
    const currency = cart.total.currency.toLowerCase();
    const session = await stripe.checkout.sessions.create(
        {
            mode: "payment",
            ui_mode: "elements", // 'hosted_page' → return session.url and use success_url instead
            client_reference_id: cart.id,
            metadata: { crystallize_cart_id: cart.id },
            // Session metadata is NOT copied to the PaymentIntent; capture/refund events need it there.
            payment_intent_data: { metadata: { crystallize_cart_id: cart.id } },
            // payment_intent_data: { capture_method: 'manual', metadata: … } → authorize now, capture on ship
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency,
                        unit_amount: toMinor(cart.total.gross, currency),
                        product_data: { name: `Order ${cart.id}` },
                    },
                },
            ],
            customer_email: email, // elements mode needs an email: this, or ContactDetailsElement
            return_url: `${origin}/checkout/stripe/return?session_id={CHECKOUT_SESSION_ID}`,
        },
        { idempotencyKey: `session-${cart.id}` },
    );
    return { clientSecret: session.client_secret! };
}
```

`elements`/`embedded_page` reject `success_url`/`cancel_url`. Sessions expire after 24 h by default.

## Client

```tsx
"use client";
import { loadStripe } from "@stripe/stripe-js";
import { CheckoutElementsProvider, PaymentElement, useCheckoutElements } from "@stripe/react-stripe-js/checkout";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!); // module scope, no await

export function StripePay({ clientSecret }: { clientSecret: string }) {
    return (
        <CheckoutElementsProvider stripe={stripePromise} options={{ clientSecret }}>
            <PayForm />
        </CheckoutElementsProvider>
    );
}

function PayForm() {
    const state = useCheckoutElements();
    if (state.type !== "success") return null;
    const pay = async () => {
        const result = await state.checkout.confirm(); // redirect methods leave and come back to return_url
        if (result.type === "error") alert(result.error.message);
    };
    return (
        <>
            <PaymentElement />
            <button disabled={!state.checkout.canConfirm} onClick={pay}>
                Pay
            </button>
        </>
    );
}
```

The return page shows the session status and **polls for the order** (`readOrder`); it never creates it.

## Webhook

Listen to `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `payment_intent.succeeded`, `payment_intent.canceled` and
`charge.refunded`.

```ts
export async function verifyStripe(req: Request): Promise<Stripe.Event> {
    const body = await req.text(); // raw bytes — never req.json() first
    const signature = req.headers.get("stripe-signature") ?? "";
    return stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!); // throws
}
```

```ts
// app/api/payments/stripe/webhook/route.ts
import { createOrderOnce, readOrder } from "@/lib/crystallize-payments"; // from SKILL.md
import { stripe, toMajor, verifyStripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(req: Request) {
    let event;
    try {
        event = await verifyStripe(req);
    } catch {
        return new Response("bad signature", { status: 400 });
    }
    try {
        if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
            const cartId = event.data.object.client_reference_id;
            if (!cartId) return new Response("ignored"); // e.g. `stripe trigger` fixtures
            // Re-read: decide by the PaymentIntent, not by session.payment_status alone.
            const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
                expand: ["payment_intent.latest_charge"],
            });
            const pi = session.payment_intent as Stripe.PaymentIntent;
            if (pi.status === "processing") return new Response("pending"); // async_payment_* follows
            const captured = pi.status === "succeeded";
            if (!captured && pi.status !== "requires_capture") return new Response("ignored");
            const charge = pi.latest_charge as Stripe.Charge | null;
            await createOrderOnce(cartId, captured ? "paid" : "unpaid", {
                provider: "stripe",
                method: charge?.payment_method_details?.type ?? "card",
                transactionId: pi.id,
                amount: toMajor(pi.amount, pi.currency),
                createdAt: new Date(pi.created * 1000).toISOString(),
                meta: [
                    { key: "state", value: captured ? "captured" : "authorized" },
                    { key: "checkoutSessionId", value: session.id },
                ],
            });
        }
        // payment_intent.succeeded (late capture), payment_intent.canceled, charge.refunded:
        // cart id = PaymentIntent metadata.crystallize_cart_id → see "Capture, refund, cancel".
        return new Response("ok");
    } catch (error) {
        console.error(error);
        return new Response("retry", { status: 500 }); // Stripe retries: 3 days live, 3× in sandbox
    }
}
```

| Stripe event / state                                         | Crystallize ([SKILL.md](../SKILL.md#paymentstatus))         |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| `checkout.session.completed`, PI `succeeded`                 | `createOrderOnce(…, 'paid', state=captured)`                |
| `checkout.session.completed`, PI `requires_capture` (manual) | `createOrderOnce(…, 'unpaid', state=authorized)`            |
| `checkout.session.completed`, PI `processing` (SEPA, bank)   | Nothing yet; wait for `async_payment_succeeded`             |
| `checkout.session.async_payment_succeeded`                   | Same as the first row                                       |
| `checkout.session.async_payment_failed` / `.expired`         | No order; the shopper retries with a new session            |
| `payment_intent.succeeded` after manual capture              | `setPayments` state=captured; Core `paymentStatus: paid`    |
| `payment_intent.canceled`                                    | `setPayments` state=cancelled; stays `unpaid`               |
| `charge.refunded`                                            | `addPayments` type=refund; `partiallyRefunded` / `refunded` |

Stripe may deliver an event twice, even concurrently; `createOrderOnce` absorbs it.

## Capture, refund, cancel

```ts
// Capture on shipment (manual capture only). One capture per PI; a partial capture releases the rest.
await stripe.paymentIntents.capture(
    piId,
    { amount_to_capture: toMinor(amount, currency) },
    { idempotencyKey: `capture-${piId}` },
);
// → payment_intent.succeeded → setPayments (state=captured, captured amount) + Core paymentStatus paid/partiallyPaid

// Refund (captured payments only). Several partial refunds up to the charged total.
await stripe.refunds.create(
    { payment_intent: piId, amount: toMinor(amount, currency) },
    { idempotencyKey: `refund-${piId}-${refundNo}` },
);
// → charge.refunded / refund.created → addPayments { transactionId: re_…, meta type=refund }

// Void an authorization (status requires_capture). A refund of an uncaptured PI is not possible.
await stripe.paymentIntents.cancel(piId, {}, { idempotencyKey: `cancel-${piId}` });
// → payment_intent.canceled → setPayments state=cancelled
```

Crystallize calls: [SKILL.md](../SKILL.md#paymentstatus). `refund.failed` means alert a human.

## Mapping

```ts
{
    provider: 'stripe',
    method: charge.payment_method_details.type, // card, klarna, vipps, mobilepay, swish, link, sepa_debit, …
    transactionId: paymentIntent.id,            // pi_… — capture, cancel and refund use it
    amount: toMajor(paymentIntent.amount, paymentIntent.currency), // MAJOR units
    createdAt: new Date(paymentIntent.created * 1000).toISOString(),
    meta: [
        { key: 'state', value: 'captured' },            // authorized | captured | cancelled
        { key: 'checkoutSessionId', value: session.id }, // cs_…
    ],
}
```

Refund record: `transactionId: refund.id` (`re_…`), `amount` = refunded amount in major units,
`meta: [{ key: 'type', value: 'refund' }, { key: 'paymentIntentId', value: pi.id }]`.

## Gotchas

- `ui_mode` values `hosted`, `embedded`, `custom` **fail** on Dahlia: use `hosted_page`, `embedded_page`,
  `elements`. Stripe.js renamed `initCheckout` → `initCheckoutElementsSdk` and `initEmbeddedCheckout` →
  `createEmbeddedCheckoutPage`, and removed `handleCardPayment`, `confirmPaymentIntent`, `createSource`.
- Webhook payload shape follows the **endpoint's** API version, not the SDK's. Pin the endpoint to the SDK's.
- `PaymentIntent.charges` was removed in `2022-11-15`; use `latest_charge` (expand it).
- `19.99 * 100` is `1998.9999…` — always `Math.round`. Minimums: 3.00 NOK/SEK, 2.50 DKK, 0.50 EUR/USD.
- A 3xx from the webhook route (trailing slash, auth middleware) counts as a failed delivery.
- In the old furniture boilerplates:
    - `receivePaymentEvent.ts` / `use-cases/payments/stripe.ts` read `event.data.object.charges.data[0]` —
      undefined on any endpoint newer than 2022-11-15, so no order is created. The handler library pins
      `apiVersion: '2022-08-01'`.
    - `routes/api.webhook.payment.stripe.tsx` calls `request.json()` and passes the object as `rawBody`:
      signature verification can never pass.
    - `amount: cart.total.gross * 100` is unrounded ("not sure here if this is correct").
    - No idempotency: a duplicate `payment_intent.succeeded` runs `pushOrder` again.
    - Orders use the typed `provider: 'stripe', stripe: {…}` shape via `@crystallize/node-service-api-request-handlers`.
    - `components/payments/stripe.tsx` hardcodes `return_url: 'http://' + …`, awaits `loadStripe` at module
      top level, and uses PaymentIntents + `confirmPayment` with `@stripe/stripe-js@5` / `react-stripe-js@3`.

[accept]: https://docs.stripe.com/payments/accept-a-payment?payment-ui=elements&api-integration=checkout
[cs-api]: https://docs.stripe.com/api/checkout/sessions/create
[fulfill]: https://docs.stripe.com/checkout/fulfillment
[webhooks]: https://docs.stripe.com/webhooks
[hold]: https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
[refunds]: https://docs.stripe.com/refunds
[currencies]: https://docs.stripe.com/currencies
[dahlia]: https://docs.stripe.com/changelog/dahlia
