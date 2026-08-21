import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { styles } from "./styles";
import { physicsScript } from "./physics";
import { headMeta } from "./meta";
import { featuresGrid } from "./features";
import { analyticsHead } from "./analytics";

// The command is assembled from three parts so the toggle script can rebuild the
// middle (the URL + query string) live while keeping the prefix/headers fixed.
const INSTALL_PREFIX = "npx add-mcp ";
const INSTALL_BASE_URL = "https://mcp.crystallize.com/mcp";
const INSTALL_SUFFIX = ` --header "X-Crystallize-Access-Token-Id: YOUR_TOKEN_ID" --header "X-Crystallize-Access-Token-Secret: YOUR_TOKEN_SECRET"`;
const installCommand = `${INSTALL_PREFIX}${INSTALL_BASE_URL}${INSTALL_SUFFIX}`;

// Wires the feature-card switches: flipping a card appends/removes its query
// parameter and rewrites the install command above. Only non-default states add
// a parameter, so the default command is the clean read-only URL.
const toggleScript = /* js */ `
    (function () {
        var PREFIX = ${JSON.stringify(INSTALL_PREFIX)};
        var BASE = ${JSON.stringify(INSTALL_BASE_URL)};
        var SUFFIX = ${JSON.stringify(INSTALL_SUFFIX)};
        var cmd = document.getElementById("cmd");
        var block = cmd.closest(".code-block");
        var toggles = document.querySelectorAll(".feature-card.toggle");

        function isActive(card) {
            var on = card.classList.contains("on");
            return card.getAttribute("data-append-when") === "on" ? on : !on;
        }
        function rebuild() {
            var params = [];
            toggles.forEach(function (card) {
                var active = isActive(card);
                card.classList.toggle("param-active", active);
                var sub = card.querySelector(".feature-sub");
                if (sub) {
                    sub.textContent = active
                        ? card.getAttribute("data-caption-active")
                        : card.getAttribute("data-caption-default");
                }
                if (active) params.push(card.getAttribute("data-query"));
            });
            cmd.textContent = PREFIX + BASE + (params.length ? "?" + params.join("&") : "") + SUFFIX;
            if (block) {
                block.classList.remove("pulse");
                void block.offsetWidth;
                block.classList.add("pulse");
            }
        }
        function flip(card) {
            var on = !card.classList.contains("on");
            card.classList.toggle("on", on);
            card.setAttribute("aria-checked", String(on));
            rebuild();
        }
        toggles.forEach(function (card) {
            card.addEventListener("click", function () { flip(card); });
            card.addEventListener("keydown", function (e) {
                if (e.key === " " || e.key === "Enter" || e.key === "Spacebar") {
                    e.preventDefault();
                    flip(card);
                }
            });
        });
    })();
`;

const copyButtonScript = /* js */ `
    document.querySelector(".copy-btn").addEventListener("click", function () {
        var btn = this;
        var code = document.getElementById("cmd").textContent;
        navigator.clipboard
            .writeText(code)
            .then(function () {
                btn.textContent = "Copied!";
                btn.disabled = true;
                if (window.plausible) {
                    window.plausible("Copy Install Command");
                }
                setTimeout(function () {
                    btn.textContent = "Copy";
                    btn.disabled = false;
                }, 3000);
            })
            .catch(function () {
                btn.textContent = "Error!";
            });
    });
`;

type LandingPageOptions = {
    /** Plausible's site-specific `pa-XXXX.js` URL. Omitted (local dev, previews) means no script is emitted. */
    plausibleScriptUrl?: string;
    /** Plausible Events API endpoint, passed to the script through `plausible.init()`. */
    plausibleEndpoint: string;
};

export function landingPage({ plausibleScriptUrl, plausibleEndpoint }: LandingPageOptions): HtmlEscapedString {
    return html`
        <!doctype html>
        <html lang="en">
            <head>
                ${headMeta} ${analyticsHead({ scriptUrl: plausibleScriptUrl, endpoint: plausibleEndpoint })}
                <style>
                    ${raw(styles)}
                </style>
            </head>
            <body>
                <canvas id="pinball"></canvas>

                <div id="top-logo">
                    <img src="https://crystallize.com/crystallize-logo/crystallize-logo.svg" alt="Crystallize" />
                </div>

                <div id="content">
                    <h1>Commerce data.<br />MCP-ready.</h1>
                    <p class="description">
                        Connect your coding agent to Crystallize. Query catalogs, mutate content, manage pricing — all
                        through natural language.
                    </p>

                    <div class="code-block">
                        <button class="copy-btn">Copy</button>
                        <pre id="cmd">${installCommand}</pre>
                    </div>

                    <p class="hint">
                        Read-only by default. Toggle the cards below to add write, skills, or UI tools — the command
                        above updates as you go. Prefer everything bundled? Install the
                        <a
                            href="https://github.com/crystallizeapi/ai/tree/main/use-crystallize"
                            target="_blank"
                            rel="noopener"
                            >Claude plugin</a
                        >.
                    </p>

                    <p class="hint">
                        Get tokens at
                        <a href="https://app.crystallize.com" target="_blank" rel="noopener">app.crystallize.com</a>
                        → Settings → Access Tokens
                    </p>

                    ${featuresGrid}

                    <p class="hint" style="margin-top: 32px;">
                        Open Source on
                        <a href="https://github.com/crystallizeapi/ai" target="_blank" rel="noopener">GitHub</a>
                        · Skills, MCP server & usage guide in the
                        <a href="https://crystallizeapi.github.io/ai" target="_blank" rel="noopener">Documentation</a>.
                    </p>

                    <p class="sling-hint">Drag anywhere to slingshot products ✨</p>
                </div>

                <script src="https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js"></script>
                <script>
                    ${raw(copyButtonScript)};
                </script>
                <script>
                    ${raw(toggleScript)};
                </script>
                <script>
                    ${raw(physicsScript)};
                </script>
            </body>
        </html>
    ` as HtmlEscapedString;
}
