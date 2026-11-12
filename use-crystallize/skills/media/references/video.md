# Video (Core API)

`copyRemoteAsset` takes images only, so video always goes through the upload path. (Fashion Universe and Screen
Universe, September 2026.)

## Upload and attach

1. Download the file. MP4 and MOV upload as they are; an HLS-only source is remuxed first (`ffmpeg -i x.m3u8 -c copy
   out.mp4`).
2. `generatePresignedUploadRequest(filename:, contentType: "video/mp4" | "video/quicktime", type: MEDIA)`. `maxSize`
   is 10 GiB (S3's own limit for a single POST is 5 GB); 500 MB to 1 GB films are well within it.
3. POST the form: `fields` in order, the file last. Stream it (`fs.openAsBlob(path, { type: "video/mp4" })`, Node
   20+): 11 MB uploaded in 1.2 s, 62 MB in 9.5 s.
4. Write `{ key, title }` into a `videos` component, or a variant's videos:

```graphql
mutation Attach($itemId: ID!, $language: String!) {
    updateComponent(
        itemId: $itemId
        language: $language
        component: {
            componentId: "trailer"
            videos: [{ key: "<key>", title: "Trailer", thumbnails: [{ key: "<image key>", altText: "…" }] }]
        }
    ) {
        __typename
        ... on BasicError {
            errorName
            message
        }
    }
}
```

There is no `registerVideo`. **A video is registered when an item first uses it**: `video(key)` is `null` after the
upload until `{ key, title }` is written into a component. A `videos` component's `max` is enforced on create
(`Cannot provide more than 2 videos for component hero-video`).

## Transcoding

- A 32 s trailer had Core `video(key) { playlists }` within 32 s; a 10-minute, 62 MB file took 114 s. The output is
  CMAF on `media.crystallize.com`: `…/cmaf/<name>.m3u8` and `.mpd`.
- **The ladder goes up to 1080p, upscaling**: 480p and 360p sources both got 234p, 360p, 432p, 720p and 1080p
  renditions (H.264). One earlier build saw the ladder capped at the source; check on your tenant.
- **Every rendition is 29.97 fps**: a 25 fps clip came back converted, which judders slightly. It isn't configurable
  from the API.
- An audio group is always added: the source's audio when it has one, otherwise an `eng` program audio group. Keep a
  silent stereo AAC track on silent sources if you want every file to have the same shape.

## Thumbnails

`thumbnails` stays `null` unless you write one. Upload a poster image and attach it, either with the video
(`VideoInput.thumbnails: [ImageInput]`, as above) or later with `updateVideo`. Discovery returns
`<component> { thumbnails { url } }`.

## Publishing order

**Discovery doesn't pick up the playlists by itself.** An item published before transcoding finished kept
`playlists: []` in Discovery (checked for over four minutes) while Core had them, and publishing the item again fixed
it within 10 s. So: upload, attach, **wait for Core `video(key) { playlists }`**, then publish.

## Deleting

`deleteVideo` answers `AssetInUseError` while an item uses the video, so delete or change the item first. Once the
item is gone, `video(key)` still answers with its playlists, so a cached key can be attached to a new item and is
ready at once.

## Files

Files work the same way: upload with `type: STATIC`, then write `{ key, title }` into a `files` component. There is no
register step for them either.
