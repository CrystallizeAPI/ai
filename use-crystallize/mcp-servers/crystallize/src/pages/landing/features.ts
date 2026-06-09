import { html, raw } from "hono/html";

// A toggle card maps a feature to an MCP query parameter. `query` is appended to
// the install URL only when the card sits in its NON-default state — so the
// default command stays clean (read-only, skills + UI on).
type Toggle = {
    param: string;
    defaultOn: boolean;
    query: string; // "name=value" appended in the non-default state
    appendWhen: "on" | "off"; // append `query` when the card is on / off
    ariaLabel: string;
    // Captions reflect the card's CURRENT contribution to the URL: a neutral word
    // in the default (no-param) state, the actual `?param=value` token when active.
    // Avoids showing e.g. "?exposeSkills=false" while Skills are still enabled.
    captionDefault: string;
    captionActive: string;
};

type Feature = {
    color: string;
    rgba: string;
    svgPath: string;
    title: string;
    caption?: string; // static cards only; toggle cards use the toggle's captions
    toggle?: Toggle;
};

const features: Feature[] = [
    {
        color: "rgba(0, 186, 255, 0.18)",
        rgba: "rgba(0,186,255,0.9)",
        svgPath: '<circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" />',
        title: "Query Data",
        caption: "Always on",
    },
    {
        color: "rgba(168, 85, 247, 0.18)",
        rgba: "rgba(168,85,247,0.9)",
        svgPath: '<path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />',
        title: "Fetch Content Model",
        caption: "Always on",
    },
    {
        color: "rgba(34, 197, 94, 0.18)",
        rgba: "rgba(34,197,94,0.9)",
        svgPath: '<polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />',
        title: "Introspect Schemas",
        caption: "Always on",
    },
    {
        color: "rgba(244, 63, 94, 0.18)",
        rgba: "rgba(244,63,94,0.9)",
        svgPath: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />',
        title: "Mutate Data",
        toggle: {
            param: "exposeWrite",
            defaultOn: false,
            query: "exposeWrite=true",
            appendWhen: "on",
            ariaLabel: "Enable write tools — adds ?exposeWrite=true to the install command",
            captionDefault: "Read-only",
            captionActive: "?exposeWrite=true",
        },
    },
    {
        color: "rgba(99, 102, 241, 0.18)",
        rgba: "rgba(99,102,241,0.9)",
        svgPath:
            '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />',
        title: "Access Skills",
        toggle: {
            param: "exposeSkills",
            defaultOn: true,
            query: "exposeSkills=false",
            appendWhen: "off",
            ariaLabel: "Bundled Skills tool — turn off to add ?exposeSkills=false to the install command",
            captionDefault: "Included",
            captionActive: "?exposeSkills=false",
        },
    },
    {
        color: "rgba(45, 212, 191, 0.18)",
        rgba: "rgba(45,212,191,0.9)",
        svgPath:
            '<rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />',
        title: "UI Panels",
        toggle: {
            param: "exposeUi",
            defaultOn: true,
            query: "exposeUi=false",
            appendWhen: "off",
            ariaLabel: "Tenant & product overview panels — turn off to add ?exposeUi=false to the install command",
            captionDefault: "Included",
            captionActive: "?exposeUi=false",
        },
    },
];

function featureIcon(feature: Feature) {
    return html`
        <div class="feature-icon" style="background: ${feature.color}">
            <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="${feature.rgba}"
                stroke-width="2"
                stroke-linecap="round"
            >
                ${raw(feature.svgPath)}
            </svg>
        </div>
    `;
}

function featureCard(feature: Feature) {
    const t = feature.toggle;
    if (!t) {
        return html`
            <div class="feature-card">
                ${featureIcon(feature)}
                <h3>${feature.title}</h3>
                <span class="feature-sub">${feature.caption}</span>
            </div>
        `;
    }

    // `param-active` mirrors whether the query is currently in the URL, so the
    // caption lights up in sync with the command above.
    const active = t.appendWhen === "on" ? t.defaultOn : !t.defaultOn;
    const className = `feature-card toggle${t.defaultOn ? " on" : ""}${active ? " param-active" : ""}`;
    return html`
        <div
            class="${className}"
            role="switch"
            tabindex="0"
            aria-checked="${t.defaultOn ? "true" : "false"}"
            aria-label="${t.ariaLabel}"
            data-query="${t.query}"
            data-append-when="${t.appendWhen}"
            data-caption-default="${t.captionDefault}"
            data-caption-active="${t.captionActive}"
        >
            ${featureIcon(feature)}
            <span class="toggle-dot" aria-hidden="true"></span>
            <h3>${feature.title}</h3>
            <span class="feature-sub">${active ? t.captionActive : t.captionDefault}</span>
        </div>
    `;
}

export const featuresGrid = html` <div class="features-grid">${features.map(featureCard)}</div> `;
