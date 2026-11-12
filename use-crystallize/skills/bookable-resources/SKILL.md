---
name: bookable-resources
description: >
    Sell Crystallize products that are held in time rather than counted in stock — rentals, services,
    rooms, courses, equipment, appointments. Covers booking policies and bookable pools on the Core API,
    the booking flow on the Shop API /cart endpoint (availability, holds, checkout and confirmation), and
    the Shop API /booking/admin endpoint (maintenance blocks, reservation calendars, staff cancellations).
    Use when the user wants to rent something out, take bookings or reservations, sell time slots or
    by the day/weekend/week, show a booking calendar, manage a fleet of machines, rooms or seats, take a
    unit out of service, or handle cancellations. Trigger on "bookable", "booking", "reservation",
    "rental", "rent", "hire", "availability", "time slot", "calendar", "hold", "setBookable",
    "bookSkuItem", "createBookingPolicy", "confirmCartBooking", "cancelReservation", "rebookReservation",
    "nearestAvailability", "checkBooking", "booking/admin", "booking policy", "cancellation window",
    "pool", "units".
metadata:
    author: Crystallize
    version: "1.0"
---

# Crystallize Bookable Resources

A bookable product is not counted down like stock — it is **held for a window of time and given back**.
A digger rented Friday to Monday, a meeting room at 09:00, a photographer for an afternoon. The same
product sells again and again; what is scarce is the calendar.

Crystallize serves this natively: a **policy** carries the rules, a **pool** carries the things that can
be booked, and the Shop API holds them for a shopper while they shop, then hands them to the order.

> Verified on 2026-09-24 and 2026-09-28 against the live Core API and Shop API on a tenant with bookable
> resources, including test reservations taken and released. Where a claim comes from one storefront build
> rather than from the API, this skill says so.

## Five concepts

| Concept          | What it is                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| **Policy**       | The rules, all durations in **seconds**: how far ahead, buffers, how long a hold lives, cancellation window |
| **Pool**         | What can be booked on one product: **named units** (machine 1, machine 2) **or** a plain **capacity**       |
| **Reservation**  | One hold on one window, in one cart line. It expires unless it is confirmed                                 |
| **Window**       | `start` and `end`, absolute times. Availability is asked and holds are taken per window                     |
| **Confirmation** | What turns a hold into a booking that survives. It must run after the cart has its `orderId` — see below    |

Booking sits on the **product**; the price comes from the **variant**. A rental sold by the day, the
weekend and the week is therefore one bookable product with three variants.

## The pipeline

```text
Core    createBookingPolicy          the rules — every duration in SECONDS
Core    setBookable(id, language)    one pool per product: units[] OR capacity, never both
Core    publishItem                  the Shop API reads published data only — publish after EVERY
                                     setBookable, reapplyBookablePolicy or clearBookable
Shop    availability / checkBooking  what is free, and would this exact booking be taken
Shop    bookSkuItem                  a hold on the cart, in state PENDING
Shop    place                        re-checks the holds and extends them to placedHoldDuration
Shop    createFromCart               the order. It only snapshots the reservations
Shop    confirmCartBooking           once the cart has its orderId (optionally also before payment)
```

## Which API does what

| Task                                                         | API and endpoint                     | Who calls it                          |
| ------------------------------------------------------------ | ------------------------------------ | ------------------------------------- |
| The pool, unit meta and `policySnapshot` on a product page   | Discovery (`bookable { … }`)         | Storefront server, cached             |
| Availability, `nearestAvailability`, `checkBooking`          | Shop API `/cart`                     | Storefront server, after the product  |
| Hold, change, release; `place`; `confirmCartBooking`         | Shop API `/cart`                     | Storefront server, payment webhook    |
| The order and its `reservations` snapshot                    | Shop API `/order` (`createFromCart`) | Payment webhook                       |
| Read or cancel any reservation, maintenance blocks, calendar | Shop API `/booking/admin`            | Staff tools, server only              |
| Policies, pools, `reapplyBookablePolicy`, publishing         | Core API                             | Setup scripts and admin, never a page |

Everything a storefront does is on Discovery and the Shop API, and every Shop API call runs on the
server (a server action or route): the Shop token never reaches the browser. **Core is for setup only.**
Discovery never serves availability. The API contract for the whole storefront is in [[storefront]].

## Is this tenant bookable?

There is no feature flag: every tenant has booking policies, and **role permissions are the gate**. Ask
for the policies to find out whether this session can manage them:

```graphql
{
    bookingPolicies(first: 1) {
        __typename
        ... on BookingPolicyConnection {
            totalCount
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

A connection means yes. `FORBIDDEN` means the role lacks the `bookingPolicies` permission. That
usually happens on a custom role created before bookings existed, and it is fixed on the role, not in
the query. Putting a pool on a product is a second permission: `setBookable`, `reapplyBookablePolicy`
and `clearBookable` need `productBookable` on top of the right to edit the item. One earlier build
(2026-09) got `ExperimentalFeaturesNotAvailableError` here instead: then booking is not enabled on that
tenant, whatever the role.

## Storefront rules

Learned on four storefront builds (machine rental, a hotel, design appointments, machine hire). Each is
detailed in [booking-flow](references/booking-flow.md).

1. **Customer first, full flow, even for seeds.** A reservation records its customer only at
   `bookSkuItem`/`hydrate`, and its order only from a `confirmCartBooking` after `createFromCart`.
   Reservations seeded with `place` and a confirm, without a customer or an order, show "No customer / No
   order" in the admin, and no cart call can repair them.
2. **The availability buckets are the admission test.** They already include the policy's buffers on
   both sides, so a window is free when every bucket of `[start, end)` has room.
3. **Lay the day slots on the booking grid**, not on UTC midnight, or every hire looks a day longer.
4. **Write the refusal text yourself.** A refusal's `message` is only its type name; branch on
   `__typename`.
5. **Validate bookable lines yourself.** A plain `addSkuItem` of any variant of a bookable product is
   accepted, and nothing is reserved.
6. **Build the confirmation page from the order.** Its meta carries a `reservations` snapshot, with
   `orderId` after the second confirm. `OrderFromCartInput` has no `meta`: set it on the cart before `place`.
7. **Enforce the cancellation window yourself after the order.** The cart cannot cancel an ordered
   reservation, and `/booking/admin` `cancel` ignores the window. A "cancel my booking" page compares the
   start with `policySnapshot.cancellationWindow` before it calls `cancel` on the server.

## Failure modes

Three of these are silent — a paid booking whose reservation has no order, a pool or policy change that
has no effect, and a bookable SKU sold with nothing held. They are the reason this skill exists; the
rest name themselves.

| Symptom                                                      | Cause                                                                            | Fix                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Admin shows "No order — not checked out" on a paid booking   | `confirmCartBooking` ran before the cart had its `orderId`                       | Confirm **again** after `createFromCart` — see [booking-flow](references/booking-flow.md) |
| An order for a bookable product with nothing reserved        | The SKU went through `addSkuItem` or `hydrate` with no `booking`: a plain line   | Book with `bookSkuItem`, or send `booking` on the `hydrate` line                          |
| `NotBookable` on a product you just made bookable            | The item is not published, or the query's `language` is wrong                    | Publish it; pass the language the item exists in                                          |
| A pool or policy change has no effect in the Shop            | Bookable edits are drafts; products keep the `policySnapshot` they were set with | `reapplyBookablePolicy` for a policy change, then **publish** the product                 |
| `FORBIDDEN` from `createBookingPolicy`                       | The role has no `bookingPolicies` permission                                     | Grant it on the role                                                                      |
| Holds vanish within seconds, or `InvalidRange` on every date | A duration was sent in minutes, hours or days                                    | Every policy duration is **seconds**; read `humanized` back to check                      |
| `hydrate` throws "A placed cart cannot be hydrated"          | The cart is placed; its contents are frozen                                      | Change bookings before `place`, or through `/booking/admin` after                         |
| `ReservationConflict` on a unit that looked free             | Someone took it between the availability query and the booking                   | Walk the other `freeUnitIds` and retry                                                    |
| `ReservationConflict` whose `message` says the cart changed  | Another write landed on the same cart first, and nothing was booked              | Read the cart back, then retry; serialize booking writes per cart                         |
| `ReservationConflict` on a capacity pool with seats free     | Capacity counts every booking overlapping the window, not the busiest moment     | Keep capacity windows uniform, or use units                                               |
| `Cannot place this cart: <sku> (<reason>)`                   | `place` or `hydrate` could not keep a booking line; see the reason               | Nothing was saved: `hydrate` with another window or without the line                      |
| `InvalidRange` on a date far ahead                           | The window is past the policy's `advanceWindow`                                  | Widen the policy, or cap the calendar at the shortest `advanceWindow` in the basket       |
| `CancellationWindowClosed` when removing a basket line       | The window applies to holds that were never bought                               | Re-hydrate the cart without that line instead                                             |
| `Unexpected error.` from `addCartItem` or `removeCartItem`   | They refuse a booking line                                                       | `hydrate` with the new quantity, or without the line                                      |
| The calendar shows every hire one day longer                 | The `availability` range starts at UTC midnight, the periods at 07:00 local      | Start the range where the periods start                                                   |
| "Next free slot" offers a time the shop is closed            | `nearestAvailability` knows no opening hours and searches the whole pool         | Use it as a hint; filter the starts to opening hours and units in code                    |
| `Field "product" of required type "ProductInput!"`           | `addExternalItem` got a `variant` without `product`                              | Send `variant: { price, product: { id, path } }`                                          |
| `BookablePoolKindChangeError`                                | Capacity → units while a capacity pool is published                              | `clearBookable`, publish, cancel or wait out open reservations, then set units            |
| `BookingPolicyInUseError` on delete                          | Products still reference the policy (`stats.referencingProductCount`)            | Move those products to another policy and publish them                                    |

## References

- [references/policies-and-pools.md](references/policies-and-pools.md) — Core: policies, unit and
  capacity pools, snapshots and reapplying, deleting and clearing.
- [references/booking-flow.md](references/booking-flow.md) — Shop API `/cart`: availability, holds,
  checkout, the double confirmation, cancelling and moving a booking.
- [references/booking-admin.md](references/booking-admin.md) — Shop API `/booking/admin`: maintenance
  blocks, the reservation calendar and list, moving a reservation to another unit.
- [references/modelling.md](references/modelling.md) — periods as variants, units as real machines,
  multi-day hires, what Discovery serves, and how a rental relates to the product it is a rental of.

Related: [[storefront]] for the API contract and the checkout request path, [[mutation]] for the Core API
mutations themselves, [[query]] for Discovery and the Shop API query surface, [[pricing]] for what a
booked variant costs, [[payments]] for the payment webhook that creates the order, and
[[agentic-commerce]] for bookings made by an agent.
