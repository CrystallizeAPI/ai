/// <reference lib="dom" />
/// <reference types="vite/client" />
import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mountLayout } from "../_shared/layout";
import "./mcp-app.css";

mountLayout({ title: "Tenant Overview" });

type Tenant = {
    id?: string;
    identifier?: string;
    name?: string;
    staticAuthToken?: boolean;
};

type Payload = {
    authType?: string;
    tenants?: Tenant[];
    fetchedAt?: string;
};

const tenantsEl = document.getElementById("tenants") as HTMLElement;
const authTypeEl = document.getElementById("auth-type") as HTMLElement;
const metaEl = document.getElementById("meta") as HTMLElement;
const refreshBtn = document.getElementById("refresh") as HTMLButtonElement;

function escapeHtml(s: unknown): string {
    return String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
            (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<string, string>)[c]!,
    );
}

function render(payload: Payload | null): void {
    if (!payload) {
        tenantsEl.innerHTML = '<div class="empty">No data yet — click Refresh.</div>';
        authTypeEl.innerHTML = "";
        metaEl.textContent = "";
        return;
    }
    const { authType, tenants = [], fetchedAt } = payload;
    authTypeEl.innerHTML = authType
        ? `<span class="badge">${escapeHtml(authType)}</span> <span>${tenants.length} tenant${tenants.length === 1 ? "" : "s"}</span>`
        : "";
    if (!tenants.length) {
        tenantsEl.innerHTML = '<div class="empty">No tenants resolved for this connection.</div>';
    } else {
        tenantsEl.innerHTML = tenants
            .map(
                (t) => `
                    <div class="card">
                        <div class="name">${escapeHtml(t.name || t.identifier || "(unnamed)")}</div>
                        <div class="row"><span class="k">Identifier</span><span class="v">${escapeHtml(t.identifier)}</span></div>
                        <div class="row"><span class="k">ID</span><span class="v">${escapeHtml(t.id)}</span></div>
                        ${t.staticAuthToken ? '<div class="row"><span class="k">Static Token</span><span class="v">yes</span></div>' : ""}
                    </div>
                `,
            )
            .join("");
    }
    metaEl.textContent = fetchedAt ? `Fetched at ${new Date(fetchedAt).toLocaleString()}` : "";
}

function extractPayload(result: CallToolResult | null | undefined): Payload | null {
    if (!result) return null;
    if (result.structuredContent) return result.structuredContent as Payload;
    const text = result.content?.find((c) => c.type === "text")?.text;
    if (text) {
        try {
            return JSON.parse(text) as Payload;
        } catch {
            return null;
        }
    }
    return null;
}

const app = new App({ name: "Crystallize Tenant Overview", version: "1.0.0" });
app.onerror = console.error;
app.ontoolresult = (result) => {
    console.log("Tool result received:", result);
    return render(extractPayload(result));
};

refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    try {
        const result = await app.callServerTool({ name: "tenant-overview", arguments: {} });
        render(extractPayload(result));
    } catch (e) {
        console.error(e);
    } finally {
        refreshBtn.disabled = false;
    }
});

await app.connect();
render(null);
