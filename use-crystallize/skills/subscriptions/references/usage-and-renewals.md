# Metered usage and renewals

Two jobs Crystallize does not do for you: counting what a customer used, and charging them for the next
period. The API gives you a meter and an order writer; the schedule and the arithmetic are yours.

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
  records nothing, which makes it safe to call from a route that may run twice. Build the key from what
  makes the event unique — contract, thing, day.
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

**So keep the period's start yourself**, in `meta.periodStart`: set it at sign-up and again at every
renewal, and read the meter as `usage(periodStart, now)`. If you renew early — a demo button, a manual
run — the next period starts at the moment of renewal, otherwise events between the real `renewAt` and
your early run fall outside every window.

## Renewals

Nothing renews itself. Run a scheduled task (a cron, a queue worker, or a button in a demo) that takes
every contract with `state: active` and `renewAt <= now` and does this:

```text
usage(periodStart, renewAt)              the meter for the period that is ending
price the tiers yourself                 graduated: (usage − threshold) × the tier's price, per tier
registerOrder                            the invoice: plan line + an overage line so the total adds up
renewSubscriptionContract                moves renewAt one period on
update meta.periodStart (and tier)       the new period's start, and nextTier → tier if it changed
```

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
- Make it idempotent: put `renewalOf = <contract>:<renewAt>` in the order's `meta` and look for it with
  `orders(filter: { customer: { identifier }, meta: [{ key, value }] })` before writing.

### What `orderIntent` gives you

`orderIntent(id, format: shop | core | coreWithOrderV2 | legacy)` on the Shop API returns the **next**
period's order — `type: recurring`, the recurring price, and
`subscription { start: renewAt, end: renewAt + period, meteredVariables: [{ identifier, price, usage }] }`.
It is a preview, not a charge, and on the tenant it was tried on it reported `usage: 0` even with usage
tracked in Core, and answered the same shape during a trial. Treat it as a template to render, not as a
source of truth for money.

**`createFromSubscriptionContract` on the Shop `/order` endpoint failed on every attempt** in the Screen
Universe spike — trial, renewed, cancelled and flat contracts, before and after re-igniting — always
"Unexpected error". A Shop `/order` `create` with a `type: subscription` line does work, but the metered
`price` is **not** added to the order total. For renewal invoices, Core `registerOrder` is the path that
held up.

## Webhooks

`createWebhook` accepts any `concern`/`event` string — `nope`/`nope` is accepted — so the API cannot tell
you which contract events exist. Do not design a renewal pipeline around webhook events you have not seen
arrive at a receiver.
