---
name: plugins
description: >
    How to build Crystallize Plugins — vendor-hosted apps that extend the Crystallize App UI via iframes.
    Use when the user wants to create, register, install, or develop a Crystallize plugin: scaffolding the
    upstream server with `crystallize plugin create`, generating the plugin keypair, writing the configuration
    schema (JSON Schema), declaring entrypoints / placements / scopes, private installs before approval,
    reinstalling or upgrading an installation, handling the post-installation webhook, decrypting the iframe
    payload and Backend Token, encrypting installation secrets, talking to the App from the iframe with
    `@crystallize/plugin-signal`, or testing a plugin locally with `issuePluginPayload`.
    Also use when the user mentions Crystallize plugins, plugin revisions, plugin store, marketplace, plugin
    installations, plugin payload, or plugin permissions.
metadata:
    author: Crystallize
    version: "1.0"
---

# Crystallize Plugins

A Crystallize Plugin is a **vendor-hosted application** that extends the Crystallize App UI inside iframes at predefined placement points. Plugins do **not** run code in the App UI itself — they receive a scoped **Backend Token** to act on behalf of the signed-in user via Crystallize APIs, and any secrets they need are encrypted client-side with the vendor's own public key.

The full normative contract — entities, fields, JWE/JWT specs, request shapes, sequence diagrams — lives in [references/plugin-contract.md](references/plugin-contract.md). This SKILL.md is the **builder's guide**: how to ship a plugin end-to-end. Read the contract when a field, security guarantee, or wire format is in question.

## Consultation Approach

Before writing code, get the lay of the land:

1. **What does the plugin do?** Pure UI widget, server-side action on a Crystallize entity (order, catalogue item…), or tenant-wide dashboard? This drives the entrypoint **placements**.
2. **Does it need to call Crystallize APIs?** If yes, you'll use the `backendToken` from the decrypted payload as a `Bearer` credential on the Core and PIM APIs. Other APIs need other credentials: see [Backend Token rules](#backend-token-rules).
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

### 1. Scaffold the upstream and generate the keypair

`crystallize plugin create` downloads a skeleton, generates the keypair, and fills in the plugin name, identifier and keys:

```bash
crystallize plugin create ./my-plugin hono-plugin-skeleton
# headless: add --no-interactive --name "My Plugin" --author "Acme" [--identifier com.acme.my-plugin] [--plugin-url https://plugin.acme.com]
```

Skeletons: `hono-plugin-skeleton`, `cloudflare-hono-plugin-buddy`, `hello-world-plugin`.

To add a keypair to an existing server: the vendor needs an RSA key (RSA-OAEP-256 / A256GCM, JWE compact). Use the Crystallize CLI:

```bash
crystallize plugin keygen
```

This emits a `private.jwk.json` and a `public.jwk.json`. **Keep `private.jwk.json` on the server only**; the public key goes into the revision.

### 2. Register the plugin

Run on the Me API (`https://api.crystallize.com/@me`), or create the plugin in the App under **Settings → Apps**. `/@me` answers 403 to tenant-bound credentials, including access tokens scoped to a tenant.

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

`identifier` is lowercase reverse-DNS with at least three dot-separated segments, each starting with a letter. The CLI is laxer: `com.acme` passes `--identifier` but `createPlugin` rejects it. `logo` and `icon` must be absolute URLs. No mutation updates these fields afterwards.

The plugin starts in `pending` state — until Crystallize approves a revision, only its owner can install it, as a private install (step 5).

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
                "placement": "orders/order/top/inline",
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

| Field                 | Notes                                                                                                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upstream`            | Base HTTPS URL of your origin. `http://`, `localhost`, private IPs and IPv6 literals are rejected. Crystallize POSTs to `$upstream/$tenantIdentifier/$path`.                                                                                                                        |
| `entryPoints[]`       | Each: `placement` (from the [table below](#placements)), `target` (path under upstream, starting with `/`), optional `label` + `icon` (absolute URL).                                                                                                                               |
| `scopes`              | Permissions the plugin needs, as `<resource>:<action>` (`orders:read`, never `order:read`): anything else is rejected. See [Scopes](references/plugin-contract.md#scopes) for the values. Recorded on the installation but not enforced on the token yet — declare honestly anyway. |
| `configurationSchema` | JSON Schema **draft 2020-12**. Crystallize renders this as the install form. Validates submissions (with secret fields excluded). Without a schema, `configuration` must be empty.                                                                                                  |
| `secrets`             | Names of **top-level** properties from the schema to treat as secrets. Each becomes `<input type="password">` and is JWE-encrypted in the browser.                                                                                                                                  |
| `publicKey`           | JWK from `crystallize plugin keygen`. Must be `kty=RSA` with `n` and `e`. Keep the `alg` and `enc` the CLI sets: the API treats them as optional, but the App needs both to encrypt secrets.                                                                                        |
| `postInstallationUri` | Path Crystallize POSTs to on install / reinstall / uninstall events. **Fire-and-forget, no retries** — make your handler idempotent.                                                                                                                                                |
| `version`             | Vendor-declared semver. Cosmetic — does not drive any Crystallize behavior.                                                                                                                                                                                                         |

#### Placements

The API accepts any `placement` string, but the App only renders these. Anything else, such as `order/view/toolbar-button`, is stored without error and never appears.

| Placement                                                                                                                                 | Where the App renders it                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `dashboard/home/top-card`                                                                                                                 | Home dashboard, replacing the default top card                                                             |
| `layout/sidebar-right`                                                                                                                    | Right sidebar, on every page                                                                               |
| `layout/bottom-right/inline`                                                                                                              | Fixed bottom-right bar, on every page                                                                      |
| `orders/order/top/inline`, `orders/order/bottom/inline`                                                                                   | Order detail page                                                                                          |
| `catalogue/item/above-components/inline`, `catalogue/item/below-components/inline`                                                        | Item editor, around the components. Not on archived versions                                               |
| `catalogue/variant/above-components/inline`, `catalogue/variant/below-components/inline`                                                  | Variant editor, around the components. Not on archived versions                                            |
| `catalogue/item/split-view/inline`                                                                                                        | An extra view in the item's view switcher, using the entry point's `label` and `icon`                      |
| `catalogue/folder-nerdy/nerdy-action/all`, `catalogue/folder-nerdy/nerdy-action/products`, `catalogue/folder-nerdy/nerdy-action/variants` | Bulk action in the catalogue data grid and Lightbox, opening a dialog. The suffix is the grid's items type |
| `plugins/page/full`                                                                                                                       | Full page at `/plugins/<identifier>`                                                                       |
| `apps/plugin/content`                                                                                                                     | The plugin's page under Apps, replacing its config page                                                    |

The App renders only the first entry point of a revision for a given placement, so declare each placement once. Users whose role lacks read access to `pluginInstallations` see no plugin UI.

Sizes, entity context and signals per placement are in the contract's [Entrypoints](references/plugin-contract.md#entrypoints) section.

### 4. Get approval

Approval is what lets other tenants install the plugin. To try the plugin on your own tenant first, use a private install (step 5). Query state:

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

Contact Crystallize on Slack to move it from `pending` → `active`: only Crystallize staff can approve a revision. Once approved, `approvedRevision.id` is populated and the plugin can be installed from any tenant. Each later revision needs its own approval. The marketplace page in the App is a separate listing, so ask for it when you request approval: without a listing, an approved plugin can only be installed through the API.

### 5. Install on a tenant

An installation resolves to one of two modes, and the mutation fails unless the matching terms flag is `true`:

| Mode          | Who                                                                   | Revision                                                                 | Required flag               |
| ------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------- |
| `marketplace` | A user with create access to `pluginInstallations`                    | The approved revision of an `active` plugin                              | `acceptMarketplaceTerms`    |
| `private`     | The plugin's owner, holding the tenantAdmin role on the target tenant | The latest revision, when it is not the approved one. Works on `pending` | `acceptPrivateInstallTerms` |

Any other combination is refused, and an `inactive` plugin can't be installed at all. To check first, query `pluginInstallability(identifier: "com.acme.order-preview") { ... on PluginInstallability { mode } }` on the Core API: it returns `marketplace`, `private` or `notInstallable`.

In the App, a marketplace install happens under **Apps** (renders the schema, encrypts secrets in the browser). A private install happens on the plugin's page under **Settings → Apps**, and there you paste the configuration as JSON and the secrets already encrypted. For private installs and API installs, you must encrypt secrets yourself:

```bash
crystallize plugin encrypt-secret --public-key /path/to/public.jwk.json
# paste the plaintext secret, or pass --value / pipe it; outputs a JWE compact string
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
            acceptMarketplaceTerms: true # or acceptPrivateInstallTerms: true
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

`grantedScopes`, `configuration` and `encryptedSecrets` are all required: pass `[]` or `{}` when empty. Every name in the revision's `secrets` needs an entry, even when the schema does not mark it `required`. A missing one fails with `Encrypted secret for "<name>" is not tagged with the target revisionId.` A tenant holds one installation per plugin, so a second `createPluginInstallation` fails: use `reinstallPluginInstallation`.

On install, Crystallize POSTs the post-install body to `$upstream/$tenantIdentifier/$postInstallationUri`. See **Develop the upstream** below.

#### Reinstall, upgrade, uninstall

`reinstallPluginInstallation` takes the same input with `installationId` in place of `pluginIdentifier`. It replaces the revision, scopes, configuration and secrets, and keeps the same `installationId`. The modes and terms flags above apply again, so a private install pinned to a superseded revision can only move to the latest one. `deletePluginInstallation(id:)` uninstalls. See [Re-install and Uninstall](references/plugin-contract.md#re-install-and-uninstall) for both mutations.

Send every secret again, because a blank one is rejected rather than kept. To keep a value, resend its stored `ciphertext`. That only works while the key is unchanged: Crystallize can't tell which key encrypted a ciphertext, so a stale one is accepted, and then `decrypter` throws on every payload of that installation.

## Develop the Upstream

The upstream is your server. Two endpoint shapes to handle — both POST with the same wire format:

- **Post-install webhook** (`$postInstallationUri`) — POST with form-encoded body `payload=<JWE>`.
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

**The decrypter does not reject a forged payload.** It only throws when a payload can't be decrypted. A bad or expired signature still returns the envelope, with `signatureStatus.verified: false`. Your public key is not secret, so anyone can build a payload that your private key decrypts: refuse the request unless `signatureStatus.verified` is `true`, as both handlers below do.

### Post-install handler

```ts
app.post("/:tenantIdentifier/post-install", async (c) => {
    const tenantIdentifier = c.req.param("tenantIdentifier");
    try {
        const body = await c.req.parseBody(); // form-encoded
        if (typeof body?.payload !== "string") return c.text("invalid body", 400);

        const decoded = await decrypter(body.payload);
        if (!decoded.signatureStatus.verified) return c.text("invalid signature", 403);
        if (decoded.envelope?.tenantIdentifier !== tenantIdentifier) {
            return c.text("tenant mismatch", 403); // path tenant must match payload tenant
        }
        // decoded.envelope.event is "install" | "reinstall" | "uninstall"
        // decoded.envelope.configuration carries non-secret config; decoded.secrets
        // carries plaintext secrets (already decrypted by the decrypter). Neither is
        // delivered on "uninstall", and its backendToken no longer works.
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
        if (typeof body?.payload !== "string") return c.text("invalid body", 400);

        const decoded = await decrypter(body.payload);
        if (!decoded.signatureStatus.verified) return c.text("invalid signature", 403);
        if (decoded.envelope?.tenantIdentifier !== tenantIdentifier) {
            return c.text("tenant mismatch", 403);
        }

        // Plaintext secrets are at decoded.secrets[name] — no manual decrypt step.
        // Call Crystallize APIs on behalf of the viewer using the Backend Token.
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

The `decrypter` returns a structured `DecryptedPluginPayload` (see [`@crystallize/js-api-client`](https://www.npmjs.com/package/@crystallize/js-api-client)):

| Field                         | Description                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `envelope.tenantIdentifier`   | Always check against the path param.                                                                                                                                  |
| `envelope.tenantId`           | Tenant ID (string).                                                                                                                                                   |
| `envelope.installationId`     | Stable across reinstalls of the same `(tenant, plugin)`. An uninstall followed by an install creates a new one.                                                       |
| `envelope.pluginIdentifier`   | Sanity-check it's yours.                                                                                                                                              |
| `envelope.revisionId`         | Which revision this installation is pinned to.                                                                                                                        |
| `envelope.sub`                | The viewing user's ID. On webhooks, the user who first installed the plugin, whoever triggered the event.                                                             |
| `envelope.configuration`      | Non-secret configuration values (plaintext). Absent on `uninstall`.                                                                                                   |
| `envelope.encryptedSecrets`   | Per-field JWE ciphertext (raw). The decrypter already plaintexts these into `secrets` — only touch this for re-encryption. Absent on `uninstall`.                     |
| `envelope.entityContext`      | The page behind the iframe at load time, e.g. `{ entity: "orders", orderId: "...", mode: "view", placement, ... }`. The App always sends it, even on the dashboard.   |
| `envelope.event`              | **Webhook variant only**: `"install"` \| `"reinstall"` \| `"uninstall"`. Absent on iframe payloads.                                                                   |
| `envelope.installMode`        | **Webhook variant only**: `"marketplace"` \| `"private"`. Absent on `uninstall`.                                                                                      |
| `envelope.acceptedTermsAt`    | **Webhook variant only**: ISO 8601 timestamp of the terms acceptance. Absent on `uninstall`.                                                                          |
| `envelope.backendToken`       | RS256 JWT (string) — pass as `Authorization: Bearer …` to the Core and PIM APIs.                                                                                      |
| `envelope.signatureSecret`    | _(optional)_ The tenant's secret for verifying inbound Crystallize webhooks via `createSignatureVerifier`. Present when the tenant has one.                           |
| `envelope.staticAuthToken`    | _(optional)_ The tenant's static auth token for protected Catalogue / Discovery APIs. Pass it as `staticAuthToken`, not as a bearer. Present when the tenant has one. |
| `secrets`                     | **Plaintext** map of secret values, already decrypted by the decrypter. Use this — don't re-decrypt `encryptedSecrets`.                                               |
| `signatureStatus.verified`    | `true` if the signature of the JWT inside the JWE checks out. `false` when it fails, has expired, or `verify` was omitted; see `signatureStatus.reason`.              |
| `backendTokenStatus.verified` | `true` if the JWKS verification of the Backend Token passed (when `verifyBackendToken: true`).                                                                        |
| `backendTokenStatus.claims`   | Decoded claims (`sub` = userId, `aud` = your plugin identifier, `act = { pluginIdentifier, tenantId, installationId, revisionId }`).                                  |

### Backend Token rules

- TTL: 1 hour. Never cache it across requests — every iframe load mints a fresh one. A mounted iframe is not re-POSTed, so there is no refresh until the user reloads the page.
- Send as `Authorization: Bearer <jwt>` to the Core API (`nextPimApi`) and the PIM API (`pimApi`). No other API takes it: `/@me` answers 403, Discovery and Catalogue ignore it, and the Shop API token fetch does not read it.
- For a protected Catalogue or Discovery API, build a separate `createClient({ tenantIdentifier, staticAuthToken: decoded.envelope.staticAuthToken })`. A client holding both credentials sends only the Bearer, so those calls fail.
- The server verifies signature, installation and plugin state on every call. Uninstalling, or reinstalling onto another revision, revokes outstanding tokens at once, and the `inactive` kill-switch is **live**, not TTL-bounded. A revoked or expired token gets a 400 `No authentication data provided.`; a plugin in a refused state gets a 403.
- The uninstall webhook carries a `backendToken`, but the installation is already gone, so that token never works. Clean up without calling Crystallize.
- The token impersonates the **viewing user**, bounded by their permissions. A plugin cannot escalate privileges. On webhooks it impersonates the user who first installed the plugin.

## Talk to the App from the iframe

Use [`@crystallize/plugin-signal`](https://www.npmjs.com/package/@crystallize/plugin-signal) in the browser code your upstream serves. It is a typed JSON-RPC channel over `postMessage`:

```ts
import { createChannel, createWindowTransport } from "@crystallize/plugin-signal";

const channel = createChannel({
    transport: createWindowTransport(),
    handlers: {
        setEntityContext: (_channel, context) => render(context),
    },
});

channel.notify("ready", undefined); // the App answers with setEntityContext
channel.notify("notifyHeight", { height: document.body.scrollHeight });
channel.notify("navigateTo", { entity: "order", id: "<orderId>" });
```

**`envelope.entityContext` goes stale.** The App POSTs the payload once, when the iframe mounts. As the user navigates, a mounted iframe (the sidebar, for one) is not re-POSTed: the App sends each change through `setEntityContext` instead. Treat the payload's value as the initial one.

Every method, and which placements honour it, is in the contract's [App Channel](references/plugin-contract.md#app-channel) section.

## Local Testing Without the App UI

You don't need to click through the App UI to exercise an endpoint locally. Crystallize exposes the same payload-issuing mutation directly on the Core API (`https://api.crystallize.com/@<tenant>`). The `entryPointId` comes from `pluginInstallation(id:) { ... on PluginInstallation { revision { entryPoints { id placement } } } }`:

```graphql
mutation {
    issuePluginPayload(
        installationId: "<installationId>"
        entryPointId: "<entryPointId>"
        entityContext: { entity: "orders", orderId: "<orderId>", mode: "view" } # optional
    ) {
        ... on BasicError {
            message
        }
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

To inspect a payload, run `crystallize plugin decrypt-payload --private-key ./private.jwk.json --payload "$ENCRYPTED_PAYLOAD" --audience com.acme.order-preview`.

For the post-install webhook, the wire format is identical — `curl --data-urlencode "payload=$ENCRYPTED_PAYLOAD" "$URL"` — but `issuePluginPayload` sets no `event`. To trigger a real lifecycle event for testing, re-install the plugin (it's atomic, keeps the same `installationId`, and fires `reinstall`).

For local development of the upstream, expose your dev server with a tunnel (e.g. ngrok) and set that URL as the revision's `upstream`. `upstream` is locked in the revision, so use a stable hostname: a new URL means a new revision and a reinstall. Code under `upstream` can change without a new revision.

### Dev-payload Vite plugin (no Crystallize round-trip)

If you're on Vite, the **`crystallize-plugin-skeleton`** and **`crystallize-buddy`** examples ship a `vite/dev-payload.ts` plugin that intercepts GETs in dev and mints a fake JWE envelope (encrypted with your local `public.jwk.json`, then re-POSTs it to your handler). You declare the routes you want to mock in `dev-payload.config.jsonc` (entrypoints, post-install events, entity context, plaintext secrets that get JWE-wrapped). This decouples local development from the App UI entirely — open the route in a browser, your handler sees a payload identical to production.

The plugin uses a `dev-payload://` prefix on the locally-minted `backendToken` as a sentinel, and its payloads are unsigned. **Do not copy the examples' bypass as it stands:** their middleware skips the signature check on that prefix alone, and anyone holding your public key can mint such a payload against production. Gate the bypass on something only your dev build sets, such as `import.meta.env.DEV`, so production always requires a verified signature.

## Common Mistakes

| Mistake                                                                     | What to do                                                                                                                             |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Storing `PLUGIN_PRIVATE_JWK` in source control                              | Treat it like any other private key. Env var only, secret manager in production.                                                       |
| Acting on a payload without checking its signature                          | The decrypter returns the envelope even when the signature fails. Refuse it unless `decoded.signatureStatus.verified` is `true`.       |
| Forgetting to validate `tenantIdentifier` from the path vs payload          | Always compare both. The contract requires the path to match the payload's `tenantIdentifier`.                                         |
| Trusting `pluginIdentifier` from payload without checking                   | Compare it to your own `PLUGIN_IDENTIFIER`. The decrypter's `audience` check covers the token; do this too.                            |
| Inventing a placement                                                       | The API accepts any string and the App renders nothing. Use a placement from the [table](#placements).                                 |
| Caching the Backend Token                                                   | Never. It's per-load, 1h TTL, and live-revoked on uninstall, on a reinstall onto another revision, or when the plugin goes `inactive`. |
| Designing the post-install handler with side effects that aren't idempotent | Webhook is fire-and-forget, **no retries**. Make it idempotent or rely on the next iframe load's payload.                              |
| Trying to mutate revision fields after creation                             | A revision is immutable. Create a new revision and re-install to migrate.                                                              |
| Putting secrets in plaintext `configurationSchema` properties               | List the property name in the top-level `secrets[]` array. The App UI then encrypts it client-side.                                    |
| Auto-migrating users to a new revision                                      | Installations pin a `revisionId`. Users must re-install to consent to the new contract.                                                |
| Dropping the old private key after rotating keys                            | Installations on the old revision keep getting payloads encrypted with its key. Keep the old key until they have all moved.            |

## Working Examples

The [Crystallize plugins monorepo](https://github.com/CrystallizeAPI/plugins) ships three reference plugins. Check their payload handling against this skill before copying it: `hello-world` omits the signature check, and the other two have the dev-payload bypass described above.

- **[`plugins/crystallize-plugin-skeleton`](https://github.com/CrystallizeAPI/plugins/tree/main/plugins/crystallize-plugin-skeleton)** — the empty starting point behind `crystallize plugin create … hono-plugin-skeleton`: a Node.js server with Vite and Hono.
- **[`plugins/hello-world`](https://github.com/CrystallizeAPI/plugins/tree/main/plugins/hello-world)** — minimal Bun + Hono server. Two routes (`post-install` + entrypoint) showing payload decryption, envelope/tenant validation, and a Backend-Token-authenticated Crystallize API call. Mirror this layout (`src/index.ts` for routes, `.env` for `PLUGIN_PRIVATE_JWK` + `PLUGIN_IDENTIFIER`) for any new plugin.
- **[`plugins/crystallize-buddy`](https://github.com/CrystallizeAPI/plugins/tree/main/plugins/crystallize-buddy)** — full-featured Cloudflare Workers plugin (Hono + Vite + JSX SSR with React islands, Awilix DI, webhook receiver, SSE channel). Useful when you outgrow a single-file server: shows a reusable `payloadDecrypter` middleware, a per-tenant routing pattern (`/:tenantIdentifier/...`), and a local **dev-payload Vite plugin** that mints fake JWE payloads on GET so you can develop without round-tripping through Crystallize.

## References

- [Plugin Contract](references/plugin-contract.md) — normative spec: entities, fields, JWE/JWT formats, sequence diagrams, entity context, App channel, security model, V1 vs V2 behavior.
- [Official documentation](https://crystallize.com/docs/developer/plugins)
- Companion skill: [js-api-client](../js-api-client/SKILL.md) — `createClient`, `createPluginPayloadDecrypter`, all API callers.
- CLI helpers: `crystallize plugin create`, `crystallize plugin keygen`, `crystallize plugin encrypt-secret --public-key <path>`, `crystallize plugin decrypt-payload --private-key <path>`.
