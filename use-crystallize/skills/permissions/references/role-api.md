# Role API Reference

Queries and mutations for roles, on the **Core API** (`https://api.crystallize.com/@{tenant}`, `nextPimApi` in the JS client). Results are unions, so select `... on Role` and `... on BasicError`. Role calls need `read` or the matching write on the `roles` resource.

## Contents

- [Query role permissions](#query-role-permissions)
- [Query a specific role](#query-a-specific-role)
- [Create a custom role](#create-a-custom-role)
- [Update role permissions](#update-role-permissions)
- [Delete a role](#delete-a-role)
- [Set UI preferences](#set-ui-preferences)
- [Assign a role](#assign-a-role)

## Query role permissions

`roles` lists the tenant's custom roles.

```graphql
query GetRoles($first: Int, $after: String) {
    roles(first: $first, after: $after) {
        ... on RoleConnection {
            pageInfo {
                hasNextPage
                endCursor
            }
            edges {
                node {
                    identifier
                    name
                    userCount
                }
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

## Query a specific role

```graphql
query GetRole($identifier: String!) {
    role(identifier: $identifier) {
        ... on Role {
            identifier
            name
            userCount
            resources {
                catalogue {
                    read {
                        effect
                        conditions {
                            itemIds
                            languages {
                                code
                            }
                        }
                    }
                }
                shapes {
                    read {
                        effect
                    }
                }
            }
            interfaceSettings {
                shapes {
                    limitedShapes {
                        identifier
                        components {
                            id
                            editable
                        }
                    }
                }
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

To test a role against one item, `resources.catalogue` also has `canRead(itemId, language)`, `canUpdate`, `canDelete`, `canPublish`, `canUnpublish`, and `canCreate(parentItemId, language)`. To read the caller's own role, query `user { ... on User { role(tenantIdentifier: "your-tenant") { identifier } } }` on the Me API.

## Create a custom role

```graphql
mutation CreateRole($input: CreateRoleInput!) {
    createRole(input: $input) {
        ... on Role {
            identifier
            name
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
        "name": "Blog Editor",
        "resources": {
            "catalogue": {
                "read": { "effect": "allow", "conditions": [{ "itemIds": ["<blog-folder-id>"] }] },
                "update": { "effect": "allow", "conditions": [{ "itemIds": ["<blog-folder-id>"] }] },
                "publish": {
                    "effect": "allow",
                    "conditions": [{ "itemIds": ["<blog-folder-id>"], "languages": ["en"] }]
                }
            },
            "shapes": { "read": { "effect": "allow" } },
            "languages": { "read": { "effect": "allow" } },
            "priceVariants": { "read": { "effect": "allow" }, "update": { "effect": "allow" } },
            "subscriptionPlans": { "read": { "effect": "allow" }, "update": { "effect": "allow" } },
            "assets": {
                "read": { "effect": "allow" },
                "create": { "effect": "allow" },
                "update": { "effect": "allow" }
            }
        }
    }
}
```

`resources` is required, even if empty. `identifier` is optional, is generated from `name` and can never change. Reserved identifiers such as `admin`, `tenantAdmin` and `user` are refused, in any case. So `name: "Admin"` fails unless you pass another `identifier`.

## Update role permissions

```graphql
mutation UpdateRole($identifier: String!, $input: UpdateRoleInput!) {
    updateRole(identifier: $identifier, input: $input) {
        ... on Role {
            identifier
            name
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`input` takes `name`, `resources` and `interfaceSettings`, all optional.

**`resources` and `interfaceSettings` are replaced whole, never merged.** Send one resource and every other resource is denied. Read the role first and send all of it.

## Delete a role

`deleteRole(identifier: $identifier)` returns `... on DeleteCount { removed }`. It is refused while a user holds the role, or while the role is the tenant's SAML default.

## Set UI preferences

Prefer these to `updateRole` for field locks: they change one shape and leave the rest of `interfaceSettings` alone.

```graphql
mutation LockFields {
    upsertLimitedShapeToRole(
        identifier: "blog-editor"
        input: {
            limitedShape: {
                identifier: "product"
                components: [{ id: "title", editable: true }, { id: "erp-data", editable: false }]
                productSku: { editable: false }
                externalReferences: { visible: false, editable: false }
            }
        }
    ) {
        ... on Role {
            identifier
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`removeLimitedShapeFromRole(roleIdentifier: "blog-editor", shapeIdentifier: "product")` takes a shape out of the list.

**These lists are allow-lists.** The App's toggles fill them in for you. On the API you must:

- `shapes.limitedShapes` — Absent means all shapes. Once present, only the listed shapes can be used to create items in the App. So the first `upsertLimitedShapeToRole` on a role hides every other shape, unless you upsert them all
- `components`, `variantComponents` — Absent means all editable. Once present, only the listed components show, in that order, and an unlisted one is hidden. To lock one component, list all of them
- `upsertLimitedShapeToRole` replaces the whole entry for that shape
- The same rule holds for `priceVariants.preferredPriceVariants`, `fulfillment.pipelines` and `flows.limitedFlows` with its `limitedFlowStages`. `pipelines[].identifier` takes the pipeline's id

```text
interfaceSettings
  shapes         { hideShapesAnchor, limitedShapes[] }
  priceVariants  { hidePriceVariantsAnchor, preferredPriceVariants[]: { identifier, editable } }
  orders         { hideOrdersAnchor, limitOrdersToPipelines }
  fulfillment    { hideFulfillmentAnchor, pipelines[]: { identifier, editable } }
  flows          { hideFlowsAnchor, limitedFlows[]: { identifier, limitedFlowStages[]: { identifier, canTransitionIn, canTransitionOut } } }

limitedShapes[]
  identifier, components[]: { id, editable }, variantComponents[]: { id, editable }
  itemName, variantName, variantMedia, productSku: { editable }
  productAttributes, externalReferences: { editable, visible }
```

## Assign a role

```graphql
mutation SetRole($userId: ID!, $role: String!) {
    setUserRole(userId: $userId, role: $role) {
        ... on UserTenantRole {
            userId
            role
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`role` is a custom role's identifier or `tenantAdmin`. The call needs `users.update`. The user must already be on the tenant, and you cannot change your own role.

**Promoting to `tenantAdmin` is one-way here.** `setUserRole` on a Tenant Admin succeeds and returns `tenantAdmin` unchanged, so check `role` in the result. To demote, remove the user from the tenant (`tenant { removeUsers(tenantId, userIds) }` on the PIM API, which needs `users.create`) and invite them again. Before promoting, weigh what it brings:

- Every token of theirs that reaches the tenant gains full access to it, and mass operations they created run with it
- An unscoped token gets into the tenant even if it enforces SAML login
- On an agent-made tenant, a human `tenantAdmin` claims the tenant for good, however they got the role: see [agent-tenants](../../agent-tenants/SKILL.md)

To bring someone new onto the tenant, call `createInviteToken(role: "blog-editor", expiresAt: "...")`, which needs `users.create` and returns `... on InviteToken { token }`. They join through the App's `/get-access?token=<token>` link.
