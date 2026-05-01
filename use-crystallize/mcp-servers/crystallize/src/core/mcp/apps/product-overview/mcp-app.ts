/// <reference lib="dom" />
/// <reference types="vite/client" />
import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mountLayout } from "../_shared/layout";
import "./mcp-app.css";

mountLayout({ title: "Product Overview" });

type Image = { url?: string; altText?: string };

type PriceVariant = { currency?: string; price?: number; identifier?: string };

type Variant = {
    sku?: string;
    name?: string;
    isDefault?: boolean;
    defaultPrice?: number;
    firstImage?: Image;
    priceVariants?: PriceVariant[];
};

type Hit = {
    id?: string;
    name?: string;
    path?: string;
    type?: string;
    defaultVariant?: Variant;
    variants?: Variant[];
    [k: string]: unknown;
};

type TenantInfo = { id?: string; identifier?: string; name?: string };

type Summary = { totalHits?: number; endCursor?: string; hasMoreHits?: boolean };

type Payload = {
    tenant?: TenantInfo;
    language?: string;
    hits?: Hit[];
    summary?: Summary;
    fetchedAt?: string;
};

const itemsEl = document.getElementById("items") as HTMLElement;
const contextEl = document.getElementById("context") as HTMLElement;
const summaryEl = document.getElementById("summary") as HTMLElement;
const metaEl = document.getElementById("meta") as HTMLElement;

const expandedIds = new Set<string>();
const activeVariantBySku = new Map<string, string>();
let lastPayload: Payload | null = null;

function escapeHtml(s: unknown): string {
    return String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
            (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<string, string>)[c]!,
    );
}

function hitKey(hit: Hit, index: number): string {
    return hit.id || hit.path || `idx-${index}`;
}

function formatPrice(amount: number | undefined, currency: string | undefined): string {
    if (typeof amount !== "number" || !Number.isFinite(amount)) return "";
    if (currency) {
        try {
            return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
        } catch {
            return `${amount} ${currency}`;
        }
    }
    return amount.toString();
}

function pickVariant(hit: Hit, key: string): Variant | undefined {
    const active = activeVariantBySku.get(key);
    if (active && Array.isArray(hit.variants)) {
        const found = hit.variants.find((v) => v.sku === active);
        if (found) return found;
    }
    if (hit.defaultVariant) return hit.defaultVariant;
    if (Array.isArray(hit.variants) && hit.variants.length) {
        return hit.variants.find((v) => v.isDefault) ?? hit.variants[0];
    }
    return undefined;
}

function readCurrency(variant: Variant | undefined): string | undefined {
    if (!variant) return undefined;
    const pv = variant.priceVariants;
    if (Array.isArray(pv) && pv.length) {
        const def = pv.find((p) => p.identifier === "default") ?? pv[0];
        if (def?.currency) return def.currency;
    }
    return undefined;
}

function readPrice(variant: Variant | undefined): number | undefined {
    if (!variant) return undefined;
    if (typeof variant.defaultPrice === "number") return variant.defaultPrice;
    const pv = variant.priceVariants;
    if (Array.isArray(pv) && pv.length) {
        const def = pv.find((p) => p.identifier === "default") ?? pv[0];
        if (typeof def?.price === "number") return def.price;
    }
    return undefined;
}

function renderImage(variant: Variant | undefined, name: string | undefined): string {
    const url = variant?.firstImage?.url;
    if (url) {
        const alt = variant?.firstImage?.altText ?? name ?? "";
        return `<img class="image" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
    }
    const initial = (name ?? "?").trim().charAt(0) || "?";
    return `<div class="placeholder" aria-hidden="true">${escapeHtml(initial)}</div>`;
}

function renderTypePill(type: string | undefined): string {
    if (!type) return "";
    return `<span class="type-pill">${escapeHtml(type)}</span>`;
}

function renderRow(label: string, value: string): string {
    if (!value) return "";
    return `<div class="row"><span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(value)}</span></div>`;
}

function renderVariantsStrip(hit: Hit, key: string): string {
    if (!Array.isArray(hit.variants) || hit.variants.length < 2) return "";
    const activeSku =
        activeVariantBySku.get(key) ?? hit.defaultVariant?.sku ?? hit.variants.find((v) => v.isDefault)?.sku;
    const chips = hit.variants
        .map((v) => {
            if (!v.sku) return "";
            const isActive = v.sku === activeSku;
            const label = v.name ?? v.sku;
            return `<button class="variant-chip${isActive ? " active" : ""}" data-variant-sku="${escapeHtml(v.sku)}" data-key="${escapeHtml(key)}" type="button">${escapeHtml(label)}</button>`;
        })
        .join("");
    if (!chips) return "";
    return `<div class="variants-strip">${chips}</div>`;
}

function renderExpandedDetail(hit: Hit, variant: Variant | undefined, key: string): string {
    const sku = variant?.sku;
    const id = hit.id;
    const variantName = variant?.name;
    const rows = [
        renderRow("Path", hit.path ?? ""),
        renderRow("ID", id ?? ""),
        renderRow("SKU", sku ?? ""),
        renderRow("Variant", variantName ?? ""),
    ]
        .filter(Boolean)
        .join("");
    return `<div class="expanded-detail">${rows}${renderVariantsStrip(hit, key)}</div>`;
}

function renderCard(hit: Hit, index: number, forceExpanded: boolean): string {
    const key = hitKey(hit, index);
    const expanded = forceExpanded || expandedIds.has(key);
    const variant = pickVariant(hit, key);
    const price = readPrice(variant);
    const currency = readCurrency(variant);
    const priceLabel = formatPrice(price, currency);
    const name = hit.name ?? hit.path ?? "(unnamed)";

    const top = renderImage(variant, hit.name);
    const meta = [
        hit.type ? renderTypePill(hit.type) : "",
        priceLabel ? `<div class="price">${escapeHtml(priceLabel)}</div>` : "",
    ]
        .filter(Boolean)
        .join("");

    const detail = expanded ? renderExpandedDetail(hit, variant, key) : "";

    return `<div class="card${expanded ? " expanded" : ""}" data-key="${escapeHtml(key)}">
        ${top}
        <div class="body">
            <div class="name">${escapeHtml(name)}</div>
            ${hit.path ? `<div class="path">${escapeHtml(hit.path)}</div>` : ""}
            ${meta}
            ${detail}
        </div>
    </div>`;
}

function render(payload: Payload | null): void {
    lastPayload = payload;
    if (!payload) {
        contextEl.innerHTML = "";
        summaryEl.textContent = "";
        itemsEl.innerHTML = '<div class="empty">No data yet.</div>';
        metaEl.textContent = "";
        return;
    }

    const tenantLabel = payload.tenant?.name || payload.tenant?.identifier;
    const lang = payload.language;
    const chips = [
        tenantLabel ? `<span class="badge">${escapeHtml(tenantLabel)}</span>` : "",
        lang ? `<span class="badge muted">${escapeHtml(lang)}</span>` : "",
    ]
        .filter(Boolean)
        .join(" ");
    contextEl.innerHTML = chips;

    const allHits = Array.isArray(payload.hits) ? payload.hits : [];
    const hits = allHits.filter((h) => {
        if (h && (h.name || h.path)) return true;
        console.warn("product-overview: skipping hit with no name and no path", h);
        return false;
    });

    if (payload.summary?.totalHits !== undefined) {
        const shown = hits.length;
        const total = payload.summary.totalHits;
        summaryEl.textContent =
            total > shown ? `Showing ${shown} of ${total}` : `${shown} item${shown === 1 ? "" : "s"}`;
    } else {
        summaryEl.textContent = hits.length ? `${hits.length} item${hits.length === 1 ? "" : "s"}` : "";
    }

    if (!hits.length) {
        itemsEl.innerHTML = '<div class="empty">No items to display.</div>';
        metaEl.textContent = payload.fetchedAt ? `Fetched at ${new Date(payload.fetchedAt).toLocaleString()}` : "";
        return;
    }

    const singleHit = hits.length === 1;
    if (singleHit) {
        const key = hitKey(hits[0]!, 0);
        expandedIds.add(key);
    }

    itemsEl.innerHTML = hits.map((h, i) => renderCard(h, i, singleHit)).join("");
    metaEl.textContent = payload.fetchedAt ? `Fetched at ${new Date(payload.fetchedAt).toLocaleString()}` : "";
}

itemsEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const variantBtn = target.closest("[data-variant-sku]") as HTMLElement | null;
    if (variantBtn) {
        event.stopPropagation();
        const sku = variantBtn.getAttribute("data-variant-sku");
        const key = variantBtn.getAttribute("data-key");
        if (sku && key) {
            activeVariantBySku.set(key, sku);
            render(lastPayload);
        }
        return;
    }

    const card = target.closest(".card") as HTMLElement | null;
    if (!card) return;
    const key = card.getAttribute("data-key");
    if (!key) return;
    if (expandedIds.has(key)) {
        expandedIds.delete(key);
    } else {
        expandedIds.add(key);
    }
    render(lastPayload);
});

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

const app = new App({ name: "Crystallize Product Overview", version: "1.0.0" });
app.onerror = console.error;
app.ontoolresult = (result) => {
    expandedIds.clear();
    activeVariantBySku.clear();
    render(extractPayload(result));
};

await app.connect();
render(null);
