# Modelling a bookable catalogue

## Booking is on the product, price is on the variant

`setBookable` takes an item id, so the calendar belongs to the product. The money belongs to the
variant. That one split decides the model: **sell time as variants.**

```text
Product  Bosch GAS 55 M dust extractor — rental        bookable: 5 units, policy "heavy-equipment"
  ├─ RENT-GAS55-DAY       1 day        attributes: { period: day }
  ├─ RENT-GAS55-WEEKEND   weekend      attributes: { period: weekend }
  ├─ RENT-GAS55-WEEK      1 week       attributes: { period: week }
  └─ RENT-GAS55-4WEEKS    4 weeks      attributes: { period: 4-weeks }
```

The shopper picks a period and a start; the storefront turns that into `start`/`end` and books the
matching SKU. Keep the length of each period on the variant — a numeric `duration-hours`, or an
attribute — so the window is computed from data rather than from a hardcoded table. A weekend is rarely
48 hours: Friday 12:00 to Monday 08:00 is 68.

Price tiers per period, currency per market and VAT all work as they do for any other variant — see
[[pricing]].

## Units are the real things

A unit id should be the thing in the world: an asset tag, a room number, a registration number. Put
everything that distinguishes it in `meta`:

```json
{
    "id": "GAS55-OSL-1",
    "meta": [
        { "key": "depot", "value": "osl" },
        { "key": "serial", "value": "TU316652" },
        { "key": "hours", "value": "257" },
        { "key": "lastService", "value": "2026-06-07" }
    ]
}
```

That is what lets a storefront filter by location ("available in Oslo this weekend") without another
data source: read the pool from Discovery, group the `freeUnitIds` from `availability` by their depot
meta, and show one line per location.

Use a **capacity** pool instead when the units are interchangeable and nobody needs to know which one
they got — seats on a course, bikes in a rack. You lose per-unit meta, so if the storefront must say
_which_ one, use units.

## What Discovery serves, and what it does not

Discovery carries the **static** bookable configuration on the item:

```graphql
{
    browse {
        rental(language: en, pagination: { limit: 24 }) {
            hits {
                itemId
                name
                path
                bookable {
                    poolSize
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
                variants {
                    sku
                    attributes
                    defaultPrice
                }
            }
        }
    }
}
```

**Discovery never serves availability.** Listing pages can say "5 machines, 3 depots" from `poolSize` and
the pool; anything about a date is a Shop API call. Design the page so the calendar loads after the
product, not as part of the listing query — one `availability` call per visible card is a lot of calls.

## Rentals next to the thing being rented

A rental item and the product it is a rental of are two catalogue items. Relate them both ways: an item
relation from the rental to the tool, and one back from the tool to its rental. The tool's page can then
offer "rent this instead", and the rental page can show the tool's specifications without duplicating
them. See [[content-model]] for the relation component and [[information-architecture]] for where the
rental folder sits.

Mark the rental folder with an `externalReference` (`folder:/rental`) so the storefront can recognise a
rental listing without matching on the path in four languages.

## Services around a booking

Delivery, damage waiver, cleaning, an operator: sell them as ordinary products and add them to the cart
as normal lines, or as `type: service` lines. They are not bookable themselves; they follow the booking
they belong to. Give them and the booking line the same `group` so the basket can show them together.
Set `group` and `type` through `hydrate`: `bookSkuItem` ignores both on a new line.
