# Images, video and media (Core API)

You have a list of image URLs from a supplier, or files on disk, and they need to end up on products.
There are **two ways in**, and the one you pick decides what can go wrong afterwards.

> Signatures below were read from the live Core API schema on 2026-09-29. The behaviours — what arrives
> late, what fails silently — are attributed to the builds that hit them.

Rendering what you have imported is the other half, and it lives in [[responsive-images]].

| You have                                 | Use                                                            |
| ---------------------------------------- | -------------------------------------------------------------- |
| A URL Crystallize can fetch              | `copyRemoteAsset` — Crystallize pulls it, as a bulk task       |
| Bytes you hold, or a URL it cannot fetch | `generatePresignedUploadRequest` → form POST → `registerImage` |
| Video, whatever the source               | The upload path — `copyRemoteAsset` takes images only          |

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

`type` is `RemoteAssetType`, and today its only value is **`image`**. `requestHeaders: [{ name, value }]`
is there for sources that will not serve a bare request.

**It is a bulk task, so the key comes back before the file does.** `targetKey` is handed to you
immediately; the copy happens afterwards. Three consequences, all found the hard way:

- **Do not call `registerImage` afterwards.** `copyRemoteAsset` already registers the image, and the
  second call fails. (Tools Universe.)
- **`updateImage` on a fresh key answers `ImageNotFoundError` for a while** — WebP sources seemed
  slowest. Retry a "not found" after a delay, or wait for **every** copy task rather than the last few
  you happen to hold (`bulkTask(id:)` until it leaves `pending`/`started`). (Tools Universe.)
- **A key can be registered whose file never arrives, with no error anywhere.** Two builds, two
  suppliers: 91 WebP sources (ZF, Brembo) got a key and a library entry while the file behind it 404s
  (Car Parts Universe), and every image from one fashion brand did the same because that CDN serves a
  normal browser but not Crystallize's fetcher (Fashion Universe). The library shows broken tiles, items
  show broken images, and nothing reports it.

So after the copy tasks finish, **HEAD-check the keys** — all of them if the import is small, a sample if
it is not. For the ones that 404: try `requestHeaders` first if you suspect the CDN is refusing the
fetch, and otherwise download the file yourself, convert it if it needs converting (both builds went to
JPEG), and take the upload path below.

WebP sources do work — some manufacturers publish nothing else — and PNG transparency is preserved.
(Tools Universe.)

## Uploading bytes yourself

Three steps: ask for a presigned target, POST the file to it, register what landed.

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

`type` is `FileUploadType`: **`MEDIA`** for images and video, `STATIC` for files, `MASS_OPERATIONS` for
an operations file. Build a multipart form from `fields` **in the order given**, append the file last,
and POST it to `url` — `lifetime` is how long that target stays valid and `maxSize` caps the upload.
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
            mimeType
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

Unlike the copy path, this one **does** need `registerImage`.

### Video

The upload path is the only way in for video, since `copyRemoteAsset` is images only: download the file,
`generatePresignedUploadRequest(contentType: "video/mp4" | "video/quicktime", type: MEDIA)`, POST the
form, then write `{ key, title }` into a `videos` component or a variant's videos. There is no
`registerVideo` step — the video is registered on first use, and transcoded to HLS and DASH
(`playlists`) within about a minute. MP4 and MOV upload as they are; an HLS-only source has to be
remuxed first (`ffmpeg -i x.m3u8 -c copy`). A `videos` component's `max` is enforced on create
(`Cannot provide more than 2 videos for component hero-video`). (Fashion Universe.)

## Renditions arrive later, and the storefront has to cope

`Image.variants` is the generated ladder that [[responsive-images]] builds a `srcset` from, and it is
produced in a queue. After roughly 4,600 copies in one import, `image(key)` answered
`width: null, variants: null` for the later ones for a long while, and Discovery indexed those items with
`variants: []`. (Fashion Universe.)

Two things follow: a storefront must fall back to the original `url` when `variants` is empty, and the
items need **publishing and re-indexing again** once the renditions exist, or Discovery keeps serving the
empty list it indexed.

## Replacing an image

`registerImageRevision(imageKey:, revisionKey:)` points the library entry at a new file — Core
`image(key)` returns the new `url` and `size`, and the ladder rebuilds in about 25 seconds.

**It does not reach items that are already published.** Discovery kept serving the original file and its
renditions for every item using the image, even after rewriting the image component and republishing.
(Tools Universe, replacing 98 letterboxed manufacturer photos.)

So to replace an image in practice: upload the new file as a **new** image
(`generatePresignedUploadRequest` → POST → `registerImage`) and write the new key onto the items. Treat
`registerImageRevision` as a library-level correction, not a way to change what shoppers see.

## Metadata, topics and showcases

```graphql
mutation Annotate($key: String!, $language: String!, $input: UpdateImageInput!) {
    updateImage(key: $key, language: $language, input: $input) {
        __typename
        ... on Image {
            key
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

`UpdateImageInput` carries `altText`, `caption`, `focalPoint`, `meta`, `topicIds` and `showcase`. Note
the required `language`: an image's topics and alt text are **per language**, so tagging an image in one
language leaves the others untagged.

**Showcases are hotspots on the image — the whole "shop the look" feature, and in no skill until now.**
Core takes `showcase: [{ hotspot: { x, y }, itemIds, skus, meta }]`, several per image, on
`registerImage`'s image input and on `updateImage`. Discovery exposes them on the image as
**`showcases`** — plural, type `Showcase`, with `hotspot` as a `Hash` `{ x, y }` plus `items` (the
related documents), `variants` and `meta`. Verified against a live tenant; the naming difference between
input (`showcase`) and output (`showcases`) is easy to trip over. (Fashion Universe.)

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

`deleteImage` refuses an image that **any** item version references, including old ones —
`AssetInUseError … referenced in 3 places` came back for an image every current draft and published
version had already moved away from. `force: true` removes it anyway. Check the current versions
yourself before forcing. (Car Parts Universe.)

## Failure modes

| Symptom                                                     | Cause                                                  | Fix                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| Broken tiles in the library, broken images on items         | `copyRemoteAsset` gave a key but the copy never landed | HEAD-check the keys; re-import those with `requestHeaders`, or upload |
| `ImageNotFoundError` from `updateImage` right after a copy  | The key exists before the file does                    | Wait for every copy task, and retry "not found"                       |
| `registerImage` fails on a copied key                       | `copyRemoteAsset` already registered it                | Don't register a copied image                                         |
| `variants: []` in Discovery, `width: null` in Core          | Renditions are still queued                            | Fall back to `url`; publish and re-index once they exist              |
| A replaced image still shows the old file on the storefront | `registerImageRevision` does not reach published items | Upload a new image and write its key onto the items                   |
| `AssetInUseError` on an image nothing current uses          | Old item versions still reference it                   | `deleteImage(force: true)` after checking current versions            |
| `copyRemoteAsset` rejects a video URL                       | `RemoteAssetType` is `image` only                      | Use the presigned upload path                                         |
