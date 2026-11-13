# Product cards with MCP Apps

[MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) let a tool point at an HTML resource that the
host renders in a sandboxed iframe under the tool call. For a store, that means product cards with packshots,
key specs, price with its VAT label, stock and **Add to basket**, instead of a Markdown list. Claude (web,
desktop, mobile), ChatGPT, VS Code and Goose render them.

Crystallize's own MCP server has a `product-overview` app (`ui://crystallize/product-overview.html`); it is a
good starting point for the markup.

## One resource, many views

One HTML document renders every result the server produces: product carousels, a product detail with its
variants and spec sheet, the basket with quantity steppers, domain views (platforms, rentals, campaigns). The
tool's `structuredContent` says which (`kind: "products"`, `kind: "cart"`, …).

```ts
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

export const UI_RESOURCE_URI = "ui://my-store/cards.html";

registerAppResource(
    server,
    "My Store cards",
    UI_RESOURCE_URI,
    { description: "Interactive product cards, product detail and basket views.", mimeType: RESOURCE_MIME_TYPE },
    async () => ({
        contents: [
            {
                uri: UI_RESOURCE_URI,
                mimeType: RESOURCE_MIME_TYPE,
                text: appHtml(site),
                // The client script comes from the store, images from the Crystallize CDN.
                _meta: {
                    ui: { csp: { resourceDomains: [site, "https://media.crystallize.com"] }, prefersBorder: false },
                },
            },
        ],
    }),
);

// Every tool that returns products or the basket:
registerAppTool(server, "search_products", { /* … */ _meta: { ui: { resourceUri: UI_RESOURCE_URI } } }, handler);
```

- **The resource CSP lists the store's origin and the media host**, nothing else. With a custom media domain,
  list that instead. Missing it means cards without images.
- **Serve the ext-apps client bundle from the store's origin** (`public/mcp-app.js`), refreshed by a script when
  the package is upgraded, rather than from a third-party CDN.
- Ask Discovery for chat-sized images: `variants(types: "webp", maxWidth: 500)`.

## The app

The app talks to the host through the ext-apps `App` client. Buttons call **the same tools the model uses**, links
open through the host, and basket changes are reported back to the model:

```js
const app = new App({ name: "My Store", version: "1.0.0" }, {}, { autoResize: true });

app.ontoolinput = ({ arguments: args }) => {
    if (args?.cartId) state.cartId = args.cartId;
    if (args?.lang) state.lang = args.lang;
};
app.ontoolresult = (result) => show(result?.structuredContent, result);
app.onhostcontextchanged = (ctx) => applyCtx(ctx); // theme and host style variables

const call = (name, args) => app.callServerTool({ name, arguments: args });

async function tellModel(c) {
    await app.updateModelContext({
        content: [
            {
                type: "text",
                text: `Basket ${c.cartId}: ${c.count} items, ${c.total}. Pass cartId=${c.cartId} to basket tools. Checkout: ${c.checkoutUrl}`,
            },
        ],
        structuredContent: { cartId: c.cartId, count: c.count, total: c.total, checkoutUrl: c.checkoutUrl },
    });
}

// Add to basket: the same tool the model calls, with the cartId the app has seen.
el.addEventListener("click", async () => {
    const res = await call("add_to_cart", { sku, cartId: state.cartId ?? undefined, lang: state.lang });
    state.cartId = res.structuredContent?.cartId ?? state.cartId;
    await tellModel(res.structuredContent);
});

// Links open through the host; fall back to a new window.
app.openLink({ url }).catch(() => window.open(url, "_blank"));

await app.connect();
```

- **Use the host's style variables** (`--color-text-primary`, `--font-*`, `--border-radius-*`) for text outside the
  cards, with `light-dark()` fallbacks, so the app follows the host's light or dark theme. Keep the store's own look
  inside the cards.
- Show "Did you mean" suggestions as chips that call `search_products` with their arguments.
- A **Checkout in store** button opens the `checkoutUrl` hand-off ([../SKILL.md](../SKILL.md)).

## Host detection: what the text result says

The text result of a product tool is what the model reads. If the host renders cards and the text also lists the
products, the model repeats them in prose. If the host doesn't render cards and the text is thin, the shopper sees
nothing. So detect the host per call:

```ts
import { getUiCapability } from "@modelcontextprotocol/ext-apps/server";

const isUi = (tool?: ServerContext) => {
    // 2026-07-28 clients send their capabilities on every request.
    const declared = Boolean(getUiCapability(server.server.getClientCapabilities()));
    // Claude's hosted apps (web, desktop, mobile, Cowork) render cards but identify as Claude-User.
    const ua = tool?.http?.req?.headers.get("user-agent") ?? "";
    const ui = declared || /^Claude-User\b/i.test(ua);
    if (process.env.MCP_DEBUG) console.log(`[mcp] ui=${ui} declared=${declared} ua=${ua || "?"}`);
    return ui;
};
```

Then, in the result:

- **Cards on screen**: one paragraph that says so and gives the model just enough to reason and point:
  "Results for impact driver · 18 V: 6 product cards rendered for the user with pictures, key specs, prices,
  stock and Add-to-basket buttons. Do not repeat them — reply with one or two sentences (your pick and why).
  Shown: Name [variant] (SKU, 18 V · 226 Nm, €199, in stock); …". Add the "Did you mean" labels and their
  arguments.
- **No cards**: Markdown whose first line links to `/mcp/view?skus=…` ("See these with pictures →"), then each
  product as `**[name](url)**`, SKU, key specs, price, availability and `[Add to basket](buyUrl)`. No Markdown
  images: most hosts don't render them, or render them huge.
- **Both** carry the same `structuredContent`, which the app renders.

2025-era clients in stateless mode don't send capabilities, and get the Markdown. `MCP_DEBUG=1` logs the detection
per call; check it with each host you support.

## Image blocks

`get_product` also returns the packshot as an `image` content block (WebP, about 500 px). Claude shows it inline
even without MCP Apps. Fetch it with a short timeout and skip it above about 1.5 MB.

## The view page for hosts without cards

`/mcp/view?lang=…&skus=…` renders the storefront's own product cards in the tool's order, with a title. It is the
link the Markdown fallback starts with, so a shopper on any host is one click from pictures and prices. It is
`noindex` and disallowed in robots.txt.
