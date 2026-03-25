import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

const command = `npx add-mcp https://mcp.crystallize.com/mcp --header "X-Crystallize-Access-Token-Id: YOUR_TOKEN_ID" --header "X-Crystallize-Access-Token-Secret: YOUR_TOKEN_SECRET"`;

const physicsScript = /* js */ `
(function() {
    var Engine = Matter.Engine,
        Runner = Matter.Runner,
        Bodies = Matter.Bodies,
        Body = Matter.Body,
        Composite = Matter.Composite,
        Events = Matter.Events;

    var W = window.innerWidth;
    var H = window.innerHeight;
    var canvas = document.getElementById('pinball');
    canvas.width = W;
    canvas.height = H;

    var engine = Engine.create({ gravity: { x: 0, y: 0.6 } });
    var world = engine.world;

    var wallT = 60;
    var walls = [
        Bodies.rectangle(W / 2, -wallT / 2, W + wallT * 2, wallT, { isStatic: true, render: { visible: false } }),
        Bodies.rectangle(W / 2, H + wallT / 2, W + wallT * 2, wallT, { isStatic: true, render: { visible: false } }),
        Bodies.rectangle(-wallT / 2, H / 2, wallT, H + wallT * 2, { isStatic: true, render: { visible: false } }),
        Bodies.rectangle(W + wallT / 2, H / 2, wallT, H + wallT * 2, { isStatic: true, render: { visible: false } })
    ];
    Composite.add(world, walls);

    /* ── Feature bodies (synced to HTML cards) ──────── */
    var featureBodies = [];
    var contentEl = document.getElementById('content');
    function syncFeatures() {
        featureBodies.forEach(function(b) { Composite.remove(world, b); });
        featureBodies = [];
        var cards = document.querySelectorAll('.feature-card');
        cards.forEach(function(card, i) {
            var r = card.getBoundingClientRect();
            var b = Bodies.rectangle(r.left + r.width/2, r.top + r.height/2, r.width, r.height, {
                isStatic: true, restitution: 1.3, label: 'feature-' + i, plugin: { idx: i }
            });
            Composite.add(world, b);
            featureBodies.push(b);
        });
    }
    setTimeout(syncFeatures, 300);
    var scrollTimer;
    contentEl.addEventListener('scroll', function() {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(syncFeatures, 50);
    });

    /* ── Product images ──────────────────────────────── */
    var CDN = 'https://crystallize.com/minigames/pricing/';
    var productNames = [
        'burger','cheddar','chili','donut','flour','gauda',
        'hotdog','pizza','shoe','tee-blue','tee-pink',
        'tomato','unicorn'
    ];
    var productImages = {};
    var imagesLoaded = 0;
    productNames.forEach(function(name) {
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function() { imagesLoaded++; };
        img.src = CDN + name + '.png';
        productImages[name] = img;
    });

    var MAX_PRODUCTS = 30;
    var products = [];

    function spawnProduct(x, y, vx, vy) {
        if (products.length >= MAX_PRODUCTS) {
            var old = products.shift();
            Composite.remove(world, old);
        }
        var name = productNames[Math.floor(Math.random() * productNames.length)];
        var size = 20 + Math.random() * 12;
        var p = Bodies.circle(x, y, size, {
            restitution: 0.7,
            friction: 0.05,
            frictionAir: 0.005,
            render: { visible: false },
            label: 'product',
            plugin: { imgName: name, size: size }
        });
        Body.setVelocity(p, { x: vx || 0, y: vy || 0 });
        // Random gentle spin
        Body.setAngularVelocity(p, (Math.random() - 0.5) * 0.1);
        Composite.add(world, p);
        products.push(p);
        return p;
    }


    /* ── Slingshot ────────────────────────────────────── */
    var sling = { active: false, sx: 0, sy: 0, mx: 0, my: 0 };

    canvas.addEventListener('pointerdown', function(e) {
        sling.active = true;
        sling.sx = e.clientX;
        sling.sy = e.clientY;
        sling.mx = e.clientX;
        sling.my = e.clientY;
    });
    canvas.addEventListener('pointermove', function(e) {
        if (!sling.active) return;
        sling.mx = e.clientX;
        sling.my = e.clientY;
    });
    window.addEventListener('pointerup', function(e) {
        if (!sling.active) return;
        sling.active = false;
        var dx = sling.sx - sling.mx;
        var dy = sling.sy - sling.my;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 10) return;
        var power = Math.min(dist / 8, 25);
        var nx = dx / dist;
        var ny = dy / dist;
        spawnProduct(sling.sx, sling.sy, nx * power, ny * power);
    });

    /* ── Collision → animate HTML cards ────────────── */
    var hitTimers = [];
    Events.on(engine, 'collisionStart', function(event) {
        event.pairs.forEach(function(pair) {
            [pair.bodyA, pair.bodyB].forEach(function(b) {
                if (b.label && b.label.indexOf('feature-') === 0) {
                    var idx = b.plugin.idx;
                    var card = document.querySelectorAll('.feature-card')[idx];
                    if (!card) return;
                    card.classList.add('hit');
                    clearTimeout(hitTimers[idx]);
                    hitTimers[idx] = setTimeout(function() { card.classList.remove('hit'); }, 600);
                }
            });
        });
    });

    /* ── Render ───────────────────────────────────────── */
    var ctx = canvas.getContext('2d');
    var runner = Runner.create();
    Runner.run(runner, engine);

    function draw() {
        ctx.clearRect(0, 0, W, H);

        /* Products */
        Composite.allBodies(world).forEach(function(b) {
            if (b.label !== 'product') return;
            var p = b.plugin;
            var img = productImages[p.imgName];
            if (!img || !img.complete || !img.naturalWidth) return;
            var drawSize = p.size * 2.2;
            ctx.save();
            ctx.translate(b.position.x, b.position.y);
            ctx.rotate(b.angle);
            ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
            ctx.restore();
        });

        /* Draw slingshot aim line */
        if (sling.active) {
            var dx = sling.sx - sling.mx;
            var dy = sling.sy - sling.my;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 10) {
                var nx = dx / dist;
                var ny = dy / dist;
                var len = Math.min(dist, 200);

                ctx.save();
                ctx.setLineDash([6, 8]);
                ctx.lineDashOffset = -performance.now() / 40;
                ctx.beginPath();
                ctx.moveTo(sling.sx, sling.sy);
                ctx.lineTo(sling.sx + nx * len, sling.sy + ny * len);
                ctx.strokeStyle = 'rgba(255,191,74,0.7)';
                ctx.lineWidth = 2;
                ctx.stroke();

                /* Arrow head */
                ctx.setLineDash([]);
                var ax = sling.sx + nx * len;
                var ay = sling.sy + ny * len;
                var angle = Math.atan2(ny, nx);
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(ax - 10 * Math.cos(angle - 0.4), ay - 10 * Math.sin(angle - 0.4));
                ctx.moveTo(ax, ay);
                ctx.lineTo(ax - 10 * Math.cos(angle + 0.4), ay - 10 * Math.sin(angle + 0.4));
                ctx.strokeStyle = 'rgba(255,191,74,0.7)';
                ctx.lineWidth = 2;
                ctx.stroke();

                /* Spawn preview */
                var previewName = productNames[Math.floor(performance.now() / 2000) % productNames.length];
                var previewImg = productImages[previewName];
                if (previewImg && previewImg.complete && previewImg.naturalWidth) {
                    ctx.globalAlpha = 0.45;
                    ctx.drawImage(previewImg, sling.sx - 20, sling.sy - 20, 40, 40);
                    ctx.globalAlpha = 1;
                }

                ctx.restore();
            }
        }

        requestAnimationFrame(draw);
    }
    draw();

    /* ── Resize ──────────────────────────────────────── */
    var resizeTimeout;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(function() {
            var newW = window.innerWidth;
            var newH = window.innerHeight;
            canvas.width = newW;
            canvas.height = newH;

            /* Update walls */
            Body.setPosition(walls[0], { x: newW / 2, y: -wallT / 2 });
            Body.setVertices(walls[0], Bodies.rectangle(newW / 2, -wallT / 2, newW + wallT * 2, wallT).vertices);
            Body.setPosition(walls[1], { x: newW / 2, y: newH + wallT / 2 });
            Body.setVertices(walls[1], Bodies.rectangle(newW / 2, newH + wallT / 2, newW + wallT * 2, wallT).vertices);
            Body.setPosition(walls[2], { x: -wallT / 2, y: newH / 2 });
            Body.setVertices(walls[2], Bodies.rectangle(-wallT / 2, newH / 2, wallT, newH + wallT * 2).vertices);
            Body.setPosition(walls[3], { x: newW + wallT / 2, y: newH / 2 });
            Body.setVertices(walls[3], Bodies.rectangle(newW + wallT / 2, newH / 2, wallT, newH + wallT * 2).vertices);

            syncFeatures();

            W = newW;
            H = newH;
        }, 100);
    });
})();
`;

export function landingPage(): HtmlEscapedString {
    return html`
        <!doctype html>
        <html lang="en">
            <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>Crystallize MCP Server — Commerce Data, MCP-Ready</title>
                <meta
                    name="description"
                    content="Connect your AI coding agent to Crystallize. Query product catalogs, fetch content models, introspect schemas — all through natural language via the Model Context Protocol."
                />
                <link rel="canonical" href="https://mcp.crystallize.com" />

                <link rel="icon" type="image/svg+xml" href="https://crystallize.com/crystallize-logo/crystallize-logo.svg" />
                <link rel="shortcut icon" href="https://crystallize.com/favicon.ico" />

                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://mcp.crystallize.com" />
                <meta property="og:title" content="Crystallize MCP Server — Commerce Data, MCP-Ready" />
                <meta
                    property="og:description"
                    content="Connect your AI coding agent to Crystallize. Query product catalogs, fetch content models, introspect schemas — all through natural language via the Model Context Protocol."
                />
                <meta
                    property="og:image"
                    content="https://media.crystallize.com/crystallize_marketing/24/10/29/1/crystallize-meta-image.jpg"
                />

                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content="Crystallize MCP Server — Commerce Data, MCP-Ready" />
                <meta
                    name="twitter:description"
                    content="Connect your AI coding agent to Crystallize. Query product catalogs, fetch content models, introspect schemas — all through natural language via the Model Context Protocol."
                />
                <meta
                    name="twitter:image"
                    content="https://media.crystallize.com/crystallize_marketing/24/10/29/1/crystallize-meta-image.jpg"
                />

                <script type="application/ld+json">
                    {
                        "@context": "https://schema.org",
                        "@type": "SoftwareApplication",
                        "name": "Crystallize MCP Server",
                        "url": "https://mcp.crystallize.com",
                        "description": "Connect your AI coding agent to Crystallize via the Model Context Protocol. Query product catalogs, fetch content models, and introspect schemas through natural language.",
                        "applicationCategory": "DeveloperApplication",
                        "operatingSystem": "Any",
                        "offers": { "@type": "Offer", "price": "0" },
                        "provider": {
                            "@type": "Organization",
                            "name": "Crystallize AS",
                            "url": "https://crystallize.com",
                            "logo": "https://crystallize.com/static/logo.png",
                            "email": "hello@crystallize.com"
                        }
                    }
                </script>

                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
                <link
                    href="https://fonts.googleapis.com/css2?family=Roboto+Serif:wght@400;700&family=Roboto:wght@400;500&display=swap"
                    rel="stylesheet"
                />
                <style>
                    *,
                    *::before,
                    *::after {
                        box-sizing: border-box;
                        margin: 0;
                        padding: 0;
                    }
                    html,
                    body {
                        height: 100%;
                        overflow: hidden;
                    }
                    body {
                        background: #1a1333;
                        color: #fff;
                        font-family: "Roboto", sans-serif;
                    }
                    #pinball {
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        z-index: 0;
                        touch-action: none;
                    }

                    #content {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        z-index: 10;
                        overflow-y: auto;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        text-align: center;
                        padding: 24px;
                        pointer-events: none;
                    }
                    #content > * {
                        pointer-events: auto;
                    }
                    h1 {
                        font-family: "Roboto Serif", Georgia, serif;
                        font-size: 4rem;
                        font-weight: 700;
                        line-height: 1.08;
                        letter-spacing: -0.02em;
                        margin-bottom: 16px;
                        color: #fff;
                    }
                    .description {
                        font-family: "Roboto", sans-serif;
                        font-size: 1.25rem;
                        line-height: 1.55;
                        opacity: 0.55;
                        max-width: 600px;
                        margin-bottom: 32px;
                        font-weight: 400;
                    }
                    .code-block {
                        position: relative;
                        background: rgba(255, 255, 255, 0.06);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 10px;
                        padding: 14px 52px 14px 16px;
                        max-width: 640px;
                        width: 100%;
                        text-align: left;
                    }
                    pre {
                        margin: 0;
                        font-size: 12px;
                        white-space: pre-wrap;
                        word-wrap: break-word;
                        line-height: 1.6;
                        color: rgba(255, 255, 255, 0.75);
                        font-family: "SF Mono", SFMono-Regular, Consolas, monospace;
                    }
                    .copy-btn {
                        position: absolute;
                        top: 10px;
                        right: 10px;
                        background: rgba(255, 191, 74, 0.3);
                        color: #fff;
                        border: none;
                        border-radius: 6px;
                        padding: 5px 10px;
                        font-size: 11px;
                        font-weight: 700;
                        cursor: pointer;
                        transition: background 0.15s;
                    }
                    .copy-btn:hover {
                        background: rgba(255, 191, 74, 0.65);
                    }
                    .hint {
                        margin-top: 14px;
                        font-size: 0.78rem;
                        opacity: 0.3;
                    }
                    .hint a {
                        color: rgba(255, 191, 74, 0.85);
                        text-decoration: none;
                    }
                    .hint a:hover {
                        text-decoration: underline;
                    }

                    /* ── Top-left logo ── */
                    #top-logo {
                        position: fixed;
                        top: 20px;
                        left: 24px;
                        z-index: 20;
                        pointer-events: auto;
                    }
                    #top-logo img {
                        height: 56px;
                        opacity: 0.85;
                        display: block;
                    }

                    /* ── Feature grid ── */
                    .features-grid {
                        display: flex;
                        flex-direction: row;
                        gap: 8px;
                        max-width: 860px;
                        width: 100%;
                        margin-top: 64px;
                    }
                    .feature-card {
                        flex: 1;
                        position: relative;
                        background: rgba(255, 255, 255, 0.03);
                        border: 1px solid rgba(255, 255, 255, 0.07);
                        border-radius: 10px;
                        padding: 16px 12px 14px;
                        text-align: left;
                        display: flex;
                        flex-direction: column;
                        align-items: flex-start;
                        transition:
                            border-color 0.35s ease,
                            box-shadow 0.35s ease,
                            background 0.35s ease;
                    }
                    .feature-card.hit {
                        border-color: rgba(0, 186, 255, 0.5);
                        box-shadow:
                            0 0 24px rgba(0, 186, 255, 0.25),
                            inset 0 0 12px rgba(0, 186, 255, 0.08);
                        background: rgba(0, 186, 255, 0.04);
                    }
                    .feature-icon {
                        width: 34px;
                        height: 34px;
                        border-radius: 8px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin-bottom: 10px;
                        color: #fff;
                        flex-shrink: 0;
                    }
                    .feature-card h3 {
                        font-family: "Roboto", sans-serif;
                        font-size: 0.78rem;
                        font-weight: 500;
                        color: rgba(255, 255, 255, 0.92);
                        letter-spacing: -0.01em;
                    }
                    .badge {
                        position: absolute;
                        top: 10px;
                        right: 10px;
                        font-size: 0.58rem;
                        font-weight: 600;
                        letter-spacing: 0.06em;
                        text-transform: uppercase;
                        padding: 3px 8px;
                        border-radius: 4px;
                        background: rgba(0, 0, 0, 0.5);
                        border: 1px solid rgba(255, 255, 255, 0.12);
                        color: rgba(255, 255, 255, 0.7);
                    }
                    .sling-hint {
                        margin-top: 18px;
                        font-size: 0.72rem;
                        opacity: 0.2;
                        font-style: italic;
                        pointer-events: none;
                    }
                    @media (max-width: 860px) {
                        .features-grid {
                            flex-direction: column;
                        }
                    }
                    @media (max-width: 700px) {
                        #top-logo {
                            left: 0;
                            right: 0;
                            top: 16px;
                            display: flex;
                            justify-content: center;
                        }
                        #top-logo img {
                            height: 36px;
                        }
                        html,
                        body {
                            overflow: auto;
                            height: auto;
                        }
                        #pinball {
                            display: none;
                        }
                        #content {
                            position: relative;
                            padding: calc(52px + 2.808rem) 24px 64px;
                            justify-content: flex-start;
                        }
                        h1 {
                            font-size: 2.6rem;
                        }
                        .description {
                            font-size: 1.05rem;
                        }
                        .features-grid {
                            margin-top: 40px;
                            gap: 10px;
                        }
                        .feature-card {
                            padding: 20px 16px;
                        }
                    }
                    @media (max-width: 480px) {
                        h1 {
                            font-size: 2rem;
                        }
                        pre {
                            font-size: 10.5px;
                        }
                    }
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
                        Connect your coding agent to Crystallize. Query catalogs, mutate content, manage pricing — all through
                        natural language.
                    </p>

                    <div class="code-block">
                        <button class="copy-btn">Copy</button>
                        <pre id="cmd">${command}</pre>
                    </div>

                    <p class="hint">
                        Get tokens at
                        <a href="https://app.crystallize.com" target="_blank" rel="noopener">app.crystallize.com</a>
                        → Settings → Access Tokens
                    </p>

                    <div class="features-grid">
                        <div class="feature-card">
                            <div class="feature-icon" style="background: rgba(0, 186, 255, 0.18)">
                                <svg
                                    width="17"
                                    height="17"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="rgba(0,186,255,0.9)"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                >
                                    <circle cx="11" cy="11" r="7" />
                                    <path d="m21 21-4.35-4.35" />
                                </svg>
                            </div>
                            <h3>Query Data</h3>
                        </div>
                        <div class="feature-card">
                            <div class="feature-icon" style="background: rgba(168, 85, 247, 0.18)">
                                <svg
                                    width="17"
                                    height="17"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="rgba(168,85,247,0.9)"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                >
                                    <path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                                </svg>
                            </div>
                            <h3>Fetch Content Model</h3>
                        </div>
                        <div class="feature-card">
                            <div class="feature-icon" style="background: rgba(34, 197, 94, 0.18)">
                                <svg
                                    width="17"
                                    height="17"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="rgba(34,197,94,0.9)"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                >
                                    <polyline points="16 18 22 12 16 6" />
                                    <polyline points="8 6 2 12 8 18" />
                                </svg>
                            </div>
                            <h3>Introspect Schemas</h3>
                        </div>
                        <div class="feature-card">
                            <div class="feature-icon" style="background: rgba(244, 63, 94, 0.18)">
                                <svg
                                    width="17"
                                    height="17"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="rgba(244,63,94,0.9)"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                >
                                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                </svg>
                            </div>
                            <h3>Mutate Data</h3>
                            <span class="badge">Coming Soon</span>
                        </div>
                        <div class="feature-card">
                            <div class="feature-icon" style="background: rgba(99, 102, 241, 0.18)">
                                <svg
                                    width="17"
                                    height="17"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="rgba(99,102,241,0.9)"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                >
                                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                                </svg>
                            </div>
                            <h3>Access Skills</h3>
                        </div>
                    </div>

                    <p class="sling-hint">Drag anywhere to slingshot products ✨</p>
                </div>

                <script src="https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js"></script>
                <script>
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
                </script>
                <script>
                    ${raw(physicsScript)};
                </script>
            </body>
        </html>
    ` as HtmlEscapedString;
}
