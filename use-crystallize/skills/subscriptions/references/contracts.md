# Contracts: creating them, and what each lifecycle call really does

A contract holds the customer, the plan and period they chose, the **phases** (an optional `initial`, a
required `recurring`), the dates, and your `meta`. Everything below is the Core API unless it says
otherwise; the Shop endpoint's differences are at the end.

## Create

```graphql
mutation Create($input: CreateSubscriptionContractInput!) {
    createSubscriptionContract(input: $input) {
        __typename
        ... on SubscriptionContractAggregate {
            id
            status {
                state
                renewAt
                activeUntil
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
        "customerIdentifier": "ada@example.com",
        "subscriptionPlan": { "identifier": "membership", "periodId": "<period id>", "periodName": "Monthly" },
        "item": { "sku": "plan-premium", "name": "Membership Premium", "quantity": 1 },
        "initial": { "currency": "EUR", "price": 0, "period": 14, "unit": "day" },
        "recurring": {
            "currency": "EUR",
            "price": 19.99,
            "period": 1,
            "unit": "month",
            "meteredVariables": [
                {
                    "identifier": "downloads",
                    "tierType": "graduated",
                    "tiers": [
                        { "threshold": 0, "price": 0, "currency": "EUR" },
                        { "threshold": 10, "price": 0.61, "currency": "EUR" }
                    ]
                }
            ]
        },
        "status": { "renewAt": "2026-10-12T00:00:00Z", "activeUntil": "2026-10-12T00:00:00Z" },
        "payment": { "provider": "custom", "custom": { "properties": [{ "property": "method", "value": "card" }] } },
        "meta": [
            { "key": "tier", "value": "premium" },
            { "key": "periodStart", "value": "2026-09-28T00:00:00Z" }
        ]
    }
}
```

- `subscriptionPlan.periodName` is **required** on Core, so carry the period's name alongside its id.
- A Core contract needs an existing customer (`CustomerNotFoundError`) and an existing SKU
  (`SkuNotFoundError`). Upsert the customer with `createCustomer` first.
- `payment` here records how it will be paid; it does not take money.
- **Core refuses dates in the past** (`InvalidActiveUntilDateError`). To seed a subscriber "since 2025",
  back-date `signedAt` (accepted) and the orders (`registerOrder { createdAt }`), and keep your own
  history in `meta`.

### The date rules, which decide the state

`SubscriptionContractStatusInput` is only `activateAt`, `renewAt` and `activeUntil` — there is no state
field. See the table in [SKILL.md](../SKILL.md).

- **`activateAt` cannot be combined with the other two** (`ActivateAtMustBeExclusiveError`). A contract
  that starts later is created with `activateAt` alone, and becomes `cancelled` when that moment passes
  unless you have activated it first with `updateSubscriptionContract { status: { renewAt, activeUntil } }`,
  which replaces the whole status and clears `activateAt`.
- **`renewAt` and `activeUntil` travel together.** For a trial, both are the trial's end. For a running
  period, both are the end of the paid period.
- A contract **with** an `initial` phase stays on it until the first renewal, so "is this a trial?" is
  `status.phase` equal to the initial phase. Leave `initial` out and it starts on `recurring` at once —
  which is what you want for an add-on, or for seeding an existing subscriber.

### One contract, several products

`item` is the single headline product, but `recurring.productVariants` takes a list of
`{ sku, name, quantity, imageUrl, meta }`, and the phase's `price` is what the whole basket costs per
period. A standing order of six consumables is therefore **one** contract with six lines, not six
contracts — pause, resume and renewal then act on all of them at once. (Lab Universe.)

## The lifecycle

Recorded step by step on a trial contract (`renewAt = activeUntil = T+14d`):

| Call                                               | State after           | What moved                                                          |
| -------------------------------------------------- | --------------------- | ------------------------------------------------------------------- |
| `createSubscriptionContract`                       | `active`              | phase = the 14-day trial                                            |
| `pauseSubscriptionContract`                        | `paused`              | **nothing else** — the dates keep their values                      |
| pause again                                        | error                 | `SubscriptionContractIsAlreadyPausedError`                          |
| `resumeSubscriptionContract`                       | `active`              | dates unchanged                                                     |
| `updateSubscriptionContract { item, recurring }`   | `active`              | item and recurring phase now; `status.phase` only at the next renew |
| `renewSubscriptionContract`                        | `active`              | `renewAt` = **old** `renewAt` + one period; `activeUntil` follows   |
| `cancelSubscriptionContract { deactivate: false }` | `pendingDeactivation` | `renewAt` → `null`, `activeUntil` kept (runs to the paid end)       |
| `renewSubscriptionContract` after that             | `active`              | back from the dead, `renewAt` = `activeUntil` + one period          |
| `cancelSubscriptionContract { deactivate: true }`  | `cancelled`           | `renewAt` and `activeUntil` → `null`                                |

Consequences worth designing around:

- **Renew adds a period to the previous `renewAt`, not to now.** Renewing a long-expired contract
  revives it on its old dates. If you renew late, decide whether the customer gets the lost time.
- **Pause freezes nothing.** A contract paused over the summer keeps running down, stays `paused` past
  `activeUntil`, and `resume` then yields `cancelled`. Record what was left at the pause
  (`meta.pauseRemainingMs`) and on resume set `renewAt`/`activeUntil` to now plus that. Note that
  `updateSubscriptionContract { status }` **also un-pauses**, so a resume is: `resume` (tolerating
  `SubscriptionContractIsNotPausedError`), then the date update.
- **Undo a cancel with `updateSubscriptionContract { status: { renewAt: activeUntil, activeUntil } }`**,
  not `renewSubscriptionContract` — renew reactivates too, but silently moves the customer a whole
  period on without an invoice.
- **`updateSubscriptionContract { meta }` replaces the whole list.** Keys you leave out are deleted;
  always send all of it.
- **Plan and period cannot change.** `UpdateSubscriptionContractInput` has no `subscriptionPlan`, so
  monthly ↔ yearly is cancel plus a new contract. A tier change is
  `update { item, recurring }` and applies from the next renewal — there is no proration. Keep the tier
  in force and the coming one apart (`meta.tier`, `meta.nextTier`) and swap them when you renew.
- `deleteCustomer(identifier, deleteSubscriptionContracts: true)` removes a customer and their contracts
  in one call; orders go separately with `deleteOrder`.

## Reading contracts

`subscriptionContracts(filter: { customerIdentifier, state, sku, subscriptionPlanIdentifier })` is a
connection (`edges { node { … } }`), sortable by `createdAt`. One contract is
`subscriptionContract(id:)`. Useful fields: `status { state renewAt activeUntil phase }`, `item`,
`initial`, `recurring { price currency period unit meteredVariables { tiers } productVariants }`,
`subscriptionPlan { identifier periodId periodName }`, `meta`, and
`usage(startDate:, endDate:)`.

`status.phase` is the phase in force — the trial before the first renewal, the recurring phase after it.

## The Shop API endpoint

`/subscription-contract` (scopes `subscription-contract`, `subscription-contract:admin`) is the
storefront-facing store, and it is labelled **EXPERIMENTAL**. What differs:

- `create` needs **no** Core customer: it creates one from `customer { identifier, email, firstName,
lastName }`. Ids are `UUID!`. Prices are `{ gross, net }` per phase instead of Core's single `price`,
  and the currency comes from `context.price.currency` (EUR if omitted). `plan` is
  `{ identifier, periodId }` — no `periodName`.
- The lifecycle behaves as above (`pause`, `resume`, `renew`, `cancel`, `deactivate`, `changeDates`),
  with three differences: `resume` after a cancel is silently ignored, `renew` on a paused contract makes
  it `active`, and the only way to change what is billed is
  `updateRecurringPhase(phase: { price, period, unit, productVariants, meteredVariables })` — there is no
  item update. `status.phase` is always `null`.
- `subscriptionContracts(customerIdentifier:)` right after `create` can answer `[]`; the contract shows
  up seconds later. Don't list to confirm a write.
- **`subscriptionContractTemplate` was unusable** on the tenant it was tried on: zero prices, no
  `initial`, and `currency: "eur"` regardless — most likely because it reads the empty Catalogue
  `variants`. Build the create input yourself from Discovery plus the plan.
- There is no delete. Cancelled test contracts stay in the list.
- Usage is Core-only, and a Core id is required for it, so a Shop-store tenant has no metered billing
  path today. Plan flat periods there, or keep the whole thing in Core.
