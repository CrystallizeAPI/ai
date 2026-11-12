---
name: media
description: Import images, video and files into Crystallize and get them served — copyRemoteAsset from a supplier or manufacturer URL, presigned uploads (generatePresignedUploadRequest, form POST, registerImage), verifying that a copy landed, waiting for renditions before publishing, video upload and transcoding, alt text, captions and image topics per language (updateImage), showcases (hotspots, shop the look), replacing an image (registerImageRevision) and deleting media. Use when importing product images, debugging broken or missing images, images without renditions or with variants [] in Discovery, ImageNotFoundError, ImageAlreadyExistsError, copy tasks that fail silently, uploading images from a browser page, attaching video, tagging or classifying images, or adding hotspots. For rendering images (srcset, sizes, formats, LCP) use responsive-images.
metadata:
    author: Crystallize
    version: "1.0"
---

# Crystallize Media Skill

Get images, video and files into the media library, onto items, and into Discovery. Every step is asynchronous, and
most failures are silent: a key is handed back before the file exists, renditions arrive minutes to an hour later,
and Discovery keeps whatever it saw when the item was published. Media import was the second most frequent problem
across twelve builds.

Rendering what you imported (srcset, sizes, WebP vs AVIF, LCP, share images) is [[responsive-images]]. Modelling the
components that hold media is [[content-model]]. All mutations here are on the Core API, from scripts or your server.

## Consultation Approach

1. **Where do the files come from?** A URL Crystallize can fetch, bytes you hold, or a browser page (user uploads)?
2. **Images, video or files?** Video and files take the upload path only.
3. **How many?** Hundreds need throttling, task checks and a verification pass; thousands need a resumable script.
4. **Which languages?** Alt text, captions and image topics are written once per language.
5. **When will the items be published?** After the renditions exist, or Discovery serves them without renditions.

## Choose the way in

| You have                                | Use                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| A URL Crystallize can fetch             | `copyRemoteAsset(sourceUrl:, type: image)`: Crystallize pulls it, as a bulk task   |
| Bytes you hold, or a URL it can't fetch | `generatePresignedUploadRequest(type: MEDIA)` → form POST (it registers the image) |
| A file uploaded from a browser page     | Presign on the server, POST from the browser, no Core token in the page            |
| Video, whatever the source              | The upload path: `copyRemoteAsset` takes images only                               |
| Files (PDF, CAD)                        | Upload with `type: STATIC`, then `{ key, title }` in a `files` component           |
| Many images in a mass operation         | `image/register` with `{{ upload url }}` ([[mass-operations]])                     |

**`copyRemoteAsset` can't fetch** a source that:

- takes more than **30 s** to answer (the task ends in `error`: `Request timed out after 30 seconds`);
- has a URL longer than **256 characters** (`InvalidLengthError`, before any fetch; signed CDN URLs hit this);
- sends no `Content-Length` (streamed or chunked resizers, and Cloudflare when it compresses on `Accept-Encoding`);
- sits behind bot protection (Akamai, Imperva): the mutation succeeds and only the task says `error`;
- answers a compressed body or a `content-type` other than `image/jpeg`, `jpg`, `png`, `webp`, `tiff`, `tif` or `avif`.

For those, download the file yourself and use the upload path. Don't work around a block a site has put up. Prefer a
resized source where the manufacturer offers one: 3-17 MB CMYK originals copied slowly and failed often, while the
same CDN's 1600 px WebP (0.5-1 MB) went in as is.

Details, code and every error: [Importing images](references/import.md).

## The pipeline that works

1. **Import** with bounded concurrency (8-12). Keep a local `source URL → key` cache, so reruns are free and no image
   is registered twice.
2. **Check every copy task.** `copyRemoteAsset` answers with a `targetKey` and a task id before the copy runs. Read
   `bulkTasks(filter: { type: copyRemoteAsset, status: error })` (or `bulkTask(id:)` per task) until no task is
   `pending` or `started`; `info.error` has the reason, `targetKey` what to retry.
3. **Verify that the file landed**: `image(key) { key }` plus a HEAD on the CDN URL. The record existing proves
   nothing: a key can be registered whose file never arrives, and `image(key)` is `null` while a copy is pending or
   failed.
4. **Wait for processing**: `image(key) { width variants { url } }`. `width` and `variants` stayed `null` for 15 minutes
   to over an hour on large imports, while the CDN already served the file. Don't re-copy because `width` is still
   `null`; one build did, and got 320 duplicate records.
5. **Write metadata** (alt text, caption, topics, showcases) per language with `updateImage`, **before publishing**:
   `updateImage` re-indexes every item that uses the image.
6. **Write the keys onto the items** (`images` components, variant images). A key can be referenced as soon as it is
   registered.
7. **Publish the items only after `variants` exist for every key.** Discovery snapshots image metadata at publish time:
   an item published earlier keeps `width: null` and `variants: []` until it is published again
   ([Discovery Indexing](../query/references/discovery-indexing.md)).

Check the content of what you imported, too. Manufacturer CDNs serve "missing image" placeholders, logos and blank
images with HTTP 200, a redirect to a login page uploads HTML, and an extension-less URL gives a key that is never
processed. A size and content-hash check catches most of it, and one picture re-encoded per colour variant is
de-duplicated by hash (`resourceIdentifier: img-<sha1>` in a mass operation).

## Presigned uploads

```graphql
mutation Presign($filename: String!, $contentType: String!) {
    generatePresignedUploadRequest(filename: $filename, contentType: $contentType, type: MEDIA) {
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

Build a multipart form from `fields` **in the order given**, append the file **last**, and POST it to `url`. The key is
the `key` field.

- **The POST registers the image by itself.** A `registerImage` afterwards answers `ImageAlreadyExistsError`: treat it
  as success. It is still worth calling right after the POST, because it makes the key usable at once.
- **So a browser page can upload directly**: the server makes the presign (Core token), the page POSTs the form, and
  no Core credential reaches the browser. This is the one Core-related call a storefront page makes, and it goes to
  the storage URL, not to Core.
- A `400 RequestTimeout` from the POST is retried with a **fresh** presign (the failed try may leave an orphan key).
- Check the `content-type` you are uploading: a 302 to a login page uploaded HTML that `registerImage` accepted and
  that never got a size.
- `maxSize` was 10 GiB for images and video. The decoded policy lasts a year, so presigns can be made in bulk.

## Metadata per language

`updateImage(key:, language:, input:)` writes `altText`, `caption` (`{ html: [...] }`), `focalPoint`, `meta`,
`topicIds` and `showcase` on the **library asset**:

- **Alt text, caption and image topics are per language.** Two languages means two writes per image (652 writes for
  326 images ran in about two minutes at concurrency 8, with no rate limiting).
- Item images point at the asset, so there is **no per-item alt text** to keep in sync: Discovery's
  `images { altText }` comes from the asset, after the next publish.
- `updateImage` **re-indexes every item that uses the image** (17k updates touched all 787 products in one build).
  Write metadata before publishing products, not after.
- Variant **attributes** are not per language: an `en` update overwrote the `no` colour values. Variant **images** are
  written per language.
- `targetFilename` on `copyRemoteAsset` sets the public file name (`…/<hash>/helsingin-heikas-a1-floor-plan.jpg`):
  name files for people and search engines.
- Image topics in Discovery come back as a flat hash of every ancestor path, not leaf paths.
- Classifying images with a vision model (image type, alt text in each language) worked on 697 images; cache by URL.

## Showcases (hotspots)

A showcase links a point on an image to products, SKUs or documents: "shop the look". Core writes `showcase`
(singular) on `updateImage` and on every `ImageInput`; Discovery reads `showcases` (plural). Coordinates are
**fractions 0-1**, `skus` is required (send `[]`), and labels go in `meta`. See
[Showcases](references/showcases.md).

## Video

Upload with `generatePresignedUploadRequest(contentType: "video/mp4" | "video/quicktime", type: MEDIA)`, then write
`{ key, title }` into a `videos` component or a variant's videos. The video is registered when an item first uses it,
transcoded to HLS and DASH in about a minute for a short clip, and an item published before `playlists` exist keeps
`playlists: []` in Discovery. See [Video](references/video.md).

## Replacing and deleting

- **Replace**: upload the new file, then `registerImageRevision(imageKey:, revisionKey:)` right after the POST.
  Core and the Catalogue API show the revision at once and the ladder rebuilds in about 25 s, but Discovery keeps the
  file each item was indexed with. Republishing the items fixed it on one tenant and did not on another, so the
  reliable way is a **new image**: upload, write the new key onto the items, publish.
- **Delete**: `deleteImage(key:, force:)` refuses while any item version references the image, old versions included
  (`AssetInUseError … referenced in 3 places`). Check the current versions, then `force: true`. `deleteVideo` refuses
  while an item uses it; once the item is gone the video stays registered and can be reused.

## Failure modes

| Symptom                                                    | Cause                                                        | Fix                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Broken tiles in the library, broken images on items        | `copyRemoteAsset` gave a key, the copy never landed          | Read failed tasks; HEAD-check keys; re-import with `requestHeaders`, or upload |
| `image(key)` is `null` after a copy                        | Copy pending, or failed (timeout, length, no Content-Length) | Wait for the task; read `info.error`                                           |
| `ImageNotFoundError` from `updateImage` right after a copy | The key exists before the file does                          | Wait for every copy task; retry "not found" after a delay                      |
| `ImageAlreadyExistsError` from `registerImage`             | The copy or the presigned POST registered it already         | Treat as success                                                               |
| `width: null`, `variants: null` for a long time            | Renditions are queued (minutes to an hour)                   | Wait; verify by key + HEAD, not width; don't re-copy                           |
| `variants: []` in Discovery, renditions fine in Core       | The item was published before the renditions existed         | Publish the items again                                                        |
| `playlists: []` in Discovery                               | Published before transcoding finished                        | Wait for Core `video(key) { playlists }`, then publish                         |
| Alt text shows in one language only                        | Metadata is per language                                     | `updateImage` once per language                                                |
| A replaced image still shows the old file                  | Discovery keeps what it indexed                              | Republish, or register a new image and write its key                           |
| `AssetInUseError` on an image nothing current uses         | Old item versions still reference it                         | `deleteImage(force: true)` after checking current versions                     |
| `copyRemoteAsset` rejects a video URL                      | `RemoteAssetType` is `image` only                            | Use the presigned upload path                                                  |

## References

- [Importing images](references/import.md) - `copyRemoteAsset` and its limits, task checks, presigned uploads, mass
  operation registration, verification, renditions
- [Video](references/video.md) - Upload, registration on first use, transcoding, thumbnails, publishing order
- [Showcases](references/showcases.md) - Hotspot input and output, coordinates, labels per language, variant images

## Related skills

[[responsive-images]] renders the ladder. [[mutation]] covers the item writes that reference media keys, and
[[mass-operations]] the `image/register` path. [[content-model]] decides which components hold media and whether they
are discoverable (an `images` component left non-discoverable is absent from Discovery). Indexing behaviour is in
[Discovery Indexing](../query/references/discovery-indexing.md).
