# The booking flow (Shop API `/cart`)

Everything the storefront does. All of it is on the `/cart` endpoint except the order itself, which is
`/order`. See [[mutation]] for tokens and endpoints.

The Shop API reads products from the Catalogue with the credentials on the request, and the Shop token is
not one of them. On a tenant whose Catalogue requires authentication, also send its
`X-Crystallize-Static-Auth-Token`, or its access token pair, on every call that reads a product.

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

One slot per `granularitySec` across the range: `86400` for a day view, `3600` for hours. A query is
refused past 10,000 slots, or past 100,000 slots × units. `free` is how many units or seats are open.
`freeUnitIds` names the units you may pin, and is always `[]` on a capacity pool. `bookable` is the time
check alone (not elapsed, inside the `advanceWindow`), and `reason` explains a `false`. So a sold-out
slot reads `{ free: 0, bookable: true, reason: null }`: a calendar needs both.

- **`language` is required and it must be a language the item exists in.** The wrong one reads like an
  unbookable product: a GraphQL error with `extensions.reason: "NotBookable"` from `availability` and
  `nearestAvailability`, and `{ ok: false, reason: "NotBookable" }` from `checkBooking`.
- **`bookSkuItem` has no `language`.** It reads the product in the cart's `context.language`, and a
  `hydrate` that sends no `context` means `en`. Hydrate the cart in the language you pass here.
- Ask for the range the calendar shows, plus enough tail that the longest bookable period starting on the
  last visible day still fits.
- **A run of open days does not prove the whole window is open.** Each slot is counted alone, so one unit
  can be free on Monday and another on Tuesday. Ask `checkBooking` before booking across several slots.
- **The slots already include the policy's buffers, on both sides of every booking.** A booking 10:00–11:00
  under a 15-minute buffer reads busy from 09:45 to 11:15 at 15-minute granularity: 09:45, because a new
  booking ending at 10:00 would need its own buffer. So "this unit is free in every slot of
  `[start, end)`" is the right admission test, and `bookSkuItem` refused exactly where the slots said busy.
  (Korsbakken build, 2026-10.)
- **Start the range on the booking grid, not on UTC midnight.** With `granularitySec: 86400` from UTC
  midnight, a 07:00→07:00 Oslo hire falls into two slots, so every hire looks a day longer. Start the
  range at the local period start (07:00) and the slots line up with the bookings. (Felleskjøpet build.)

`nearestAvailability(productId, sku, around, durationSec, n, language)` answers "the next `n` windows of
this length from this time" as `{ start, end }` — the right query behind a "next free slot" button. `n`
defaults to 5, at most 100. It only walks forward, up to 30 days, in steps of `durationSec`: a 7-day
window is tried once a week, not every day. A `durationSec` under 260 is refused. The windows start at
the time of day of `around`.

**`nearestAvailability` knows no opening hours and searches the whole pool.** For a four-hour job it
offered 16:00–20:00, and it takes no unit or region filter. Use it as a hint (jump the calendar to that
week), then filter the slot starts to opening hours and to the units the shopper can use in code. Opening
hours are not a booking concept; to make closed hours unbookable, `block` them on
[`/booking/admin`](booking-admin.md#take-a-unit-out-of-service). (Korsbakken build.)

`checkBooking(input: CartCheckBookingInput!)` is a dry run of one exact booking and returns
`{ ok, reason }`, not a union. `reason` is `NotBookable`, `Conflict`, `InvalidRange` or `InvalidUnitId`:
`Conflict` here, where `bookSkuItem` says `ReservationConflict`. It takes `productId`, `sku`, `start`,
`end`, `language`, and optionally `unitId` and `quantity`. Debounce it: it runs the same gates the booking
itself does.

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
`errors` treats a refused booking as a success. **Their `message` is only the type name**
(`{ __typename: "ReservationConflict", message: "ReservationConflict" }`), apart from the cart-changed
conflict below, so the storefront writes its own text per `__typename` and per language.

### `quantity` is units out of the pool, not the length of the window

This is the single thing most likely to produce a wrong price. Measured on a unit pool of 5, booking a
**two-day** window on a **one-day** SKU priced at 39 net:

| Sent                              | Result                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `quantity: 1`                     | one reservation over the whole window, line **39** — not 78                                 |
| `quantity: 2`                     | **two** reservations, both over the whole window, line **78**                               |
| `quantity: 6` (pool holds 5)      | `ReservationConflict`                                                                       |
| `quantity: 2` **with** a `unitId` | `OUTPUT_VALIDATION_ERROR`, with `booking.unitId requires quantity 1` in `extensions.errors` |

So `quantity: 2` means _two machines_, or _two rooms_, for the same window — never "two days" or "two
nights". **Nothing in the booking inputs prices by duration.** A window twice as long costs the same
unless the price says otherwise, and the price only comes from the SKU.

Three ways out, and the first is the one to reach for:

1. **Sell the duration as variants** — a day SKU, a weekend SKU, a week SKU — and book the SKU whose
   length matches the window. See [modelling.md](modelling.md).
2. **When the shopper picks arbitrary dates** (hotel nights, hourly hire), book one managed line for the
   first unit of time and add the rest as an **external** line (`addExternalItem`) that carries the
   remaining nights, tied back to the booked line by your own `meta`. Do not reprice the booked line:
   `place` refuses a cart whose booked line went through `changeCartItemPricing` with `NotBookable`,
   even though the reservation itself survives it. A group discount works as a negative external line.
   (From the Boutique Universe build, a hotel on nightly rates.)
3. **When period prices matter** (a weekend and a week cost less than seven days), chain period SKUs on
   one unit: a 10-day hire is a weekend SKU plus a week SKU, the cheapest cover computed in the storefront,
   booked back to back with one `bookSkuItem` each on the same `unitId`. This needs zero buffers and
   periods that meet (every period 07:00→07:00). Each line carries its real SKU and price, a customer's
   price list applies per line, and the calendar is blocked exactly. (Felleskjøpet build, machine hire.)

`addExternalItem` needs the product on its variant: `variant: { price, product: { id, path } }`.
Without `product` it fails with `Field "product" of required type "ProductInput!" was not provided`.

**A `unitId` and `quantity: 1` belong together.** To hold two named units, book twice — once per unit.

**A bookable SKU with no window is a plain line.** `addSkuItem`, or a `hydrate` line with no `booking`,
reserves nothing, and `place` and `createFromCart` let it through: the order exists and the calendar never
heard of it. That holds for every variant of a bookable product, not only the one you booked. Nothing
warns you, so validate in the storefront that every line of a bookable product has a `booking`, unless
you add such a line on purpose. The Korsbakken build did: one window for a set of installation jobs, booked
on the first job's SKU, with the other jobs as plain lines tied to it by `meta`.

**Put the customer on the cart before booking.** The reservation records who holds it at
`bookSkuItem`/`hydrate` time, and only when the cart's customer has an identifier. Nothing sets it later:
`setCustomer` after `place` does not reach it. Create the cart with `hydrate(input: { customer, items: [] })`,
or `setCustomer` before the first booking.

**Seed bookings through the full flow too.** A seed that books, places and confirms with no customer and
no order leaves reservations the admin shows as "No customer — admin-created / No order": 705 of them in
the Boutique Universe build. The cart cannot cancel them once placed, and `clearBookable` + `setBookable`
keep them. Cancel them on [`/booking/admin`](booking-admin.md) (`cancel`, `bulkCancel`), or better, seed
with a customer, `createFromCart` and the second confirm, as a shopper would.

**On `ReservationConflict`, walk the other `freeUnitIds`.** Between the availability query and the
booking someone else may have taken that unit. The exception is a `message` that says the cart changed:
see [below](#one-write-at-a-time-per-cart). Any other refusal is final — stop and tell the shopper.

**A window past the policy's `advanceWindow` is refused as `InvalidRange`**, with nothing to say the
policy is what stopped it. Products that are booked together need the same window: a room on a 120-day
policy and a boat trip on a 60-day one means a summer booking can hold the room but not the trip. Cap
the calendar at the shortest `advanceWindow` in the basket. (Observed in the Boutique Universe build.)

**The reservation id comes back on the line's `meta`**, not on the cart's, comma-separated when the line
holds several:

```json
"meta": { "reservationIds": "18a6b9d4-…", "booking.window": "2026-10-01T08:00:00.000Z/2026-10-01T16:00:00.000Z" }
```

`booking.window` is written for you. **Write the `unitId` into the line's `meta` yourself.** `CartItem`
has no booking field, and a pinned line re-hydrated without its `unitId` does not match its hold: it
is rebooked, possibly onto another unit. `reservation(cartId:, id:) { unitId }` can recover a lost one.
It is also how a storefront learns the unit of an unpinned booking, which takes the first free units in
pool order.

`bookSkuItem` ignores `group` and `type` on a new line. To group a booking with its services, set
`group` when you next `hydrate`.

Read one hold with `reservation(cartId:, id:)`:
`{ id, productId, variantSku, unitId, start, end, state, source, cartLineId, orderId, expiresAt }`. It
answers `null` for a row this cart does not hold.

**Look holds up one at a time.** Several `reservation(cartId:, id:)` fields aliased into a single query
sometimes never answer — 3 of 10 attempts in the Boutique Universe build. One query per hold, with a
timeout.

### One write at a time per cart

Every booking write is conditional on the version of the cart it read. Two `bookSkuItem` calls in flight
against one cart land one booking. The other answers `ReservationConflict`, its hold is released, and its
`message` says the cart changed and nothing was booked. A slot conflict has the bare `message`
`ReservationConflict`. `hydrate`, `place`, `cancelReservation` and `rebookReservation` lose the same race
with a GraphQL error: "The cart was changed by another request…".

So **serialize the booking writes for one cart** — a queue or a lock per cart id — and when a write loses
that race, read the cart back before retrying: the other request may have made this same booking.

## 3. Keep it while they shop

**`hydrate` is the whole cart.** A booking line you leave out is cancelled with it, and re-hydrating with
the line slides its expiry forward. There is no "extend the hold" mutation. Every hydrate gives all the
holds of the cart one deadline, set by the shortest `pendingHoldDuration` among them. `bookSkuItem` slides
nothing, not even the other holds on that cart.

That cuts both ways, and the second half is the useful one:

- **To keep a booking**, send every line on every hydrate, with its window and unit:

    ```json
    {
        "sku": "RENT-GAS55-DAY",
        "quantity": 1,
        "booking": { "start": "2026-10-01T08:00:00Z", "end": "2026-10-01T16:00:00Z", "unitId": "GAS55-OSL-1" },
        "meta": [{ "key": "unitId", "value": "GAS55-OSL-1" }]
    }
    ```

    A line is matched to its hold per SKU, by window and unit, so resend both unchanged. Lines that match
    nothing are paired in payload order and moved, so changing one date moves that line. `hydrate` does
    not use `lineId` for this. `lineId` (selectable on `CartItem`) is the line's server-minted handle for
    the mutations that target one line, such as `changeCartItemPricing`, which refuse a SKU shared by
    several lines without it.

- **To change a booking**, send it changed. A new line with a `booking` is reserved, and a new `quantity`
  takes or releases the difference. A refusal is not a union member here: the whole hydrate fails with
  `Cannot place this cart: <sku> (ReservationConflict)` and saves nothing. Use `bookSkuItem` for a new
  booking when the shopper needs to know why.

- **To remove one from the basket**, re-hydrate without it. `removeCartItem` refuses a booking line. Do
  **not** use `cancelReservation`: the policy's cancellation window applies to a hold that was never
  bought, so a rental starting tomorrow under a two-day window answers `CancellationWindowClosed` and the
  shopper cannot empty their own basket. Verified against a live tenant.

`abandon(id)` gives back every hold of a draft cart at once, rather than at their expiry.

`cancelReservation(cartId:, reservationId:)` succeeds only while the start is at least
`cancellationWindow` seconds away. It is right for a line that is far enough out, and
`rebookReservation(cartId:, reservationId:, newBooking:)` moves a hold to a new window atomically. It
moves every reservation on that line, so a quantity-3 line moves as one, each keeping its unit if that
unit is free in the new window. A `unitId` on such a line answers `InvalidUnitId`. Both mutations answer a
union, so check `__typename`. `ReservationConflict` is the only outcome worth retrying.

**All of this is for a draft cart.** Once the cart is placed, `hydrate` throws "A placed cart cannot be
hydrated", and `cancelReservation`/`rebookReservation` fail with `INPUT_STATE_ERROR`. Finish every change
to the bookings before `place`.

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
last check before payment, and the holds live for `placedHoldDuration` while payment runs. If that payment
fails, `remove(id)` deletes the cart and gives its unconfirmed holds back at once. It leaves `CONFIRMED`
rows alone, and `abandon` is refused on a placed cart.
`confirmCartBooking` answers `Cart`, `NotPlaced`, `NothingToConfirm` or `ReservationNoLongerHeld`. The
last one means a hold expired while payment was in flight; select its `missing` field for the ids. It
is all or nothing: the surviving holds stay `PENDING`, and the shopper has to pick another window for
the lost one.

Every step here runs on the server: a server action for `place` and the first confirm, and the payment
gateway's webhook for `createFromCart` and the second confirm (see [[payments]]). The browser holds only
the cart id. The `cart.orderId` link took about 440 ms in one build and 500 ms in another, so the poll is
required, not defensive.

**Order meta comes from the cart.** `OrderFromCartInput` takes no `meta`; `createFromCart` copies the
cart's meta onto the order. Write what the order needs (reference, the person who booked, the depot)
with the cart's `setMeta` before `place`.

**Give rentals their own pipeline** when the tenant also takes ordinary orders: pass both in
`createFromCart`'s `pipelines` (ids, not names) — ordinary lines to an Orders pipeline, booked lines to a
Rentals pipeline. Do not set `placeNewOrders: true` on the first stage of more than one pipeline: every
new order then lands in all of them. (Tools Universe build.)

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

    `bulkCancel(ids:, reason:)` takes up to 100 ids and answers per id; it is not atomic. See
    [booking-admin](booking-admin.md) for the rest of that endpoint, including why
    `client.shopBookingApi` cannot reach it.

- **A hold lost after `place` cannot be re-picked on that cart.** A placed cart cannot be hydrated or
  rebooked. On `ReservationNoLongerHeld`, cancel the survivors (above), refund if the money has
  moved, and start a new cart for the new window.
- A reservation's `state` is a string: `PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED` or `EXPIRED`. A
  hold that runs out becomes `EXPIRED`, up to a minute late, while its line stays in the cart. The next
  `hydrate` takes it again if the window is still free. If not it fails with
  `Cannot place this cart: <sku> (ReservationConflict)`, saving nothing, so send the next one with another
  window or without that line.
- `place` refuses a cart with `Cannot place this cart: <sku> (<reason>)`. `HoldNoLongerHeld` is a hold that
  ran out or was cancelled, `UnitNoLongerInPool` a pinned unit that left the published pool, and
  `NotBookable` a product no longer published or bookable. The cart stays a draft, so it can be fixed.
- `/order` carries what was booked: `items { lineId booking { start end unitId } }`, where `unitId` is the
  pinned unit only. The order's `meta` adds `reservations`, a JSON string with one record per reservation,
  real unit included, which outlives the reservation itself. A `reservations.unconfirmed` key, there only
  when something went wrong, lists the ids no longer held. Watch for it: the order is created either way.
- **The confirmation page needs no reservation lookup.** Each `reservations` record carries the id,
  `unitId`, window, `state`, `frozenPolicy`, `customerId` and the line's meta, and `orderId` once the
  second confirm has run. Read it from the order `createFromCart` returned, or from `order(id) { meta }`.
  To verify `{ state: CONFIRMED, orderId }` server-side, `/booking/admin` `reservation(id)` reads any
  reservation without its cart id.
- **Self-service cancellation is yours to gate.** The cart refuses to cancel an ordered reservation, and
  `/booking/admin` `cancel` ignores the cancellation window (it cancelled an ordered reservation in the
  Korsbakken build). A "cancel my booking" action therefore checks, on the server, that the start is at
  least `policySnapshot.cancellationWindow` seconds away and that the session's customer owns the order,
  then calls `cancel`, then refunds through the payment provider.
