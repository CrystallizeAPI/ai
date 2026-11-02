# Metered usage and renewals

Two jobs Crystallize does not do for you: pricing what a customer used, and charging them for the next
period. The platform keeps the calendar and gives you a meter, webhooks and an order writer; the charge
and the arithmetic are yours.

## Tracking usage

```graphql
mutation Track($id: ID!, $input: TrackSubscriptionContractUsageInput!) {
    trackSubscriptionContractUsage(subscriptionContractId: $id, input: $input) {
        __typename
        ... on SubscriptionContractUsage {
            id
            createdAt
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
    "meteredVariableIdentifier": "downloads",
    "quantity": 1,
    "idempotencyKey": "<contract>:<title>:<profile>:2026-09-28",
    "description": "Offline download"
}
```

- **By `identifier`, never by id.** The metered variable's id answers `MeteredVariableNotFoundError`.
- **The `idempotencyKey` is the retry guard.** A reused key answers `IdempotencyKeyExistsError` and
  records nothing, which makes it safe to call from a route that may run twice. Keys are unique across
  the tenant, so build the key from what makes the event unique — contract, thing, day.
- Fractional quantities are accepted (`0.5`).
- **Usage is Core-only and needs the Core contract id.** A Shop UUID gives `InvalidIdError`, and usage
  tracked on the Core copy of a Shop contract is invisible to the Shop API.
- Usage can be tracked against `paused` and `cancelled` contracts too. If that should not be allowed,
  check `status.state` in your own route first.

## Reading the meter

`usage(startDate:, endDate:)` on the contract returns the **sum per metered variable** in that window
(`[{ meteredVariableIdentifier: "downloads", quantity: 12.5 }]`), and `[]` when there is nothing. It is a
window over the **tracking time** — there is no notion of "the current period", and usage cannot be
back-dated.

**So keep the period's start yourself**, in `meta.periodStart`: set it at sign-up and again each time
you bill, and read the meter as `usage(periodStart, now)`. If you renew early — a demo button, a manual
run — the next period starts at the moment of renewal, otherwise events between the real `renewAt` and
your early run fall outside every window.

## Renewals

**The platform renews; you bill.** Every few minutes it picks up each contract whose `renewAt` is due
and runs the same operation as `renewSubscriptionContract`: `renewAt` and `activeUntil` move one
recurring period on and `status.phase` leaves the trial. It looks at neither payment nor `status.state`,
so paused contracts renew too, and it can run a few minutes ahead of `renewAt`. Only clearing `renewAt`
stops it, which is what `cancelSubscriptionContract` does.

So do not poll for `renewAt <= now`: the platform has already moved it, and renewing again skips a whole
period. Hang billing on the `renew` webhook and, for each contract:

```text
read the contract                        stop here if status.state is paused
usage(periodStart, now)                  the meter for the period that just ended
price the tiers yourself                 graduated: (usage − threshold) × the tier's price, per tier
charge                                   your payment provider; Crystallize takes no money
registerOrder                            the invoice: plan line + an overage line so the total adds up
update meta.periodStart (and tier)       that same now, and nextTier → tier if it changed
```

- **A failed charge does not undo the renewal.** The dates have already moved, so decide what it means:
  `cancelSubscriptionContract { deactivate: true }` ends the contract now, `deactivate: false` lets the
  new period run out.
- **`updateSubscriptionContract { meta }` replaces the whole list**, so send every key back with
  `periodStart` and `tier`. On the Core copy of a contract born in the Shop store that includes
  `_shopApiId`: without it, the next Core change reaches the Shop store under the Core id, and
  `subscriptionContracts` fails on that element.
- **To charge before the period starts**, bill from the day-ahead `renewalDue` instead (compare its
  `renewAt` with now): charge, then call `renewSubscriptionContract` yourself, which moves `renewAt` on so
  the platform finds nothing due. `renew` fires for that call too, so take billing off the `renew` webhook,
  or it charges the period a second time. If the charge fails, `cancelSubscriptionContract { deactivate: false }`
  clears `renewAt` and the contract simply runs out. The usage of the ending period is not complete yet
  at that point, so this suits flat plans.
- **For a safety net against a missed webhook**, keep the `renewAt` you last billed in `meta` and sweep
  the contracts for any that have moved past it. There is no `renewAt` filter, so page through them.

`registerOrder` writes the invoice. The shape that worked:

```json
{
    "customer": { "identifier": "ada@example.com" },
    "cart": [
        {
            "name": "Membership Premium",
            "sku": "plan-premium",
            "quantity": 1,
            "type": "subscription",
            "subscriptionContractId": "<core contract id>",
            "price": { "currency": "NOK", "gross": 211.25, "net": 169 },
            "subscription": {
                "name": "Monthly",
                "period": 1,
                "unit": "month",
                "start": "2026-10-10",
                "end": "2026-11-10",
                "meteredVariables": [{ "id": "<metered variable id>", "usage": 13.5, "price": 21.88 }]
            }
        }
    ],
    "total": { "currency": "NOK", "gross": 238.6, "net": 190.88 },
    "type": "recurring"
}
```

- `subscription.start` and `end` are `Date`, not `DateTime`, and here the metered variable is referenced
  by **`id`** — the opposite of tracking.
- **Put the overage on its own line** (`type: service`) so the total adds up. The meters inside
  `subscription.meteredVariables` are a record, not a charge: nothing in Crystallize prices them.
- `pipelines: [{ pipelineId, stageId }]` drops the order straight into a stage (Trial, Active). The ids
  come from the PIM API, so resolve them in your seed rather than at runtime.
- Make it idempotent: put `renewalOf = <contract>:<renewAt>` in the order's `meta`, with the `renewAt` the
  contract has after renewing, and look for it with
  `orders(filter: { subscriptionContractId, meta: [{ key, value }] })` before writing.

### What `orderIntent` gives you

`orderIntent(id, format: shop | core | coreWithOrderV2 | legacy)` on the Shop API returns a draft of the
next order — `type: recurring`, the price of `status.phase` (the recurring phase while that is `null`),
and `subscription { start: renewAt, end: renewAt + period, meteredVariables: [{ identifier, price, usage }] }`.
It is a preview, not a charge. **`usage` is always 0** and `price` is the first tier's, whatever was
tracked in Core, and `format` only labels the result: the shape is the same. Treat it as a template to
render, not as a source of truth for money.

**`createFromSubscriptionContract` on the Shop `/order` endpoint is not implemented**: it is in the
schema, and every call fails with "Unexpected error". A Shop `/order` `create` with a `type: subscription`
line does work, but the metered `price` is **not** added to the order total. For renewal invoices, Core
`registerOrder` is the path that held up.

## Webhooks

The concern is `subscriptionContracts`, and its events are `create`, `update`, `delete` and:

| Event           | Fires                                                                | Payload                                            |
| --------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| `renewalDue`    | a week and again a day before `renewAt` (once a day, by UTC date)    | `subscriptionContractId`, `renewAt`, `tenantId`    |
| `renew`         | on every renewal, scheduled or called                                | `id`, `tenantId`                                   |
| `activationDue` | a week and again a day before `activateAt`                           | `subscriptionContractId`, `activateAt`, `tenantId` |
| `activate`      | when the platform activates a contract                               | `id`, `tenantId`                                   |
| `pause`         | on `pauseSubscriptionContract`                                       | `id`, `tenantId`                                   |
| `resume`        | on `resumeSubscriptionContract`                                      | `id`, `tenantId`                                   |
| `cancel`        | on every `cancelSubscriptionContract`                                | `id`, `tenantId`                                   |
| `deactivate`    | on `cancelSubscriptionContract { deactivate: true }`, after `cancel` | `id`, `tenantId`                                   |
| `deactivated`   | minutes before `activeUntil` on a contract with no `renewAt`         | `subscriptionContractId`, `tenantId`               |

- **The id does not always have the same name.** Those fields are also the variables of the webhook's
  `graphqlQuery`, so `renewalDue`, `activationDue` and `deactivated` need `$subscriptionContractId`, not
  `$id`. The query runs on the PIM API unless `graphqlQueryTarget: next` sends it to Core.
- `renewalDue` and `renew` fire for paused contracts too. A contract created less than a week before
  `renewAt` misses the week-ahead `renewalDue`. Handle all of them idempotently.
- Lifecycle calls on the Shop endpoint fire these too, once they have reached the Core copy.
- `createWebhook` accepts any `concern`/`event` string — `nope`/`nope` is accepted — so a typo creates a
  webhook that never fires, without an error.
