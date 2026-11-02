---
name: content-json
description: Generate Crystallize rich text JSON, the node tree stored in `richText` components, paragraph bodies and image captions. Use when creating, converting or editing rich text for Crystallize, converting HTML or Markdown to Crystallize JSON, or debugging rich text that opens empty in the App. Also use when the user mentions "rich text JSON", "content nodes", "Crystallize content format" or the Content Transformer format.
---

# Crystallize Rich Text Content JSON

You are generating rich text content in the **Crystallize Content Transformer JSON** format — a tree of nodes representing structured rich text (similar to an AST).

The output must be a **JSON array of block nodes** (or a single node object when used inline).

## Node Structure

Every node has these properties:

| Property      | Type                    | Required | Description                                                                              |
| ------------- | ----------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `kind`        | `"block"` or `"inline"` | yes      | Block-level or inline                                                                    |
| `type`        | `string` or `null`      | yes      | Semantic content type (see tables below)                                                 |
| `textContent` | `string`                | no       | Raw text (leaf nodes only — mutually exclusive with `children`)                          |
| `children`    | `node[]`                | no       | Child nodes (mutually exclusive with `textContent`)                                      |
| `metadata`    | `object`                | no       | Extra attributes (e.g. `{ "href": "..." }` for links, `{ "id": "..." }` for any element) |

A node is either a **leaf** (has `textContent`) or a **branch** (has `children`). Never set both.

## Block Node Types (`kind: "block"`)

| `type`                      | HTML equivalent | Notes                                                                                                                                                                                         |
| --------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"paragraph"`               | `<p>`           | Most common block type                                                                                                                                                                        |
| `"heading1"` – `"heading6"` | `<h1>` – `<h6>` |                                                                                                                                                                                               |
| `"unordered-list"`          | `<ul>`          | Children must be `list-item`                                                                                                                                                                  |
| `"ordered-list"`            | `<ol>`          | Children must be `list-item`                                                                                                                                                                  |
| `"list-item"`               | `<li>`          |                                                                                                                                                                                               |
| `"quote"`                   | `<blockquote>`  | Block quote. API `html` output writes it as `<quote>`                                                                                                                                         |
| `"code"`                    | `<code>`        | Code block, inside `preformatted`. Inline code is the inline `code` node                                                                                                                      |
| `"preformatted"`            | `<pre>`         | Preformatted text                                                                                                                                                                             |
| `"table"`                   | `<table>`       | Contains `table-row` directly                                                                                                                                                                 |
| `"table-row"`               | `<tr>`          | Contains `table-cell` or `table-head-cell`                                                                                                                                                    |
| `"table-cell"`              | `<td>`          | Contains block content (`paragraph`)                                                                                                                                                          |
| `"table-head-cell"`         | `<th>`          | Contains block content (`paragraph`)                                                                                                                                                          |
| `"horizontal-line"`         | `<hr>`          | Self-closing, no children/textContent needed                                                                                                                                                  |
| `"image"`                   | `<img>`         | Shows no image: API `html` output is an empty `<img></img>`, the React `<ContentTransformer>` renders nothing and the App drops the node. Use an `images` component or a paragraph's `images` |
| `"container"`               | `<div>`         | Generic block container                                                                                                                                                                       |
| `"section"`                 | `<section>`     |                                                                                                                                                                                               |
| `"article"`                 | `<article>`     |                                                                                                                                                                                               |
| `"address"`                 | `<address>`     |                                                                                                                                                                                               |
| `"figure"`                  | `<figure>`      |                                                                                                                                                                                               |
| `"figcaption"`              | `<figcaption>`  |                                                                                                                                                                                               |
| `"details"`                 | `<details>`     |                                                                                                                                                                                               |
| `"deleted"`                 | `<del>`         | Keep it inside a block such as `paragraph`: at the root the App cannot open the content                                                                                                       |
| `"picture"`                 | `<picture>`     |                                                                                                                                                                                               |
| `"title-of-a-work"`         | `<cite>`        |                                                                                                                                                                                               |

## Inline Node Types (`kind: "inline"`)

| `type`            | HTML equivalent | Notes                                                                     |
| ----------------- | --------------- | ------------------------------------------------------------------------- |
| `null`            | (none)          | Plain text wrapper — use `textContent` for raw text                       |
| `"strong"`        | `<strong>`      | Bold                                                                      |
| `"emphasized"`    | `<em>`          | Italic                                                                    |
| `"underlined"`    | `<u>`           |                                                                           |
| `"deleted"`       | `<del>`         | Strikethrough, as the App writes it. API `html` output renders no tag     |
| `"code"`          | `<code>`        | Inline code, as the App writes it. API `html` output renders no tag       |
| `"link"`          | `<a>`           | Requires `metadata.href`. Optionally `metadata.target` and `metadata.rel` |
| `"highlight"`     | `<mark>`        |                                                                           |
| `"subscripted"`   | `<sub>`         |                                                                           |
| `"superscripted"` | `<sup>`         |                                                                           |
| `"line-break"`    | `<br>`          | Self-closing                                                              |
| `"abbrevition"`   | `<abbr>`        | Note: this is the actual spelling used in the format                      |
| `"aside"`         | `<aside>`       |                                                                           |
| `"container"`     | `<span>`        | Generic inline container                                                  |
| `"time"`          | `<time>`        |                                                                           |

## Metadata

- **Links** (`type: "link"`): `{ "href": "https://...", "target": "_blank", "rel": "nofollow" }` — `href`, `target` and `rel` are supported. API `html` output drops `rel`; the App and the React `<ContentTransformer>` keep it.
- **Code blocks** (`type: "code"`): `{ "language": "javascript" }` — the App's code language. API `html` output does not render it.
- **All elements**: `{ "id": "some-id" }` — the `id` attribute is valid on every node. Only API `html` output renders it, and the App drops it on save.
- No other HTML attributes are supported in metadata.

## Key Rules

1. **Text lives in leaf nodes only.** A paragraph with mixed formatting contains inline children; those inline children hold the `textContent`. A block with only plain text can carry it directly: `{ "kind": "block", "type": "paragraph", "textContent": "Hello" }` is what the App writes.
2. **Plain text** uses inline nodes with `type: null`: `{ "kind": "inline", "type": null, "textContent": "Hello" }`.
3. **Lists** must follow: `unordered-list`/`ordered-list` → `list-item` → inline/block content.
4. **Tables** must follow: `table` → `table-row` → `table-cell`/`table-head-cell` → `paragraph` → inline content. Cells use `kind: "block"`. A header is a first row of `table-head-cell`.
    - Never emit `table-head`, `table-body`, `table-footer` or `table-caption`: the Crystallize App editor drops them along with every row inside. When converting HTML, put the rows of `<thead>`/`<tbody>`/`<tfoot>` directly under `table`, and turn a `<caption>` into a paragraph before the table.
5. **Nested formatting** is done via `children`: e.g. bold + italic = `strong` node containing an `emphasized` child.
6. **Top-level output** is always an array of block nodes.

## Strict Formatting Enforcement

These rules are **mandatory** — every generated or modified node must comply. Validate the output before returning it.

1. **`type` is always required.** Every node must have an explicit `type` field. For plain text inlines, use `"type": null`. Never omit it.
    - ❌ `{ "kind": "inline", "textContent": "hello" }`
    - ✅ `{ "kind": "inline", "type": null, "textContent": "hello" }`

2. **Formatting nodes (`strong`, `emphasized`, `underlined`, `subscripted`, `superscripted`, `deleted`, inline `code`) hold one run of text**, in `textContent` or through a single chain of `children`. The App and `html` input write the first form below.
    - ✅ `{ "kind": "inline", "type": "strong", "textContent": "bold text" }`
    - ✅ `{ "kind": "inline", "type": "strong", "children": [{ "kind": "inline", "type": null, "textContent": "bold text" }] }`
    - ❌ `{ "kind": "inline", "type": "strong", "children": [<text>, <text>] }`: the App keeps only the last text, with every format applied to it. Emit sibling formatting nodes instead.
    - ❌ A `link` inside a formatting node: the App loses the link. Put the formatting inside the `link`.

3. **No empty block nodes.** Every block node must have either `children` (with at least one child) or `textContent`, except `horizontal-line`. Do not emit blocks like `{ "kind": "block", "type": "paragraph" }` with neither.

4. **Preserve existing structure.** When the input already contains Crystallize JSON, preserve its formatting and structure. Do not restructure, re-wrap, or flatten nodes that are already valid.
    - Tables saved by the Crystallize App editor have `kind: "inline"` cells. Leave them as they are, but give new cells `kind: "block"`: only block cells render as `<td>`/`<th>` in the API's HTML output.
    - The App writes plain text nodes without `type`, and an empty `paragraph` for a blank line. Leave those too.

5. **`code` blocks inside `preformatted`** use `kind: "block"` and hold the code in `textContent`, line breaks included. Give the `preformatted` node no `textContent` of its own: the App drops it.

## What the Crystallize App Keeps

The API stores any node, but the App's rich text editor only knows part of the format. Anything else is missing when the field opens, and an edit in the App saves the field without it. For content that will be edited in the App, stay within these types:

- **Blocks:** `paragraph`, `heading1`–`heading6`, `unordered-list`, `ordered-list`, `list-item`, `quote`, `preformatted` with `code`, `table`, `table-row`, `table-cell`, `table-head-cell`, `horizontal-line`.
- **Inline:** `null`, `strong`, `emphasized`, `underlined`, `subscripted`, `superscripted`, `deleted`, `code`, `link`, `line-break`.

The rest behaves like this:

- **Other block types** (`section`, `article`, `address`, `figure`, `figcaption`, `details`, `picture`, `image`, `title-of-a-work`) are dropped with all their children. When converting HTML, lift the children out of these wrappers.
- **`container` and `preformatted`** are unwrapped: their children stay, but `textContent` on a block-kind one is lost.
- **Other inline types** (`highlight`, `abbrevition`, `aside`, `time`) keep their text and lose the format when they use `textContent`. With `children` they are dropped, and so is a `type: null` node with `children`.
- **Content the App cannot open:** inline children directly in a root-level block `container` or `preformatted`, or a `deleted` block at the root. The field shows "We aren't able to display your rich text content due to an error in the data structure", and a reset there erases the content. Fix it through the API instead.

## Writing It to Crystallize

Rich text input is `json`, `html`, or both, each a list. It is the same on a `richText` component, a paragraph's `body` and an image's `caption`:

```json
{
    "componentId": "description",
    "richText": { "json": [{ "kind": "block", "type": "paragraph", "textContent": "Hello" }] }
}
```

- **`json` is not validated.** The API only removes empty entries, so a wrong `type` or a misspelt property is stored without an error. `isModelValid` from the public `@crystallize/content-transformer` package checks types and properties. It does not check nesting, so `table-head` passes, and it rejects App-saved nodes without `type` and the array entries described under Reading It Back.
- **`html` is converted on write** and stored as `json`, after any `json` sent with it. The package's `fromHTML` does the same conversion, so use it to preview the result. A string with one top-level element gives one node, and a string with several gives an array of nodes: send one string per block to keep `json` flat.
- **There is no Markdown input.** Markdown sent in `html` or `textContent` stays literal text, so convert it to nodes yourself.
- **A component's `required`, `min` and `max`** are measured on the plain text of the JSON, so nodes without text count as empty.

The `html` conversion loses content. Send `json` for any of these:

| In `html`      | What gets stored                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `<table>`      | Rows under a `table-body`, even with no `<tbody>` in the HTML, so the App drops them all                                           |
| `<blockquote>` | A `type: null` node, not `quote`, which the App drops if it wraps a `<p>`. Same for any tag the format does not map, such as `<s>` |
| `<div>`        | `container`. With only text, the App loses the text. With inline content at the root, the App cannot open the field                |
| `<pre>`        | Line breaks are removed, so multi-line code becomes one line. Without an inner `<code>`, the App loses the text                    |
| `<img>`        | `image` without `src` or `alt`                                                                                                     |
| Attributes     | Only `id`, and `href` and `target` on `<a>`, are kept                                                                              |

## Reading It Back

Rich text output on the Core and Catalogue APIs has `json`, `html` and `plainText`, with one `html` and one `plainText` string per `json` entry. On the Discovery API, a `richText` field and a paragraph's `body` take `format: json` (the default), `html` or `plainText`, and `html` comes back as one string.

- **A `json` entry is a node or an array of nodes**, the second from `html` input with several top-level elements. Handle both when editing. Before rendering, flatten with `json.flat()`: `<ContentTransformer>` from `@crystallize/reactjs-components` renders nothing for an array entry.
- **`Invalid crystallize-content-chunk:`** at the start of a Core API `html` or `plainText` string means that `json` entry is malformed, for example a `textContent` that is not a string.

## Examples

### Simple paragraph with bold text

```json
[
    {
        "kind": "block",
        "type": "paragraph",
        "children": [
            { "kind": "inline", "type": null, "textContent": "This is " },
            {
                "kind": "inline",
                "type": "strong",
                "children": [{ "kind": "inline", "type": null, "textContent": "bold" }]
            },
            { "kind": "inline", "type": null, "textContent": " text." }
        ]
    }
]
```

### Heading + paragraph with a link

```json
[
    {
        "kind": "block",
        "type": "heading2",
        "children": [{ "kind": "inline", "type": null, "textContent": "About Us" }]
    },
    {
        "kind": "block",
        "type": "paragraph",
        "children": [
            { "kind": "inline", "type": null, "textContent": "Visit " },
            {
                "kind": "inline",
                "type": "link",
                "metadata": { "href": "https://example.com", "target": "_blank" },
                "children": [{ "kind": "inline", "type": null, "textContent": "our site" }]
            },
            { "kind": "inline", "type": null, "textContent": " for more." }
        ]
    }
]
```

### Unordered list

```json
[
    {
        "kind": "block",
        "type": "unordered-list",
        "children": [
            {
                "kind": "block",
                "type": "list-item",
                "children": [{ "kind": "inline", "type": null, "textContent": "First item" }]
            },
            {
                "kind": "block",
                "type": "list-item",
                "children": [{ "kind": "inline", "type": null, "textContent": "Second item" }]
            }
        ]
    }
]
```

### Table with a header row

```json
[
    {
        "kind": "block",
        "type": "table",
        "children": [
            {
                "kind": "block",
                "type": "table-row",
                "children": [
                    {
                        "kind": "block",
                        "type": "table-head-cell",
                        "children": [
                            {
                                "kind": "block",
                                "type": "paragraph",
                                "children": [{ "kind": "inline", "type": null, "textContent": "Name" }]
                            }
                        ]
                    },
                    {
                        "kind": "block",
                        "type": "table-head-cell",
                        "children": [
                            {
                                "kind": "block",
                                "type": "paragraph",
                                "children": [{ "kind": "inline", "type": null, "textContent": "Price" }]
                            }
                        ]
                    }
                ]
            },
            {
                "kind": "block",
                "type": "table-row",
                "children": [
                    {
                        "kind": "block",
                        "type": "table-cell",
                        "children": [
                            {
                                "kind": "block",
                                "type": "paragraph",
                                "children": [{ "kind": "inline", "type": null, "textContent": "Shoe" }]
                            }
                        ]
                    },
                    {
                        "kind": "block",
                        "type": "table-cell",
                        "children": [
                            {
                                "kind": "block",
                                "type": "paragraph",
                                "children": [{ "kind": "inline", "type": null, "textContent": "42" }]
                            }
                        ]
                    }
                ]
            }
        ]
    }
]
```

### Code block

```json
[
    {
        "kind": "block",
        "type": "preformatted",
        "children": [
            {
                "kind": "block",
                "type": "code",
                "textContent": "const a = 1;\nconst b = 2;",
                "metadata": { "language": "javascript" }
            }
        ]
    }
]
```

### Bold + italic (nested inline formatting)

```json
{
    "kind": "inline",
    "type": "strong",
    "children": [
        {
            "kind": "inline",
            "type": "emphasized",
            "children": [{ "kind": "inline", "type": null, "textContent": "bold and italic" }]
        }
    ]
}
```
