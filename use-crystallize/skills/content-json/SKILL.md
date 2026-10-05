---
name: content-json
description: Generate Crystallize Rich Text Content JSON — the tree-based AST format used by Crystallize for structured rich text. Use this skill whenever the user needs to create, convert, or manipulate rich text content for Crystallize, including converting HTML/Markdown to Crystallize JSON, building content programmatically, or understanding the Content Transformer format. Also use when the user mentions "rich text JSON", "content nodes", "Crystallize content format", or needs to populate rich text components.
---

# Crystallize Rich Text Content JSON

You are generating rich text content in the **Crystallize Content Transformer JSON** format — a tree of nodes representing structured rich text (similar to an AST).

The output must be a **JSON array of block nodes** (or a single node object when used inline).

## Node Structure

Every node has these properties:

| Property      | Type                  | Required | Description |
|---------------|-----------------------|----------|-------------|
| `kind`        | `"block"` or `"inline"` | yes   | Block-level or inline |
| `type`        | `string` or `null`    | yes      | Semantic content type (see tables below) |
| `textContent` | `string`              | no       | Raw text (leaf nodes only — mutually exclusive with `children`) |
| `children`    | `node[]`              | no       | Child nodes (mutually exclusive with `textContent`) |
| `metadata`    | `object`              | no       | Extra attributes (e.g. `{ "href": "..." }` for links, `{ "id": "..." }` for any element) |

A node is either a **leaf** (has `textContent`) or a **branch** (has `children`). Never set both.

## Block Node Types (`kind: "block"`)

| `type`            | HTML equivalent | Notes |
|-------------------|-----------------|-------|
| `"paragraph"`     | `<p>`           | Most common block type |
| `"heading1"` – `"heading6"` | `<h1>` – `<h6>` | |
| `"unordered-list"`| `<ul>`          | Children must be `list-item` |
| `"ordered-list"`  | `<ol>`          | Children must be `list-item` |
| `"list-item"`     | `<li>`          | |
| `"quote"`         | `<blockquote>`  | Block quote |
| `"code"`          | `<code>`        | Code block |
| `"preformatted"`  | `<pre>`         | Preformatted text |
| `"table"`         | `<table>`       | Contains `table-row` directly |
| `"table-row"`     | `<tr>`          | Contains `table-cell` or `table-head-cell` |
| `"table-cell"`    | `<td>`          | Contains block content (`paragraph`) |
| `"table-head-cell"` | `<th>`       | Contains block content (`paragraph`) |
| `"horizontal-line"` | `<hr>`       | Self-closing, no children/textContent needed |
| `"image"`         | `<img>`         | Self-closing, use metadata for src, alt etc. |
| `"container"`     | `<div>`         | Generic block container |
| `"section"`       | `<section>`     | |
| `"article"`       | `<article>`     | |
| `"address"`       | `<address>`     | |
| `"figure"`        | `<figure>`      | |
| `"figcaption"`    | `<figcaption>`  | |
| `"details"`       | `<details>`     | |
| `"deleted"`       | `<del>`         | |
| `"picture"`       | `<picture>`     | |
| `"title-of-a-work"` | `<cite>`     | |

## Inline Node Types (`kind: "inline"`)

| `type`           | HTML equivalent | Notes |
|------------------|-----------------|-------|
| `null`           | (none)          | Plain text wrapper — use `textContent` for raw text |
| `"strong"`       | `<strong>`      | Bold |
| `"emphasized"`   | `<em>`          | Italic |
| `"underlined"`   | `<u>`           | |
| `"link"`         | `<a>`           | Requires `metadata.href`. Optionally `metadata.target` |
| `"highlight"`    | `<mark>`        | |
| `"subscripted"`  | `<sub>`         | |
| `"superscripted"`| `<sup>`         | |
| `"line-break"`   | `<br>`          | Self-closing |
| `"abbrevition"`  | `<abbr>`        | Note: this is the actual spelling used in the format |
| `"aside"`        | `<aside>`       | |
| `"container"`    | `<span>`        | Generic inline container |
| `"time"`         | `<time>`        | |

## Metadata

- **Links** (`type: "link"`): `{ "href": "https://...", "target": "_blank" }` — `href` and `target` are supported.
- **All elements**: `{ "id": "some-id" }` — the `id` attribute is valid on every node.
- No other HTML attributes are supported in metadata.

## Key Rules

1. **Text lives in leaf nodes only.** A paragraph contains inline children; those inline children hold the `textContent`.
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

2. **Formatting nodes (`strong`, `emphasized`, `underlined`, `link`, `highlight`, etc.) must use `children`, never `textContent` directly.** Only plain text nodes (`type: null`) and self-closing nodes may use `textContent` as a leaf.
   - ❌ `{ "kind": "inline", "type": "strong", "textContent": "bold text" }`
   - ✅ `{ "kind": "inline", "type": "strong", "children": [{ "kind": "inline", "type": null, "textContent": "bold text" }] }`

3. **No empty block nodes.** Every block node must have either `children` (with at least one child) or `textContent`. Do not emit blocks like `{ "kind": "block", "type": "paragraph" }` with neither.

4. **Preserve existing structure.** When the input already contains Crystallize JSON, preserve its formatting and structure. Do not restructure, re-wrap, or flatten nodes that are already valid.
   - Tables saved by the Crystallize App editor have `kind: "inline"` cells. Leave them as they are, but give new cells `kind: "block"`: only block cells render as `<td>`/`<th>` in the API's HTML output.

5. **`code` blocks inside `preformatted`** use `kind: "block"` and may hold `textContent` directly (they are leaf blocks). This is the one exception where a typed block node carries `textContent`.

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
        "children": [
          { "kind": "inline", "type": null, "textContent": "bold" }
        ]
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
    "children": [
      { "kind": "inline", "type": null, "textContent": "About Us" }
    ]
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
        "children": [
          { "kind": "inline", "type": null, "textContent": "our site" }
        ]
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
        "children": [
          { "kind": "inline", "type": null, "textContent": "First item" }
        ]
      },
      {
        "kind": "block",
        "type": "list-item",
        "children": [
          { "kind": "inline", "type": null, "textContent": "Second item" }
        ]
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
                "children": [
                  { "kind": "inline", "type": null, "textContent": "Name" }
                ]
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
                "children": [
                  { "kind": "inline", "type": null, "textContent": "Price" }
                ]
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
                "children": [
                  { "kind": "inline", "type": null, "textContent": "Shoe" }
                ]
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
                "children": [
                  { "kind": "inline", "type": null, "textContent": "42" }
                ]
              }
            ]
          }
        ]
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
      "children": [
        { "kind": "inline", "type": null, "textContent": "bold and italic" }
      ]
    }
  ]
}
```
