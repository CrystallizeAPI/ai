export const styles = /* css */ `
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
`;
