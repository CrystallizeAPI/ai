---
name: permissions
description: Manage user roles, permissions, and access control in Crystallize. Use when configuring field-level permissions (read-only or hidden fields for specific roles), managing user roles and team access, creating or updating custom roles (createRole, updateRole, setUserRole, createInviteToken), restricting a role to specific folders, languages or stock locations, creating access tokens and scoping them to a tenant, deciding which user and role an integration runs as, debugging a Forbidden error on the Core API, controlling who can view/edit specific content areas or component fields, designing role-based access for multi-team tenants, or planning permission strategies for content workflows. For wiring credentials and Shop API token scopes into client code use js-api-client.
metadata:
    author: Crystallize
    version: "2.0"
---

# Crystallize Permissions & Access Control

Design and configure user roles, field-level permissions, and access tokens in Crystallize.

## Critical concept: UI vs API permissions

This distinction trips up most users. Crystallize separates permissions into two layers:

| Layer                | Scope               | What it controls                                                          |
| -------------------- | ------------------- | ------------------------------------------------------------------------- |
| **UI permissions**   | Crystallize UI only | Hide or lock fields from editors — cosmetic, does not restrict API access |
| **CRUD permissions** | API + UI            | Actual data access control (read/write/delete)                            |

In a role these are the **UI preferences** tab (`interfaceSettings` on the API) and the **Permissions** tab (`resources` on the API).

Setting a field to "Read-Only" in the UI does **not** prevent API writes to that field, and **no API restriction exists per field**. CRUD permissions stop at the resource, narrowed at most by item and language or by stock location (see [Conditions](#conditions)): a role with `catalogue.update` can write every field of the items it reaches, through any access token. So a hidden field is hidden from the App, not protected. This is especially useful when integrations (ERPs, PIMs) write data via API — UI locks for editors, while the integration keeps write access.

CRUD permissions apply on the Core and PIM APIs. They do not reach the Catalogue, Discovery or Shop APIs: see [Other credentials](#other-credentials).

## Consultation Approach

Before recommending a permission setup, understand the user's situation. Ask clarifying questions:

1. **How many distinct user types do you have?** Editors, contributors, product managers, admins? Each needs its own role since Crystallize uses one role per user on a tenant.
2. **Do you need UI restrictions, API restrictions, or both?** UI-only hides/locks fields in the dashboard. CRUD controls actual data access.
3. **Are there specific folders or languages that need restricted access, or shapes to hide from the App?** Multi-team setups often need folder-level isolation.
4. **Do external systems write data?** ERPs, PIMs, and import scripts may need their own user and role, with broader access than human editors.
5. **What fields should editors never touch?** Prices synced from ERP, migration metadata, internal tracking fields?

Use the answers to design a role structure and recommend the right combination of UI + CRUD permissions.

## Overview

Crystallize provides granular access control at multiple levels:

- **User roles** — Control what users can do (read, write, publish, admin)
- **Field-level permissions** — Make specific component fields read-only or hidden for certain roles
- **Resource-level permissions** — Control access to features like shapes, price variants, catalogue folders
- **UI vs API permissions** — UI permissions only affect the Crystallize UI, not API access
- **Access tokens** — Belong to a user and act with that user's role

## User roles

Crystallize has two built-in roles and supports unlimited custom roles.

### Built-in roles

| Role             | Identifier    | Description                                                                                                                                                    |
| ---------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tenant Admin** | `tenantAdmin` | Full access to everything and all settings. The only role that can copy the tenant, manage tenant secrets (static auth token, signature secret) and set up SSO |
| **User**         | `user`        | Legacy role, not a base for custom roles and not minimal: full access to the tenant's data, read-only on `roles` and `users`. The App no longer assigns it     |

Built-in roles cannot be edited, and `updateRole` refuses them.

### Custom roles

Create custom roles in **Settings → Roles**.

Key characteristics:

- **Empty by default** — A custom role inherits nothing, from `user` or anything else. Every action not set to `allow` is denied
- **One-to-one mapping** — Each user can only have one role per tenant
- **Fully customizable** — Set permissions per feature/resource
- **Granular control** — UI-level hiding/locking, folder-level catalogue access

When inviting users, select which role they should have. If a user needs different permissions, create a new role — you cannot assign multiple roles to one user.

## Field-level permissions

Field-level permissions are UI preferences, configured per shape on the **Shapes** resource of a role.

### How to configure (UI)

1. Go to **Settings → Roles**
2. Select or create a role
3. Open the **Shapes** resource, switch to the **UI preferences** tab, and click on a specific shape
4. You'll see all components on that shape (product shapes have a **Product** and a **Variant** tab)
5. For each component, toggle:
    - **Lock icon (read-only)** — Field appears greyed out, cannot be edited
    - **Eye icon (hidden)** — Field is invisible to this role

### Supported fields

- **Root-level components** on shapes, and variant components on product shapes
- **Structural components** (contentChunk, componentChoice, etc.) — as a whole, not the fields nested in them
- **Native Crystallize fields** — Name, variant name, SKU and media can be locked. External reference and attributes can be locked or hidden
- **Whole shapes** — A hidden shape cannot be used to create items in the App. Existing items of that shape stay readable, editable and deletable
- **Price variants** — Configure in the Price Variants resource (same pattern as shapes)
- **Orders, fulfilment pipelines and flows** — Have their own UI preferences tab: which pipelines and flow stages appear, stage transitions, hiding the settings from navigation

### Behavior

| Permission                   | Crystallize UI          | API behavior               |
| ---------------------------- | ----------------------- | -------------------------- |
| **Read-Only**                | Greyed out, cannot edit | Not affected, CRUD decides |
| **Hidden**                   | Completely invisible    | Not affected, CRUD decides |
| **Default (no restriction)** | Editable                | Not affected, CRUD decides |

**Important:** UI permissions (hide/lock) only apply to the Crystallize UI, **not** the API level. Use API-level CRUD restrictions for API access control.

**Publishing gotcha:** Locking or hiding a component with min/max validation (files, selection, colors, item relations, or a chunk or choice containing one) leaves the role unable to meet that validation, so it can no longer publish. The App warns about it. The API does not.

## Resource permissions

Almost every feature in Crystallize has **CRUD operation resources** (Create, Read, Update, Delete).

### Resources

API names, as used in `resources`. Each action takes `{ effect: allow | deny }`, and an action left out is denied.

| Actions                                                      | Resources                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`, `read`, `update`, `delete`                         | `apps`, `assets`, `bookingPolicies`, `customers`, `fulfillment`, `languages`, `markets`, `metaPresets`, `operationLog`, `orders`, `pluginInstallations`, `priceLists`, `priceVariants`, `productBookable`, `roles`, `shapes`, `stockLocations`, `subscriptionContracts`, `subscriptionPlans`, `topics`, `users`, `vatGroups`, `vocabularies`, `webhooks` |
| `create`, `read`, `update`, `delete`, `transition`           | `flows`                                                                                                                                                                                                                                                                                                                                                  |
| `create`, `read`, `update`, `delete`, `publish`, `unpublish` | `catalogue`, `grids`                                                                                                                                                                                                                                                                                                                                     |
| `read`                                                       | `reports`                                                                                                                                                                                                                                                                                                                                                |

What a name covers is not always obvious:

- `catalogue` is all items (products, documents, folders). The App labels it **Tree**
- `shapes` includes pieces, `assets` includes images, videos and files, `customers` includes customer groups
- `users` includes invite tokens
- `operationLog` also governs mass operation bulk tasks, so an integration running mass operations needs it

**Dependencies.** The App treats these as required and adds them when you tick a permission. `createRole` and `updateRole` accept a role without them, so list them yourself:

- Any action on a resource needs `read` on that resource
- `catalogue.read` needs `read` on `shapes`, `languages`, `priceVariants`, `subscriptionPlans` and `assets`
- `catalogue.create` needs `vatGroups.read`
- `catalogue.update` needs `update` on `priceVariants` and `subscriptionPlans`, plus `create` and `update` on `assets`
- `topics.read` needs `languages.read`
- `grids.read` needs `languages.read` and `catalogue.read`
- `orders.create`, `priceLists.read` and `subscriptionContracts.create` need `priceVariants.read`

**API-only resources.** The App's role editor does not know `vocabularies` and `metaPresets`, and saving a role there drops them. Set them on the API, and set them again after a save in the App.

**Treat `roles` and `users` writes as admin rights.** Nothing compares them to the holder's own level: `roles.update` can widen the holder's own role, and `users.update` or `users.create` can hand out `tenantAdmin`.

### Conditions

Conditions narrow an `allow`, and are how folder-level restrictions work. In the App: open the resource and use **Add condition**. On the API: `conditions` on the action. A condition on `deny` is refused.

Restrict catalogue access to specific folders per role:

- User can only **see** certain folders
- User can only **edit** certain folders
- Combine with other permissions for granular control

| Resource         | Condition fields                                                                   | Actions                                            |
| ---------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| `catalogue`      | `itemIds`, `languages`                                                             | `create`, `read`, `update`, `publish`, `unpublish` |
| `catalogue`      | `itemIds`                                                                          | `delete`                                           |
| `orders`         | `stockLocations: { stockLocationIdentifiers, includeOrdersWithoutStockLocations }` | `create`, `read`, `update`, `delete`               |
| `stockLocations` | `identifiers`                                                                      | `read`, `update`, `delete` (`create` takes none)   |

How they behave:

- **Per action** — An action allowed without conditions stays tenant-wide. To lock a team to a folder, put the condition on every action it holds
- **Item ids cover the subtree** — An item id matches that item and everything under it. Use the folder's item id, not its path
- **Conditions are alternatives** — Entries in `conditions` are ORed. Inside one entry, `itemIds` and `languages` must both match
- **Empty means everything** — `itemIds: []` is no item restriction, and `conditions: []` is no condition at all
- **Limits** — At most 42 `itemIds` per condition. Item ids, languages and stock locations must exist on the tenant, or the role is refused
- **No parent, no access** — A conditioned `create` is checked against `input.tree.parentId`, and a conditioned `read` on an item list against `filter.parentItemId`. Without one, the call is refused

## UI vs API permissions

| Permission type      | Scope               | Use case                                       |
| -------------------- | ------------------- | ---------------------------------------------- |
| **UI permissions**   | Crystallize UI only | Hide/lock fields from editors, simplify UI     |
| **CRUD permissions** | API + UI            | Control actual data access (read/write/delete) |

**Example:** You can hide a "price" field in the UI but still allow API access — useful when editors shouldn't manually change prices that are synced from an ERP.

## Access tokens

Every access token belongs to a user. There is no tenant-level or service token, and a token carries no permissions of its own: it acts as its owner, with the role the owner holds on the tenant at the time of the request. Change the role and the token follows. Remove the user from the tenant and the token stops working there. UI preferences do not apply to it.

- **Personal** — Created in the user's own account settings, under **Access tokens**, not in the tenant's settings. On the API, `createAccessToken` on the Me API (`https://api.crystallize.com/@me`) always creates for the caller, and `accessTokens` lists the caller's. Nobody can create a token for another user, tenant admins included
- **Secret shown once** — `secret` is only returned at creation
- **Limit** — 50 tokens per user
- **Tenant scope** — `tenantId` (the id, not the identifier) limits a token to one tenant the user belongs to. Without it, the token reaches every tenant the user is on
- **A tenant-scoped token is refused on `/@me`** with a 403. It cannot call the Me API, and it cannot fetch a Shop API token, which goes through `/@me` too
- **SSO** — On a tenant that enforces SAML login, a token with no tenant scope only works for a Tenant Admin. Other users need a tenant-scoped token

```graphql
mutation CreateToken($tenantId: ID) {
    createAccessToken(name: "ERP sync", tenantId: $tenantId) {
        ... on AccessToken {
            id
            secret
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

**Integrations run as a user.** Give each one a dedicated user, invited with a custom role that holds only what the integration needs, and sign in as that user to create the token. A person's token ties the integration to that person's role and account. Scope the token to the tenant, unless the integration also needs Shop API tokens: then leave it unscoped, and keep that user on a single tenant.

### Other credentials

Only the Core and PIM APIs check role permissions.

| API       | Gated by                                                                                           | Role permissions apply                           |
| --------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Core, PIM | Access token pair or session                                                                       | Yes                                              |
| Catalogue | **Settings → API access**: open, static token or access token pair                                 | No: with the pair, any role on the tenant passes |
| Discovery | Static token, when the tenant protects it                                                          | No                                               |
| Shop      | Bearer token from `/auth/token`, requested with a session or an unscoped pair and a list of scopes | No                                               |

See [js-api-client](../js-api-client/SKILL.md) for wiring these credentials.

## API configuration

Roles are configured on the **Core API** (`https://api.crystallize.com/@{tenant}`, `nextPimApi` in the JS client), through the root fields `role`, `roles`, `createRole`, `updateRole`, `deleteRole`, `upsertLimitedShapeToRole`, `removeLimitedShapeFromRole` and `setUserRole`. Permissions are a **separate resource** from shapes — you won't see permission settings when querying shapes.

Read [references/role-api.md](references/role-api.md) before writing any of these calls. It has every query, mutation and input shape. The traps:

- **`updateRole` replaces `resources` and `interfaceSettings` whole.** Send one resource and every other resource is denied
- **`createRole` requires `resources`**, even if empty, and refuses reserved identifiers: `name: "Admin"` fails unless you pass another `identifier`
- **UI preference lists are allow-lists.** The first `upsertLimitedShapeToRole` on a role hides every other shape, and an unlisted component is hidden
- **`setUserRole` never demotes a Tenant Admin.** It succeeds and changes nothing, so promoting to `tenantAdmin` is one-way

## Best practices

1. **Start from an empty custom role** — Add only the permissions the role needs, with their dependencies. Do not assign the legacy User role
2. **Do not rely on UI restrictions to protect data** — They don't apply at the API level, and CRUD permissions stop at the resource
3. **One role per user type** — Can't assign multiple roles, so create distinct roles (e.g., "Content Editor", "Product Manager", "External Contributor")
4. **Test with non-admin account** — Always verify permissions work as expected from a non-admin user perspective
5. **Name roles descriptively** — e.g., "Content Editor - Blog Only", "Product Manager - Catalogue Admin"
6. **Use folder restrictions for multi-team setups** — Isolate catalogue access by team or department
7. **Separate human and machine access** — Personal tokens for human workflows, a dedicated user and role for each integration

## Common use cases

### Read-only ERP fields

Scenario: Prices are synced from an ERP — editors shouldn't manually change them.

Solution:

1. Create "Editor" role
2. In the Price Variants resource → **UI preferences** → lock each price variant
3. Editors can see prices but cannot edit them in the dashboard
4. ERP integration uses the access token of a dedicated user whose role has write access

### Hide internal metadata

Scenario: Migration tracking fields should be invisible to content editors.

Solution:

1. Create "Content Editor" role
2. In Shapes → **UI preferences** → [Your Shape] → migration-metadata component → hide it with the eye icon
3. Only roles without that preference see these fields in the App. They are still returned to any token whose role can read the item

### Folder-restricted access

Scenario: Team A manages products in `/shop/electronics`, Team B manages `/shop/fashion`.

Solution:

1. Create "Team A Editor" role → condition on each of its `catalogue` actions → the item id of `/shop/electronics`
2. Create "Team B Editor" role → condition on each of its `catalogue` actions → the item id of `/shop/fashion`
3. Each team can only see and edit their assigned folder

### API-only integration with limited scope

Scenario: A reporting job needs read-only access to products on the Core API but should never modify data.

Solution:

1. Create "Report Reader" role with `read` on `catalogue` and its dependencies (`shapes`, `languages`, `priceVariants`, `subscriptionPlans`, `assets`), plus `topics`
2. Invite a dedicated user with this role, and sign in as them to generate a token scoped to the tenant
3. Use this token in the job's API calls — even if compromised, it can't write data

A storefront needs none of this: the Catalogue and Discovery APIs are read-only and do not use roles. Protect them with **Settings → API access** if they should not be public.

## References

- [Role API reference](references/role-api.md) — Queries, mutations and input shapes for roles, UI preferences and role assignment
- [Official docs — User roles](https://crystallize.com/docs/guides/user-roles)
- [Official docs — Access tokens](https://crystallize.com/docs/guides/access-tokens)
