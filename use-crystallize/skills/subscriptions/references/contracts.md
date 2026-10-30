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
- A phase needs only `price` and `currency`: `period` and `unit` default to the plan period's.
- A Core contract needs an existing customer (`CustomerNotFoundError`) and an existing SKU
  (`SkuNotFoundError`). Create the customer with `createCustomer` first; it is not an upsert, and answers
  `CustomerIdentifierAlreadyExistsError` on a returning customer.
- `payment` here records how it will be paid; it does not take money.
- **Core refuses dates in the past** (`InvalidActiveUntilDateError`, `InvalidRenewAtDateError`). To seed
  a subscriber "since 2025", back-date `signedAt` (accepted) and the orders
  (`registerOrder { createdAt }`), and keep your own history in `meta`.
- In TypeScript, `createSubscriptionContractManager` ([[js-api-client]]) wraps create, update and the
  lifecycle calls. Its `createTemplateBasedOnVariant(variant, planIdentifier, periodId, priceVariantIdentifier)`
  builds `item`, `subscriptionPlan`, `initial` and `recurring` from a variant read with its plans; add
  `customerIdentifier` and `status`. `createTemplateBasedOnVariantIdentity` fetches the variant itself, but
  from Catalogue `variants`, which can be empty — see [plans-and-pricing](plans-and-pricing.md).

### The date rules, which decide the state

`SubscriptionContractStatusInput` is only `activateAt`, `renewAt` and `activeUntil` — there is no state
field. See the table in [SKILL.md](../SKILL.md).

- **`activateAt` cannot be combined with the other two** (`ActivateAtMustBeExclusiveError`). A contract
  that starts later is created with `activateAt` alone, and the platform activates it within minutes of
  that moment: `activateAt` clears, `renewAt` and `activeUntil` become now plus one **recurring** period,
  and the `activate` webhook fires. An `initial` phase does not shorten that: `status.phase` reads the
  trial while the dates read the recurring length, so correct them from the webhook if the trial is
  shorter. `updateSubscriptionContract { status: { renewAt, activeUntil } }` replaces the whole status
  and clears `activateAt`, so it also activates early.
- **`renewAt` and `activeUntil` travel together.** For a trial, both are the trial's end. For a running
  period, both are the end of the paid period. Because `update { status }` replaces the whole status,
  sending `{ renewAt }` alone clears `activeUntil` and the contract reads `cancelled`.
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
| `renewSubscriptionContract`                        | `active`              | `activeUntil` = **old** `activeUntil` + one period; `renewAt` too   |
| `cancelSubscriptionContract { deactivate: false }` | `pendingDeactivation` | `renewAt` → `null`, `activeUntil` kept (runs to the paid end)       |
| `renewSubscriptionContract` after that             | `active`              | back from the dead, `renewAt` = `activeUntil` + one period          |
| `cancelSubscriptionContract { deactivate: true }`  | `cancelled`           | `renewAt` and `activeUntil` → `null`                                |

Consequences worth designing around:

- **The platform runs the same renew for you.** When `renewAt` comes due it renews the contract, so a
  `renewSubscriptionContract` on top moves it a second period. Call it only to renew ahead of `renewAt`.
- **Renew adds a period to the previous `activeUntil`, not to now** (to now only if there is none), and
  `renewAt` lands on the same date. Renewing a long-expired contract revives it on its old dates, and the
  platform then keeps renewing it until `renewAt` is back in the future.
- **Pause freezes nothing.** The dates keep their values, and a paused contract that has a `renewAt`
  keeps being renewed: it stays `paused` while the dates and the `renew` and `renewalDue` webhooks roll
  on, so check `status.state` before you charge. Only one with no `renewAt` runs out, and `resume` then
  yields `cancelled`. To give back the paid time, record what was left at the pause
  (`meta.pauseRemainingMs`) and on resume set `renewAt`/`activeUntil` to now plus that. Note that
  `updateSubscriptionContract { status }` **also un-pauses**, so a resume is: `resume` (tolerating
  `SubscriptionContractIsNotPausedError`), then the date update.
- **Undo a cancel with `updateSubscriptionContract { status: { renewAt: activeUntil, activeUntil } }`**,
  not `renewSubscriptionContract` — renew reactivates too, but silently moves the customer a whole
  period on without an invoice.
- **A contract cancels once.** A second `cancelSubscriptionContract` answers
  `SubscriptionContractAlreadyCancelledError`, so `deactivate: true` after `deactivate: false` fails unless
  the contract was reactivated in between. To end it at once, `updateSubscriptionContract { status: {} }`
  clears the dates.
- **`updateSubscriptionContract { meta }` replaces the whole list.** Keys you leave out are deleted;
  always send all of it.
- **Plan and period cannot change.** `UpdateSubscriptionContractInput` has no `subscriptionPlan`, so
  monthly ↔ yearly is cancel plus a new contract. A tier change is `update { item, recurring }`, with no
  proration: a contract on its trial shows it at the first renewal, one already on `recurring` shows it
  in `status.phase` at once. Keep the tier in force and the coming one apart (`meta.tier`,
  `meta.nextTier`) and swap them when you bill the renewal.
- `deleteCustomer(identifier, deleteSubscriptionContracts: true)` removes a customer and their contracts
  in one call; orders go separately with `deleteOrder`.

## Reading contracts

`subscriptionContracts(filter: { customerIdentifier, state, sku, subscriptionPlanIdentifier, signedAt,
activateAt })` is a connection (`edges { node { … } }`), sortable by `createdAt`; the two date filters
take `{ min, max }`, and there is none on `renewAt`. One contract is `subscriptionContract(id:)`. Useful
fields: `status { state activateAt renewAt activeUntil phase }`, `item`, `initial`,
`recurring { price currency period unit meteredVariables { tiers } productVariants }`,
`subscriptionPlan { identifier periodId periodName }`, `meta`, and `usage(startDate:, endDate:)`.

`status.phase` is the phase in force — the trial before the first renewal, the recurring phase after it.

**The `state` filter is not the `state` you read back.** `status.state` in a result is derived from the
dates at read time, while the filter matches the state stored at the last write. A contract that ran out
with no write since reads `cancelled` but still matches `state: pendingDeactivation`.

## The Shop API endpoint

`/subscription-contract` (scope `subscription-contract`) is the storefront-facing store, and it is
labelled **EXPERIMENTAL**. What differs:

- `create` needs **no** Core customer: it creates one from `customer { identifier, email, firstName,
  lastName }`. Ids are `UUID!`. Prices are `{ gross, net }` per phase instead of Core's single `price`,
  and the currency comes from `context.price.currency` (`eur` if omitted). `plan` is
  `{ identifier, periodId }` — no `periodName`. `period` and `unit` have no default here: send them.
- `create` checks the SKU, plan, period and metered variables against the **published** Catalogue in
  `context.language` (`en` if omitted). A draft-only product fails, with no more than "Unexpected error".
- The lifecycle behaves as above (`pause`, `resume`, `renew`, `cancel`, `deactivate`, `changeDates`),
  with three differences: `resume` after a cancel is silently ignored, `renew` on a paused contract makes
  it `active` (on Core it stays `paused`), and the only way to change what is billed is
  `updateRecurringPhase(phase: { price, period, unit, productVariants, meteredVariables })`, which
  replaces the whole phase — there is no item update. `changeDates` takes only the dates to change,
  unlike Core's `update { status }`.
- `status.phase` is `null` until a Core change syncs back. `status.state` is stored at each write, not
  derived, so it does not flip when a date passes: on a "my subscription" page compare `activeUntil` with
  now.
- `subscriptionContracts(customerIdentifier:)` right after `create` can answer `[]`; the contract shows
  up seconds later. Don't list to confirm a write.
- **Each sync overwrites.** A Core change replaces the Shop contract with Core's view: `gross` and `net`
  both become Core's single `price`, and `customer` and `context` are dropped. A Shop edit other than
  `pause`, `resume`, `renew`, `cancel` and `deactivate` replaces the Core copy, `meta` included, which
  loses `_shopApiId`; the next Core change, a scheduled renewal included, then reaches the Shop store
  under the Core id, and `subscriptionContracts` fails on that element.
- **`subscriptionContractTemplate` is a stub.** It reads nothing: it echoes your arguments with a
  `recurring` of 1 month at 0, no `initial`, and `currency: "eur"`. Build the create input yourself from
  Discovery plus the plan.
- There is no delete here. `deleteSubscriptionContract` on the Core copy removes the Shop contract too;
  otherwise cancelled test contracts stay in the list.
- Usage is Core-only and needs the Core id, which the Shop API does not expose. A Shop-store tenant can
  only meter on the Core copy: find it on Core by `meta._shopApiId` once it has appeared, and keep the
  id. If metering matters, keep the whole thing in Core.
