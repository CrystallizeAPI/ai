# Booking policies and pools (Core API)

Setup for bookable products. Admin-time work: a storefront never calls these.

## The policy

A policy is a named set of rules shared by many products. **Every duration is a number of seconds.**

```graphql
mutation CreatePolicy($input: CreateBookingPolicyInput!) {
    createBookingPolicy(input: $input) {
        __typename
        ... on BookingPolicy {
            id
            name
            version
            humanized {
                advanceWindow {
                    value
                    unit
                }
                cancellationWindow {
                    value
                    unit
                }
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

```json
{
    "input": {
        "name": "heavy-equipment",
        "advanceWindow": 10368000,
        "bufferBefore": 0,
        "bufferAfter": 14400,
        "cancellationWindow": 172800,
        "pendingHoldDuration": 900,
        "placedHoldDuration": 86400
    }
}
```

| Field                 | Required | Meaning                                                                         |
| --------------------- | -------- | ------------------------------------------------------------------------------- |
| `name`                | yes      | Unique per tenant — `BookingPolicyNameTakenError` otherwise                     |
| `advanceWindow`       | yes      | How far into the future a booking may be made (120 days = `10368000`)           |
| `bufferBefore`        | yes      | Dead time reserved before each booking                                          |
| `bufferAfter`         | yes      | Dead time after — cleaning, charging, travel (4 hours = `14400`)                |
| `cancellationWindow`  | yes      | How close to the start a booking may still be cancelled (2 days = `172800`)     |
| `pendingHoldDuration` | yes      | How long a hold in a live cart survives (15 minutes = `900`)                    |
| `placedHoldDuration`  | no       | How long a hold survives after `place`, while payment happens (1 day = `86400`) |

A `placedHoldDuration` of `0`, or none, gives a placed cart a fresh `pendingHoldDuration`. Set it
when payment takes longer than a live hold, such as an invoice or a bank transfer.

`pendingHoldDuration` must be at least 1, or the policy is refused with `InvalidNumberRangeError`. Do not
send `advanceWindow: 0` to mean "no limit": `bookSkuItem` then refuses every future window as
`InvalidRange` while `availability` reports them bookable. Send a long window instead.

**Read `humanized` back after writing.** It returns the same values as `{ value, unit }` in days, hours,
minutes or seconds, which is the cheapest way to catch a duration that was sent in the wrong unit. The
mistake is silent otherwise: a `cancellationWindow` of `2` is two seconds, not two days.

`updateBookingPolicy(id, input)` takes the same fields, all optional, and bumps `version`, even for a
rename, so a product's `policySnapshot.version` behind the policy's does not prove the terms differ.

`bookingPolicies(first:)` returns a **connection** (`edges { node { … } }`), not a list.
`bookingPolicy(id:)` reads one. `BookingPolicy.stats.referencingProductCount` says how many products use
it, and `deleteBookingPolicy` refuses with `BookingPolicyInUseError` while that count is above zero.

## The pool

`setBookable` attaches a policy and says what can be booked. One product, one pool, and every SKU of the
product draws on it. `language` is required, but the pool is not per language: every language of the
product shares it, so set it and reapply it once per product. Mass operations have no intent for this:
it is one `setBookable` per product.

```graphql
mutation SetBookable($id: String!, $language: String!, $input: GraphqlBookableInputInput!) {
    setBookable(id: $id, language: $language, input: $input) {
        __typename
        ... on BasicError {
            errorName
            message
        }
    }
}
```

Two kinds, and a product has exactly one of them:

```json
{ "input": { "policyId": "6ab3…", "units": [{ "id": "GAS55-OSL-1", "meta": [{ "key": "depot", "value": "osl" }] }] } }
{ "input": { "policyId": "6ab3…", "capacity": 8 } }
```

| Pool       | Use it for                                                      | What the shopper books      |
| ---------- | --------------------------------------------------------------- | --------------------------- |
| `units`    | Real, distinguishable things: machine 1, room A, instructor Ada | One named unit, by `unitId` |
| `capacity` | Interchangeable seats: 8 places on a course, 20 bikes in a pile | One of N, no identity       |

**A unit's `meta` is where its identity lives.** Depot, serial number, running hours, last service — the
storefront reads it back from Discovery and can show "the machine in Oslo". There is no other place to
put it.

**A capacity pool counts every booking that overlaps the window, not the busiest moment.** With capacity
6 and 4 seats booked on each of seven nights in a row, a 7-night request is refused with
`ReservationConflict` although 2 seats are free every night, and `availability` undercounts the same way.
It never oversells, and it is exact when bookings share one window, like a class at 09:00. When windows
vary in length, use units, even for things nobody tells apart.

**Do not rename or remove a unit that holds live reservations.** They keep the old id and still hold
their window. While one does, every pin on that window is refused with `ReservationConflict` and
`freeUnitIds` is empty even when `free` is not. A cart pinned to a unit that left the published pool fails
at `place` with `UnitNoLongerInPool`. Add the new id, publish, move the reservations with `assignUnit` (see
[booking-admin](booking-admin.md)), and only then drop the old id.

Units → capacity is allowed. Capacity → units answers `BookablePoolKindChangeError` while the
**published** pool is a capacity pool, because capacity-era reservations carry no unit. Clear it with
`clearBookable`, publish that, cancel or wait out the open reservations, then set the units.

`clearBookable(id, language)` removes the pool, but only from the draft: the Shop keeps taking bookings
until the product is published again. Unpublish to stop bookings at once. `bookableProducts` lists
products with a **published** bookable configuration only. A product configured but never published
is not in it. `bookableProducts(filter: { policyId: "…" })` is how to find the products to reapply; each
node has `productId`, `poolSize`, `policySnapshot` and `product(language:)`.

## The snapshot

`setBookable` stamps the policy onto the product as a `policySnapshot` with its `version`, on every call,
so a pool edit also takes the policy's current terms:

```graphql
{
    item(id: "6ab3…", language: "en") {
        ... on Product {
            bookable {
                policyId
                poolSize
                policySnapshot {
                    version
                    cancellationWindow
                }
                pool {
                    __typename
                    ... on BookableUnitPool {
                        units {
                            id
                            meta {
                                key
                                value
                            }
                        }
                    }
                    ... on BookableCapacityPool {
                        capacity
                    }
                }
            }
        }
    }
}
```

**Editing a policy does not reach the products that use it.** They keep their snapshot until
`reapplyBookablePolicy(id, language)` runs on each one. It re-freezes the policy's current terms and
leaves the pool untouched, so do not re-run `setBookable` for this. Change the window, reapply, check
the product's `policySnapshot`, then **publish**. Until the publish, the Shop still books under the old
terms. This is the step that makes "we changed the cancellation window and nothing happened" go away.

Reservations already taken keep the terms they were admitted under. A policy edit never changes a
booking a shopper already holds.

`Product.bookable` on the Core API always shows the draft, whatever `versionLabel` you ask for. A bookable
edit creates no item version either, so read `bookableHasUnpublishedChanges` on the product to see whether
a publish is still owed. `bookableProducts`, the Catalogue API and Discovery show what the Shop serves.

## Publish

The Shop reads the **published** bookable configuration only. A bookable product that is not
published answers `NotBookable` on every Shop API call. `setBookable`, `reapplyBookablePolicy` and
`clearBookable` all write to the draft, so each one needs a publish before the Shop sees it. Publish per
item and language with `publishItem`. See [[mutation]]. The publish of any one language promotes the
shared pool, but the Shop reads the product per language, so publish every language you sell in.
`publishItem` only queues the work: the Shop sees the change a moment after it answers.
