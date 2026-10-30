---
name: subscriptions
description: >
    Sell and run Crystallize subscriptions — memberships, plans with trials, metered usage, standing
    orders and recurring baskets. Covers subscription plans and periods (legacy PIM API), subscription
    pricing on variants, subscription contracts and their lifecycle on the Core API and the Shop API
    /subscription-contract endpoint, usage tracking, renewals and renewal orders. Use when the user wants a
    monthly or yearly plan, a free trial, tiered or metered billing, pause/resume, upgrade or downgrade,
    cancel at period end, a recurring delivery, or a "my subscription" account page. Trigger on
    "subscription", "abonnement", "recurring", "membership", "plan", "trial",
    "metered", "usage-based", "standing order", "renewal", "renewalDue", "subscriptionPlan",
    "createSubscriptionContract", "subscriptionContract", "renewSubscriptionContract",
    "pauseSubscriptionContract", "trackSubscriptionContractUsage", "createFromSubscriptionContract",
    "orderIntent", "meteredVariables", "churn", "pause subscription", "cancel subscription".
metadata:
    author: Crystallize
    version: "1.0"
---

# Crystallize Subscriptions

A **subscription plan** describes what can be sold repeatedly — its periods (monthly, yearly), an
optional introductory period, and any metered variables. A **variant** carries the plan's prices. A
**subscription contract** is one customer's agreement: the plan and period they chose, the prices they
agreed, the dates it runs on, and the meter readings.

The contract is the whole model. It is not a state machine that bills for you.

> Reviewed on 2026-10-30 against the API implementation, on top of two builds that ran the whole
> lifecycle: **Screen Universe** (memberships with a 14-day trial and metered downloads) and **Lab
> Universe** (B2B standing orders). Claims that come only from those builds are marked.

## Two things to know before you write any code

**1. Crystallize moves the dates; it never bills.** There is no billing engine behind a contract:
nothing is charged and no order appears, at `renewAt` or ever. What does run by itself is the calendar.
Within minutes of `renewAt` the platform renews every contract that has one: `renewAt` and `activeUntil`
move one recurring period on, a trial moves to its recurring phase, and the `renew` webhook fires,
whether or not anyone paid and even if the contract is paused. A contract with `activateAt` is activated
the same way. A contract with no `renewAt` runs out and reads `cancelled` once `activeUntil` passes.
Billing is **your** job, hung on those events: price the period, charge, write an order. Calling
`renewSubscriptionContract` on top moves the contract a second period; keep it for renewing ahead of
`renewAt`. Plan for that before you model anything.

**2. Contracts live in two stores that sync loosely.** Core and the Shop API
`/subscription-contract` endpoint both hold contracts, and they are not one store with two doors:

|                        | Core API                                                      | Shop API `/subscription-contract`              |
| ---------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| Meant for              | back office, seeding, batch, renewals                         | a storefront acting for the signed-in customer |
| Ids                    | 24-character hex id                                           | `UUID!`                                        |
| Usage tracking         | `trackSubscriptionContractUsage`, `usage(startDate, endDate)` | not available — Core only                      |
| Needs a customer first | yes (`CustomerNotFoundError`)                                 | no, it creates one from `customer { … }`       |
| Status                 | labelled stable                                               | labelled **EXPERIMENTAL**                      |

A Shop contract is copied to Core about 7 seconds later with a new Core id and the Shop UUID in
`meta._shopApiId`. **After that the two copies follow each other, asynchronously**: Shop `pause`,
`resume`, `renew`, `cancel` and `deactivate` are replayed on the Core copy, any other Shop edit
overwrites it, and every Core change, scheduled renewals included, overwrites the Shop copy. Those
overwrites lose data — see [contracts](references/contracts.md). In the other direction a Core contract
is copied into the Shop store **with its 24-character Core id as `id`** — which is not a UUID, so
`subscriptionContracts(customerIdentifier:)` then fails on that element and the contract cannot be
addressed through the Shop API at all.

**So pick one store per tenant and stay in it.** Both builds landed on that rule the hard way:

- **Core for everything** when the lifecycle is driven server-side — seeding, billing jobs, usage,
  back-dated history, and account pages rendered by your own server. This is what Screen Universe does.
  Core is rate limited and is not meant for storefront traffic, so put it behind your own server actions
  or API routes — never in a browser call, and never once per page view.
- **Shop API for everything** when the storefront itself creates and changes contracts for the customer
  in front of it, as Lab Universe does for standing orders. Then never create contracts for those
  customers in Core.

## The pipeline

```text
PIM     subscriptionPlan.create      periods and metered variables — the ids are generated, keep them
Core    createProduct / updateProduct   variant prices per plan period and price variant
Core    igniteDiscoApi               so the storefront can read the plan cards from Discovery
Core    createCustomer               Core contracts need a customer; the Shop endpoint does not
Core    createSubscriptionContract   the agreement: item, phases, dates, meta
Core    registerOrder                the receipt for the first period (0 for a trial)
Core    trackSubscriptionContractUsage   every metered event, with an idempotency key
… then, every period, per contract ………………………………………………………………………
Crystallize  renewalDue webhook      a week and a day before renewAt
Crystallize  renews the contract     at renewAt: dates move one period on, renew webhook fires
Core    usage(startDate, endDate)    the meter for the period that just ended
you     charge                       your payment provider; Crystallize takes no money
Core    registerOrder                the invoice: plan line + overage line, priced by you
Core    updateSubscriptionContract   meta.periodStart, so the next meter window starts here
```

## States

`SubscriptionContractState` is `active`, `paused`, `pendingActivation`, `pendingDeactivation` or
`cancelled`, and it is **derived from the dates**, not set directly:

| Dates                                     | State                 |
| ----------------------------------------- | --------------------- |
| `activateAt` in the future                | `pendingActivation`   |
| now before `activeUntil`, `renewAt` set   | `active`              |
| `activeUntil` in the future, no `renewAt` | `pendingDeactivation` |
| no `activeUntil`, or it has passed        | `cancelled`           |
| paused explicitly (wins over the dates)   | `paused`              |

Two rules follow, and both bite:

- **`activateAt` is exclusive of `renewAt` and `activeUntil`** (`ActivateAtMustBeExclusiveError`; the
  Shop endpoint only says "Unexpected error"). Send either a future start, or a running contract's dates.
- **Send `renewAt` and `activeUntil` together.** `createSubscriptionContract` fills a missing
  `activeUntil` from `renewAt`, but `updateSubscriptionContract { status }` and the Shop `create` do not:
  there, `renewAt` alone reads `cancelled`.

## Failure modes

| Symptom                                                         | Cause                                                               | Fix                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Nothing is charged and no order appears at `renewAt`            | There is no billing engine                                          | Bill from the `renew` webhook — see [usage-and-renewals](references/usage-and-renewals.md) |
| `renewAt` moved two periods                                     | A job called `renewSubscriptionContract` after the platform renewed | Never renew what is already due; only bill it                                              |
| A paused customer gets charged                                  | `renew` and `renewalDue` fire for paused contracts too              | Check `status.state` before charging                                                       |
| A brand-new contract reads `cancelled`                          | `activeUntil` missing (Shop: also when only `renewAt` was sent)     | Send both; for a trial set both to the trial's end                                         |
| `subscriptionContracts` errors on one element, the rest is data | A contract reached the Shop store under its Core id                 | Use one store; read with partial results in the meantime                                   |
| A Shop `pause`/`renew` is not on the Core copy yet              | The copies sync asynchronously                                      | Don't read one store to confirm a write to the other                                       |
| Usage tracked but the invoice has no overage                    | Nothing prices usage for you                                        | Read `usage(…)`, price the tiers yourself, add an overage line                             |
| A trial shows the full price on the plan card                   | Discovery's `initial` repeats `recurring`                           | Read the trial from the plan (PIM, server-side), Catalogue or your own config              |
| `MeteredVariableNotFoundError` when tracking                    | The metered variable's **id** was sent                              | Track by `identifier`                                                                      |
| Variant prices or contracts stop resolving after a plan edit    | `subscriptionPlan.update` without ids mints new period ids          | Always pass the existing `id`s back                                                        |
| A resumed contract lost the time it spent paused                | Pause freezes nothing; renewals kept rolling the dates              | On resume, set `renewAt`/`activeUntil` to now plus what was left                           |
| A `state` filter misses contracts that ran out                  | The filter reads the state stored at the last write                 | Compare the dates yourself                                                                 |
| `InvalidActiveUntilDateError` while seeding history             | Core refuses dates in the past (`InvalidRenewAtDateError` too)      | Back-date `signedAt` and the orders instead                                                |

## References

- [references/plans-and-pricing.md](references/plans-and-pricing.md) — plans and periods in the PIM API,
  variant subscription prices, metered variables, and what Discovery and Catalogue serve.
- [references/contracts.md](references/contracts.md) — creating contracts, the date rules, the whole
  lifecycle with what each call actually changes, and the Shop endpoint's differences.
- [references/usage-and-renewals.md](references/usage-and-renewals.md) — metered usage, period windows,
  scheduled renewals, renewal orders, `orderIntent`, webhooks, and how to bill on top of them.

Related: [[pricing]] for price variants and markets, [[mutation]] and [[query]] for the APIs themselves,
[[js-api-client]] for the TypeScript helpers, [[bookable-resources]] for the other "sold over time"
model — booking holds a calendar, a subscription repeats a charge.
