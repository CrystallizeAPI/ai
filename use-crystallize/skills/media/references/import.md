# Importing images (Core API)

You have a list of image URLs from a supplier, or files on disk, and they need to end up on products. There are
**two ways in**, and the one you pick decides what can go wrong afterwards.

> Signatures were read from the live Core API schema (2026-09-29, rechecked 2026-11-12). The behaviours, what
> arrives late and what fails silently, are attributed to the builds that hit them.

| You have                                 | Use                                                              |
| ---------------------------------------- | ---------------------------------------------------------------- |
| A URL Crystallize can fetch              | `copyRemoteAsset`: Crystallize pulls it, as a bulk task          |
| Bytes you hold, or a URL it cannot fetch | `generatePresignedUploadRequest` → form POST (→ `registerImage`) |
| Video, whatever the source               | The upload path ([Video](video.md))                              |

## Copying from a supplier URL

```graphql
mutation Copy($sourceUrl: String!, $filename: String) {
    copyRemoteAsset(sourceUrl: $sourceUrl, type: image, targetFilename: $filename) {
        __typename
        ... on BulkTaskCopyRemoteAsset {
            id
            targetKey
            status
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`type` is `RemoteAssetType`, and today its only value is **`image`**. `requestHeaders: [HttpHeaderInput!]` (`{ name,
value }`) is there for sources that will not serve a bare request; a wrong input type name fails the whole mutation
as a validation error. `targetFilename` sets the public file name.

**Each call took 10-15 s to answer** for 1 MB sources. Concurrency 12 copied about 2,900 images in 25 minutes on one
tenant and 10,743 in 547 s on another.

### It is a bulk task, so the key comes back before the file does

`targetKey` is handed to you immediately; the copy happens afterwards. The consequences, all found the hard way:

- **A failed copy only shows on the task.** `bulkTask(id:) { ... on BulkTask { status info } }` ends in `error`, with
  the reason in `info.error`. List every failure at once with
  `bulkTasks(filter: { type: copyRemoteAsset, status: error })`; each carries the `targetKey`, which is how a rerun
  finds what to copy again.
- **The source has to answer within 30 s.** A slow on-the-fly resizer failed 2,897 of 3,056 copies with
  `Request timed out after 30 seconds`; an origin taking up to 107 s for 4-13 MB originals lost 5,677 of 10,563.
  Copy from the manufacturer's CDN or resizer instead, and throttle.
- **`sourceUrl` is at most 256 characters** (`InvalidLengthError: sourceUrl length must be between 1 and 256
  characters`), checked before the fetch. Signed CDN URLs of about 300 characters all failed.
- **The response needs a `Content-Length`**: chunked resizers fail with `No content length in response`, and so does
  Cloudflare when it compresses on `Accept-Encoding`. The body must be uncompressed (`content-encoding` other than
  `identity` is refused), within the upload limit, with a `content-type` of exactly `image/jpeg`, `jpg`, `png`,
  `webp`, `tiff`, `tif` or `avif`.
- **Bot protection fails only in the task.** Akamai and Imperva sources returned a key and a task id, and only
  `bulkTask(id).status` said `error` later. A CDN that serves a normal browser but not Crystallize's fetcher gave every
  image of one brand a key whose file 404s forever.
- **Do not call `registerImage` afterwards.** `copyRemoteAsset` already registers the image, and the second call
  answers `ImageAlreadyExistsError`.
- **`updateImage` on a fresh key answers `ImageNotFoundError` for a while**, and `image(key)` is `null` while a copy
  is pending or failed. Retry "not found" after a delay, or wait for **every** copy task rather than the last few.

So after the copy tasks finish, **HEAD-check the keys**: all of them if the import is small, a sample if it is not.
For the ones that 404, try `requestHeaders` if you suspect the CDN is refusing the fetch, and otherwise download the
file yourself, convert it if needed (JPEG worked), and take the upload path below. Never work around a block a site
has put up on purpose.

WebP sources work (some manufacturers publish nothing else), and PNG transparency is preserved. (Tools Universe.)

## Uploading bytes yourself

Ask for a presigned target, POST the file to it, register what landed.

```graphql
mutation Upload($filename: String!, $contentType: String!) {
    generatePresignedUploadRequest(filename: $filename, contentType: $contentType, type: MEDIA) {
        __typename
        ... on PresignedUploadRequest {
            url
            fields {
                name
                value
            }
            maxSize
            lifetime
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`type` is `FileUploadType`: **`MEDIA`** for images and video, `STATIC` for files, `MASS_OPERATIONS` for an operations
file. Build a multipart form from `fields` **in the order given**, append the file **last**, and POST it to `url`.
The key is the `key` form field, of the form `<tenant>/<yy>/<m>/<d>/<hash>/<filename>`.

```typescript
const form = new FormData();
for (const { name, value } of presign.fields) form.append(name, value);
form.append("file", await fs.openAsBlob(path, { type: contentType }), filename); // Node 20+, streams the file
const res = await fetch(presign.url, { method: "POST", body: form }); // 201 on success
```

Then:

```graphql
mutation Register($imageKey: String!) {
    registerImage(imageKey: $imageKey) {
        __typename
        ... on Image {
            key
            url
            width
            height
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

- **The upload registers the image by itself**, in the background. `registerImage` right after the POST makes the
  key usable at once; when it answers `ImageAlreadyExistsError`, the upload got there first. Treat that as success.
- Right after `registerImage`, `width`/`height` are `null` and the media URL answers 404 for 5-20 s. It is fine to
  reference the key in item writes immediately; poll the HEAD before anything reads the file.
- A `400 RequestTimeout` from S3 is retried with a **fresh** presign.
- Check the content type before uploading: a URL that 302s to a login page uploads HTML, which registers and never
  gets a size.
- `maxSize` is 10 GiB and `lifetime` 3,600 s, while the decoded POST policy is valid for a year, so presigns can be
  made in bulk ahead of time.
- Throughput: download (3 concurrent) + presign + POST + `registerImage` (8 concurrent) ran at about 34 images/s.
- In JS, `createBinaryFileManager(client).uploadImage(path)` does all three steps, and needs `tenantId` in the client
  config ([[js-api-client]]).

**From a browser page** (user content): make the presign on the server, hand the page `url` and `fields`, and let the
page POST the form. The POST registers the image, so the page needs no Core token, and your server records the key.

## In a mass operation

`image/register` with `{{ upload url rid }}` is the fast path: 691 images in five 150-operation files, about 10 s
each. The register log's `input.value.operation.key` is the key; cache it. Three traps:

- `{{ upload }}` names the file after the URL's basename, so an extension-less URL (`…/product-images/4846/default`)
  gives a key that registers but is **never processed**. Append a query whose last segment is a file name
  (`…/default?name=/product-4846.jpg`).
- `image/register` with a resourceIdentifier that is already registered is **skipped silently**: no log, no key.
- Registered images get language `en` and no alt text: write metadata afterwards with `updateImage` per language.

See [[mass-operations]].

## Verifying an import

| Check                                   | Proves                                       |
| --------------------------------------- | -------------------------------------------- |
| The task's `status` is `complete`       | The copy ran                                 |
| `image(key) { key }` answers            | The record exists, not that the file arrived |
| A HEAD on the CDN URL answers 200       | The file landed                              |
| `image(key) { width variants { url } }` | Processing finished: renditions exist        |

Verify the import by **key + HEAD**. Then, before the final publish, wait for **`variants`**: 45 minutes after one
import, 58 of 400 images still had `variants: null`, and it took about 70 minutes. After 326 copies, all had
`width: null` for 15 minutes while the CDN served them. A seed that waits for `width` right after the copy, and
re-copies what lacks it, makes duplicates (320 in one build).

## Renditions and Discovery

`Image.variants` is the generated ladder that [[responsive-images]] builds a `srcset` from, produced in a queue.
Discovery stores each item with the image metadata it saw when that item was indexed. Content published within
minutes of a bulk upload was served with `width/height: null` and `variants: []` for 280 of 614 images, while Core
had the full ladder shortly after. Re-writing the image components and republishing fixed all of them about 2 minutes
later.

So: a storefront falls back to the original `url` when `variants` is empty, and an import publishes only after every
key has `variants`, or publishes again once they exist ([Discovery Indexing](../../query/references/discovery-indexing.md)).

## Replacing an image

`registerImageRevision(imageKey:, revisionKey:)` points the library entry at a new file: Core `image(key)` returns the
new `url` and `size`, and the ladder rebuilds in about 25 seconds. `revisionKey` is a file you have just uploaded;
call it right after the POST and skip `registerImage`, because once the upload has registered itself as an image the
revision is refused.

**It reaches the read APIs at different times.** The Catalogue API serves the latest revision at once. Discovery
stores the file with each indexed document, so every item using the image keeps the original until it is indexed
again. One build fixed that by republishing; another (Tools Universe) still saw the old file after rewriting the image
component and republishing. The way that worked everywhere: upload the new file as a **new** image, write the new key
onto the items, and publish.

## Deleting

```graphql
mutation Delete($key: String!) {
    deleteImage(key: $key, force: true) {
        __typename
        ... on DeleteCount {
            removed
        }
        ... on AssetInUseError {
            key
            referrerCount
        }
    }
}
```

`deleteImage` refuses an image that **any** item version references, old ones included: `AssetInUseError …
referenced in 3 places` came back for an image every current draft and published version had moved away from.
`force: true` removes it anyway. Check the current versions yourself before forcing. (Car Parts Universe.)

Clearing a variant's images with Core `updateProductVariant(sku, language, input: { images: [] })` leaves its
components alone, unlike the mass operation's `product/variant/update`.
