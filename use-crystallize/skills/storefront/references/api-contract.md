# The storefront API contract

Which API a storefront calls for each task, with which token, from where. The rule in one line: **Discovery for
every catalogue read, the Shop API for everything about a shopper, Catalogue and Core only for the tasks named
here.**

## Decision table

| Task                                       | API                        | Call                                                                                                                                                                      | Token / scope                                                     | Where                               |
| ------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| Item by path (product, category, document) | Discovery                  | `search(language, filters: { path: { equals } })`, then shape fragments                                                                                                   | none / static                                                     | server, cached                      |
| Category listing                           | Discovery                  | `browse.<shape>(filters: { parentPaths: { equals } })` (any depth); the `parentPaths` facet for subfolders                                                                | none / static                                                     | server, cached                      |
| Facets                                     | Discovery                  | `summary { facets }`. Each selection option is its own field (`<field>_<optionKeyCamel>`, `exists: true`); a `NumberFacet` needs at least two `boundaries`                | none / static                                                     | server                              |
| Card per colourway                         | Discovery                  | `variantGroups(by, filter, first)` with `matched`, `summary`, `representative`                                                                                            | none / static                                                     | server                              |
| Variant pick on the PDP                    | Discovery                  | `variant(selected: [{ attribute, value }])`, then the SKU into `hydrate`                                                                                                  | none / static                                                     | server                              |
| Search results                             | Discovery                  | `term` + `options: { fuzzy: { fuzziness: SINGLE } }`, `sorting: { score: desc }`; add `{ signal: relevance }` when `rankBy` is used                                       | none / static                                                     | server                              |
| Typeahead                                  | Discovery                  | `filters: { name: { autocomplete: { term } } }` plus the same `term` for scoring; drop `score == 0`. Or an in-memory index built from one Discovery snapshot              | none / static                                                     | server route or browser index       |
| Translated paths, hreflang, sitemap        | Discovery                  | One aliased query per language by `itemId`; a sitemap is one `browse` per language joined on `itemId`                                                                     | none / static                                                     | server, build                       |
| Personal ranking, "more like this"         | Discovery                  | `rankBy` + `context.userTaste` (rebuilt from Shop order history) + `nearestTo`                                                                                            | none / static                                                     | server                              |
| List, sale, "from" price                   | Discovery                  | `<variant>Price`, `variantGroups.summary.price`                                                                                                                           | none / static                                                     | server                              |
| Public market price                        | Discovery                  | `<variant>PriceFor(marketIdentifiers)`; only for the SKUs on screen                                                                                                       | none / static                                                     | server                              |
| Contract price for display (B2B)           | Shop API, Catalogue        | A throw-away `hydrate` with the customer, or Catalogue `priceFor(customerIdentifiers)`, cached per organisation. **Never Discovery**                                      | `cart` / Catalogue token                                          | server                              |
| Stock on the page                          | Discovery                  | `<location>Stock` per variant, `inStock`, `stock_<location>` filters. A new stock location needs a re-ignite                                                              | none / static                                                     | server                              |
| Create or change the cart                  | Shop `/cart`               | `hydrate` with the **whole** item list (it replaces), or `addSkuItem`; batch client changes into one hydrate                                                              | `cart`                                                            | server action                       |
| Price the cart for customer and market     | Shop `/cart`               | `context.price { currency, selectedVariantIdentifier, fallbackVariantIdentifiers, compareAtVariantIdentifier, markets, customerGroups, voucherCodes, decimals, taxRate }` | `cart`                                                            | server                              |
| Customer on the cart                       | Shop `/cart`               | `setCustomer`, or `hydrate(customer: { identifier, isGuest: false })`; for B2B the organisation; before any booking                                                       | `cart`                                                            | server                              |
| Validate a voucher                         | Shop `/cart`               | `validateVoucher(voucher)`                                                                                                                                                | `cart`                                                            | server                              |
| Lock the cart before charging              | Shop `/cart`               | `place` (it hydrates one last time; charge its `total`)                                                                                                                   | `cart`                                                            | server                              |
| Order from the cart                        | Shop `/order`              | `createFromCart(id, { pipelines, paymentStatus, payments })`; cart meta is copied; no `fulfill` afterwards                                                                | `order`                                                           | server, payment webhook             |
| Order without a cart (accepted quote, POS) | Shop `/order`              | `create` (takes `relatedOrderIds`)                                                                                                                                        | `order`                                                           | server                              |
| Record payments                            | Shop `/order`              | `addPayments` / `setPayments`; `paymentStatus` is set once, at creation                                                                                                   | `order`                                                           | server                              |
| Move the order through stages              | Shop `/order`              | `addToStage(id, pipelineId, stageId)` (ids, not names), then `setMeta`                                                                                                    | `order`                                                           | server, back office                 |
| Order confirmation page                    | Shop `/order`              | The order `createFromCart` returned; `order(id)` can be "not found" for a moment                                                                                          | `order`                                                           | server                              |
| Shopper's order history                    | Shop `/order`              | `orders(customerIdentifier, limit: 100)`; it lags and can be incomplete                                                                                                   | `order`                                                           | server; identifier from the session |
| Customer record from the storefront        | Shop `/customer`           | `customer(input)`, `addAddress`, `setMeta` (synced to Core)                                                                                                               | `customer`                                                        | server                              |
| Booking availability                       | Shop `/cart`               | `availability`, `nearestAvailability`, `checkBooking` (Discovery never serves availability)                                                                               | `cart`                                                            | server, after the product           |
| Hold, change, release a booking            | Shop `/cart`               | `bookSkuItem` (one at a time per cart); re-`hydrate` without the line to release it                                                                                       | `cart`                                                            | server                              |
| Confirm a booking                          | Shop `/cart`               | `confirmCartBooking` before **and after** `createFromCart`, once `cart.orderId` is set                                                                                    | `cart`                                                            | server                              |
| Read or cancel any reservation (staff)     | Shop `/booking/admin`      | `reservation(id)`, `cancel(id, reason)`, `block`, `calendar`; see [[bookable-resources]]                                                                                  | `booking` + `booking:admin` (both; one alone is "Invalid Scopes") | server, staff                       |
| Subscription sign-up and account page      | One store per tenant       | Shop `/subscription-contract` or Core; see [[subscriptions]]                                                                                                              | own token / pair                                                  | server                              |
| Usage metering                             | Core only                  | `trackSubscriptionContractUsage`, one call per metered event, never per page view                                                                                         | pair                                                              | server                              |
| Idempotency guard                          | Shop `/lock`               | acquire and release                                                                                                                                                       | `lock`                                                            | server                              |
| Pipeline stage names for display           | PIM                        | `pipeline.getMany` at **build time**; write the ids into the storefront's data                                                                                            | pair                                                              | build                               |
| Cache revalidation on publish              | Core (setup)               | `createWebhook(concern: "items")` with `graphqlQuery` and `preserveDefaultPayload: true`                                                                                  | pair (setup)                                                      | setup; receiver is a server route   |
| Draft preview                              | Discovery                  | `publicationState: draft`; never cached. On an open Discovery drafts are public; restrict it if they must stay private                                                    | none / static                                                     | server, behind preview mode         |
| Seller or approval queue across customers  | Core                       | `orders(filter: { … })` behind staff login, or an index fed by webhooks                                                                                                   | pair                                                              | back office server                  |
| Seeding, model, publish, ignite, taste     | Core, PIM, mass operations | —                                                                                                                                                                         | pair                                                              | scripts only                        |

Field names on Discovery (`nokPrice`, `<location>Stock`, `price_default`, `specs_drilling_torque_number`) are
generated from the tenant's identifiers; read them from the schema, see [[query]].

## Where the order lives

Write an order in one store and read it from the same store. A storefront that lists orders from the Shop API
creates them on the Shop API (`createFromCart`, or `create` without a cart). Core `registerOrder` is for orders
nobody reads from the edge, such as imports into a back office. The order store table in [[mutation]] is the
rule.

## Shop API token rules

- Minted with `POST https://shop-api.crystallize.com/{tenant}/auth/token` and `{ scopes, expiresIn }`, using an
  access token pair whose token is **not tenant-scoped** ([[permissions]]). The `@` before the tenant is
  optional on the Shop API.
- Per tenant, not per shopper. Cache it server-side; refresh before `exp`. Expiry is one day by default in the
  API and 12 hours in `@crystallize/js-api-client`.
- `"exp" claim timestamp check failed` means the cached token expired. A rejected token answers 401 with
  `{ success: false }` and no `errors`.
- The Shop API allows browser calls only from Crystallize origins and localhost. Production calls are server-side
  (server action or route), always.

## Things that look like contradictions

- **"Discovery is public."** It is open by default and can be restricted with a static token. When open,
  everything it serves is public.
- **"Catalogue for exact paths."** Discovery resolves paths. Catalogue `variants` came back empty on several
  tenants; keep it for per-customer price lists.
- **Customer price resolution.** Discovery resolves markets only. The Shop API resolves the cart's customer (price
  lists inherited from parent customers). Catalogue resolves any customer for display.
- **Payments code that reads Core.** That runs in the payment webhook, not in page code; it is not the request
  path. See [[payments]].
- **Deterministic secondary sort.** Discovery applies sort keys in schema order, so a second key such as
  `itemId` can replace a primary that sorts after it. Use one key per sort, or check the order; `score` is safe
  as the primary. `{ itemId: asc }` alone is stable for full scans.
