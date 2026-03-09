---
name: permissions
description: Manage user roles, permissions, and access control in Crystallize. Use when configuring field-level permissions (read-only or hidden fields for specific roles), managing user roles and team access, setting up access tokens with specific scopes, or controlling who can view/edit specific content areas or component fields.
metadata:
  author: Crystallize
  version: "1.0"
---

# Crystallize permissions and access control

Guide for managing user roles, field-level permissions, and access tokens in Crystallize.

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

| Role | Description |
|------|-------------|
| **Tenant Admin** | Full access to everything including tenant copying, mass operation logs, and all settings |
| **User** | Base role with minimal permissions — typically used as starting point for custom roles |

### Custom roles

Create custom roles in **Settings → Roles & Permissions**.

Key characteristics:
- **One-to-one mapping** — Each user can only have one role assigned
- **Fully customizable** — Set permissions per feature/resource
- **Granular control** — UI-level hiding/locking, folder-level catalogue access

When inviting users, select which role they should have. If a user needs different permissions, create a new role.

## Field-level permissions

Field-level permissions are configured per **shape resource** in the Roles & Permissions settings.

### How to configure

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

| Permission | Crystallize UI | API behavior |
|------------|---------------|--------------|
| **Read-Only** | Greyed out, cannot edit | Can only read field values |
| **Hidden** | Completely invisible | Field is not accessible |
| **Default (no restriction)** | Editable | Full read/write access |

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

| Permission type | Scope | Use case |
|----------------|-------|----------|
| **UI permissions** | Crystallize UI only | Hide/lock fields from editors, simplify UI |
| **CRUD permissions** | API + UI | Control actual data access (read/write/delete) |

**Example:** You can hide a "price" field in the UI but still allow API access — useful when editors shouldn't manually change prices that are synced from an ERP.

## Access tokens

Crystallize has two types of tokens:

### User tokens

- **Follow user role permissions** — Same API access as the role assigned to the user
- **API-level only** — UI preferences are not included
- **Use case** — Programmatic access with the same permissions as a specific user role

### API tokens

- **Tenant-level** — Created for the entire tenant
- **Use case** — Service-to-service integrations, webhooks, background jobs

Generate tokens in **Settings → Access Tokens**.

## API configuration

Field-level permissions can be configured via the **Core Next GraphQL API**.

### Query permissions

Permissions are a **separate resource** from shapes — you won't see permission settings when querying shapes.

To read permissions:

```graphql
query GetRolePermissions($roleId: ID!) {
  user {
    role(id: $roleId) {
      id
      name
      permissions {
        # Permission structure
      }
    }
  }
}
```

### Set permissions

Use mutations from the Core API. Check the generated types from `@graphql-codegen/cli` against the Core API for the exact mutation structure.

**Note:** Permission configuration is under the `user` resource in the GraphQL schema.

## Best practices

1. **Start with User role** — Create custom roles based on the base User role
2. **UI + API permissions** — Set both UI restrictions (hide/lock) and CRUD restrictions for full control
3. **One role per user type** — Can't assign multiple roles, so create distinct roles for each user type (Editor, Contributor, etc.)
4. **Test with non-admin account** — Always verify permissions work as expected from a non-admin user perspective
5. **Document role purposes** — Name roles clearly (e.g., "Content Editor - Blog Only", "Product Manager - Catalogue Admin")
6. **Folder-based access** — Use catalogue folder restrictions for multi-team tenants

## Common use cases

### Read-only ERP fields

Scenario: Prices are synced from an ERP — editors shouldn't manually change them.

Solution:
1. Create "Editor" role
2. In Shapes → Product shape → price component → set **Read-Only**
3. Editors can see prices but cannot edit them
4. ERP integration uses API token with full write access

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

## References

- [Official docs — User roles](https://crystallize.com/docs/guides/user-roles)
- [Official docs — Access tokens](https://crystallize.com/docs/guides/access-tokens)
