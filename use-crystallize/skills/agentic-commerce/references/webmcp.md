# WebMCP: tools in the store's own pages

> **Status: early preview.** WebMCP runs in Chromium 146.0.7672+ with `chrome://flags/#enable-webmcp-testing`,
> under a draft W3C Community Group spec, and no major browser supports it natively yet. Chrome-specific parts:
> `consequentialHint` from Chrome 154; `toolactivated`/`toolcancel` dispatched on `document.modelContext` from
> Chrome 156 (on `window` before that). Neither Crystallize store behind this skill ships WebMCP yet: what follows
> is the design from a Modern Web Guidance v1.0 audit of one of them, not tested code. Follow Chrome's MWG guides
> (`guides/webmcp/webmcp.md`, `agentic-forms.md`, `agentic-javascript-tools.md`) for the API itself.

## How it relates to the MCP server

|                       | Remote MCP server ([mcp-server.md](mcp-server.md))       | WebMCP                                                                          |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Agent                 | Claude, ChatGPT and other hosts, with no browser session | The agent inside the shopper's own tab (Gemini in Chrome, extensions, DevTools) |
| Shopper               | OAuth token                                              | The page's session: cookies, market, VAT mode, taste                            |
| Basket                | `cartId` and a hand-off link                             | The page's cart cookie; no `cartId`, no OAuth                                   |
| What the shopper sees | Cards in the chat                                        | The page itself updating as the agent works                                     |

Both call the same code: the storefront's server actions (`addToCart`, `setQuantity`, the cart view, checkout,
booking availability) and the same search and ranking as the MCP tools. **Use the MCP server's tool names**
(snake_case, the same nouns), so an agent that knows one surface knows the other.

## Prerequisites

Fix these first; they are also what the tools' schemas are built from:

- **Labelled native controls.** Quantity is `<input type="number" name="quantity" min="1">`, not a `<span>`
  between buttons. Variant options are radio inputs in a `fieldset`/`legend`.
- **Errors in live regions**, and returned to the agent as strings.
- **Security headers**, at least the companion headers and a Report-Only CSP: tools act with the shopper's session,
  so an XSS becomes an agent acting as the shopper ([[storefront]] security headers).

## Declarative: agentic forms

Self-contained forms get `toolname` and `tooldescription`, and `toolparamdescription` on their fields. Browsers
without WebMCP ignore the attributes, so they are safe to ship now.

| Form           | Attributes                                                                                                  | Notes                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header search  | `toolname="search_products"`, a `tooldescription` naming what can be searched, `toolautosubmit` (read-only) | `toolparamdescription` on `q` with examples. Wrap the form in `<search>`. On `agentInvoked`, `respondWith` the results JSON instead of navigating |
| Add to basket  | `toolname="add_to_cart"`, `toolautosubmit` (low-risk and reversible)                                        | Wrap the variant `fieldset` and the quantity input in the form. `respondWith` the updated basket summary                                          |
| Card checkout  | `toolname="place_order"`, **no** `toolautosubmit` (financial)                                               | The browser stops for the shopper to review. Style `form:tool-form-active` and `button:tool-submit-active`                                        |
| Invoice, quote | `toolname="order_on_invoice"`, `toolname="request_quote"`, no autosubmit                                    | `toolparamdescription` on the PO reference and project fields                                                                                     |

```html
<!-- Design, not tested code: attribute names from the MWG agentic-forms guide. -->
<search>
    <form
        action="/en/search"
        method="get"
        toolname="search_products"
        toolautosubmit
        tooldescription="Search the catalogue by words, brand or spec, and list matching products."
    >
        <input
            name="q"
            type="search"
            aria-label="Search"
            toolparamdescription="e.g. '18V impact driver over 200 Nm', 'Makita 40V angle grinder'"
        />
    </form>
</search>
```

**Never `toolautosubmit` on a form that spends money.** Not declarative: facet sidebars made of links, and forms
with highly dependent fields (a rental booking where depot, period and start day depend on each other and on
fetched availability).

## Imperative: tools registered in JavaScript

For what isn't a form: filters, the current product, the cart. In React, register them with `useWebMCP` from
`use-webmcp-tool` (the package MWG mandates for React), in one client component mounted in the layout, using
`enabled` per route rather than conditional hooks.

| Tool                           | Route                 | Does                                                                                                              | Hint                                      |
| ------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `list_filters`                 | Category, brand pages | The facet groups and values with counts on this page                                                              | `readOnlyHint: true`                      |
| `filter_products`              | Same                  | Navigates to the filtered URL, waits for the render, returns the active filters and the count                     | `readOnlyHint: true`                      |
| `get_product`                  | Product page          | The current product: variants (SKU, price in the active VAT mode, stock) and typed specs, in the MCP tool's shape | `readOnlyHint: true`                      |
| `view_cart`                    | All                   | Basket lines and totals; opens the drawer                                                                         | `readOnlyHint: true`                      |
| `update_cart_line`             | All                   | Sets a quantity; 0 removes the line                                                                               | none (reversible)                         |
| Booking availability, `book_…` | Bookable products     | Wrap the availability and booking actions                                                                         | read-only, then `consequentialHint: true` |
| `checkout`                     | Cart                  | Only if you want one tool rather than the checkout forms                                                          | `consequentialHint: true`                 |

- **Feature-detect** (`'modelContext' in document`) before registering anything.
- **Validate input inside `execute`**, pass the `AbortSignal` on to `fetch`, and **return errors as values**
  (`{ error }`) rather than throwing.
- **Register per page with an `AbortSignal`**, so tools disappear when the shopper navigates away.
- `consequentialHint` is not an enforcement mechanism: keep the in-page confirmation for orders.
- Add `webmcp-types` to `tsconfig` `types`.

## Testing

Test with the Chrome flag on, and in a Node test through `getTools()` / `executeTool()`. Your own on-site
assistant can later discover the page's tools the same way, for example to open the cart drawer.
