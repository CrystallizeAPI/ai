# Cart and checkout on the Shop API

The browser holds the cart id in an httpOnly cookie. Every cart read and write is a server action or route
calling the Shop API with the server's JWT. Mutation shapes and their options are in [[mutation]]; the price
context in [[pricing]]; payment providers in [[payments]].

## The cart is a hydrate

`hydrate` replaces the whole cart. A server action reads the current cart, applies the change to the full list of
lines, and hydrates all of them (trimmed from a working storefront):

```ts
"use server";
import { cookies } from "next/headers";
import { refresh } from "next/cache";

async function change(lang: string, update: (lines: Map<string, number>) => void) {
    const jar = await cookies();
    const customer = await currentCustomer(); // the signed-in buyer, or undefined
    const cart = await getCart(jar.get("cart")?.value, lang, customer);
    // Booked lines pass through untouched; the rest are edited by SKU.
    const booked = (cart?.lines ?? []).filter((l) => l.booking);
    const lines = new Map((cart?.lines ?? []).filter((l) => !l.booking).map((l) => [l.sku, l.quantity]));
    update(lines);
    const items = [...booked.map(lineInput), ...[...lines].map(([sku, quantity]) => ({ sku, quantity }))];
    const next = await hydrate(cart?.id, items, lang, customer);
    jar.set("cart", next.id, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    refresh();
    return next.count;
}

export const addToCart = (sku: string, quantity: number, lang: string) =>
    change(lang, (l) => l.set(sku, (l.get(sku) ?? 0) + quantity));
export const setQuantity = (sku: string, quantity: number, lang: string) =>
    change(lang, (l) => (quantity > 0 ? l.set(sku, quantity) : l.delete(sku)));
```

The hydrate itself, with the price context for the language's market:

```ts
const FIELDS = `id state isStale updatedAt context customer { identifier }
  items { lineId name quantity meta variant { sku product { path name } price { net } } price { net } }
  total { net gross taxAmount }`;

export async function hydrate(
    id: string | undefined,
    items: LineInput[],
    language: string,
    customer?: CartCustomer,
    markets: string[] = [],
) {
    const m = MARKET[language];
    const { hydrate } = await shop<{ hydrate: RawCart }>(
        `mutation Hydrate($input: CartInput!) { hydrate(input: $input) { ${FIELDS} } }`,
        {
            input: {
                ...(id ? { id } : {}),
                ...(customer ? { customer } : {}),
                items: items.filter((i) => i.quantity > 0),
                context: {
                    language,
                    price: {
                        currency: m.currency,
                        selectedVariantIdentifier: m.priceVariant,
                        pricesHaveTaxesIncludedInCrystallize: false,
                        taxRate: m.vat, // a fraction: 0.25
                        decimals: 4, // exact line and tax amounts; round for display only
                        markets, // the buyer's price-list markets
                    },
                },
            },
        },
    );
    return toCart(hydrate);
}
```

- **`price.net` on a cart line is the line total**; `variant.price.net` is the unit price. Order lines carry the
  unit price.
- **A booked line keeps its booking only if it comes back** with its `lineId`, `meta` and `booking`. Hydrating
  without it releases the reservation. See [[bookable-resources]].
- **An unknown SKU** was seen both failing the whole call and silently dropping the line. Check SKUs against
  Discovery in parallel, and check the answer for the line you added.
- **Cart meta becomes order meta**: `createFromCart` copies it.

## Reading a stored cart

Re-hydrate when the stored cart could be priced wrong: it is stale, it was built in another language, or for
another customer (a company's price lists only apply to a cart hydrated with that company).

```ts
export async function getCart(
    id: string | undefined,
    language: string,
    customer?: CartCustomer,
    markets: string[] = [],
) {
    if (!id) return null;
    const { cart } = await shop<{ cart: RawCart | null }>(`query Cart($id: UUID!) { cart(id: $id) { ${FIELDS} } }`, {
        id,
    }).catch(() => ({ cart: null }));
    if (!cart || cart.state !== "cart") return null; // placed or ordered: start a new one
    const other =
        cart.context.language !== language || (cart.customer?.identifier ?? undefined) !== customer?.identifier;
    if (cart.isStale || other) return hydrate(id, toCart(cart).lines.map(lineInput), language, customer, markets);
    return toCart(cart);
}
```

## The drawer

- Show the line at once (optimistic), then replace the drawer with the hydrate's answer. The hydrate takes about
  200–400 ms; the optimistic line shows in a few milliseconds.
- Batch rapid quantity changes into one hydrate.
- Quantity is a labelled native control, and steppers are named after the product
  ([accessibility.md](accessibility.md)). An agent or a screen reader can then read and set it.

## Checkout

The order of calls matters. In a server action:

1. **Hydrate one last time** with the customer and the final lines (product names in line meta if you want them
   on the order).
2. **`setCustomer`**. For B2B, the organisation, with the person who ordered in cart meta.
3. **`setMeta(merge: true)`**: market, segment, PO reference, project.
4. **`place`**. The cart is now locked; charge `place`'s `total`. If order creation fails after this, the
   shopper needs a new cart.
5. **Bookings**: `confirmCartBooking(cartId)` before the order, which checks the holds still stand.
6. **Payment**: create the provider session on the server from the placed total ([[payments]]). In the
   provider's webhook, verify, then:
7. **`createFromCart(id, { type, paymentStatus, payments, pipelines })`** on `/order`, all in the input, not
   chained. No `fulfill` afterwards: `createFromCart` already moves the cart to `ordered`.
8. **Bookings again**: poll `cart { orderId }` until it is set (about 0.5 s), then `confirmCartBooking` again,
   which links the reservations to the order.
9. Delete the cart cookie, expire the buyer's cached history (`updateTag`), show the confirmation.

```ts
await shop(`mutation($id: UUID!, $c: CustomerInput!) { setCustomer(id: $id, input: $c) { id } }`, { id, c: customer });
await shop(`mutation($id: UUID!, $meta: [KeyValueInput!]!) { setMeta(id: $id, meta: $meta, merge: true) { id } }`, {
    id,
    meta,
});
await shop(`mutation($id: UUID!) { place(id: $id) { id } }`, { id });

const { createFromCart: order } = await shop<{ createFromCart: { id: string } }>(
    `mutation($id: UUID!, $input: OrderFromCartInput!) { createFromCart(id: $id, input: $input) { id } }`,
    {
        id,
        input: {
            type: "standard",
            paymentStatus: "paid",
            payments: [{ provider: "custom", method: "card", amount: cart.gross, transactionId: providerReference }],
            pipelines: [{ identifier: pipelineId, stage: stageId }], // ids from PIM pipeline.getMany at build time
        },
    },
    "order",
);
```

- A guest is `{ isGuest: true, identifier: email, firstName, lastName, email }`; a signed-in buyer is
  `{ identifier, isGuest: false, … }`. Put the customer on the cart before any booking.
- `additionalInformation: null` is refused: leave the key out.
- Pipeline and stage ids, not names. Read them with PIM `pipeline.getMany` at build time.

## Quotes and invoice

A quote is `createFromCart` with `type: "quote"`, no payment, and a quotes pipeline. Accepting it creates the
order with Shop `create` (lines and prices from the quote, `relatedOrderIds: [quoteId]`), then moves the quote's
stage. Invoice checkout is `paymentStatus: "unpaid"` with a custom payment, for signed-in trade buyers, after a
credit check against their open orders.

## The confirmation page

- Show the order `createFromCart` returned. `order(id)` can answer "not found" for a moment after creation; retry
  if you must read it.
- Booking details come from the order meta snapshot.
- Later visits list `orders(customerIdentifier, limit: 100)` on `/order`. New orders can take seconds to minutes to
  appear there, and paging with `limit`/`skip` was inconsistent: read one page, and say on the confirmation page
  that history updates shortly.

## Agents in the checkout

An AI agent's basket has no cookie: it travels as a `cartId`, and a signed hand-off link lets the shopper's
browser adopt it and finish payment in the store. See [[agentic-commerce]].
