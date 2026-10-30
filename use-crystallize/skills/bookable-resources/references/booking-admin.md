# Booking administration (Shop API `/booking/admin`)

For back-office tools: taking a unit out of service, reading who holds what, and changing what a shopper
cannot. Run it server-side only.

The token needs both the `booking` and `booking:admin` scopes, so ask for
`"scopes": ["booking", "booking:admin"]` when you mint it (see [[mutation]]). Post to
`https://shop-api.crystallize.com/@{tenant}/booking/admin` yourself: `client.shopBookingApi` in
`@crystallize/js-api-client` posts to `/booking`, which serves nothing and answers 404.

**Refusals are GraphQL errors here, not union members.** Branch on `extensions.reason`, under
`extensions.code: "BOOKING_REJECTED"`: `NotBookable`, `NotFound`, `Conflict`, `InvalidRange` or
`InvalidUnitId`.

## Take a unit out of service

Do not fake a cart hold, and do not remove the unit from the pool. Block it:

```graphql
mutation {
    block(
        input: {
            productId: "6ab3…"
            sku: "RENT-GAS55-DAY"
            start: "2026-10-05T00:00:00Z"
            end: "2026-10-07T00:00:00Z"
            unitId: "GAS55-OSL-1"
            source: MAINTENANCE
            sourceReason: "annual service"
            language: "en"
        }
    ) {
        id
        unitId
        state
    }
}
```

- `source` is `MAINTENANCE`, `STAFF_HOLD`, `PARTNER_ALLOCATION` or `OTHER`. `sku` and `language` are
  required because the pool is read through the variant, in one language.
- Without a `unitId`, `quantity` (default 1) takes that many of the pool, all or none. With a `unitId` it
  must be 1. The answer is a list with one reservation per unit of quantity, and each needs its own
  `cancel`.
- The `advanceWindow` does not apply to a block; the policy's buffers do.
- **A block never expires.** It reads `state: PENDING` with `expiresAt: null` and holds its window until
  you `cancel` it.
- `Conflict` means something already holds that window. Move it with `assignUnit`, or cancel it.
- `bulkBlock(inputs:)` takes several and answers `results`, one `{ ok, reservations, reason }` per input
  in request order. It is not atomic, so reissue only the failed ones.

`checkBooking(input:)` is the dry run for a block. It takes the same fields as the `/cart` one plus a
required `source`, and refuses `source: CART`.

## Read the reservations

| Query                                             | Use it for                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `calendar(filter:)`                               | A range, grouped by product. `rangeStart` and `rangeEnd` required; refused past 5,000 rows |
| `reservations(filter:, limit:, after:)`           | A flat list, paged by `nextCursor`. `limit` defaults to 50, at most 5,000. Range optional  |
| `reservationSummary(productId:, range:, states:)` | `total`, `byState` and `bySource` for one product                                          |
| `reservation(id:)`                                | One row, with the `customerId`, `frozenPolicy` and `meta` the `/cart` query does not serve |

- Filters take `productIds`, `states`, `sources`, `unitId`, `orderId`, `cartId` and `customerId`.
- Omit `states` and you get every state, finished ones included. Pass `[PENDING, CONFIRMED]` for what
  actually holds the calendar.
- `orderId` only finds rows confirmed after the cart had its order. For the others, filter by `cartId`:
  the order id is the cart id.
- Rows carry `productId` and `variantSku`, never names. Hydrate those from the Catalogue or Discovery.
- These queries serve open reservations and 90 days of finished ones. An older booking is on its order,
  in the `reservations` meta. See [booking-flow](booking-flow.md#after-the-order).

## Change a reservation

`cancel` and `bulkCancel` are in [booking-flow](booking-flow.md#after-the-order).
`assignUnit(id:, unitId:, language:)` moves a reservation to another unit of the pool, keeping its window,
and is refused with `Conflict` if that unit is taken. `setMeta(id:, meta:, merge:)` writes the
reservation's own `meta`. All of these update the record on the order that bought the reservation.
