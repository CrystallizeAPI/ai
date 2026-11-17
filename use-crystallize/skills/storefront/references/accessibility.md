# Accessibility

The accessibility tree is what screen readers read, and it is also what AI browsers and in-browser agents read and
act on. A drawer that is hidden but focusable, or a quantity that is a `<span>` between two buttons, is broken for
both. These are the gaps a Modern Web Guidance (MWG v1.0) audit found on two Crystallize storefronts, with the fix
for each.

## Drawers and dialogs (cart, assistant, filters)

What was wrong: an `<aside role="dialog">` without `aria-modal`; when closed, a wrapper with `aria-hidden` that
stayed focusable (only translated off-screen), so Tab reached the hidden close button and textarea; when open,
the page behind was not inert, focus did not move in or come back, and Escape was a hand-written listener.

Use a native `<dialog>` opened with `showModal()`. The browser then makes the rest of the page inert, exposes a
modal dialog, handles Escape and returns focus on close.

- Name it with `aria-labelledby` pointing at its heading. Put `autofocus` on the first control.
- `closedby="any"` for light dismiss.
- **No** `role="dialog"`, focus trap or Escape handler of your own.
- **Never** `aria-hidden="true"` on a focusable element or its parent. A closed drawer is not rendered, or is
  `inert`.
- Don't lock scroll with `overflow: hidden` on `<html>` or `<body>` (layout shift, broken sticky elements). Use
  `overscroll-behavior: contain` on `dialog:modal` and `overflow: hidden` on `dialog::backdrop`.
- Closed drawers cast no shadow onto the page edge.

## Skip link

Put a skip link first in `<body>`, before the header and mega menu (WCAG 2.4.1). One store had about 60 KB of
header and menu, with dozens of links, before `<main>`.

```tsx
<body>
    <a href="#main" className="skip-link">
        {t.skipToContent}
    </a>
    <Header lang={lang} />
    <main id="main">{children}</main>
</body>
```

Style `.skip-link` off-screen until `:focus-visible`.

## Focus

- A focus indicator with a contrast ratio of **at least 3:1** against what is around it. A lime outline measured
  1.5:1 on the page's off-white.
- Inputs must not replace the outline with a 1 px border change.
- `:focus-visible`, not `:focus`.

## Forms: quantity, steppers, errors, autofill

- **Quantity is a labelled native control**: `<input type="number" name="quantity" min="1">`. Steppers have names
  that include the product ("Decrease quantity of Combi drill 18V"), not `−` or `−1`. An agent can then read and
  set the quantity instead of clicking N times, and an agentic form can build its schema from it.
- Variant options are native radio inputs in a `fieldset` with a `legend`.
- **Announce errors**: a live region (`role="alert"` for errors, `role="status"` for progress) or move focus to
  the message. A plain `<p class="error">` is silent.
- **Enter to submit** in a textarea or a search box checks `isComposing` (skip when
  `e.nativeEvent.isComposing || e.keyCode === 229`), so an IME user doesn't send half-composed text.
- **Autofill** on checkout fields: `autocomplete="email"`, `name`, `shipping street-address`, `postal-code`,
  `cc-number`, and so on. Offer guest checkout.

## Structure

- One `<h1>` per page, and an unbroken heading outline. Watch Suspense fallbacks: a fallback with its own `<h1>`
  plus the resolved content gave a category page two in the raw HTML.
- Breadcrumbs: `<nav aria-label="Breadcrumbs"><ol>`, the last item with `aria-current="page"`, dividers in CSS.
- Wrap search and filtering in `<search>` rather than `<form role="search">`.
- Landmarks: one `<main>`, labelled `<nav>`s.
- The search combobox: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, a `listbox`,
  and a real GET `action` so it works without JavaScript.
- Facets as plain GET links: every filtered view is crawlable, linkable and usable by an agent without JavaScript.

## Chat and streaming text

- A chat log is `role="log"`, but don't update it token by token: debounce, or announce the finished message.
- "Thinking" is `role="status"` text or a `<progress>`, not an `aria-label` on a `<p>`.
- Render model output as elements, never with `innerHTML`.

## Motion

Don't kill all motion with a global `animation-duration: 0.01ms` under `prefers-reduced-motion`. Drop the
movement (drawer slide, menu translate, scale on hover) and keep non-spatial transitions.
