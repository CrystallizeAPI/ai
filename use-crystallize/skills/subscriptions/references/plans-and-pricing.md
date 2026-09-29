# Plans, periods and subscription pricing

A plan is the template. It says which periods can be bought (Monthly, Yearly), whether there is an
introductory period, and which meters exist. Prices are **not** on the plan — they are on the variant,
per plan period and per price variant.

## Plans live in the legacy PIM API

There is no plan surface on the Core API. Create and edit plans on `https://pim.crystallize.com/graphql`,
which takes the tenant **id**, not the identifier:

```graphql
mutation CreatePlan($input: CreateSubscriptionPlanInput!) {
    subscriptionPlan {
        create(input: $input) {
            identifier
            periods {
                id
                name
                initial {
                    period
                    unit
                }
                recurring {
                    period
                    unit
                }
            }
            meteredVariables {
                id
                identifier
            }
        }
    }
}
```

```json
{
    "input": {
        "tenantId": "<tenant id>",
        "identifier": "membership",
        "name": "Membership",
        "periods": [
            {
                "name": "Monthly",
                "initial": { "period": 14, "unit": "day" },
                "recurring": { "period": 1, "unit": "month" }
            },
            {
                "name": "Yearly",
                "initial": { "period": 14, "unit": "day" },
                "recurring": { "period": 1, "unit": "year" }
            }
        ],
        "meteredVariables": [{ "identifier": "downloads", "name": "Offline downloads", "unit": "download" }]
    }
}
```

**The ids are generated, and everything downstream points at them.** Period ids and metered-variable ids
come back from `create` as 24-hex ObjectIds. Variant prices reference a period id; contracts reference a
period id and a metered-variable identifier. Store them in your seed or config.

**`update` mints new ids for anything you send without one.** `update(identifier, tenantId, input: {
periods: [{ id, … }], meteredVariables: [{ id, … }] })` keeps them; the same lists without `id`s replace
them, and every variant price and contract pointing at the old ids is orphaned. A name-only update
(`input: { name }`) leaves periods and meters alone. `delete(identifier, tenantId)` succeeds even while
variants still reference the plan.

## Prices go on the variant (write on Core, read on PIM)

`createProduct`, `updateProduct` and `updateProductVariant` take `subscriptionPlans` per variant:

```json
{
    "identifier": "membership",
    "periods": [
        {
            "id": "<period id>",
            "initial": { "priceVariants": [{ "identifier": "default", "price": 0 }] },
            "recurring": {
                "priceVariants": [
                    { "identifier": "default", "price": 7.99 },
                    { "identifier": "nok", "price": 89 }
                ],
                "meteredVariables": [
                    {
                        "id": "<metered variable id>",
                        "tierType": "graduated",
                        "tiers": [
                            { "threshold": 0, "price": 0, "priceVariants": [{ "identifier": "default", "price": 0 }] },
                            {
                                "threshold": 10,
                                "price": 0,
                                "priceVariants": [{ "identifier": "default", "price": 0.5 }]
                            }
                        ]
                    }
                ]
            }
        }
    ]
}
```

Four things worth knowing, all from the Screen Universe spike:

- **Reading `ProductVariant.subscriptionPlans` back on Core answers "Not implemented"** — one error per
  variant, even for `subscriptionPlans { identifier }`. The write itself succeeds, so a `createProduct`
  that _selects_ the plans throws **after** creating the product, and a naive retry duplicates it.
  Select only `id` on the write, and read the plans back from PIM
  (`product { get(id, language) { variants { subscriptionPlans { … } } } }`).
- **A tier's own `price` is ignored.** It is required by the input, but the stored tier price is the one
  in `priceVariants`. `price: 99` with `default: 0.1` stores 0.1, and an empty `priceVariants` stores
  `null`.
- **Price variants are optional per period.** Leave `nok` out and only `default` is stored; Discovery
  then answers `nokPrice: null`. A period omitted from the variant is stored as `initial: null,
recurring: null` and Discovery drops it.
- **Meters are addressed two ways.** On a variant's tiers, by metered-variable **`id`**. On contracts and
  when tracking usage, by **`identifier`**. Mixing them up gives `MeteredVariableNotFoundError`.

## What the storefront can read

Discovery serves the plan cards, and this is the query that works (verified on a live tenant):

```graphql
{
    browse {
        plan(language: en) {
            hits {
                variants {
                    sku
                    hasSubscriptionPlans
                    subscriptionPlans {
                        identifier
                        name
                        periods {
                            id
                            name
                            recurring {
                                period
                                unit
                                defaultPrice
                                priceVariants
                                meteredVariables {
                                    identifier
                                    tierType
                                    tiers {
                                        threshold
                                        defaultPrice
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
```

- `period` comes back as a **string** (`"1"`), `priceVariants` as a hash
  (`{ default: { price, currency }, nok: { … } }`), and `meteredVariables` as `[]` when there are none.
- **Do not trust `initial`.** It repeats `recurring`: on a tenant whose Monthly period is "14 days free,
  then 1 month at 7.99", Discovery answered `initial { period: "1", unit: "month", defaultPrice: 7.99 }`,
  and a re-check on 2026-09-28 again returned `initial` byte-identical to `recurring`. Take the
  introductory period from the plan (PIM, server-side) or from your own config, and price the trial
  yourself.
- `hasSubscriptionPlans` is the cheap filter for "is this a plan variant".
- On one tenant the **Catalogue API's `variants` came back empty** for every product while
  `defaultVariant` worked and carried the correct plans, including the trial. If a plan card looks empty,
  read `defaultVariant`, or use Discovery.

Remember that a plan variant is an ordinary variant: markets, price variants, VAT and volume tiers behave
as they do everywhere else — see [[pricing]].
