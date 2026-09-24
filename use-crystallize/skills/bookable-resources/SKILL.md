---
name: bookable-resources
description: >
    Sell Crystallize products that are held in time rather than counted in stock — rentals, services,
    rooms, courses, equipment, appointments. Covers booking policies and bookable pools on the Core API,
    and the booking flow on the Shop API /cart endpoint: availability, holds, checkout and confirmation.
    Use when the user wants to rent something out, take bookings or reservations, sell time slots or
    by the day/weekend/week, show a booking calendar, manage a fleet of machines, rooms or seats, or
    handle cancellations. Trigger on "bookable", "booking", "reservation", "rental", "rent", "hire",
    "availability", "time slot", "calendar", "hold", "setBookable", "bookSkuItem",
    "createBookingPolicy", "confirmCartBooking", "cancelReservation", "rebookReservation",
    "nearestAvailability", "checkBooking", "booking policy", "cancellation window", "pool", "units".
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

> Verified on 2026-09-24 against the live Core API and Shop API on a tenant with bookable resources,
> including two test reservations taken and released. Where a claim comes from one storefront build
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

Everything a storefront does is on Discovery and the Shop API. **Core is for setup only** — policies,
pools and publishing are admin-time work, never called from a storefront at runtime.

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
the query.

## Failure modes

The first three produce no error at all — they are the reason this skill exists.

| Symptom                                                      | Cause                                                                            | Fix                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Admin shows "No order — not checked out" on a paid booking   | `confirmCartBooking` ran before the cart had its `orderId`                       | Confirm **again** after `createFromCart` — see [booking-flow](references/booking-flow.md) |
| `NotBookable` on a product you just made bookable            | The item is not published, or the query's `language` is wrong                    | Publish it; pass the language the item exists in                                          |
| A pool or policy change has no effect in the Shop            | Bookable edits are drafts; products keep the `policySnapshot` they were set with | `reapplyBookablePolicy` for a policy change, then **publish** the product                 |
| `FORBIDDEN` from `createBookingPolicy`                       | The role has no `bookingPolicies` permission                                     | Grant it on the role                                                                      |
| Holds vanish within seconds, or `InvalidRange` on every date | A duration was sent in minutes, hours or days                                    | Every policy duration is **seconds**; read `humanized` back to check                      |
| `hydrate` throws "A placed cart cannot be hydrated"          | The cart is placed; its contents are frozen                                      | Change bookings before `place`, or through `/booking/admin` after                         |
| `ReservationConflict` on a unit that looked free             | Someone took it between the availability query and the booking                   | Walk the other `freeUnitIds` and retry                                                    |
| `CancellationWindowClosed` when removing a basket line       | The window applies to holds that were never bought                               | Re-hydrate the cart without that line instead                                             |
| `BookablePoolKindChangeError`                                | Capacity → units while a capacity pool is published                              | `clearBookable`, publish, cancel or wait out open reservations, then set units            |
| `BookingPolicyInUseError` on delete                          | Products still reference the policy (`stats.referencingProductCount`)            | Move those products to another policy and publish them                                    |

## References

- [references/policies-and-pools.md](references/policies-and-pools.md) — Core: policies, unit and
  capacity pools, snapshots and reapplying, deleting and clearing.
- [references/booking-flow.md](references/booking-flow.md) — Shop API `/cart`: availability, holds,
  checkout, the double confirmation, cancelling and moving a booking.
- [references/modelling.md](references/modelling.md) — periods as variants, units as real machines,
  what Discovery serves, and how a rental relates to the product it is a rental of.

Related: [[mutation]] for the Core API mutations themselves, [[query]] for Discovery and the Shop API
query surface, [[pricing]] for what a booked variant costs.
