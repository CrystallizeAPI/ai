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
                lineId
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

`booking.window` is written for you. **Write the `unitId` into the line's `meta` yourself.** `CartItem`
has no booking field, and a pinned line re-hydrated without its `unitId` does not match its hold: it
is rebooked, possibly onto another unit. `reservation(cartId:, id:) { unitId }` can recover a lost one.

`bookSkuItem` ignores `group` and `type` on a new line. To group a booking with its services, set
`group` when you next `hydrate`.

Read one hold with `reservation(cartId:, id:)`:
`{ id, productId, variantSku, unitId, start, end, state, source, cartLineId, orderId, expiresAt }`.

## 3. Keep it while they shop

**`hydrate` is the whole cart.** A booking line you leave out is cancelled with it, and re-hydrating with
the line slides its expiry forward. There is no "extend the hold" mutation.

That cuts both ways, and the second half is the useful one:

- **To keep a booking**, send every line on every hydrate, with its window and unit:

    ```json
    {
        "sku": "RENT-GAS55-DAY",
        "quantity": 1,
        "lineId": "…",
        "booking": { "start": "2026-10-01T08:00:00Z", "end": "2026-10-01T16:00:00Z", "unitId": "GAS55-OSL-1" },
        "meta": [{ "key": "unitId", "value": "GAS55-OSL-1" }]
    }
    ```

    A line is matched to its hold by window and unit, so resend both unchanged. `lineId` (selectable on
    `CartItem`) is the line's server-minted handle; send it back when two lines share a SKU.

- **To remove one from the basket**, re-hydrate without it. Do **not** use `cancelReservation`: the
  policy's cancellation window applies to a hold that was never bought, so a rental starting tomorrow
  under a two-day window answers `CancellationWindowClosed` and the shopper cannot empty their own
  basket. Verified against a live tenant.

`cancelReservation(cartId:, reservationId:)` succeeds only while the start is at least
`cancellationWindow` seconds away. It is right for a line that is far enough out, and
`rebookReservation(cartId:, reservationId:, newBooking:)` moves a hold to a new window atomically. It
moves every reservation on that line, so a quantity-3 line moves as one. `ReservationConflict` is the
only outcome worth retrying.

**All of this is for a draft cart.** Once the cart is placed, `hydrate` throws "A placed cart cannot be
hydrated", and `cancelReservation`/`rebookReservation` throw `InvalidStateError`. Finish every change to
the bookings before `place`.

## 4. Place, pay, order, confirm — in that order

```text
place(id)                     re-checks every hold, extends to placedHoldDuration (0 = pendingHoldDuration)
confirmCartBooking(cartId)    OPTIONAL: the holds still stand, and are now committed — see below
… take payment …
createFromCart(id, input)     the order (on /order). It snapshots the reservations
… wait for cart.orderId …     the cart is linked in the background, ~500 ms
confirmCartBooking(cartId)    REQUIRED: this is what writes orderId onto the reservations
```

**`confirmCartBooking` writes `orderId` onto the reservations only if the cart already has one.** The
order id is the cart id, but `createFromCart` returns before it links the cart: it saves the order
and stamps `orderId` on the cart in the background. The cart therefore gets its `orderId` a few
hundred milliseconds after `createFromCart` returns, so a single confirm
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

**The first confirm commits the slot before the money moves.** A `CONFIRMED` reservation never expires:
it blocks the calendar until its window ends. It is what proves the holds still stand before the
shopper is charged. If you keep it, cancel the reservations through `/booking/admin` when the payment
fails, or the machine stays blocked with no order behind it. If you drop it, `place` is still the
last check before payment, and the holds live for `placedHoldDuration` while payment runs.
`confirmCartBooking` answers `Cart`, `NotPlaced`, `NothingToConfirm` or `ReservationNoLongerHeld`. The
last one means a hold expired while payment was in flight; select its `missing` field for the ids. It
is all or nothing: the surviving holds stay `PENDING`, and the shopper has to pick another window for
the lost one.

When payment is confirmed server-side by a gateway webhook, run the confirmation there rather than in the
browser round trip.

**Do not call `fulfill`.** `createFromCart` already moves the cart to `ordered`, and the order id is the
cart id.

## After the order

- A reservation on a placed or ordered cart **cannot be cancelled through the cart**: "A reservation
  cannot be cancelled through a cart that is no longer editable." Cancel it on the Shop API's
  `/booking/admin` endpoint, which needs a token with both the `booking` and `booking:admin` scopes and
  ignores the cancellation window. Run it server-side only:

    ```graphql
    mutation {
        cancel(id: "18a6b9d4-…", reason: "payment failed") {
            id
            state
        }
    }
    ```

    `bulkCancel(ids:, reason:)` takes up to 100 ids and answers per id; it is not atomic.

- **A hold lost after `place` cannot be re-picked on that cart.** A placed cart cannot be hydrated or
  rebooked. On `ReservationNoLongerHeld`, cancel the survivors (above), refund if the money has
  moved, and start a new cart for the new window.
- A reservation's `state` is a string: `PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED` or `EXPIRED`. A
  hold that runs out becomes `EXPIRED`, up to a minute late, while its line stays in the cart. The next
  `hydrate` takes it again if the window is still free and throws `BookingNoLongerAvailable` if not;
  `place` refuses it with `HoldNoLongerHeld`.
