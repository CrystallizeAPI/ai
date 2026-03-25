# Catalogue API Reference

The Catalogue API provides path-based access to items in your Crystallize tenant. It offers strong consistency for deterministic reads.

## Base URL

```
https://api.crystallize.com/{tenant-identifier}/catalogue
```

Replace `{tenant-identifier}` with your tenant name.

## Authentication

By default, the API is accessible without authentication. You can configure access in the Crystallize App:

1. Go to Settings → API Access
2. Choose your preferred access level
3. Save changes

## When to Use Catalogue API

Use the Catalogue API when you need:

- **Deterministic exports** - Payload must reflect exact current state
- **Path-based reads** - You know the exact path to the item
- **Strong consistency** - Cannot tolerate async delays

For search, filtering, and faceting, use the Discovery API instead.

## Query Structure

### Basic Path Query

```graphql
{
    catalogue(language: "en", path: "/shop/plants") {
        name
        path
        type
    }
}
```

### Product Query with Variants

```graphql
{
    catalogue(language: "en", path: "/shop/furniture/dining-chair") {
        name
        ... on Product {
            variants {
                sku
                name
                price
                stock
                attributes {
                    attribute
                    value
                }
            }
        }
    }
}
```

### Folder with Children

```graphql
{
    catalogue(language: "en", path: "/shop/plants") {
        name
        ... on Folder {
            children {
                name
                path
                type
            }
        }
    }
}
```

### Document Query

```graphql
{
    catalogue(language: "en", path: "/blog/welcome-post") {
        name
        ... on Document {
            components {
                id
                name
                content {
                    ... on RichTextContent {
                        html
                    }
                }
            }
        }
    }
}
```

## cURL Example

```bash
curl \
  -X POST \
  -H "Content-Type: application/json" \
  --data '{ "query": "{ catalogue(language: \"en\", path: \"/shop/plants\") { name } }" }' \
  https://api.crystallize.com/furniture/catalogue
```

## Limitations

The Catalogue API does **not** support:

- Full-text search
- Filtering
- Faceting
- Sorting across multiple items

Use the Discovery API for these capabilities.

## Related Links

- [Crystallize Catalogue API Documentation](https://crystallize.com/docs/developer/apis/catalogue-api)
