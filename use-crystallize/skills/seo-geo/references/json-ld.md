# JSON-LD from typed Crystallize data

One `@graph` per page, with stable `@id`s, so a product, its brand page and its platform page describe the same
entities. Everything is built from the Discovery read the page already made. The code is trimmed from a working
storefront (`lib/seo.ts`); field names such as `defaultPrice`, `defaultStock` and `nokPrice` are generated from
the tenant's price variants and stock locations, so yours will differ.

Render it escaped, so content can't close the tag:

```tsx
export function JsonLd({ data }: { data: unknown }) {
    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
        />
    );
}
```

## Site graph: Organization and WebSite

On the home page. Other pages reference them by `@id`.

```ts
const ORG = `${SITE_URL}/#organization`;
const WEBSITE = `${SITE_URL}/#website`;

export const organization = (lang: Lang) => ({
    "@type": ["Organization", "OnlineStore"],
    "@id": ORG,
    name: SITE_NAME,
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: absolute("/icon.svg") },
    areaServed: ["NO", "SE", "NL"].map((c) => ({ "@type": "Country", name: c })),
    knowsLanguage: LANGS.map((l) => HREFLANG[l]), // BCP 47: "nb", not "no"
});

export const website = (lang: Lang) => ({
    "@context": "https://schema.org",
    "@graph": [
        organization(lang),
        {
            "@type": "WebSite",
            "@id": WEBSITE,
            url: absolute(`/${lang}`),
            name: SITE_NAME,
            inLanguage: MARKET[lang].locale,
            publisher: { "@id": ORG },
            potentialAction: {
                "@type": "SearchAction",
                target: { "@type": "EntryPoint", urlTemplate: absolute(`/${lang}/search?q={search_term_string}`) },
                "query-input": "required name=search_term_string",
            },
        },
    ],
});

export const breadcrumbs = (items: { name: string; path: string }[]) => ({
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: it.name,
        item: absolute(it.path),
    })),
});
```

Discovery's `breadcrumbs` end with the item itself; that is what `BreadcrumbList` wants.

## Prices: incl. and excl. VAT

Prices in Crystallize are usually net. State the price the shopper pays as `price`, and both incl. and excl. VAT
as `UnitPriceSpecification`s, with volume tiers as `eligibleQuantity`:

```ts
function price(net: number, lang: Lang, tiers: { threshold: number; price: number }[] = []) {
    const m = MARKET[lang];
    const spec = (p: number, minQty?: number) =>
        [true, false].map((incl) => ({
            "@type": "UnitPriceSpecification",
            price: incl ? round(p * (1 + m.vat)) : round(p),
            priceCurrency: m.currency,
            valueAddedTaxIncluded: incl,
            ...(minQty && { eligibleQuantity: { "@type": "QuantitativeValue", minValue: minQty, unitCode: "C62" } }),
        }));
    return {
        price: round(net * (1 + m.vat)),
        priceCurrency: m.currency,
        priceSpecification: [...spec(net), ...tiers.flatMap((t) => spec(t.price, t.threshold))],
    };
}
```

A B2B store whose price is per case, excl. VAT, for business buyers only (from a food wholesale build):

```ts
offers: {
    "@type": "Offer",
    url: absolute(url),
    price: v.defaultPrice,
    priceCurrency: "EUR",
    itemCondition: "https://schema.org/NewCondition",
    seller: { "@id": `${SITE_URL}/#organization` },
    eligibleCustomerType: "http://purl.org/goodrelations/v1#Business",
    priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: v.defaultPrice,
        priceCurrency: "EUR",
        valueAddedTaxIncluded: false,
        referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitText: "case" },
    },
},
```

Never put a contract price in JSON-LD: it is per customer, and the page is public.

A product sold only on quote gets an `Offer` with a `description` ("price on request") and no price.

## Units: UN/CEFACT Rec 20

A numeric component with a unit becomes a `QuantitativeValue` (or a `PropertyValue` carrying the same fields):
`value`, `unitText` as written, and `unitCode` from UN/CEFACT Recommendation 20. The content model's unit list
has no slot for the code, so the storefront maps it. Give no code rather than a guess.

```ts
const CODES: Record<string, string> = {
    mm: "MMT",
    cm: "CMT",
    m: "MTR",
    g: "GRM",
    kg: "KGM",
    l: "LTR",
    V: "VLT",
    A: "AMP",
    Ah: "AMH",
    W: "WTT",
    Wh: "WHR",
    Nm: "NU",
    J: "JOU",
    kN: "B47",
    kPa: "KPA",
    mbar: "MBR",
    "m/s": "MTS",
    "m/s²": "MSK",
    "m³/h": "MQH",
    lm: "LUM",
    "dB(A)": "2N",
    "°": "DD",
    "%": "P1",
    h: "HUR",
    min: "MIN",
    s: "SEC",
    years: "ANN",
};

/** "1/min" is a rotational speed (RPM) on speed fields and a frequency (C94) on impact or stroke rates. */
export function unitCode(unit: string | null | undefined, field = ""): string | undefined {
    if (!unit) return undefined;
    if (unit === "1/min") return /speed/i.test(field) ? "RPM" : "C94";
    return CODES[unit];
}

/** A bound ("max. drilling diameter") from the field id. */
export function boundOf(field: string): "max" | "min" | undefined {
    const id = field.split(".").at(-1) ?? field;
    if (/^max[A-Z_]|Max($|[A-Z_])/.test(id)) return "max";
    if (/^min[A-Z_]|Min($|[A-Z_])/.test(id)) return "min";
    return undefined;
}
```

Use one unit per numeric where you can: Discovery range filters ignore the unit, so a field stored in both mm and
cm compares 10 with 100. Pieces (counts) are `C62`.

## Typed specs as `additionalProperty`

Turn every typed component into one row first, then render the row as a page table, a Markdown table and a
`PropertyValue`. A row holds the label, value, unit, unit code, bound, the classification feature code (for
example ETIM `EF…`) and, for selections, the option keys with their codes:

```ts
export type SpecRow = {
    key: string;
    label: string;
    text: string;
    value: number | string | boolean;
    unit?: string | null;
    unitCode?: string;
    bound?: "max" | "min";
    etim?: string; // feature code, e.g. EF000001
    options?: { key: string; label: string; etim?: string }[];
    items?: { name: string; path: string }[]; // relations (e.g. the platforms a battery fits)
};

function property(r: SpecRow): Record<string, unknown> {
    const n = typeof r.value === "number" ? r.value : null;
    return {
        "@type": "PropertyValue",
        name: r.label,
        ...(r.etim && { propertyID: r.etim }),
        value: r.value,
        ...(n != null && r.bound === "max" && { maxValue: n }),
        ...(n != null && r.bound === "min" && { minValue: n }),
        ...(r.unit && { unitText: r.unit }),
        ...(r.unitCode && { unitCode: r.unitCode }),
        ...(r.options && {
            valueReference: r.options.map((o) => ({
                "@type": "DefinedTerm",
                name: o.label,
                termCode: o.key,
                ...(o.etim && { identifier: { "@type": "PropertyValue", propertyID: "ETIM", value: o.etim } }),
            })),
        }),
    };
}

const specs = specGroups(p.specs, p.power, p.physical, lang)
    .flatMap((g) => g.rows)
    .filter(stated);
```

Discovery returns a numeric component as `{ <field>: number, <field>Unit: string }` in the hit, a boolean as a
boolean, and a selection as a hash of option key → label. The row builder walks those (skip `*Unit` keys and
`null`s). A selection option can't carry an external code in the model, so keep codes in a generated labels
file or in the component's `description`, and look them up by option key.

## Classification codes from topics

Keep classification codes (ETIM class `EC…`, GS1 GPC, UNSPSC, Google product category) in topic `meta`, or in a
topic map that mirrors the code set (`/etim/<group>/<class>`). Emit them as `CategoryCode`, alongside the product
type as plain text:

```ts
const ETIM_SET = { "@type": "CategoryCodeSet", name: "ETIM International classification", url: "https://www.etim-international.com/" };

/** Discovery `topics` is a hash: topic path → "Map > Parent > Leaf". */
export function classification(topics: Record<string, string> | null | undefined) {
    const entries = Object.entries(topics ?? {});
    const type = entries
        .filter(([k]) => k.startsWith("/category/"))
        .sort((a, b) => b[0].split("/").length - a[0].split("/").length)[0];
    const etim = entries.find(([k]) => k.startsWith("/etim/"));
    const code = etim?.[0].split("/").at(-1)?.toUpperCase();
    return {
        type: type?.[1].split(" > ").slice(1).join(" > "),
        etim: etim && code ? { code, name: etim[1].split(" > ").at(-1)! } : undefined,
    };
}

category: [
    type, // "Drilling & driving > Combi drill": what Google Merchant reads
    etim && { "@type": "CategoryCode", codeValue: etim.code, name: etim.name, inCodeSet: ETIM_SET },
].filter(Boolean),
```

Keyword-like topics (trade, material, feature, level) become a comma-separated `keywords`.

## Identifiers

`sku` is the merchant's SKU; the GTIN is a separate fact (a kit and a bare tool have different GTINs). Pick the
property from the length:

```ts
const gtin = (g?: string | null) => {
    const d = g?.replace(/\D/g, "");
    return d
        ? d.length === 13
            ? { gtin13: d }
            : d.length === 12
              ? { gtin12: d }
              : d.length === 14
                ? { gtin14: d }
                : { gtin: d }
        : {};
};

const ids = (x: Variant) => ({
    sku: x.sku,
    ...gtin(x.gtin),
    ...(x.nobbNumber && { identifier: { "@type": "PropertyValue", propertyID: "NOBB", value: x.nobbNumber } }),
});
```

## Product, or ProductGroup with a Product per variant

One variant: a `Product` with one `Offer`. Several: a `ProductGroup` (`productGroupID` = the item id) whose
`hasVariant` lists a `Product` per variant, each with its own identifiers, images and `Offer`:

```ts
const offer = (x: Variant) => ({
    "@type": "Offer",
    name: x.name ?? undefined,
    sku: x.sku,
    ...gtin(x.gtin),
    url,
    ...price(netFor(x, lang), lang, tiersOf(x)),
    availability: `https://schema.org/${(x.defaultStock ?? 0) > 0 ? "InStock" : "OutOfStock"}`,
    inventoryLevel: { "@type": "QuantitativeValue", value: Math.max(0, x.defaultStock ?? 0), unitCode: "C62" },
    itemCondition: "https://schema.org/NewCondition",
    ...(country && { eligibleRegion: { "@type": "Country", name: country } }),
    ...(box.length && { includesObject: box }), // TypeAndQuantityNode per item in the box
    ...(warranty && { warranty }), // WarrantyPromise with durationOfWarranty in ANN
    seller: { "@id": ORG },
});

const node =
    p.variants.length > 1
        ? {
              "@type": "ProductGroup",
              "@id": `${url}#product`,
              productGroupID: p.itemId,
              ...common, // name, url, description, image, brand, category, keywords, additionalProperty, relations
              hasVariant: p.variants.map((x) => ({
                  "@type": "Product",
                  "@id": `${url}#${x.sku}`,
                  name: `${p.name} (${x.name ?? x.sku})`,
                  ...ids(x),
                  isVariantOf: { "@id": `${url}#product` },
                  offers: offer(x),
              })),
          }
        : { "@type": "Product", "@id": `${url}#product`, ...ids(v), ...common, offers: offer(v) };

return { "@context": "https://schema.org", "@graph": [node, breadcrumbs(crumbs)] };
```

`common` also carries:

- `brand`: a `Brand` with the brand page's `@id` (`…/brand-path#brand`), so the brand page defines the same
  entity.
- `weight`, `width`, `height`, `depth` as `QuantitativeValue`s from the physical specs.
- `releaseDate` from a launch date.
- `image`: up to six images, through `bestImage` (original format, never AVIF).

## Relations

Item relations become typed links to other products' `@id`s:

```ts
const productRef = (lang: Lang, it: { name?: string | null; path?: string | null }) =>
    it.path ? { "@type": "Product", "@id": `${absolute(`/${lang}${it.path}`)}#product`, name: it.name ?? undefined, url: absolute(`/${lang}${it.path}`) } : null;

...(fits.length && { [consumable ? "isConsumableFor" : "isAccessoryOrSparePartFor"]: fits }),
...(pairs.length && { isRelatedTo: pairs }),
```

A shared concept with its own page (a battery platform, a collection, a technology) is a `DefinedTerm` with that
page's `@id`; products point at it from an `additionalProperty` `valueReference`, and the concept page puts the
same term at the top of its graph.

## Rentals and services

A rented machine is a `Product` with one `Offer` per rental period, leased out from the depots that hold it:

```ts
{
    "@type": "Offer",
    name: periodName(v),
    sku: v.sku,
    url,
    businessFunction: "http://purl.org/goodrelations/v1#LeaseOut",
    leaseLength: { "@type": "QuantitativeValue", value: hoursOf(v), unitCode: "HUR", unitText: "h" },
    price: p.price,
    priceCurrency: p.priceCurrency,
    priceSpecification: p.priceSpecification.map((s) => ({ ...s, referenceQuantity: hours })),
    availability: `https://schema.org/${pool > 0 ? "InStock" : "OutOfStock"}`,
    availableAtOrFrom: depots.map((d) => ({
        "@type": "Place",
        name: d.name,
        address: { "@type": "PostalAddress", streetAddress: d.street, postalCode: d.postalCode, addressLocality: d.city },
        geo: { "@type": "GeoCoordinates", latitude: d.lat, longitude: d.long },
    })),
    availableDeliveryMethod: "https://schema.org/OnSitePickup",
    seller: { "@id": ORG },
}
```

`leaseLength` is a property of `Offer`, not `Product`: the vocabulary check catches that.

## Listings: CollectionPage with an ItemList

Category, brand and platform pages list the products on the page, each with its default variant's price and
stock:

```ts
{
    "@type": "CollectionPage",
    "@id": url,
    name,
    url,
    inLanguage: MARKET[lang].locale,
    isPartOf: { "@id": WEBSITE },
    ...(about && { about }), // the Brand or DefinedTerm the page is about
    mainEntity: {
        "@type": "ItemList",
        name,
        numberOfItems: total,
        itemListElement: items.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: absolute(`/${lang}${p.path}`), item: listedProduct(p, lang) })),
    },
}
```

A brand page adds a `Brand` (`logo`, `slogan`, `sameAs` the brand's own site) and points `about` at it.

## Other page types

- **Article, about, info pages**: `WebPage` (or `Article`) with `isPartOf` the website and `publisher` the
  organisation.
- **FAQPage** only from a real FAQ block in the content, never generated.
- **Recipe** from a recipe shape, with the products it uses linked (a food build does this).
- **Short factual Q&A built from typed specs** ("Does it have a hammer mode? Yes.") is fine on the page, shown
  only when the value exists.

## What Google asks for beyond schema.org

Merchant listings ask for `shippingDetails`, `hasMerchantReturnPolicy` and review data. State them only if the
store has them. Check with the Rich Results Test ([validation.md](validation.md)).
