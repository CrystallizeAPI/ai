# Crystallize Plugin Contract

This document defines the technical and security conventions every Plugin (vendor-hosted application) must respect to integrate with Crystallize.

A Crystallize Plugin is a vendor-hosted application that extends the Crystallize App UI with custom functionality — rendered inside iframes at predefined placement points. Plugins don't run code in the App UI itself; they receive a scoped Backend Token to act on behalf of the signed-in user via Crystallize APIs, and any secrets they need are encrypted client-side with the vendor's own public key.

Plugins are **server-hosted**. The iframe is loaded via a form POST carrying an encrypted payload that contains the Backend Token, configuration, and secrets. Plugin vendors must operate a backend that can handle POST requests and decrypt the payload — a Cloudflare Worker, Vercel/Netlify edge function, Lambda, or any server-side runtime. Pure static file hosting is not sufficient.

The contract establishes the interface between three parties:

- **Crystallize Core** — manages identity, tenancy, the plugin collection, and the plugin registry
- **Crystallize App UI** — renders buttons, views, configuration forms, and plugin iframes
- **Vendor Upstream** — provides the actual business logic and secure endpoints

---

## Core Concepts

Three entities manage the lifecycle of a plugin from creation to installation.

### Plugin Collection

Where plugins are **defined**. A developer creates a plugin with `createPlugin` on `/@me`, providing the plugin metadata (name, description, logo, etc.), then adds its first revision with `createPluginRevision`. Both can also be done in the App under **Settings → Apps**.

Every plugin has a **state**:

- `pending` — submitted, awaiting validation by Crystallize. Only its owner can install it, as a private install.
- `active` — validated and installable
- `inactive` — disabled. The plugin is no longer installable and **stops working immediately across all tenants** (live auth rejects any request made with a token whose `act.pluginIdentifier` matches an inactive plugin — the kill is not bounded by token TTL).

Apart from the owner's private install (see [Installation Modes](#installation-modes)), a plugin can't be installed until it reaches `active` state.

#### Revisions

A plugin evolves through **revisions**. A revision locks the **contract surface** — the fields that define what the plugin is allowed to do and where it shows up:

- `upstream` — the base URL of the plugin origin
- `entryPoints` — where the plugin appears in the UI
- `scopes` — the permissions the plugin requires
- `configurationSchema` — the JSON Schema defining the install-time configuration form
- `secrets` — which configuration fields are secrets
- `publicKey` — the JWK public key for payload encryption
- `postInstallationUri` — path where Crystallize POSTs installation data
- `version` — vendor-declared semver for this revision

A revision is immutable once submitted. The code running at `upstream` is entirely under the vendor's control — bug fixes, UI changes, and performance improvements can be deployed anytime without a new revision. A new revision is only needed when the contract itself changes.

Plugin-level fields (name, description, logo, etc.) live on the plugin, not on a revision. They're cosmetic — they don't affect what the plugin is allowed to do. `createPlugin` sets them, and no mutation updates them afterwards.

Revision fields are locked per revision because they directly affect the Backend Token: when a user installs a plugin, they consent to a specific `upstream`, a specific set of entrypoints, and a specific set of scopes. The token issued at runtime is bounded by that consent. Locking the contract per revision ensures the token always reflects what was approved at installation.

Each plugin carries an `approvedRevisionId` pointer. This is the revision that the Plugin Store surfaces and that new installations default to. Only Crystallize staff can set it. Installations pin a specific `revisionId` and **never auto-migrate** — upgrading an installation to a newer revision requires the user to re-install.

The full mutation input is detailed in the [Revision Fields](#revision-fields) section.

### Plugin Registry

Where **installations** live. When a user installs a plugin on their tenant, the Plugin Registry stores the result: which tenant, which plugin, which revision, the non-secret configuration, the granted scopes, and the encrypted secrets.

One plugin can be installed on many tenants, each with its own configuration and scopes. Each `(tenant, plugin)` pair maps to exactly one installation.

To change configuration, scopes, or revision, the plugin must be re-installed with `reinstallPluginInstallation`. Re-install is atomic and keeps the same `installationId`.

### Plugin Store

The **public-facing catalog** of available plugins, shown as the marketplace under **Apps** in the App. Only plugins in `active` state can be installed from it. Its entries carry marketing content (descriptions, screenshots, vendor info, etc.) and are a separate listing: approving a revision does not create one.

Users browse the Plugin Store in the App UI to discover and install plugins.

---

## Base Requirements

A valid Plugin must satisfy:

1. **Hosting**: a publicly accessible HTTPS domain, operated by the vendor. The origin must accept POST requests and decrypt payloads with the vendor's private key. Pure static hosting is not sufficient. `upstream` must be `https:` and cannot be `localhost`, a private or link-local IPv4 address, or an IPv6 literal.
2. **Plugin registration**: the developer creates the plugin and its first revision via mutations on `/@me` in Crystallize Core.
3. **Post-installation endpoint**: a path declared in the revision (`postInstallationUri`) where Crystallize POSTs configuration and encrypted secrets at install / reinstall time, and a final notice at uninstall time.

---

## Vendor Endpoints

All URLs follow the same pattern:

```
$upstream/$tenantIdentifier/$path
```

- `$upstream` is the plugin's declared `upstream` URL (from the revision).
- `$tenantIdentifier` is the Crystallize tenant the request is scoped to.
- `$path` is either `postInstallationUri` (for install events) or an entrypoint's `target` (for iframe loads).

### Post-Installation Endpoint

When a user installs, re-installs, or uninstalls a plugin on their tenant, Crystallize POSTs a form-encoded body to:

```
$upstream/$tenantIdentifier/$postInstallationUri
```

The body is `application/x-www-form-urlencoded` with a single field `payload=<JWE>` — the same wire format used for entrypoints. The JWE wraps a JWT signed by Crystallize, whose claims are:

```ts
type PostInstallClaims = {
    event: "install" | "reinstall" | "uninstall";
    tenantId: string;
    tenantIdentifier: string;
    installationId: string;
    pluginIdentifier: string;
    revisionId: string;
    backendToken: string; // never usable on uninstall: the installation is already gone
    configuration?: Record<string, JsonValue>; // omitted for uninstall
    encryptedSecrets?: Record<string, string>; // JWE-per-field, omitted for uninstall
    installMode?: "marketplace" | "private"; // omitted for uninstall
    acceptedTermsAt?: string; // ISO 8601, omitted for uninstall
    signatureSecret?: string; // the tenant's, when it has one
    staticAuthToken?: string; // the tenant's, when it has one
    // Standard JWT claims: iss, aud (your plugin identifier), iat, nbf, exp, jti,
    // and sub (the user who first installed the plugin, whoever triggered the event)
};
```

**Delivery semantics**: fire-and-forget, best-effort, **no retries**. The request times out after 5 seconds. A 2xx response counts as success; anything else is logged and ignored. The install/reinstall/uninstall mutation does **not** block on the vendor's response — the user-visible operation completes regardless. Vendors should therefore design their post-install handler to be idempotent and to tolerate losing an occasional event.

### Plugin UI Endpoints

All other endpoints (the ones loaded inside iframes) are addressed by an entrypoint's `target`:

```
$upstream/$tenantIdentifier/$target
```

These endpoints are called via POST. The body contains a single encrypted payload (see [Plugin Loading Protocol](#plugin-loading-protocol)).

The vendor chooses the `target` paths — the entrypoints registered in the revision are the source of truth.

---

## Plugin Definition

The plugin definition is submitted via a mutation on `/@me`. It lives in the Plugin Collection.

The definition has two layers: **plugin-level fields** describing the plugin (set at creation) and **revision-level fields** defining the contract (locked per revision).

### Plugin Fields

| Field         | Type     | Description                                                                                                                                                 |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `string` | Display name of the plugin                                                                                                                                  |
| `identifier`  | `string` | Reverse-DNS identifier, globally unique, immutable (e.g. `com.acme.invoice`). Lowercase, at least three dot-separated segments, each starting with a letter |
| `author`      | `string` | _(optional)_ Author / vendor name                                                                                                                           |
| `description` | `string` | _(optional)_ Short description                                                                                                                              |
| `logo`        | `string` | _(optional)_ Absolute URL to a logo image                                                                                                                   |
| `icon`        | `string` | _(optional)_ Absolute URL to an icon image                                                                                                                  |

### Revision Fields

These define the contract surface and are locked per revision. Changing any of them requires a new revision via `createPluginRevision`.

| Field                 | Type                            | Description                                                                                                                  |
| --------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `upstream`            | `String!`                       | Base HTTPS URL of the plugin origin                                                                                          |
| `entryPoints`         | `[PluginEntryPointInput!]!`     | Where the plugin appears in the UI (see [Entrypoints](#entrypoints))                                                         |
| `scopes`              | `[PluginScope!]`                | Permissions the plugin requires (see [Scopes](#scopes))                                                                      |
| `configurationSchema` | `JSON`                          | JSON Schema (draft 2020-12) defining the install-time configuration form (see [Configuration](#configuration))               |
| `secrets`             | `[String!]`                     | Configuration property names to treat as secrets (see [Secrets](#secrets))                                                   |
| `publicKey`           | `PluginPublicKeyRevisionInput!` | JWK public key used to encrypt secrets at install time and the iframe payload at runtime (see [Cryptography](#cryptography)) |
| `postInstallationUri` | `String!`                       | Path where Crystallize POSTs installation data (see [Post-Installation Endpoint](#post-installation-endpoint))               |
| `version`             | `String!`                       | Semver by convention, not validated. The plugin's "current version" is the `version` of `approvedRevisionId`                 |

```graphql
input CreatePluginRevisionInput {
    upstream: String!
    entryPoints: [PluginEntryPointInput!]!
    scopes: [PluginScope!]
    configurationSchema: JSON
    secrets: [String!]
    publicKey: PluginPublicKeyRevisionInput!
    postInstallationUri: String!
    version: String!
}
```

### Scopes

The `scopes` field declares the permissions the plugin needs. This is what the installer reviews before granting access. Each scope is `<resource>:<action>`, and `createPluginRevision` rejects anything else.

```json
{
    "scopes": ["orders:read", "orders:update", "customers:read"]
}
```

- **Actions**: `create`, `read`, `update`, `delete`, `publish`, `unpublish`, `transition`.
- **Resources**: `apps`, `assets`, `bookingPolicies`, `catalogue`, `customers`, `flows`, `fulfillment`, `grids`, `inviteTokens`, `languages`, `markets`, `metaPresets`, `operationLog`, `orders`, `pieces`, `pluginInstallations`, `plugins`, `priceLists`, `priceVariants`, `productBookable`, `reports`, `roles`, `shapes`, `stockLocations`, `subscriptionContracts`, `subscriptionPlans`, `tenant`, `tenantSso`, `topics`, `user`, `users`, `vatGroups`, `vocabularies`, `webhooks`.

At install time, `grantedScopes` is recorded on the installation as submitted. The App grants everything the revision declares. The API lets the caller pass a subset, and checks the value neither against the revision's scopes nor against the installer's own permissions.

> **V1 behavior:** granted scopes are recorded on the installation but are **not** enforced when minting the Backend Token. In V1, the Backend Token carries the current user's full permissions (bounded by the user's own role, as always). Scope intersection enforcement — narrowing the token to `grantedScopes ∩ userPermissions` — is planned for V2. Declare scopes honestly now so that the installer's consent is meaningful and so that V2 will "just work" for your plugin.

### Cryptography

The revision must include a `publicKey` object in JWK format (RFC 7517). This key serves two purposes:

1. **At install time**: encrypt each secret configuration value individually (client-side, in the App UI) before submitting to Crystallize.
2. **At runtime**: encrypt the entire iframe payload on every load (server-side, in Crystallize Core).

Only the vendor holds the matching private key. Crystallize never holds plaintext secrets.

The key must be an RSA key with:

| JWK field | Accepted value                              |
| --------- | ------------------------------------------- |
| `kty`     | `RSA`, with non-empty `n` and `e`           |
| `use`     | `enc`, by convention (not validated)        |
| `alg`     | `RSA-OAEP-256` (default) or `RSA-OAEP`      |
| `enc`     | `A256GCM` (default), `A192GCM` or `A128GCM` |

`crystallize plugin keygen` emits `RSA-OAEP-256` and `A256GCM`. Keep `alg` and `enc` on the key: the API treats them as optional, but the App reads both to encrypt secrets. Reading a key back through GraphQL returns `alg` as an enum (`RSA_OAEP_256`), so convert it to the JWK form (`RSA-OAEP-256`) before using the key.

JWE compact serialization is used on the wire.

```json
{
    "publicKey": {
        "kty": "RSA",
        "kid": "public",
        "use": "enc",
        "alg": "RSA-OAEP-256",
        "enc": "A256GCM",
        "n": "<modulus>",
        "e": "AQAB"
    }
}
```

### Configuration

A plugin is a single application deployed once by the vendor, but it can be installed on many tenants, each with its own context. The configuration is what makes each installation unique.

The revision declares the **shape** of the configuration as a JSON Schema. When a user installs the plugin, the App UI renders that schema as a form. The values the user fills in become that installation's specific configuration.

The same Invoice App can be installed on Tenant A with a purple theme pointing to Stripe instance X, and on Tenant B with a blue theme pointing to Stripe instance Y. The plugin code is identical — the configuration is what differentiates each installation.

Configuration is set at installation time and stored in the Plugin Registry. Non-secret values are stored in plaintext; secrets are stored as ciphertext (see below). To change any of it, the plugin must be re-installed.

The `configurationSchema` field must be a valid **JSON Schema, draft 2020-12**.

```json
{
    "configurationSchema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": false,
        "required": ["organizations"],
        "properties": {
            "StripeApiKey": {
                "type": "string",
                "title": "Stripe API Key",
                "description": "API Key of the Stripe instance"
            },
            "organizations": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["label", "email"],
                    "properties": {
                        "label": {
                            "type": "string",
                            "title": "Organization Label"
                        },
                        "email": {
                            "type": "string",
                            "title": "Organization Email"
                        },
                        "address": {
                            "type": "string",
                            "title": "Organization Address"
                        }
                    }
                }
            }
        }
    }
}
```

At install and re-install, Crystallize validates the submitted `configuration` against this schema, after removing secret fields from its top-level `properties` and `required`. A revision with no `configurationSchema` only accepts an empty `configuration`.

### Secrets

A top-level array of configuration property names to treat as secrets:

```json
{
    "secrets": ["StripeApiKey", "mySuperSecretPassword"]
}
```

Every name in `secrets[]` must be a top-level property of `configurationSchema.properties`, or `createPluginRevision` fails. Nested properties can't be secrets, and a revision with secrets needs a schema.

When a property is listed in `secrets`, the App UI, on a marketplace install:

1. Renders an `<input type="password">` for that field.
2. **Encrypts the value in the browser** using the plugin's `publicKey`, producing a JWE compact string.
3. Submits `{ configuration, encryptedSecrets }` to Crystallize. The plaintext secret value never leaves the user's browser.

A private install in the App does not encrypt anything: the developer pastes values already encrypted with `crystallize plugin encrypt-secret`. API callers do the same.

Crystallize stores the ciphertext verbatim, tagged with the `revisionId` of the installation it was submitted for. That tag records where the value was submitted, not which key encrypted it: Crystallize can't read the ciphertext, so it can't detect the wrong key.

**Re-install rules:**

- `encryptedSecrets` must hold an entry for every name in the revision's `secrets`, on every re-install. A missing entry is rejected, and the App's marketplace form never prefills secrets, so they must be re-entered there.
- To keep a value through the API, read `encryptedSecrets` from `pluginInstallation` (stored as `{ ciphertext, revisionId }`) and resend each `ciphertext` as a bare string.
- If the new revision uses a **different `publicKey`**, every secret must be re-encrypted against it. A stale ciphertext is accepted, but `createPluginPayloadDecrypter` then throws on every payload of that installation.

At runtime, Crystallize passes the stored ciphertexts through into the iframe payload as-is. The payload itself is signed as a JWT and then wrapped in an outer JWE using the same `publicKey`. The plugin's backend:

1. Decrypts the outer envelope to retrieve the signed JWT, and verifies its signature.
2. Reads `encryptedSecrets[field]` — a per-field JWE — and decrypts it a second time with the same private key.

`createPluginPayloadDecrypter` does both, and exposes the result as `secrets`. Only the vendor can decrypt secrets. Crystallize never holds plaintext.

### Entrypoints

Entrypoints declare where the plugin appears in the Crystallize App UI. Each entrypoint defines a unique placement.

`placement` is a free string for the API, which stores any value without error. The App only renders the placements below, so anything else never appears. It renders only the first entrypoint of a revision for a given placement.

| Placement                                      | Rendering                                                             | Height (px) | Width (px) |
| ---------------------------------------------- | --------------------------------------------------------------------- | ----------- | ---------- |
| `dashboard/home/top-card`                      | Home dashboard. Replaces the default top card                         | 120–1200    | Fixed      |
| `layout/sidebar-right`                         | Right sidebar, on every page                                          | 80–viewport | 240–640    |
| `layout/bottom-right/inline`                   | Fixed bottom-right bar, on every page                                 | 120–320     | 120–320    |
| `orders/order/top/inline`                      | Order detail page, top                                                | 0–1200      | Fixed      |
| `orders/order/bottom/inline`                   | Order detail page, bottom                                             | 0–1200      | Fixed      |
| `catalogue/item/above-components/inline`       | Item editor, above the components. Not on archived versions           | 0–1200      | Fixed      |
| `catalogue/item/below-components/inline`       | Item editor, below the components. Not on archived versions           | 0–1200      | Fixed      |
| `catalogue/variant/above-components/inline`    | Variant editor, above the components. Not on archived versions        | 0–1200      | Fixed      |
| `catalogue/variant/below-components/inline`    | Variant editor, below the components. Not on archived versions        | 0–1200      | Fixed      |
| `catalogue/item/split-view/inline`             | An extra view in the item's view switcher, labelled by the entrypoint | 80–2000     | Fixed      |
| `catalogue/folder-nerdy/nerdy-action/all`      | Bulk action in the catalogue data grid and Lightbox, for all items    | Dialog      | Dialog     |
| `catalogue/folder-nerdy/nerdy-action/products` | Same, when the grid shows products                                    | Dialog      | Dialog     |
| `catalogue/folder-nerdy/nerdy-action/variants` | Same, when the grid shows variants                                    | Dialog      | Dialog     |
| `plugins/page/full`                            | Full page at `/plugins/<identifier>`                                  | Full page   | Full page  |
| `apps/plugin/content`                          | The plugin's page under Apps, replacing its config page               | Full page   | Full page  |

Heights and widths are the ranges the App clamps `notifyHeight` and `notifyWidth` to.

Each entrypoint has the following fields:

| Field       | Type     | Description                                                                                                                                                        |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`        | `string` | _Server-assigned_ at revision creation. Used by the App UI in `issuePluginPayload(installationId, entryPointId)`.                                                  |
| `placement` | `string` | One of the placements above                                                                                                                                        |
| `target`    | `string` | URI path suffix appended to `$upstream/$tenantIdentifier/`. Must start with `/`, must not start with `//`, must not contain `://`, must not contain `..` segments. |
| `label`     | `string` | _(optional)_ Display label                                                                                                                                         |
| `icon`      | `string` | _(optional)_ Absolute URL to an icon                                                                                                                               |

#### Entity Context

Every payload the App issues carries an `entityContext` describing the page behind the iframe, including on the dashboard. It follows the page, not the placement: a `layout/sidebar-right` iframe gets the context of whatever is open.

```ts
{ entity, pathname, searchParams, placement, tenantIdentifier, language, ...fields }
```

| `entity`                    | Fields                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `dashboard`, `unknown`      | —                                                                                         |
| `catalogue`                 | `itemType`, `itemId`, `variantSku`, `itemLanguage`, `view`, `itemsType`, `selectedRowIds` |
| `orders`                    | `orderId`, `subscriptionId`, `mode`                                                       |
| `customers`                 | `identifier`, `mode`                                                                      |
| `subscription-contracts`    | `contractId`, `mode`                                                                      |
| `fulfilment`                | `pipelineId`, `mode`                                                                      |
| `flows`                     | `identifier`, `flowType`, `mode`                                                          |
| `topics`                    | `topicId`, `topicLanguage`, `mode`                                                        |
| `grids`                     | `gridId`, `gridLanguage`, `mode`                                                          |
| `assets`                    | `imageKey`, `assetLanguage`                                                               |
| `lightbox`                  | `area`, `lightboxLanguage`, `selectedRowIds`                                              |
| `insight`, `special-prices` | `section`                                                                                 |
| `changelog`                 | `documentId`                                                                              |
| `marketplace`               | `path`                                                                                    |
| `apps`, `plugins`           | `identifier`                                                                              |
| `settings`                  | `section`                                                                                 |

All entity fields are optional. The `EntityContext` type and `zEntityContext` schema are exported by `@crystallize/plugin-signal`.

The payload holds the context at load time. A mounted iframe is not re-POSTed as the user navigates: the App sends changes through `setEntityContext` (see [App Channel](#app-channel)). A direct `issuePluginPayload` call passes whatever `entityContext` the caller provides, and the claim is omitted when there is none.

#### Examples

A plugin adding a "Preview Order" panel to the order page, a variant panel, and a dashboard card:

```json
{
    "entryPoints": [
        {
            "placement": "orders/order/top/inline",
            "target": "/order/preview",
            "label": "Preview Order",
            "icon": "https://example.com/icon.png"
        },
        {
            "placement": "catalogue/variant/below-components/inline",
            "target": "/variant/widget",
            "label": "Variant Details"
        },
        {
            "placement": "dashboard/home/top-card",
            "target": "/dashboard/main",
            "label": "Tenant Overview"
        }
    ]
}
```

---

## Installation Flow

### Installation Modes

Every install and re-install resolves to one mode, or is refused. The mutation fails unless the terms flag for that mode is `true`, and the flag is required again on every re-install.

| Mode          | Who                                                                   | Revision                                                                 | Required flag               |
| ------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------- |
| `marketplace` | A user with create access to `pluginInstallations`                    | The approved revision of an `active` plugin                              | `acceptMarketplaceTerms`    |
| `private`     | The plugin's owner, holding the tenantAdmin role on the target tenant | The latest revision, when it is not the approved one. Works on `pending` | `acceptPrivateInstallTerms` |

`inactive` plugins are refused in both modes. A marketplace installation requires the plugin to stay `active` to keep running; a private installation also runs while the plugin is `pending`.

`pluginInstallability(identifier:)` on the Core API returns the mode that applies to the current user on the current tenant: `marketplace`, `private` or `notInstallable`. `availablePlugin(identifier:)` returns an `active` plugin with its approved revision, and `null` otherwise.

### Sequence

End-to-end sequence when a user installs a plugin on their tenant. The same shape applies to re-install (`event: "reinstall"`) and uninstall (`event: "uninstall"`, no `configuration` / `encryptedSecrets` in the webhook body).

```mermaid
sequenceDiagram
    autonumber
    actor Installer
    participant AppUI as Crystallize App UI
    participant Core as Crystallize Core
    participant Vendor as Vendor Backend

    Installer->>AppUI: Open Plugin Store, pick plugin
    AppUI->>Core: Fetch plugin + approved revision
    Core-->>AppUI: upstream, configuration schema,<br/>secrets[], scopes[], publicKey,<br/>revisionId, postInstallationUri
    AppUI->>Installer: Render form from JSON Schema<br/>(password inputs for secret fields)
    Installer->>AppUI: Fill configuration, accept terms

    Note over AppUI: For each field in secrets[]:<br/>encrypt its value with revision.publicKey<br/>(RSA-OAEP-256 + A256GCM, JWE compact).<br/>Plaintext secret never leaves the browser.

    AppUI->>Core: createPluginInstallation(<br/>pluginIdentifier, revisionId, grantedScopes,<br/>configuration, encryptedSecrets,<br/>acceptMarketplaceTerms)

    Note over Core: Validate:<br/>• install mode is marketplace or private<br/>• terms flag matches that mode<br/>• configuration vs schema (secret fields stripped)<br/>• encryptedSecrets well-formed JWE,<br/>  one per name in secrets[]

    Core->>Core: Persist installation<br/>(configuration plaintext, encryptedSecrets<br/>stored verbatim, tagged with revisionId)

    Note over Core: Sign the post-install claims as a JWT, wrap it<br/>in an outer JWE using revision.publicKey.<br/>encryptedSecrets passed through<br/>(already per-field encrypted).

    par Webhook (fire-and-forget)
        Core-)Vendor: POST $upstream/$tenantIdentifier/$postInstallationUri<br/>Content-Type: application/x-www-form-urlencoded<br/>body: payload=&lt;outer JWE of signed JWT&gt;<br/>{ event:"install", tenantId, tenantIdentifier,<br/>  installationId, pluginIdentifier, revisionId,<br/>  backendToken, configuration, encryptedSecrets,<br/>  installMode, acceptedTermsAt }
    and Mutation returns
        Core-->>AppUI: { id, ... }
        AppUI-->>Installer: Installation complete
    end

    Note over Vendor: 1. Decrypt outer JWE, verify the JWT signature<br/>2. Decrypt each encryptedSecrets[field]<br/>   a second time (same private key)<br/>3. Persist tenant-scoped state<br/>Handler MUST be idempotent — no retries.
    Vendor--)Core: 2xx (logged, not blocking)
```

**Notes on the flow**

- Crystallize never sees plaintext secret values. The only party that can decrypt them is the vendor, who holds the private key matching `revision.publicKey`.
- The webhook is delivered once, best-effort. If the vendor is down, the install still completes — the authoritative state is always re-delivered on the next iframe load (see below).
- Re-install requires an entry for **all** secret fields, encrypted against the `publicKey` of the target revision. See the [re-install rules](#secrets).
- The uninstall webhook fires after the installation is deleted, so its `backendToken` can't call Crystallize APIs.

### Re-install and Uninstall

On the Core API (`https://api.crystallize.com/@<tenant>`):

```graphql
mutation {
    reinstallPluginInstallation(
        input: {
            installationId: "<installationId>"
            revisionId: "<revisionId>"
            grantedScopes: []
            configuration: { theme: "dark" }
            encryptedSecrets: { apiKey: "<JWE compact string>" }
            acceptMarketplaceTerms: true # or acceptPrivateInstallTerms: true
        }
    ) {
        ... on BasicError {
            message
        }
        ... on PluginInstallation {
            id
            revisionId
        }
    }
}
```

```graphql
mutation {
    deletePluginInstallation(id: "<installationId>") {
        ... on BasicError {
            message
        }
        ... on DeleteCount {
            removed
        }
    }
}
```

The target revision must qualify under [Installation Modes](#installation-modes), and a re-install onto another revision revokes every Backend Token minted for the previous one. An uninstall followed by a fresh install creates a new `installationId`. In the App, an installation whose revision differs from the approved one is offered as an update.

---

## Plugin Loading Protocol

The App UI uses a **form-submit-to-named-iframe** pattern to load each entrypoint:

1. The App UI calls `issuePluginPayload(installationId, entryPointId, entityContext?)` on Crystallize Core. The server returns `{ url, encryptedPayload }`, where `url` is `$upstream/$tenantIdentifier/$target` and `encryptedPayload` is a JWE compact string.
2. An **empty** iframe is rendered with a `name` attribute.
3. A hidden `<form>` targets that iframe by name and submits via `POST`.

```html
<iframe name="plugin-frame-<entryPointId>"></iframe>
<form method="POST" action="<url>" target="plugin-frame-<entryPointId>">
    <input type="hidden" name="payload" value="<encryptedPayload>" />
</form>
```

### Encrypted Payload

The POST body contains a single encrypted payload, built by Crystallize Core and encrypted with the revision's `publicKey`. The JWE wraps a JWT signed by Crystallize (`cty: "JWT"`, RS256, 1 hour TTL), verifiable against the same JWKS as the Backend Token. Its claims are:

```ts
type PluginPayloadClaims = {
    backendToken: string; // RS256 JWT — see next section
    configuration: Record<string, JsonValue>; // plaintext non-secret settings
    encryptedSecrets: Record<string, string>; // per-field JWE compact strings
    entityContext?: Record<string, JsonValue>; // see Entity Context
    tenantId: string;
    tenantIdentifier: string;
    installationId: string;
    pluginIdentifier: string; // reverse-DNS; sanity-check that this matches you
    revisionId: string;
    signatureSecret?: string; // the tenant's, when it has one
    staticAuthToken?: string; // the tenant's, when it has one
    // Standard JWT claims: iss, aud (your plugin identifier), sub (the viewing user), iat, nbf, exp, jti
};
```

This pattern provides:

- No sensitive data in the URL or query string
- Nothing in server/CDN access logs
- No browser history pollution
- No URL length limits
- A single round-trip on load (POST, not GET)
- End-to-end encryption between Crystallize Core and the plugin's backend

The plugin origin must accept the POST, decrypt the payload, and return HTML.

### Loading Flow

End-to-end sequence for rendering one entrypoint in the App UI.

```mermaid
sequenceDiagram
    autonumber
    actor Viewer
    participant AppUI as Crystallize App UI
    participant Core as Crystallize Core
    participant Frame as Browser iframe
    participant Vendor as Vendor Backend
    participant API as Crystallize API

    Viewer->>AppUI: Navigate to page<br/>(e.g. an order)
    AppUI->>Core: List installed entrypoints<br/>matching placement for this page
    Core-->>AppUI: [{ installationId, entryPointId,<br/>   label, icon, ... }]

    loop For each matching entrypoint
        AppUI->>Core: issuePluginPayload(<br/>installationId, entryPointId,<br/>entityContext?)

        Note over Core: 1. Check the plugin state allows this installation<br/>2. Mint Backend Token (RS256 JWT):<br/>   iss = Core base URL<br/>   sub = viewing userId<br/>   aud = pluginIdentifier<br/>   exp = iat + 3600<br/>   act = { pluginIdentifier, tenantId,<br/>           installationId, revisionId }<br/>3. Sign the claims as a JWT:<br/>   { backendToken, configuration,<br/>     encryptedSecrets (passthrough),<br/>     entityContext, tenantId, tenantIdentifier,<br/>     installationId, pluginIdentifier, revisionId,<br/>     signatureSecret, staticAuthToken }<br/>4. Wrap the JWT in an outer JWE<br/>   using revision.publicKey

        Core-->>AppUI: { url: $upstream/$tenantIdentifier/$target,<br/>  encryptedPayload }

        AppUI->>AppUI: Render empty &lt;iframe name=...&gt;<br/>+ hidden &lt;form method=POST action=url<br/>   target=iframeName&gt;<br/>  &lt;input name="payload"<br/>   value="&lt;encryptedPayload&gt;"&gt;

        AppUI->>Frame: Auto-submit form
        Frame->>Vendor: POST $upstream/$tenantIdentifier/$target<br/>body: payload=&lt;encryptedPayload&gt;

        Note over Vendor: 1. Decrypt outer JWE → signed JWT<br/>2. Verify the JWT and backendToken via JWKS<br/>   ($CORE/.well-known/jwks.json):<br/>   iss, aud, exp<br/>3. Decrypt encryptedSecrets[field]<br/>   (same private key)

        opt Vendor calls Crystallize APIs on behalf of the viewer
            Vendor->>API: Request<br/>Authorization: Bearer &lt;backendToken&gt;

            Note over API: • Verify RS256 signature via JWKS<br/>• Load real user by sub = userId<br/>• Live checks, not bounded by token TTL:<br/>  installation exists, still on this revision,<br/>  plugin state allows it<br/>• Apply user's permissions

            API-->>Vendor: Response
        end

        Vendor-->>Frame: HTML
        Frame-->>Viewer: Rendered plugin UI
    end
```

**Notes on the flow**

- The URL is assembled server-side — the App UI treats `url` as opaque and never composes it from parts.
- Nothing sensitive appears in the iframe's `src` or in any URL. The encrypted payload rides in the POST body.
- The `inactive` kill-switch is enforced at the API boundary on every call, not just at token issue time — a token minted just before a plugin is disabled stops working immediately.
- `createPluginPayloadDecrypter` returns the claims even when the signature check fails, and the `publicKey` is not secret. Never act on a payload unless `signatureStatus.verified` is `true`.
- The App POSTs the payload once per mount. It does not re-issue it as the user navigates: see [Entity Context](#entity-context).

---

## App Channel

`@crystallize/plugin-signal` (public npm package) is a typed JSON-RPC 2.0 channel over `postMessage` between the iframe and the App. Both sides validate params, and invalid params fail with a `-32602` error.

```ts
const channel = createChannel({
    transport: createWindowTransport(),
    handlers: { setEntityContext: (_channel, context) => {} },
});
channel.notify("ready", undefined);
const result = await channel.call("updateItemComponent", params); // rejects with an RpcError after 5 seconds by default
```

`createWindowTransport()` targets the parent window and only accepts messages from `https://app.crystallize.com` and `http://localhost`. Pass `allowedOrigin` to change that. The upstream must allow being framed by the App, so it can't send `X-Frame-Options` or a `frame-ancestors` policy that excludes that origin.

| Method                         | Direction    | Params                                           | Effect                                                                                                             |
| ------------------------------ | ------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `ready`                        | iframe → App | —                                                | Send once mounted. The App answers with `setEntityContext`, and `setDataGrid` for a bulk action                    |
| `setEntityContext`             | App → iframe | `EntityContext`                                  | Sent after `ready`, then on every change of context                                                                |
| `notifyHeight`                 | iframe → App | `{ height }`, integer ≥ 0                        | Resizes the iframe within the [placement's range](#entrypoints). No effect on full-page placements or bulk actions |
| `notifyWidth`                  | iframe → App | `{ width }`, positive integer                    | Resizes the iframe on `layout/sidebar-right` and `layout/bottom-right/inline`                                      |
| `promoteToDialog`              | iframe → App | `{ width?, height? }`                            | Shows the iframe as a centered dialog, keeping its state. No effect on full-page placements or bulk actions        |
| `demoteFromDialog`             | iframe → App | —                                                | Returns it to its slot                                                                                             |
| `navigateTo`                   | iframe → App | `NavigateToParams`                               | Navigates the App. See below                                                                                       |
| `updateItemComponent`          | iframe → App | `{ itemId, language, sku?, componentId, input }` | `call`, not `notify`. Sets a component value in the open editor. See below                                         |
| `refetchItem`                  | iframe → App | `{ itemId, language }`                           | Reloads the base item in the open editor. Dropped without error unless that item and language are open             |
| `refetchItemComponents`        | iframe → App | `{ itemId, language }`                           | Reloads the item's components, under the same condition                                                            |
| `refetchItemVariantComponents` | iframe → App | `{ itemId, language }`                           | Reloads the displayed variant's components, under the same condition                                               |
| `setDataGrid`                  | App → iframe | `DataGridPayload`                                | Bulk actions: the selected rows, sent after `ready`                                                                |
| `updateDataGrid`               | iframe → App | `DataGridPayload`                                | Bulk actions: edited rows, applied to the grid as unsaved changes                                                  |
| `closePluginDialog`            | iframe → App | —                                                | Bulk actions: closes the dialog                                                                                    |
| `closeSplitView`               | iframe → App | —                                                | `catalogue/item/split-view/inline`: closes the split                                                               |

**`navigateTo` targets**, by `entity`: `item` (`id` or `externalReference`, optional `language`), `productVariant` (`sku`, optional `language`), `image` (`key`), `order` (`id`), `fulfilmentPipeline` (`id`), `customer` (`identifier`), `grid` (`id`), `topic` (`id`, optional `language`), `priceList` (`identifier`), `plugin` (`identifier`, for a `plugins/page/full` plugin), and `lightbox` (`area: "catalogue"`, `groups`). All except `lightbox` accept `target: "_blank"` and `splits`, a list of `item` or `productVariant` targets to open alongside.

**`updateItemComponent`** sets the value in the rendered editor field. It does not save: the user still saves the item, and the change only lands if that item, language and variant are open. It works on leaf components only, so targeting a chunk, choice or piece itself returns `NOT_RENDERED`: address the leaf inside it. `componentId` is the `/`-separated component path, e.g. `summary-chunk/0/summary`, and `input` is a component content input without its own `componentId`, e.g. `{ singleLine: { text: "New title" } }`. The result is `{ applied: true }` or `{ applied: false, reason: "NOT_RENDERED" | "TYPE_MISMATCH", message }`.

To change data for good, call the API from your upstream with the Backend Token, then send a `refetch*` signal so the open editor catches up.

---

## Backend Token

The Backend Token is generated by Crystallize Core on every plugin load and delivered inside the encrypted payload. No exchange step is required — the plugin uses it immediately to call Crystallize APIs server-side.

The token **impersonates the visitor** (the user currently viewing the page). On webhooks it impersonates the user who first installed the plugin.

### Format

RS256 JWT, signed by Crystallize Core.

### Claims

| Claim | Value                                                                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `iss` | Crystallize Core base URL                                                                                                                 |
| `sub` | The viewing user's `userId`                                                                                                               |
| `aud` | Your plugin's `identifier` (reverse-DNS)                                                                                                  |
| `exp` | `iat + 3600` (1 hour TTL)                                                                                                                 |
| `iat` | Issue time (epoch seconds)                                                                                                                |
| `nbf` | Same as `iat`                                                                                                                             |
| `jti` | Random UUID                                                                                                                               |
| `act` | `{ pluginIdentifier, tenantId, installationId, revisionId }` — RFC 8693 "actor" claim, identifies the plugin acting on behalf of the user |

### Verification

Verify every token you receive:

1. Fetch Crystallize's public JWKS at `$CORE_BASE_URL/.well-known/jwks.json` (`https://api.crystallize.com` in production).
2. Verify the RS256 signature.
3. Check `iss` matches the Crystallize Core base URL you expect.
4. Check `aud` matches your plugin's `identifier`.
5. Check `exp` is in the future.
6. Check `act.pluginIdentifier` / `act.tenantId` / `act.installationId` / `act.revisionId` match the installation you're handling.

`createPluginPayloadDecrypter` with `verify: { audience, verifyBackendToken: true }` covers steps 1 to 5, and reports the result in `backendTokenStatus` without throwing.

Send the token as a `Bearer` credential:

```
Authorization: Bearer <jwt>
```

The Core API (`/@tenant`) and the PIM API accept it. No other API does:

- `/@me` answers 403 `Tenant bounded tokens cannot access the /@me endpoint.`
- Discovery and Catalogue ignore it. They read the static auth token, and Catalogue also an access token pair. Use `envelope.staticAuthToken` on a protected tenant.
- The Shop API token fetch does not read it, so a Backend Token can't obtain a Shop API token.

Crystallize verifies the token against the JWKS on every call, then runs live checks that are not bounded by the token's TTL. The installation must still exist, so uninstalling revokes the token. It must still be pinned to the token's `revisionId`, so reinstalling onto another revision revokes every token minted before. The plugin's state must allow the installation: `active`, or `pending` for a private install.

A token that fails these checks or has expired gets a 400 `No authentication data provided.` A plugin in a refused state gets a 403.

---

## Permissions Model

Plugin permissions follow **least privilege**:

1. The plugin revision declares the permissions the plugin requires (`scopes`).
2. At install time, the granted scopes are recorded on the installation. An API caller can pass a subset of the declared scopes.
3. At runtime, the effective permissions are — conceptually — the **intersection** of:
    - The scopes granted to the plugin at installation
    - The current viewing user's own permissions

This means a plugin can never escalate a user's privileges. If a user has read-only access to orders, the plugin cannot write orders on their behalf — regardless of what the plugin requested.

> **V1 behavior:** the Backend Token currently carries the viewing user's full permissions. `grantedScopes` is stored on the installation but not yet enforced when minting the token. The user's own permissions still bound the token in the usual way. Scope-intersection enforcement is planned for V2; declaring accurate scopes now is still the right thing to do — the installer's consent is recorded and becomes binding in V2 without any vendor change.

---

## Security Considerations

- **Plugin validation**. Plugins must be approved by Crystallize before other tenants can install them. The state model (`pending` → `active`) ensures nothing reaches them without review. The one exception is the private install: a plugin's owner, as tenantAdmin, can run an unapproved revision. `inactive` is a live kill-switch that invalidates every outstanding Backend Token for the plugin regardless of TTL.
- **Revision locking**. Each revision locks the contract surface (upstream URL, entrypoints, scopes, configuration, secrets, public key, post-installation URI, version). The contract the user approved at install time is the one that runs. Code changes at `upstream` don't require a new revision; changes to the contract itself do.
- **Pinned installations**. Installations pin a specific `revisionId` and never auto-migrate. The user has to re-install to move to a newer revision — at which point they re-consent to the new contract and re-encrypt all secrets if the public key changed.
- **Key rotation**. A rotated key lives in a new revision, and installations on older revisions keep receiving payloads encrypted with the old key. Keep the old private key until every installation has moved.
- **Payload authenticity**. The JWE only proves that the payload was encrypted to your public key, which anyone may hold. The signature on the JWT inside proves it came from Crystallize, so verify it on every request and never bypass it in production.
- **End-to-end payload encryption**. Every iframe load delivers a JWE-encrypted payload that only the plugin's backend can decrypt. The Backend Token, configuration, entity context, and secrets are never readable in the DOM or in any intermediate layer.
- **Secrets isolation**. Secret configuration values are encrypted in the installer's browser using the revision's `publicKey` and are stored as ciphertext only. The outer payload envelope is then encrypted again with the same public key. Crystallize never sees plaintext secrets — not during install, not during storage, not during runtime delivery, not during the post-install webhook.
- **No code execution in the UI**. The App UI only renders iframes, links, and forms. No vendor code runs in the App UI's JavaScript context.
- **Plugin-to-App UI communication**. A defined protocol (postMessage-based) governs iframe ↔ parent communication, through `@crystallize/plugin-signal`. See [App Channel](#app-channel).
- **Vendor trust**. Installing a plugin means trusting the vendor with any secrets passed, and with the tenant's `signatureSecret` and `staticAuthToken`, which every payload carries when the tenant has them. The Plugin Store surfaces vendor identity clearly.
- **Webhook idempotency**. The post-install webhook is fire-and-forget with no retries. Design your handler to be idempotent and to tolerate occasional lost events — the authoritative state always lives on the next iframe load's payload, which carries full `configuration` and `encryptedSecrets`.
