import { html } from "hono/html";

const title = "Crystallize MCP Server — Commerce Data, MCP-Ready";
const description =
    "Connect your AI coding agent to Crystallize. Query product catalogs, fetch content models, introspect schemas — all through natural language via the Model Context Protocol.";
const url = "https://mcp.crystallize.com";
const ogImage = "https://media.crystallize.com/crystallize_marketing/24/10/29/1/crystallize-meta-image.jpg";

export const headMeta = html`
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${url}" />

    <link rel="icon" type="image/svg+xml" href="https://crystallize.com/crystallize-logo/crystallize-logo.svg" />
    <link rel="shortcut icon" href="https://crystallize.com/favicon.ico" />

    <meta property="og:type" content="website" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${ogImage}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${ogImage}" />

    <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            "name": "Crystallize MCP Server",
            "url": "${url}",
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
`;
