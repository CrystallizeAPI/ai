---
name: permissions
description: Manage user roles, permissions, and access control in Crystallize. Use when configuring field-level permissions (read-only or hidden fields for specific roles), managing user roles and team access, setting up access tokens with specific scopes, controlling who can view/edit specific content areas or component fields, designing role-based access for multi-team tenants, or planning permission strategies for content workflows.
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

Setting a field to "Read-Only" in the UI does **not** prevent API writes to that field. If you need true access restriction, set both UI and CRUD permissions. This is especially important when integrations (ERPs, PIMs) write data via API — you want UI-only locks for editors, but the API token needs write access.

## Consultation Approach

Before recommending a permission setup, understand the user's situation. Ask clarifying questions:

1. **How many distinct user types do you have?** Editors, contributors, product managers, admins? Each needs its own role since Crystallize uses one-role-per-user.
2. **Do you need UI restrictions, API restrictions, or both?** UI-only hides/locks fields in the dashboard. CRUD controls actual data access.
3. **Are there specific folders or shapes that need restricted access?** Multi-team setups often need folder-level isolation.
4. **Do external systems write data?** ERPs, PIMs, and import scripts may need separate API tokens with broader access than human editors.
5. **What fields should editors never touch?** Prices synced from ERP, migration metadata, internal tracking fields?

Use the answers to design a role structure and recommend the right combination of UI + CRUD permissions.

## Overview

Crystallize provides granular access control at multiple levels:

- **User roles** — Control what users can do (read, write, publish, admin)
- **Field-level permissions** — Make specific component fields read-only or hidden for certain roles
- **Resource-level permissions** — Control access to features like shapes, price variants, catalogue folders
- **UI vs API permissions** — UI permissions only affect the Crystallize UI, not API access
- **Access tokens** — User tokens (follow role permissions) and API tokens (tenant-level)

## User roles

Crystallize has two built-in roles and supports unlimited custom roles.

### Built-in roles

| Role             | Description                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------- |
| **Tenant Admin** | Full access to everything including tenant copying, mass operation logs, and all settings |
| **User**         | Base role with minimal permissions — typically used as starting point for custom roles    |

### Custom roles

Create custom roles in **Settings → Roles & Permissions**.

Key characteristics:

- **One-to-one mapping** — Each user can only have one role assigned
- **Fully customizable** — Set permissions per feature/resource
- **Granular control** — UI-level hiding/locking, folder-level catalogue access

When inviting users, select which role they should have. If a user needs different permissions, create a new role — you cannot assign multiple roles to one user.

## Field-level permissions

Field-level permissions are configured per **shape resource** in the Roles & Permissions settings.

### How to configure (UI)

1. Go to **Settings → Roles & Permissions**
2. Select or create a role
3. Under **Shapes** resource, click on a specific shape
4. You'll see all components on that shape
5. For each component, toggle:
    - **Read-Only** — Field appears greyed out, cannot be edited
    - **Hide Component Completely** — Field is invisible to this role

### Supported fields

- **Root-level components** on shapes
- **Structural components** (contentChunk, componentChoice, etc.)
- **Native Crystallize fields** — SKUs, images, variants
- **Price variants** — Configure in the Price Variants resource (same pattern as shapes)

### Behavior

| Permission                   | Crystallize UI          | API behavior               |
| ---------------------------- | ----------------------- | -------------------------- |
| **Read-Only**                | Greyed out, cannot edit | Can only read field values |
| **Hidden**                   | Completely invisible    | Field is not accessible    |
| **Default (no restriction)** | Editable                | Full read/write access     |

**Important:** UI permissions (hide/lock) only apply to the Crystallize UI, **not** the API level. Use API-level CRUD restrictions for API access control.

## Resource permissions

Almost every feature in Crystallize has **CRUD operation resources** (Create, Read, Update, Delete).

### Common resources

- **Shapes** — Control shape management and field-level permissions
- **Items** — Control item creation, editing, publishing
- **Price Variants** — Control which price variants a role can see/edit
- **Catalogue** — Restrict access to specific folders (e.g., User X can only edit folder Y)
- **Topics** — Control topic map management
- **Orders** — Control order visibility and management
- **Users** — Control user/team management

### Folder-level restrictions

Restrict catalogue access to specific folders per role:

- User can only **see** certain folders
- User can only **edit** certain folders
- Combine with other permissions for granular control

## UI vs API permissions

| Permission type      | Scope               | Use case                                       |
| -------------------- | ------------------- | ---------------------------------------------- |
| **UI permissions**   | Crystallize UI only | Hide/lock fields from editors, simplify UI     |
| **CRUD permissions** | API + UI            | Control actual data access (read/write/delete) |

**Example:** You can hide a "price" field in the UI but still allow API access — useful when editors shouldn't manually change prices that are synced from an ERP.

## Access tokens

Crystallize has two types of tokens:

### User tokens

- **Follow user role permissions** — Same API access as the role assigned to the user
- **API-level only** — UI preferences are not included
- **Use case** — Programmatic access with the same permissions as a specific user role

### API tokens

- **Tenant-level** — Created for the entire tenant, not bound to a specific role
- **Use case** — Service-to-service integrations, webhooks, background jobs, ERP syncs

Generate tokens in **Settings → Access Tokens**.

**Choosing between token types:** Use user tokens when you want API access scoped to a role's permissions. Use API tokens for service integrations that need tenant-wide access regardless of any specific role.

## API configuration

Permissions can be queried and configured via the **Core API** under the `user` resource in the GraphQL schema. Permissions are a **separate resource** from shapes — you won't see permission settings when querying shapes.

### Query role permissions

```graphql
query GetRoles {
    user {
        roles {
            id
            name
            tenantPermissions
        }
    }
}
```

### Query a specific role

```graphql
query GetRole($roleId: ID!) {
    user {
        role(id: $roleId) {
            id
            name
            tenantPermissions
        }
    }
}
```

### Create a custom role

```graphql
mutation CreateRole {
    user {
        role {
            create(input: { name: "Content Editor" }) {
                id
                name
            }
        }
    }
}
```

### Update role permissions

```graphql
mutation UpdateRole($roleId: ID!) {
  user {
    role {
      update(
        id: $roleId
        input: {
          name: "Content Editor"
          tenantPermissions: {
            # Set CRUD permissions per resource
          }
        }
      ) {
        id
        name
      }
    }
  }
}
```

For the exact permission structure and available fields, check the Core API schema — the `tenantPermissions` input type defines all configurable resources and their CRUD flags.

## Best practices

1. **Start with User role** — Create custom roles based on the base User role, then add permissions as needed
2. **Always set both UI + CRUD** — UI restrictions alone don't protect data at the API level
3. **One role per user type** — Can't assign multiple roles, so create distinct roles (e.g., "Content Editor", "Product Manager", "External Contributor")
4. **Test with non-admin account** — Always verify permissions work as expected from a non-admin user perspective
5. **Name roles descriptively** — e.g., "Content Editor - Blog Only", "Product Manager - Catalogue Admin"
6. **Use folder restrictions for multi-team setups** — Isolate catalogue access by team or department
7. **Separate human and machine access** — Use role-scoped user tokens for human workflows, tenant-level API tokens for integrations

## Common use cases

### Read-only ERP fields

Scenario: Prices are synced from an ERP — editors shouldn't manually change them.

Solution:

1. Create "Editor" role
2. In Shapes → Product shape → price component → set **Read-Only** (UI)
3. Editors can see prices but cannot edit them in the dashboard
4. ERP integration uses an API token with full write access

### Hide internal metadata

Scenario: Migration tracking fields should be invisible to content editors.

Solution:

1. Create "Content Editor" role
2. In Shapes → [Your Shape] → migration-metadata component → **Hide Component Completely**
3. Only admins can see these fields

### Folder-restricted access

Scenario: Team A manages products in `/shop/electronics`, Team B manages `/shop/fashion`.

Solution:

1. Create "Team A Editor" role → Catalogue folder restriction → `/shop/electronics`
2. Create "Team B Editor" role → Catalogue folder restriction → `/shop/fashion`
3. Each team can only see and edit their assigned folder

### API-only integration with limited scope

Scenario: A storefront needs read-only access to products but should never modify data.

Solution:

1. Create "Storefront Reader" role with read-only CRUD permissions on Items, Shapes, Topics
2. Generate a user token scoped to this role
3. Use this token in the storefront's API calls — even if compromised, it can't write data

## References

- [Official docs — User roles](https://crystallize.com/docs/guides/user-roles)
- [Official docs — Access tokens](https://crystallize.com/docs/guides/access-tokens)
