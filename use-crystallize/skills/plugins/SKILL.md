---
name: plugins
description: >
    How to build Crystallize Plugins — vendor-hosted apps that extend the Crystallize App UI via iframes.
    Use when the user wants to create, register, install, or develop a Crystallize plugin: scaffolding the
    upstream server, generating the plugin keypair, writing the configuration schema (JSON Schema), declaring
    entrypoints / placements / scopes, handling the post-installation webhook, decrypting the iframe payload
    and Backend Token, encrypting installation secrets, or testing a plugin locally with `issuePluginPayload`.
    Also use when the user mentions plugins, plugin revisions, plugin store, plugin installations, plugin
    payload, or plugin permissions.
metadata:
    author: Crystallize
    version: "1.0"
---

# Crystallize Plugins

A Crystallize Plugin is a **vendor-hosted application** that extends the Crystallize App UI inside iframes at predefined placement points. Plugins do **not** run code in the App UI itself — they receive a scoped **Backend Token** to act on behalf of the signed-in user via Crystallize APIs, and any secrets they need are encrypted client-side with the vendor's own public key.

The full normative contract — entities, fields, JWE/JWT specs, request shapes, sequence diagrams — lives in [references/plugin-contract.md](references/plugin-contract.md). This SKILL.md is the **builder's guide**: how to ship a plugin end-to-end. Read the contract when a field, security guarantee, or wire format is in question.

## Consultation Approach

Before writing code, get the lay of the land:

1. **What does the plugin do?** Pure UI widget, server-side action on a Crystallize entity (order, customer…), or tenant-wide dashboard? This drives the entrypoint **placements**.
2. **Does it need to call Crystallize APIs?** If yes, you'll use the `backendToken` from the decrypted payload as a `Bearer` credential.
3. **Does it need secrets?** API keys, webhook URLs, third-party credentials — these go in `secrets[]` and are encrypted in the installer's browser. Crystallize never sees plaintext.
4. **Where does it run?** Plugins are server-hosted (Cloudflare Worker, Vercel/Netlify edge, Lambda, plain Node/Bun server). Pure static hosting is **not** sufficient — the upstream must accept POST requests and decrypt JWE payloads.
5. **Which tenant(s)?** Plugins are installed per-tenant. One plugin can be installed on many tenants, each with its own configuration.

## Architecture in 30 Seconds

Three entities (full detail in the contract):

| Entity                  | Where it lives | Purpose                                                                               |
| ----------------------- | -------------- | ------------------------------------------------------------------------------------- |
| **Plugin**              | `/@me`         | The plugin definition (name, identifier, logo). Has a `state`: `pending` → `active`.  |
| **Plugin Revision**     | `/@me`         | The locked **contract surface**: upstream, entrypoints, scopes, schema, secrets, key. |
| **Plugin Installation** | `/@:tenant`    | A `(tenant, plugin, revision)` triple with the tenant-specific config + ciphertexts.  |

Key invariants:

- A revision is **immutable** once submitted. Code at `upstream` can change anytime; only **contract changes** require a new revision.
- Installations **pin** a `revisionId` and never auto-migrate. Re-install to upgrade.
- Crystallize **never holds plaintext secrets**. The installer's browser encrypts them with the revision's `publicKey`; only the vendor can decrypt.

## End-to-End Workflow

### 1. Generate the keypair

The vendor needs an RSA key (RSA-OAEP-256 / A256GCM, JWE compact). Use the Crystallize CLI:

```bash
crystallize plugin keygen
```

This emits a `private.jwk.json` and a `public.jwk.json`. **Keep `private.jwk.json` on the server only**; the public key goes into the revision.

### 2. Register the plugin

Run on the Me API (`https://api.crystallize.com/@me`):

```graphql
mutation {
    createPlugin(
        input: {
            author: "Acme"
            description: "Order preview plugin"
            icon: "https://acme.com/icon.png"
            identifier: "com.acme.order-preview" # reverse-DNS, immutable
            logo: "https://acme.com/logo.png"
            name: "Acme Order Preview"
        }
    ) {
        ... on BasicError {
            message
        }
        ... on Plugin {
            identifier
        }
    }
}
```

The plugin starts in `pending` state — it can't be installed until approved.

### 3. Create the first revision

The revision is the **contract** the installer will see and consent to. Locked once submitted.

```graphql
mutation CREATE_PLUGIN_REVISION($input: CreatePluginRevisionInput!) {
    createPluginRevision(identifier: "com.acme.order-preview", input: $input) {
        ... on BasicError {
            message
        }
        ... on PluginRevision {
            id
            version
        }
    }
}
```

Variables (the `$input`):

```json
{
    "input": {
        "version": "1.0.0",
        "upstream": "https://plugin.acme.com",
        "postInstallationUri": "/post-install",
        "scopes": [],
        "entryPoints": [
            {
                "placement": "order/view/toolbar-button",
                "target": "/order/preview",
                "label": "Preview Order",
                "icon": "https://acme.com/btn.png"
            }
        ],
        "configurationSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "additionalProperties": false,
            "required": ["apiKey"],
            "properties": {
                "apiKey": { "type": "string", "title": "Stripe API Key" },
                "theme": { "type": "string", "enum": ["light", "dark"] }
            }
        },
        "secrets": ["apiKey"],
        "publicKey": {
            "kty": "RSA",
            "kid": "public",
            "use": "enc",
            "alg": "RSA-OAEP-256",
            "enc": "A256GCM",
            "n": "<modulus from public.jwk.json>",
            "e": "AQAB"
        }
    }
}
```

#### Field cheat sheet

| Field                 | Notes                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `upstream`            | Base HTTPS URL of your origin. Crystallize POSTs to `$upstream/$tenantIdentifier/$path`.                                                   |
| `entryPoints[]`       | Each: `placement` (`$concern/$view/$placement(/$type?)`), `target` (path under upstream), optional `label` + `icon`.                       |
| `scopes`              | Permissions the plugin needs. Installer must hold them; can grant a subset. (V1: not yet enforced on the token — declare honestly anyway.) |
| `configurationSchema` | JSON Schema **draft 2020-12**. Crystallize renders this as the install form. Validates submissions (with secret fields excluded).          |
| `secrets`             | Names of properties from the schema to treat as secrets. Each becomes `<input type="password">` and is JWE-encrypted in the browser.       |
| `publicKey`           | JWK from `crystallize plugin keygen`. Must be `kty=RSA`, `use=enc`, `alg=RSA-OAEP-256`, `enc=A256GCM`.                                     |
| `postInstallationUri` | Path Crystallize POSTs to on install / reinstall / uninstall events. **Fire-and-forget, no retries** — make your handler idempotent.       |
| `version`             | Vendor-declared semver. Cosmetic — does not drive any Crystallize behavior.                                                                |

See the contract's [Entrypoints](references/plugin-contract.md) section for the full placement convention and the `dashboard` (non-entity-scoped) variant.

### 4. Get approval

Plugins must be approved before installation. Query state:

```graphql
query {
    plugin(identifier: "com.acme.order-preview") {
        ... on Plugin {
            state
            approvedRevision {
                id
            }
            name
        }
    }
}
```

Contact Crystallize on Slack to move it from `pending` → `active`. Once approved, `approvedRevision.id` is populated and the plugin appears in the Plugin Store.

### 5. Install on a tenant

Either via the App UI (renders the schema, encrypts secrets in the browser) or via the API. For API installs, you must encrypt secrets yourself:

```bash
crystallize plugin encrypt-secret --public-key /path/to/public.jwk.json
# paste the plaintext secret; outputs a JWE compact string
```

Then call (on `https://api.crystallize.com/@<tenant>`):

```graphql
mutation {
    createPluginInstallation(
        input: {
            pluginIdentifier: "com.acme.order-preview"
            revisionId: "<revisionId>"
            grantedScopes: []
            configuration: { theme: "dark" } # non-secret fields
            encryptedSecrets: { apiKey: "<JWE compact string>" } # one entry per secret
        }
    ) {
        ... on BasicError {
            message
        }
        ... on PluginInstallation {
            id
        }
    }
}
```

On install, Crystallize POSTs the post-install body to `$upstream/$tenantIdentifier/$postInstallationUri`. See **Develop the upstream** below.

## Develop the Upstream

The upstream is your server. Two endpoint shapes to handle:

- **Post-install webhook** (`$postInstallationUri`) — body is the raw outer JWE.
- **Entrypoints** (`$target`) — POST with form-encoded body `payload=<JWE>`.

Both decrypt to the same plaintext shape (with different fields populated). Use `createPluginPayloadDecrypter` from `@crystallize/js-api-client`.

### Decrypter setup

```ts
import { createPluginPayloadDecrypter } from "@crystallize/js-api-client";

const decrypter = createPluginPayloadDecrypter({
    privateJwk: JSON.parse(process.env.PLUGIN_PRIVATE_JWK!),
    verify: {
        audience: process.env.PLUGIN_IDENTIFIER!, // matches `aud` in the Backend Token
        verifyBackendToken: true, // verifies RS256 via Crystallize JWKS
    },
});
```

Always read the private JWK from a secret env var — never commit it.

### Post-install handler

```ts
app.post("/:tenantIdentifier/post-install", async (c) => {
    const tenantIdentifier = c.req.param("tenantIdentifier");
    try {
        const payload = await c.req.text(); // raw JWE compact body
        const decoded = await decrypter(payload);
        if (decoded.envelope?.tenantIdentifier !== tenantIdentifier) {
            return c.text("tenant mismatch", 403); // path tenant must match payload tenant
        }
        // decoded.envelope.event is "install" | "reinstall" | "uninstall"
        // decoded.envelope.config + encryptedSecrets carry installation state
        // Persist tenant-scoped state. Handler MUST be idempotent — no retries.
        return c.text("ok");
    } catch {
        return c.text("bad payload", 400);
    }
});
```

### Entrypoint handler

```ts
import { createClient } from "@crystallize/js-api-client";

app.post("/:tenantIdentifier/order/preview", async (c) => {
    const tenantIdentifier = c.req.param("tenantIdentifier");
    try {
        const body = await c.req.parseBody(); // form-encoded
        if (typeof body?.payload !== "string")
            return c.text("invalid body", 400);

        const decoded = await decrypter(body.payload);
        if (decoded.envelope?.tenantIdentifier !== tenantIdentifier) {
            return c.text("tenant mismatch", 403);
        }

        // Call Crystallize APIs on behalf of the viewer
        const api = createClient({
            tenantIdentifier,
            bearerToken: decoded.envelope.backendToken,
        });
        const data = await api.nextPimApi<{
            tenant: { id: string; name: string };
        }>("{ tenant { ... on Tenant { id name } } }");

        return c.html(renderPage(decoded, data));
    } catch (err) {
        console.error(err);
        return c.text("bad payload", 400);
    }
});
```

### Decoded payload shape

The `decrypter` returns a structured object:

| Field                       | Description                                                                      |
| --------------------------- | -------------------------------------------------------------------------------- |
| `envelope.tenantIdentifier` | Always check against the path param.                                             |
| `envelope.installationId`   | Stable across reinstalls of the same `(tenant, plugin)`.                         |
| `envelope.pluginIdentifier` | Sanity-check it's yours.                                                         |
| `envelope.revisionId`       | Which revision this installation is pinned to.                                   |
| `envelope.configuration`    | Non-secret configuration values (plaintext).                                     |
| `envelope.encryptedSecrets` | Per-field JWE compact strings — decrypt on demand with the same private key.     |
| `envelope.entityContext`    | e.g. `{ orderId: "..." }` for entity-scoped placements; omitted for `dashboard`. |
| `envelope.backendToken`     | RS256 JWT — pass as `Authorization: Bearer …` to Crystallize APIs.               |
| `backendToken.verified`     | `true` if the JWKS verification passed (when `verifyBackendToken: true`).        |
| `backendToken.claims`       | Decoded claims (`sub` = userId, `aud` = your plugin identifier, `act = { … }`).  |
| `signature.verified`        | `true` if the outer payload signature checks out.                                |

### Backend Token rules

- TTL: 1 hour. Never cache it across requests — every iframe load mints a fresh one.
- Send as `Authorization: Bearer <jwt>` to any Crystallize API. The server verifies signature + plugin state on every call (the `inactive` kill-switch is **live**, not TTL-bounded).
- The token impersonates the **viewing user**, bounded by their permissions. A plugin cannot escalate privileges.

## Local Testing Without the App UI

You don't need to click through the App UI to exercise an endpoint locally. Crystallize exposes the same payload-issuing mutation directly:

```graphql
mutation {
    issuePluginPayload(
        installationId: "<installationId>"
        entryPointId: "<entryPointId>"
        entityContext: { orderId: 42 } # optional, depends on placement
    ) {
        ... on PluginPayload {
            encryptedPayload
            url
        }
    }
}
```

Then POST it yourself:

```bash
curl -X POST "$URL" \
  --data-urlencode "payload=$ENCRYPTED_PAYLOAD"
```

For the post-install webhook, send the raw JWE as the request body (no form encoding). To re-trigger an install event for testing, re-install the plugin (it's atomic and keeps the same `installationId`).

For local development of the upstream, expose your dev server with a tunnel (e.g. ngrok) and set that URL as the revision's `upstream` — code under `upstream` can change without a new revision.

## Common Mistakes

| Mistake                                                                     | What to do                                                                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Storing `PLUGIN_PRIVATE_JWK` in source control                              | Treat it like any other private key. Env var only, secret manager in production.                            |
| Forgetting to validate `tenantIdentifier` from the path vs payload          | Always compare both. The contract requires the path to match the payload's `tenantIdentifier`.              |
| Trusting `pluginIdentifier` from payload without checking                   | Compare it to your own `PLUGIN_IDENTIFIER`. The decrypter's `audience` check covers the token; do this too. |
| Caching the Backend Token                                                   | Never. It's per-load, 1h TTL, and live-revoked when the plugin goes `inactive`.                             |
| Designing the post-install handler with side effects that aren't idempotent | Webhook is fire-and-forget, **no retries**. Make it idempotent or rely on the next iframe load's payload.   |
| Trying to mutate revision fields after creation                             | A revision is immutable. Create a new revision and re-install to migrate.                                   |
| Putting secrets in plaintext `configurationSchema` properties               | List the property name in the top-level `secrets[]` array. The App UI then encrypts it client-side.         |
| Auto-migrating users to a new revision                                      | Installations pin a `revisionId`. Users must re-install to consent to the new contract.                     |

## Working Example

A minimal Hono-based plugin (post-install + entrypoint, with API call) lives at [`plugins/hello-world` in the Crystallize plugins monorepo](https://github.com/CrystallizeAPI/plugins/tree/main/plugins/hello-world). Mirror that layout (`src/index.ts` for routes, `.env` for `PLUGIN_PRIVATE_JWK` + `PLUGIN_IDENTIFIER`) for any new plugin.

## References

- [Plugin Contract](references/plugin-contract.md) — normative spec: entities, fields, JWE/JWT formats, sequence diagrams, security model, V1 vs V2 behavior.
- [Official documentation](https://crystallize.com/docs/developer/plugins)
- Companion skill: [js-api-client](../js-api-client/SKILL.md) — `createClient`, `createPluginPayloadDecrypter`, all API callers.
- CLI helpers: `crystallize plugin keygen`, `crystallize plugin encrypt-secret --public-key <path>`.
