# Tenant setup: which API creates what

Getting a tenant ready to serve a storefront, whether you provisioned it as an agent or a human gave you an access
token. The settings are split across the **Core API** (`https://api.crystallize.com/@{tenant}`) and the **legacy PIM
API** (`https://pim.crystallize.com/graphql`, most calls take `tenantId`, the id and not the identifier). Both take
the same access token pair.

## What a fresh tenant has

| Setting         | On a new tenant                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Languages       | `en`, the default. It can't be removed: "Cannot add, remove or modify system languages (en)"         |
| VAT types       | One, `No Tax` at 0 %. A seed that matches VAT types by percent reuses it                             |
| Price variants  | `default`, in EUR. Its identifier can't be renamed and the variant can't be removed; change its name |
| Stock locations | `default`                                                                                            |
| Pipelines       | None. `pipeline.getMany` answers `edges: null`, not `[]`                                             |
| Shapes          | None on an agent tenant (see SKILL.md step 2)                                                        |
| Discovery index | None. Discovery answers "There is no ignited Tenant" until the first ignite                          |

A tenant that sells only in Norwegian keeps `en` and makes `no` the default.

## Setting → API → call

| Setting                             | API  | Call                                                                                             |
| ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| Languages                           | Core | `createTenantLanguage(input: { code, name })`, `updateTenantLanguage`, `deleteTenantLanguage`    |
| Default language and currency       | PIM  | `tenant { update(id, input: { defaults: { language, currency } }) }`, after the language exists  |
| VAT types                           | PIM  | `vatType { create(input: { tenantId, name, percent }) }`; `update(id, input: { name, percent })` |
| Price variants                      | PIM  | `priceVariant { create(input: { tenantId, identifier, name, currency }) }`                       |
| Stock locations                     | PIM  | `stockLocation { create(input: { tenantId, identifier, name }) }`                                |
| Order pipelines and stages          | PIM  | `pipeline { create(input: { tenantId, name, stages }) }`, `addStage`, `updateStage`              |
| Markets                             | PIM  | `market { create(input: { tenantId, identifier, name, customerIdentifiers }) }`                  |
| Subscription plans                  | PIM  | `subscriptionPlan { create }` (see [[subscriptions]])                                            |
| Custom views (tenant frontends)     | PIM  | `tenant { setPreferences(tenantId, input: { frontends: [{ name, url }] }) }`                     |
| Customer groups                     | Core | `createCustomerGroup` (see [[mutation]])                                                         |
| Booking policies                    | Core | `createBookingPolicy` (see [[bookable-resources]])                                               |
| Webhooks                            | Core | `createWebhook(input)` ([below](#webhooks-for-cache-revalidation))                               |
| Discovery index                     | Core | `igniteDiscoApi(stacks: opensearch)` ([below](#the-first-ignite))                                |
| Static auth token, signature secret | Core | read `tenant { staticAuthToken signatureSecret }`; rotate with `regenerateTenantSecrets`         |

Traps:

- **`UpdateVatTypeInput` rejects `tenantId`**, while `CreateVatTypeInput` requires it. A seed that sends the same
  input to both fails on update.
- **The default language can be changed on an empty tenant**: `createTenantLanguage`, then PIM `tenant.update` with
  `defaults.language`. Do it before content exists. The default language is the one Discovery returns relations in.
- The Core API now also has `updateTenant(input: { defaults })` and `createPriceVariant`. The PIM calls above are
  the ones the builds used.
- **`getMany` answers differ.** `pipeline.getMany` and `market.getMany` return a connection
  (`edges { node { id name stages { id name } } }`), and `edges` is `null` on an empty tenant. `priceVariant.getMany`
  and `stockLocation.getMany` return plain lists. VAT types are read from `tenant { get(id) { vatTypes { … } } }`.
- **Pipeline and stage ids are what the Shop API returns** on orders (`pipelines { identifier stage }`). A
  storefront that shows stage names reads `pipeline.getMany` at build time and writes the id → name map into its
  data, not on every request.

## The first ignite

A tenant has no Discovery index until `igniteDiscoApi` runs once. Until then Discovery answers **HTTP 404 with a
plain JSON body**, not a GraphQL `errors` array:

```json
{ "success": false, "message": "There is no ignited Tenant for …" }
```

A probe that looks only at `errors` misses it. Ignite from Core and pass the stack:

```graphql
mutation {
    igniteDiscoApi(stacks: opensearch)
}
```

It took about a minute on a new tenant. Ignite again after you add:

- shapes or components (a new field can need a second ignite minutes later; check `__type(name: "<shape>")` on
  Discovery before shipping code that queries it),
- stock locations (their `<location>Stock` fields appear only after a re-ignite),
- vector vocabularies (see [[vector-ranking]]).

Ignite indexes what is **published**. Publish first, then ignite. A component made discoverable after publishing
needs the items published again; a re-ignite alone re-indexes the old documents. Querying new fields is covered in
[[query]].

## Storefront credentials

What the storefront's server needs, and where it comes from. The API for each storefront task is in [[storefront]].

| API       | Credential                                                                                                | Where to get it                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Discovery | None while open (the default). The static token when **Settings → API access** restricts it               | `tenant { staticAuthToken }` on Core, or the App                                                   |
| Catalogue | Open, static token or token pair, per **Settings → API access**                                           | As above                                                                                           |
| Shop API  | A JWT from `POST https://shop-api.crystallize.com/{tenant}/auth/token` with `{ scopes, expiresIn }`       | Minted on the server with an access token pair that is **not tenant-scoped** (see [[permissions]]) |
| Core      | A tenant-scoped pair, for seeds, imports and webhook receivers only. Never in the storefront request path | A dedicated integration user (see [[permissions]])                                                 |

- **An agent tenant's token can't mint Shop API tokens** if it is tenant-scoped. Check before building checkout on
  it: a refused `/auth/token` call is the signal. Once a human owns the tenant, they create an unscoped token on a
  dedicated user.
- **An open Discovery is public.** Everything it indexes, every price variant and every market's price list
  included, is readable by anyone. Restrict it, or keep confidential terms out of it.
- The Shop API JWT is per tenant, not per shopper. Keep it on the server, cache it, and refresh it before it
  expires.

## Webhooks for cache revalidation

A storefront that caches Discovery reads clears its cache when items are published. The publish webhook is a Core
setting:

```graphql
mutation CreateWebhook($url: String!, $secret: String!) {
    createWebhook(
        input: {
            name: "storefront-revalidate-publish"
            concern: "items"
            event: "publish"
            method: POST
            url: $url
            headers: [{ name: "x-revalidate-secret", value: $secret }]
            preserveDefaultPayload: true
            graphqlQueryTarget: next
            graphqlQuery: "query ($id: ID!, $language: String!) { item(id: $id, language: $language) { ... on Item { id shapeIdentifier tree { path } } } }"
        }
    ) {
        ... on Webhook {
            id
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

- **The concern is `items`, plural.** `createWebhook` accepts any `concern` and `event` string without validation:
  `item`, `product` or `nope` are all accepted, and they never fire. Add a second webhook with `event: "unpublish"`.
- **The default payload has no path**: `{ id, type, tenantId, language, userId, webhookId }`. Add a `graphqlQuery`
  (it gets `$id` and `$language`; `graphqlQueryTarget: next` runs it against the Core API) and keep
  `preserveDefaultPayload: true` so the receiver gets both.
- **Debug through the invocations**: `webhooks { ... on WebhookConnection { edges { node { name concern event
  lastInvocation { start response { status } } } } } }`, or the `webhookInvocations` query. A webhook that never
  shows an invocation has the wrong concern or event.
- The receiver is a server route in the storefront that checks the secret header and clears the cache tag for the
  item (see [[storefront]]). Key the setup script on the webhook `name`, so a rerun updates instead of duplicating.
