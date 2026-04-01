import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { styles } from "./styles";
import { physicsScript } from "./physics";
import { headMeta } from "./meta";
import { featuresGrid } from "./features";

const installCommand = `npx add-mcp https://mcp.crystallize.com/mcp --header "X-Crystallize-Access-Token-Id: YOUR_TOKEN_ID" --header "X-Crystallize-Access-Token-Secret: YOUR_TOKEN_SECRET"`;

const copyButtonScript = /* js */ `
    document.querySelector(".copy-btn").addEventListener("click", function () {
        var btn = this;
        var code = document.getElementById("cmd").textContent;
        navigator.clipboard
            .writeText(code)
            .then(function () {
                btn.textContent = "Copied!";
                btn.disabled = true;
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

export function landingPage(): HtmlEscapedString {
    return html`
        <!doctype html>
        <html lang="en">
            <head>
                ${headMeta}
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
                    ${raw(physicsScript)};
                </script>
            </body>
        </html>
    ` as HtmlEscapedString;
}
