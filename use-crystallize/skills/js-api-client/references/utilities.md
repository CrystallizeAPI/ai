# Crystallize JS API Client — Utilities

---

## GraphQL Builder

Use `json-to-graphql-query` (bundled) to build queries from plain objects:

```typescript
import { jsonToGraphQLQuery } from "json-to-graphql-query";

const query = jsonToGraphQLQuery({
  query: {
    catalogue: {
      __args: { path: "/shop", language: "en" },
      name: true,
      path: true,
    },
  },
});
```

---

## Signature Verification

Verify Crystallize webhook signatures for both POST and GET requests:

```typescript
import jwt from "jsonwebtoken";
import { createHmac } from "crypto";
import { createSignatureVerifier } from "@crystallize/js-api-client";

const secret = process.env.CRYSTALLIZE_SIGNATURE_SECRET!;

const verify = createSignatureVerifier({
  secret,
  jwtVerify: async (token, s) => jwt.verify(token, s) as any,
  sha256: async (data) =>
    createHmac("sha256", secret).update(data).digest("hex"),
});

// POST webhook
await verify(signatureJwtFromHeader, {
  url: request.url,
  method: "POST",
  body: rawBodyString,
});

// GET webhook
await verify(signatureJwtFromHeader, {
  url: request.url,
  method: "GET",
  webhookUrl: "https://example.com/api/webhook",
});
```

---

## Binary File Manager

Upload files to your tenant and get back a key for use in PIM mutations:

```typescript
import { createBinaryFileManager } from "@crystallize/js-api-client";

const files = createBinaryFileManager(api);
const key = await files.uploadImage("/absolute/path/to/picture.jpg");
// Use `key` in subsequent PIM mutations
```

---

## Pricing Utilities

Calculate tiered pricing (graduated or volume):

```typescript
import { pricesForUsageOnTier } from "@crystallize/js-api-client";

const total = pricesForUsageOnTier(
  1200, // usage
  [
    { threshold: 0, price: 0, currency: "USD" },
    { threshold: 1000, price: 0.02, currency: "USD" },
  ],
  "graduated",
);
```

---

## Request Profiling

Log request timing for debugging and performance analysis:

```typescript
const api = createClient(
  { tenantIdentifier: "furniture" },
  {
    profiling: {
      onRequest: (q) => console.debug("[CRYSTALLIZE] >", q),
      onRequestResolved: ({ resolutionTimeMs, serverTimeMs }, q) =>
        console.debug(
          "[CRYSTALLIZE] <",
          resolutionTimeMs,
          "ms (server",
          serverTimeMs,
          "ms)",
        ),
    },
  },
);
```
