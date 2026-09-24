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

**Read `humanized` back after writing.** It returns the same values as `{ value, unit }` in days, hours,
minutes or seconds, which is the cheapest way to catch a duration that was sent in the wrong unit. The
mistake is silent otherwise: a `cancellationWindow` of `2` is two seconds, not two days.

`updateBookingPolicy(id, input)` takes the same fields, all optional, and bumps `version`.

`bookingPolicies(first:)` returns a **connection** (`edges { node { … } }`), not a list.
`bookingPolicy(id:)` reads one. `BookingPolicy.stats.referencingProductCount` says how many products use
it, and `deleteBookingPolicy` refuses with `BookingPolicyInUseError` while that count is above zero.

## The pool

`setBookable` attaches a policy and says what can be booked. One product, one language, one pool.

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

Switching a product from one kind to the other answers `BookablePoolKindChangeError`. `clearBookable`
removes the pool, `bookableProducts` lists every bookable product in the tenant.

## The snapshot

`setBookable` stamps the policy onto the product as a `policySnapshot` with its `version`:

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
`reapplyBookablePolicy` runs. Change the window, reapply, then check a product's
`policySnapshot.version` — this is the step that makes "we changed the cancellation window and nothing
happened" go away.

## Publish

A bookable product that is not published answers `NotBookable` on every Shop API call, with no hint that
publishing is what is missing. Publish per item and language with `publishItem` — see [[mutation]].
