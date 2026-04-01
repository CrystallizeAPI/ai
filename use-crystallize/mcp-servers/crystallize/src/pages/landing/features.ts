import { html, raw } from "hono/html";

type Feature = {
    color: string;
    rgba: string;
    svgPath: string;
    title: string;
    badge?: string;
};

const features: Feature[] = [
    {
        color: "rgba(0, 186, 255, 0.18)",
        rgba: "rgba(0,186,255,0.9)",
        svgPath: '<circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" />',
        title: "Query Data",
    },
    {
        color: "rgba(168, 85, 247, 0.18)",
        rgba: "rgba(168,85,247,0.9)",
        svgPath: '<path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />',
        title: "Fetch Content Model",
    },
    {
        color: "rgba(34, 197, 94, 0.18)",
        rgba: "rgba(34,197,94,0.9)",
        svgPath: '<polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />',
        title: "Introspect Schemas",
    },
    {
        color: "rgba(244, 63, 94, 0.18)",
        rgba: "rgba(244,63,94,0.9)",
        svgPath: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />',
        title: "Mutate Data",
        badge: "Coming Soon",
    },
    {
        color: "rgba(99, 102, 241, 0.18)",
        rgba: "rgba(99,102,241,0.9)",
        svgPath:
            '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />',
        title: "Access Skills",
    },
];

function featureCard(feature: Feature) {
    return html`
        <div class="feature-card">
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
            <h3>${feature.title}</h3>
            ${feature.badge ? html`<span class="badge">${feature.badge}</span>` : ""}
        </div>
    `;
}

export const featuresGrid = html` <div class="features-grid">${features.map(featureCard)}</div> `;
