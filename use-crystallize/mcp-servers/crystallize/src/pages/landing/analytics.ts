import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

/**
 * Custom events stay invisible until a goal with the exact same name exists in
 * Plausible → Site Settings → Goals. Matching is character-for-character, and
 * unlike pageview goals these are NOT retroactive — the counter starts at zero
 * the day the goal is created. So create it before shipping.
 *
 * Only one: copying the install command is the page's single intent signal, the
 * line between "read the page" and "tried to install". The feature-card toggles
 * used to be tracked too and were dropped — what people fiddle with on the page
 * is a worse proxy for what they actually connect with, which the server-side
 * `/mcp/session/...` paths now measure directly.
 *
 * `Outbound Link: Click` is not listed — the script raises that one itself, with
 * the href attached as a `url` prop. `url` is one of Plausible's three *internal*
 * property keys, so that per-link breakdown works without the Business plan.
 */
export const CUSTOM_EVENT_GOALS = ["Copy Install Command"] as const;

type AnalyticsHeadOptions = {
    /**
     * The site-specific `pa-XXXX.js` URL, from Site Settings → Site installation.
     * Without it nothing is emitted — that is the kill switch for dev and previews.
     */
    scriptUrl?: string;
    /** Events API endpoint, from `PLAUSIBLE_API_ENDPOINT`. */
    endpoint: string;
};

/**
 * Head snippet for the landing page — Plausible's current (v2) tracking script.
 *
 * The site is identified by the script *filename*: the domain is compiled into
 * `pa-XXXX.js`, so there is no `data-domain` attribute (the v2 script does not
 * read one) and no `data-api` either — configuration goes through `init()`.
 *
 * Three things this script already does for us, verified by reading it:
 *   - `outboundLinks`, `fileDownloads` and `formSubmissions` are baked in as
 *     enabled, so the GitHub / documentation / app.crystallize.com links are
 *     tracked with no code and no Site Settings toggle.
 *   - `captureOnLocalhost` is off, and it skips `localhost`, `127.x`, `[::1]`
 *     and `file:` itself — so dev cannot pollute production stats even if the
 *     script URL is configured locally.
 *   - `autoCapturePageviews` is on, so the landing-page view needs no call.
 *
 * The shim is Plausible's own and is deliberately order-independent: `||` keeps
 * the real implementation if the async script already ran, and otherwise buffers
 * calls on `plausible.q` and config on `plausible.o`, both of which the real
 * script drains on load.
 */
export function analyticsHead({ scriptUrl, endpoint }: AnalyticsHeadOptions): HtmlEscapedString | string {
    if (!scriptUrl) {
        return "";
    }
    // Passing the endpoint explicitly, rather than relying on the script's default,
    // keeps the browser and the server-side tracker pointed at the same place — a
    // self-hosted or proxied deployment then has one value to change instead of two.
    // With the default endpoint this is exactly the bare `plausible.init()` that
    // Plausible's own snippet ships.
    const init = `plausible.init(${JSON.stringify({ endpoint })})`;
    return html`
        <!-- Privacy-friendly analytics by Plausible -->
        <script async src="${scriptUrl}"></script>
        <script>
            window.plausible =
                window.plausible ||
                function () {
                    (plausible.q = plausible.q || []).push(arguments);
                };
            plausible.init =
                plausible.init ||
                function (i) {
                    plausible.o = i || {};
                };
            ${raw(init)};
        </script>
    ` as HtmlEscapedString;
}
