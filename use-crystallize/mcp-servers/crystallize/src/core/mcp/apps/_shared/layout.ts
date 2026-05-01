/// <reference lib="dom" />
import "./layout.css";

const LOGO_SVG = `<svg class="logo" viewBox="0 0 70 103" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g clip-path="url(#crystallize-logo-clip)">
        <path d="M55.3669 45.4332L40.3462 103.691L20.9543 91.2957L35.9764 0L57.8921 35.6656L55.3669 45.4332Z" fill="#FFBB72"/>
        <path d="M13.8175 47.1943L8.64261 83.4155L5.72941 81.5571L0 39.4316L13.8175 47.1943Z" fill="#FFEDD5"/>
        <path d="M30.2282 23.1053L19.1965 90.167L10.4192 84.5543L21.1874 9.18439L30.2282 23.1053Z" fill="#FFD6A5"/>
        <path d="M69.7476 42.8161L57.3187 90.8097L49.0844 97.6397L42.521 102.951L56.5527 48.5275L69.7476 42.8161Z" fill="#FD943A"/>
    </g>
    <defs>
        <clipPath id="crystallize-logo-clip"><rect width="69.5" height="103" fill="white"/></clipPath>
    </defs>
</svg>`;

export type LayoutOptions = {
    title?: string;
};

export function mountLayout({ title }: LayoutOptions = {}): void {
    const header = document.createElement("header");
    header.className = "layout-header";
    header.innerHTML = `
        <div class="brand">
            ${LOGO_SVG}
            <div class="wordmark">
                <span class="name">Crystallize</span>
                <span class="tag">MCP</span>
            </div>
        </div>
        ${title ? `<div class="divider"></div><div class="app-title">${escapeHtml(title)}</div>` : ""}
        <div class="spacer"></div>
    `;
    document.body.insertBefore(header, document.body.firstChild);
}

function escapeHtml(s: string): string {
    return s.replace(
        /[&<>"']/g,
        (c) =>
            (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<string, string>)[c]!,
    );
}
