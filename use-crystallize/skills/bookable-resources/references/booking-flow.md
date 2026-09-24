# The booking flow (Shop API `/cart`)

Everything the storefront does. All of it is on the `/cart` endpoint except the order itself, which is
`/order`. See [[mutation]] for tokens and endpoints.

## 1. What is free

```graphql
query Availability($productId: String!, $sku: String!, $range: CartTimeRangeInput!, $language: String!) {
    availability(productId: $productId, sku: $sku, range: $range, granularitySec: 86400, language: $language) {
        start
        end
        free
        freeUnitIds
        bookable
        reason
    }
}
```

One slot per `granularitySec` across the range: `86400` for a day view, `3600` for hours. `free` is how
many units are open, `freeUnitIds` names them, and `reason` says why a slot is closed.

- **`language` is required and it must be a language the item exists in.** The wrong one reads as
  `NotBookable` rather than as an error.
- Ask for the range the calendar shows, plus enough tail that the longest bookable period starting on the
  last visible day still fits.

`nearestAvailability(productId, sku, around, durationSec, n, language)` answers "the next `n` windows of
this length near this time" — the right query behind a "next free slot" button.

`checkBooking(input: CartCheckBookingInput!)` is a dry run of one exact booking and returns
`{ ok, reason }`, not a union. It takes `productId`, `sku`, `start`, `end`, `language`, and optionally
`unitId` and `quantity`. Debounce it: it runs the same gates the booking itself does.

## 2. Hold it

```graphql
mutation Book($id: UUID, $input: CartBookingItemInput!) {
    bookSkuItem(id: $id, input: $input) {
        __typename
        ... on Cart {
            id
            items {
                name
                meta
            }
        }
        ... on ReservationConflict {
            message
        }
        ... on NotBookable {
            message
        }
        ... on InvalidRange {
            message
        }
        ... on InvalidUnitId {
            message
        }
    }
}
```

```json
{
    "input": {
        "sku": "RENT-GAS55-DAY",
        "quantity": 1,
        "booking": { "start": "2026-10-01T08:00:00Z", "end": "2026-10-01T16:00:00Z", "unitId": "GAS55-OSL-1" },
        "meta": [{ "key": "unitId", "value": "GAS55-OSL-1" }]
    }
}
```

`bookSkuItem` is `addSkuItem` with a window: the line is priced from the SKU like any other line.

**Check `__typename`.** The four refusals are results, not GraphQL errors, so a client that only looks at
`errors` treats a refused booking as a success.

**Put the customer on the cart before booking.** The reservation records who holds it at
`bookSkuItem`/`hydrate` time, and only when the cart's customer has an identifier. Nothing sets it later.
Create the cart with `hydrate(input: { customer, items: [] })`, or `setCustomer` before the first booking.

**On `ReservationConflict`, walk the other `freeUnitIds`.** Between the availability query and the
booking someone else may have taken that unit. Any other refusal is final — stop and tell the shopper.

**The reservation id comes back on the line's `meta`**, not on the cart's:

```json
"meta": { "reservationIds": "18a6b9d4-…", "booking.window": "2026-10-01T08:00:00.000Z/2026-10-01T16:00:00.000Z" }
```

`booking.window` is written for you. **Write the `unitId` into the line's `meta` yourself** — the cart
does not return a line's unit, and you need it to re-hydrate the line without losing the hold.

Read one hold with `reservation(cartId:, id:)`:
`{ id, productId, variantSku, unitId, start, end, state, source, cartLineId, orderId, expiresAt }`.

## 3. Keep it while they shop

**`hydrate` is the whole cart.** A booking line you leave out is cancelled with it, and re-hydrating with
the line slides its expiry forward. There is no "extend the hold" mutation.

That cuts both ways, and the second half is the useful one:

- **To keep a booking**, send every line on every hydrate, including its `unitId` meta.
- **To remove one from the basket**, re-hydrate without it. Do **not** use `cancelReservation`: the
  policy's cancellation window applies to a hold that was never bought, so a rental starting tomorrow
  under a two-day window answers `CancellationWindowClosed` and the shopper cannot empty their own
  basket. Verified against a live tenant.

`cancelReservation(cartId:, reservationId:)` is right when the shopper is outside the window, and
`rebookReservation(cartId:, reservationId:, newBooking:)` moves a hold to a new window atomically —
`ReservationConflict` is the only outcome worth retrying.

## 4. Place, order, confirm — in that order, and confirm twice

```text
place(id)                     re-checks every hold, extends to placedHoldDuration
confirmCartBooking(cartId)    the holds still stand; safe to take payment
createFromCart(id, input)     the order (on /order). It snapshots the reservations
… wait for cart.orderId …     the cart is linked in the background, ~500 ms
confirmCartBooking(cartId)    again — this is what writes orderId onto the reservations
```

**`confirmCartBooking` writes `orderId` onto the reservations only if the cart already has one.** The
cart gets its `orderId` a few hundred milliseconds after `createFromCart` returns, so a single confirm
before the order leaves every reservation `{ state: CONFIRMED, orderId: null }`, and the admin shows
"No order — not checked out" for a booking that was paid for.

Poll the cart, then confirm again. It accepts an ordered cart and rows that are already confirmed:

```ts
async function linkReservations(cartId: string) {
    for (let i = 0; i < 20; i++) {
        const { cart } = await shop(`query($id: UUID!) { cart(id: $id) { orderId } }`, { id: cartId });
        if (cart?.orderId) {
            await shop(`mutation($id: UUID!) { confirmCartBooking(cartId: $id) { __typename } }`, { id: cartId });
            return;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
}
```

Keep the first confirm as well: it is what proves the holds still stand before the shopper is charged.
`confirmCartBooking` answers `Cart`, `NotPlaced`, `NothingToConfirm` or `ReservationNoLongerHeld` — the
last one means a hold expired while payment was in flight, and the shopper has to pick another window.

When payment is confirmed server-side by a gateway webhook, run the confirmation there rather than in the
browser round trip.

**Do not call `fulfill`.** `createFromCart` already moves the cart to `ordered`, and the order id is the
cart id.

## After the order

- A confirmed reservation on an ordered cart **cannot be cancelled through the cart**: "A reservation
  cannot be cancelled through a cart that is no longer editable." The Shop API's `/booking/admin`
  endpoint is where a sold booking is administered.
- A reservation's `state` is a string. The ones a storefront meets are `PENDING` before confirmation and
  `CONFIRMED` after it; a hold that was never confirmed disappears when it expires.
