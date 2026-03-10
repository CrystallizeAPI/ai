import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

const command = `npx add-mcp https://mcp.crystallize.com/mcp --header "X-Crystallize-Access-Token-Id: YOUR_TOKEN_ID" --header "X-Crystallize-Access-Token-Secret: YOUR_TOKEN_SECRET"`;

export function landingPage(): HtmlEscapedString {
    return html`<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Crystallize MCP Server</title>
    <style>
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%;font-family:'Roboto Slab',system-ui,sans-serif}
        body{display:flex;justify-content:center;align-items:center;background:#2c244a;color:#fff;padding:24px}
        main{text-align:center;padding:60px 48px;border-radius:12px;max-width:720px;width:100%;
            background:#2c244a;
            box-shadow:0 0 10px rgba(255,191,74,.6),0 0 20px rgba(255,191,74,.4),0 0 30px rgba(255,191,74,.3);
            animation:glow 1.5s infinite}
        @keyframes glow{
            0%,100%{box-shadow:0 0 10px rgba(255,191,74,.6),0 0 20px rgba(255,191,74,.4),0 0 30px rgba(255,191,74,.3)}
            50%{box-shadow:0 0 20px rgba(255,191,74,.8),0 0 30px rgba(255,191,74,.6),0 0 40px rgba(255,191,74,.5)}}
        .logo{width:56px;height:56px;margin-bottom:16px}
        h1{font-size:1.6rem;margin-bottom:8px}
        p{font-size:.95rem;opacity:.85;max-width:480px;margin:0 auto;line-height:1.5}
        .code-block{position:relative;background:#f5f5f5;border-radius:8px;padding:20px 56px 20px 20px;
            margin-top:32px;text-align:left;color:#1f1934}
        pre{margin:0;font-size:13px;white-space:pre-wrap;word-wrap:break-word;line-height:1.6}
        .copy-btn{position:absolute;top:8px;right:8px;background:rgba(255,191,74,.5);color:#1f1934;
            border:none;border-radius:4px;padding:6px 10px;font-size:11px;font-weight:bold;
            cursor:pointer;transition:background .15s}
        .copy-btn:hover{background:rgba(255,191,74,1)}
        .hint{margin-top:24px;font-size:.78rem;opacity:.6}
        .hint a{color:rgba(255,191,74,.9);text-decoration:none}
        .hint a:hover{text-decoration:underline}
        @media(max-width:540px){main{padding:40px 20px}}
    </style>
</head>
<body>
    <main>
        <img class="logo" src="https://crystallize.com/static/logo/crystallize-logo-api-cyan.svg" alt="Crystallize" />
        <h1>Crystallize MCP Server</h1>
        <p>Give your coding agents super Crystallize powers!</p>

        <div class="code-block">
            <button class="copy-btn">Copy</button>
            <pre id="cmd">${command}</pre>
        </div>

        <p class="hint">
            Get your access tokens from <a href="https://app.crystallize.com" target="_blank" rel="noopener">app.crystallize.com</a>
            → Settings → Access Tokens
        </p>
    </main>
    <script>
        document.querySelector('.copy-btn').addEventListener('click', function() {
            const btn = this;
            const code = document.getElementById('cmd').textContent;
            navigator.clipboard.writeText(code).then(() => {
                btn.textContent = 'Copied!';
                btn.disabled = true;
                setTimeout(() => { btn.textContent = 'Copy'; btn.disabled = false; }, 3000);
            }).catch(() => { btn.textContent = 'Error!'; });
        });
    </script>
</body>
</html>` as HtmlEscapedString;
}
