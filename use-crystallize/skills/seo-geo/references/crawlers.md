# Crawlers: robots.txt, AI crawlers, metadata in `<head>`, sitemaps

## robots.txt

Crawl everything that is the same for every visitor. Keep out what is per-shopper (cart, account) or technical
(API, OAuth, MCP hand-off routes). Name the AI crawlers in their own block: several look for their own
User-Agent, and naming them makes letting them in a deliberate, easy-to-change choice. From a working store
(`app/robots.ts`):

```ts
import type { MetadataRoute } from "next";

const PRIVATE = ["/api/", "/oauth/", "/mcp/", "/*/cart", "/*/account"];

const AI_AGENTS = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-User",
    "Claude-SearchBot",
    "anthropic-ai",
    "PerplexityBot",
    "Perplexity-User",
    "Google-Extended",
    "Applebot-Extended",
    "Amazonbot",
    "meta-externalagent",
    "DuckAssistBot",
    "MistralAI-User",
    "CCBot",
];

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: "*",
                allow: "/",
                disallow: PRIVATE,
                // Content Signals (contentsignals.org): searchable and usable as live input to AI answers.
                // Training is left unstated.
                other: { "Content-Signal": "search=yes, ai-input=yes" },
            },
            { userAgent: AI_AGENTS, allow: "/", disallow: PRIVATE },
        ],
        sitemap: absolute("/sitemap.xml"),
    };
}
```

- Set `ai-train=yes` or `no` in `Content-Signal` as the business decides; leaving it out states nothing.
- **Don't disallow a page you mark `noindex`.** A crawler that may not fetch the page never sees the `noindex`,
  and never follows its links. Search results are `noindex, follow` and crawlable. One store disallowed
  `/search?`, which hid the noindex.
- A page that explains the store to agents (an MCP setup page, say) is content: keep it open.
- No `Host:` line; it is non-standard.
- Staging and preview deployments send `X-Robots-Tag: noindex` site-wide ([[storefront]] security headers).
- The draft preview route is `noindex`, never linked and never in the sitemap. Drafts are never rendered on
  public pages.

## Metadata must be in the `<head>` crawlers get

Google ignores canonical and hreflang outside `<head>`, and crawlers that don't run JavaScript only see the raw
HTML. Next.js 16 streams metadata into `<body>` for normal browsers.

**What happened on a live store** (found in a Modern Web Guidance audit, confirmed with curl):

- With Cache Components and PPR, a dynamic `generateMetadata` was streamed into `<body>` instead of the static
  shell's `<head>`.
- On Vercel, **real Googlebot user agents were served the cached shell** (`x-vercel-cache: HIT`) with **no
  `<title>`, description, canonical or hreflang** on product and category pages: `</head>` at byte 1191, the
  metadata only inside the RSC flight data. bingbot, ClaudeBot and GPTBot got `BYPASS` and a full `<head>`.
  Browsers got the title about 300 KB into the HTML.
- Googlebot was in `htmlLimitedBots`, but the cached shell won.
- Root cause: the catch-all route had no `generateStaticParams`, so every catalogue URL shared one App Shell, and
  that shell can't hold path-dependent metadata.

**The rule: keep metadata cacheable, and give every URL its own shell.**

- `generateMetadata` reads only `params` and cached Discovery reads: no `cookies()`, `headers()` or
  `searchParams`. Then it lands in the shell's `<head>` for every user agent.
- `generateStaticParams` returns every sitemap path, so each URL is prerendered with its own shell. Items
  published after the build get the App Shell first and are prerendered on their first visit.
- The search page's metadata is static (reading `searchParams` deferred it to request time and streamed it).

Code: [[storefront]] `references/performance.md`.

### htmlLimitedBots

`htmlLimitedBots` tells Next.js which user agents get blocking metadata in `<head>` instead of streamed. Most
builds list search engines, AI crawlers and link-preview bots:

```ts
// next.config.ts
htmlLimitedBots:
    /Googlebot|Google-InspectionTool|bingbot|Applebot|DuckDuckBot|YandexBot|Baiduspider|GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|CCBot|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|TelegramBot/i,
```

**Observed both ways for Googlebot; verify on your deployment.** One build removed Googlebot from the list: Next
treats it as a DOM bot, and on Vercel it was served the prerendered shell plus the streamed rest; with Googlebot
listed, the streamed part skipped the metadata and on-demand pages reached Googlebot with nothing. Another build
kept Googlebot listed and fixed the same symptom with `generateStaticParams` for every path. Per-URL shells with
cacheable metadata make the list matter less. In both cases bots in the list reaching pages unknown at build
caused "Expected the resume to render <div>…" errors on Vercel, also fixed by `generateStaticParams`.

`htmlLimitedBots` does not help when a CDN serves a cached shell to that UA.

### Check it with the real user agents

Use the full user-agent strings, not a shortened `Googlebot`, and test the deployment: a local `next start`
upgraded the App Shell after the first visit while production did not.

```bash
URL=https://shop.example/en/some/category/some-product
for UA in \
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/138.0.0.0 Safari/537.36' \
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' \
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/138.0.0.0 Safari/537.36' \
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)' \
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot'; do
  html=$(curl -s -A "$UA" "$URL")
  head_end=$(printf '%s' "$html" | grep -bo '</head>' | head -1 | cut -d: -f1)
  title_at=$(printf '%s' "$html" | grep -bo '<title>' | head -1 | cut -d: -f1)
  echo "$(curl -sI -A "$UA" "$URL" | grep -i '^x-vercel-cache' | tr -d '\r') head_end=$head_end title_at=${title_at:-none} canonical=$(printf '%s' "$html" | grep -c 'rel="canonical"') hreflang=$(printf '%s' "$html" | grep -oi 'hreflang="' | wc -l | tr -d ' ')"
done
```

A good result: `title_at` smaller than `head_end`, one canonical and an hreflang per language plus `x-default`,
for every UA. (React writes the attribute as `hrefLang`, hence `grep -i`.) A broken one, as measured on a live store
before the fix:

```
x-vercel-cache: HIT head_end=1191 title_at=none canonical=0 hreflang=0       # Googlebot
x-vercel-cache: BYPASS head_end=4865 title_at=1681 canonical=1 hreflang=5    # ClaudeBot
```

## Sitemaps

Every page in every language, each with hreflang alternates to the same item in the other languages (joined on
`itemId`, because paths are translated), and `lastModified` from Discovery's `updatedAt`:

```ts
// app/sitemap.ts
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const all = await Promise.all(LANGS.map(async (l) => [l, await allItems(l)] as const)); // one browse per language
    const byItem = new Map<string, Partial<Record<Lang, string>>>();
    for (const [l, items] of all)
        for (const i of items) byItem.set(i.itemId, { ...byItem.get(i.itemId), [l]: absolute(`/${l}${i.path}`) });
    const languages = (urls: Partial<Record<Lang, string>>) => ({
        ...Object.fromEntries(LANGS.flatMap((l) => (urls[l] ? [[HREFLANG[l], urls[l]!]] : []))),
        "x-default": urls.en ?? Object.values(urls)[0]!,
    });
    return all.flatMap(([lang, items]) =>
        items.map((i) => ({
            url: absolute(`/${lang}${i.path}`),
            lastModified: i.updatedAt,
            changeFrequency: "weekly" as const,
            alternates: { languages: languages(byItem.get(i.itemId) ?? {}) },
        })),
    );
}
```

- `hreflang` keys are BCP 47 (`nb`), with `x-default`.
- Above a few thousand URLs, split into a sitemap index by type (pages, categories, products). One store had 2,112
  URLs with 10,560 `xhtml:link` alternates in one file.
- A full Discovery scan can come back incomplete during re-indexing. Read with retry, union the passes, and check
  the count against a `search` total.
- Leave out old paths (they are in the item's path history and should 301) and per-shopper pages.

## Canonicals

- Canonical from the item's current path in this language, absolute.
- Filtered and sorted category views point at the clean category: facets as GET links can be crawled, but don't
  compete with the category.
- A shortcut path (the same item reachable from a second folder) is a duplicate: canonical to the item's main path.
- Paginated listings: each page canonical to itself, or render "load more" for people and keep page 1 canonical.
