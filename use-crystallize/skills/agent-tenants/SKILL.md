---
name: agent-tenants
description: >
    Get a Crystallize tenant as an AI agent, for a user who has no Crystallize account, and hand it over
    to them before it expires. Use when the user has no tenant or no access token and wants the agent to
    set one up, asks for a sandbox or demo tenant, or wants an agent-made tenant handed over, claimed or
    kept. Trigger on "create a tenant", "new tenant", "set up Crystallize for me", "I don't have a
    Crystallize account", "sign up", "provision", "agent tenant", "/agents/tenants", "hand over the
    tenant", "claim the tenant", "invite me", "createInviteToken", "tenantAdmin", "get-access", "tenant
    expires", "tenant deleted".
metadata:
    author: Crystallize
    version: "1.0"
---

# Crystallize Agent Tenants

An agent with no Crystallize account gets a working tenant and an access token from **one unauthenticated
HTTP call**. It builds in the tenant with the normal APIs, then hands it to a human through an ordinary
`tenantAdmin` invite. **A tenant no human joins is deleted 72 hours after it was provisioned**, with
everything in it.

So the user does not sign up first, and does not create an access token for you. You provision, build, and
send them one link.

## Before you provision

- **The user already has a tenant?** Use it: ask for its identifier and an access token. Do not provision.
- **You already provisioned one for this project?** Reuse it (read it back from where you stored it in step 1),
  unless its `expiresAt` has passed with no human on it: then it is gone, and you provision again. Every call
  makes a new tenant, a new agent user and a new token, and an unused one lingers until it expires.
- Otherwise, tell the user in one line what is about to happen: a tenant named after their project is
  created now, and deleted in 72 hours unless they open the invite link you will give them.

## The flow

```text
1  Provision   POST /agents/tenants, no auth           → tenant, access token, expiresAt, apiUrl
2  Build       Core API at apiUrl with that token      → shapes, items, everything else
3  Invite      createInviteToken(role: "tenantAdmin")  → invite token
4  Hand off    the App's /get-access?token=… link      → the human joins as tenantAdmin
5  Check       the tenant's members on the PIM API     → a human tenantAdmin = claimed
```

Only step 1 is specific to agents. Steps 2 to 5 are the API a human tenant admin already uses.

| Used for                  | Host                                  |
| ------------------------- | ------------------------------------- |
| Provisioning and Core API | `https://api.crystallize.com`         |
| App (the invite link)     | `https://app.crystallize.com`         |
| PIM API (members)         | `https://pim.crystallize.com/graphql` |

## 1 · Provision

```bash
curl -s -X POST https://api.crystallize.com/agents/tenants \
  -H 'content-type: application/json' \
  -d '{"name":"Acme Coffee","identifier":"acme-coffee","source":"claude-code"}'
```

| Field        | Required | Rules                                                                                                                                                                    |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`       | yes      | String, 1 to 100 characters once trimmed. The tenant's display name.                                                                                                     |
| `identifier` | no       | String, 1 to 100 characters. Lowercased; anything outside `a-z 0-9 -` becomes `-`. Without it (or if nothing usable remains) it comes from `name`, else `agent-<8 hex>`. |
| `source`     | no       | String, 1 to 100 characters. Who is provisioning (`claude-code`, `cursor`). Shown as the agent user's name.                                                              |

Any other key is ignored, `omitDefaultShapes` included. Values that are not plain strings are refused with 400.

Response, `201 Created`:

```json
{
    "tenant": { "id": "6adbb89b790dd26b73debb6b", "identifier": "acme-coffee", "name": "Acme Coffee" },
    "accessToken": { "id": "5a495b4547e21721ecca", "secret": "<shown once>" },
    "expiresAt": "2026-10-26T19:42:19.887Z",
    "apiUrl": "https://api.crystallize.com/@acme-coffee"
}
```

- **Store all of it now.** The secret is returned this once and cannot be read again: lose it and you lose the
  tenant. Write the values where the project keeps secrets, never in a commit: a `.env` that `.gitignore` lists
  (add the line if it is missing).

    ```bash
    CRYSTALLIZE_TENANT_ID=6adbb89b790dd26b73debb6b
    CRYSTALLIZE_TENANT_IDENTIFIER=acme-coffee
    CRYSTALLIZE_API_URL=https://api.crystallize.com/@acme-coffee
    CRYSTALLIZE_ACCESS_TOKEN_ID=5a495b4547e21721ecca
    CRYSTALLIZE_ACCESS_TOKEN_SECRET=<secret>
    CRYSTALLIZE_TENANT_EXPIRES_AT=2026-10-26T19:42:19.887Z
    ```

- **Use the returned `identifier`**, not the one you sent. When the wanted one is taken, a number from 1 to
  200 is appended (`acme-coffee-37`).
- **`apiUrl` is the tenant's Core API endpoint.** Every call in steps 2 and 3 goes there.
- **`expiresAt` is 72 hours after provisioning.** The invite in step 3 must expire no later than this.

## 2 · Build with the token

You are a tenant admin like any other: every Core API call goes to `apiUrl` with the two token headers.
Nothing about an agent tenant is special.

```bash
curl -s "$CRYSTALLIZE_API_URL" \
  -H 'content-type: application/json' \
  -H "X-Crystallize-Access-Token-Id: $CRYSTALLIZE_ACCESS_TOKEN_ID" \
  -H "X-Crystallize-Access-Token-Secret: $CRYSTALLIZE_ACCESS_TOKEN_SECRET" \
  -d '{"query":"{ shapes { edges { node { identifier name type } } } }"}'
# → { "data": { "shapes": { "edges": null } } }
```

The tenant starts with **no shapes**. It does have a VAT type, a stock location, a price variant and a
catalogue root, like any new tenant. So the first build step is usually a shape. Mutations return a union:
the type on success, or an error implementing `BasicError`, so always select both.

```graphql
mutation {
    createShape(
        input: {
            identifier: "coffee"
            name: "Coffee"
            type: product
            components: [
                { id: "origin", name: "Origin", type: singleLine }
                { id: "tasting-notes", name: "Tasting notes", type: richText }
            ]
        }
    ) {
        __typename
        ... on Shape {
            identifier
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

From here on, the other Crystallize skills apply unchanged with this token: [[content-model]] to design
shapes, [[mutation]] and [[query]] for the Core API, and [[js-api-client]] in code (`tenantIdentifier` is the
returned identifier).

**Prefer one mass operations file over a string of one-off mutations** for anything beyond a first shape.
Put the shapes, pieces, folders and items in a [[mass-operations]] file and run it on the tenant with the same
token. Until a human claims it, the tenant is disposable. With the file kept in the project, a tenant that
expires unclaimed, or a build the user wants redone, is one new tenant and one replay away.

## 3 · Create the claim invite

The claim is an ordinary invite: a `tenantAdmin` invite token on the tenant, created with the same token.
Pass the tenant's `expiresAt` as the invite's `expiresAt`.

```bash
curl -s "$CRYSTALLIZE_API_URL" \
  -H 'content-type: application/json' \
  -H "X-Crystallize-Access-Token-Id: $CRYSTALLIZE_ACCESS_TOKEN_ID" \
  -H "X-Crystallize-Access-Token-Secret: $CRYSTALLIZE_ACCESS_TOKEN_SECRET" \
  -d @- <<'EOF'
{
  "query": "mutation Invite($expiresAt: DateTime) { createInviteToken(role: \"tenantAdmin\", expiresAt: $expiresAt) { __typename ... on InviteToken { id token expiresAt } ... on BasicError { errorName message } } }",
  "variables": { "expiresAt": "2026-10-26T19:42:19.887Z" }
}
EOF
# → { "data": { "createInviteToken": { "__typename": "InviteToken", "id": "…", "token": "<invite token>", "expiresAt": "…" } } }
```

- **The claim invite's role must be `tenantAdmin`**, for whoever will own the tenant: the user, or someone they
  name. Only a human `tenantAdmin` claims the tenant. An invite with any other role lets a human in and keeps the
  tenant from deletion, but does not claim it: send one on top of the admin invite, never instead of it.
- **`expiresAt` is optional in the schema; send it anyway**, no later than the tenant's. An invite that
  outlives the tenant is useless. A date in the past is accepted and gives a dead link: if a human has kept the
  tenant past its deadline, send a future date.
- **Errors come back in the result, not as HTTP errors.** An unknown role gives `RoleNotFoundError` instead of
  `InviteToken`.
- **An invite works once.** A second human needs a second invite, and a used link only shows an "already
  redeemed" error. You can create a new invite at any time, for instance when one has expired or been used.

## 4 · Hand the invite to the human

```text
https://app.crystallize.com/get-access?token=<invite token>
```

The human opens it, signs in or signs up, and joins the tenant as `tenantAdmin`. **You cannot redeem it for
them**: invite redemption is refused to agent users. Whoever opens the link becomes `tenantAdmin`, so give it
only to the person who will own the tenant, and keep it out of commits.

Always give the deadline with the link, as a date and time (the user's time zone if you know it, else UTC):

> Your Crystallize tenant **Acme Coffee** (`acme-coffee`) is ready. Open this link to sign in and take it over:
> https://app.crystallize.com/get-access?token=…
> Open it before **Monday 26 October 2026, 19:42 UTC**. If no one has joined by then, the tenant and everything
> in it is deleted.

If the user cannot open it in time, someone they name can open a `tenantAdmin` link instead and claim the tenant.

What happens next needs no call from you:

1. The App redeems the token (`redeemInviteToken`) and the human becomes `tenantAdmin` on the tenant.
2. At the next cleanup run, within 2 hours, Crystallize sees a human `tenantAdmin` and the tenant is claimed:
   from then on it can never be removed automatically.
3. The human is subscribed to the newsletter under the usual signup rules.

## 5 · Check whether the human joined (optional)

The claim happens whether or not you check. Check when the user says they have joined, so you can confirm it
worked; do not poll on a loop. The Core API has no user queries and no API reads an invite back, so the
tenant's members on the PIM API are the signal. Same two token headers:

```graphql
query Members($id: ID!) {
    tenant {
        get(id: $id) {
            users {
                role
                user {
                    id
                    firstName
                    lastName
                    email
                    kind
                }
            }
        }
    }
}
```

Variables: `{ "id": "6adbb89b790dd26b73debb6b" }` (the `tenant.id` from step 1). Before the human joins, the
only member is the agent: `role: "tenantAdmin"`, `firstName: "Agent"`, `email: null`, `kind: "agent"`. Once
they join, a second member appears with `role: "tenantAdmin"` and `kind: "human"`, with their name and email.

## Rules

| Topic               | Rule                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifetime            | `expiresAt` = provisioning + 72 h. A cleanup runs every 2 hours, so an unclaimed tenant goes between 72 h and about 74 h later, with all its content, the agent user and its token. |
| What keeps a tenant | Any human with a role on it. A human `tenantAdmin` claims it for good. A human with a lesser role keeps it from deletion but does not claim it: it waits for a human admin.         |
| Promoting a human   | Promoting a lesser-role human to `tenantAdmin` claims the tenant: `setUserRole(userId: "<id from step 5>", role: "tenantAdmin")` on the Core API, or the user list in the App.      |
| Nothing else        | No call extends the 72 hours. Only a human joining keeps the tenant.                                                                                                                |
| After the claim     | The agent stays `tenantAdmin` and its token keeps working. The human can remove the agent user in the App; the cleanup then deletes it and its tokens.                              |
| One tenant per call | An agent cannot create tenants any other way (`createTenant` on `/@me`, PIM `tenant.create`), copy a tenant, or redeem invites. Another tenant is another `POST /agents/tenants`.   |
| The agent user      | Named `Agent <source>`, no email, and no one can log in as it. It acts only through its token, which works on its own tenant only.                                                  |
| Rate limit          | Provisioning has its own limit, per IP and across all callers, on top of the per-IP limit on every call (429). On a shared cloud IP you can hit it with few calls of your own.      |

## Errors

Provisioning answers plain HTTP errors with a JSON body, `{ "message": "…", "statusCode": 400 }`. Authenticated
GraphQL calls answer HTTP 200 with the error inside the result union (`__typename`, `errorName`, `message`).

| Call                                                                   | Status | Message                                                                | What to do                                                                                    |
| ---------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Provision                                                              | 400    | `The body must be a JSON object.`                                      | Send a JSON object with `content-type: application/json`.                                     |
| Provision                                                              | 400    | `name is required and must be a string of 1 to 100 characters.`        | Fix `name`. An object or a number in `name` gets the same answer.                             |
| Provision                                                              | 400    | `identifier must be a string of 1 to 100 characters.`                  | Fix or drop `identifier`.                                                                     |
| Provision                                                              | 400    | `source must be a string of 1 to 100 characters.`                      | Fix or drop `source`.                                                                         |
| Provision                                                              | 409    | `That tenant identifier was just taken. Please retry.`                 | Retry the same call once: a new identifier is picked. Nothing was created.                    |
| Provision                                                              | 500    | `Provisioning failed (trace <id>).`                                    | Retry later; give the trace id to Crystallize support if it repeats. Half-created is cleaned. |
| Provision                                                              | 503    | `Crystallize cannot provision more agent tenants right now. …`         | At capacity. Retry later, or have the user create a tenant and give you an access token.      |
| Provision                                                              | 404    | none                                                                   | The endpoint is not deployed on that host. Tell the user.                                     |
| Any                                                                    | 429    | none                                                                   | Too many requests. Provisioning is also limited across all callers: wait minutes, then retry. |
| Any call, once the tenant is deleted                                   | 403    | `Invalid access token pair provided`                                   | The tenant, its agent user and its token are gone. Provision again and replay your build.     |
| `createInviteToken`                                                    | 200    | `RoleNotFoundError`: `Role not found: <role> (tenant id <id>)`         | The claim invite takes `tenantAdmin`; any other role must exist on the tenant.                |
| Agent-forbidden: `/@me` `createTenant`, invite redemption, tenant copy | 200    | `UnauthorizedError`: `This operation is not available to agent users.` | Do not retry. Create tenants with step 1 only, and let humans redeem invites.                 |

## Common mistakes

| Mistake                                                     | What happens                                                      | Instead                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Sending the user to sign up and create an access token      | The friction this endpoint removes                                | Provision, build, then send one invite link                                    |
| Not storing the secret right away                           | The tenant is unreachable: the secret cannot be read again        | Write every value to the project's secrets in step 1                           |
| Calling `/@<the identifier you sent>`                       | The calls fail when the identifier was taken and got a suffix     | Use the returned `identifier` and `apiUrl`                                     |
| Provisioning again to start over while the tenant is alive  | A second tenant, agent user and token; the first lingers for 72 h | Fix or recreate the shapes in the tenant you have                              |
| Building only with one-off mutations                        | An expired tenant takes the whole build with it                   | Keep the build as a mass operations file and replay it into a new tenant       |
| Sending only an invite with another role                    | The human gets in and keeps the tenant, but it is not claimed     | Always create a `tenantAdmin` invite for whoever will own it; others go on top |
| An invite with no `expiresAt`, or one past the tenant's     | A link that still looks valid after the tenant is gone            | Pass the tenant's `expiresAt`                                                  |
| Giving the link without the deadline                        | The user opens it on day four and finds nothing                   | Always state the date and time with the link                                   |
| Saying "it's yours, nothing to transfer" after provisioning | The user never opens the invite, and the tenant is deleted        | The tenant is the agent's until a human `tenantAdmin` joins                    |

Related: [[permissions]] for roles and access tokens once the human owns the tenant.
