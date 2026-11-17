# Discovery Indexing and Consistency

Discovery is an index built from published content, not a view of it. Most "Discovery is broken" reports in the
builds behind this file were indexing behaviour: a publish that had not landed, a schema still rolling out, or an
error cached per query body. This file says what is asynchronous, how long it took, and how a storefront and a seed
script live with it.

> Measured on twelve builds, September to November 2026. Times are what those tenants saw, not guarantees.

## The states a tenant goes through

| State                                    | What Discovery answers                                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Never ignited                            | HTTP 404 with a plain JSON body, `{"success": false, "message": "There is no ignited Tenant for <tenant>."}`, not GraphQL `errors` |
| Ignited, shape has no discoverable field | The shape may have no type (contested: it may also be schema propagation, see below)                                               |
| Ignite task complete                     | The new schema reaches the nodes over 5-10 minutes, unevenly: some requests see it, others don't                                   |
| Serving                                  | Published content edits show within seconds; publishes in bulk take minutes                                                        |

A probe that only looks at `errors` misses the 404. `{ __typename }` is the cheapest check that a tenant is serving,
and `summary { profiling { queryEngine lastIndexCompletedAt } }` tells which engine answered and when the last full
index finished. `lastIndexCompletedAt` moves on an ignite, not on every publish.

## Igniting

`igniteDiscoApi(stacks: opensearch)` (Core) re-indexes the whole tenant. With `stacks: both` one tenant's task
completed while `profiling.queryEngine` stayed `atlas-search` and ranking never appeared; check `queryEngine` after
the task. Ignites are tenant-wide, so run one at a time and never build a storefront during one.

**What needs an ignite** (a publish is not enough):

- New shapes, and new or changed **discoverable** components on a shape. Republishing the items does not add the
  field. One build needed a **second** ignite minutes after the first before a new content chunk appeared.
- New stock locations and price variants (their `<location>Stock`, `<variant>Price` fields and filters).
- New vocabularies for ranking ([[vector-ranking]]).
- Removed shapes: their types linger for a few minutes after the task completes.

**After an ignite, the schema reaches Discovery's nodes over minutes.** During that window the same query fails on
some requests (`Cannot query field "inTheBox"`, `Abstract type Document was resolved to a type … that does not
exist`) and succeeds on others. In one build, 4 of 10 introspection queries saw the new filter type and 6 answered
`null`. The rules:

1. Wait 5-10 minutes before concluding a type or field is missing, and sample several times.
2. **Ship storefront code that queries a new field only after the field has answered ten times in a row.**
3. Coordinate model changes with deploys: the old code must not break on the new schema, and the new code must not
   run before the schema is there.

## Answers are cached per query body

Discovery caches responses keyed on the query text, and that includes **errors**. A query that failed during the
rollout kept failing verbatim after the index was fine, while the same query with another operation name, another
field order or another `limit` succeeded. Successful answers are cached the same way: one build's verification query
kept answering 333 products for minutes while a renamed query answered the real 377.

So verification scripts **vary the operation name** (or add a harmless variable) on every call, and a failure right
after a change is retested with a changed body before anyone concludes the schema is wrong. A Next.js dev server can
also keep serving a failed read from its own cache: restart it.

## Publishing is asynchronous

`publishItem` answers `PublishInfo` before anything is published. After 527 publishes per language at concurrency 6,
10-35 % of the items still had an older published version several minutes later, and Discovery's counts kept
climbing for about 10 minutes. A few `publishItem` calls answered success for items that never became published.
Republishing at once only adds to the queue.

For a seed or an import:

1. Publish, then wait until each item's **published version is at least as new as its draft** (Core
   `item(id:, language:, versionLabel: published) { … }`), and republish only what still lags.
2. Then check Discovery counts against what you published, with a fresh operation name each time.
3. Only then ignite, if the run changed the model.

Deleted items linger in Discovery for 1-3 minutes. Unpublishing follows the same path as publishing.

## Relations, media and translations are snapshotted at indexing

Discovery stores each document with what it resolved **when that document was indexed**:

- **Relations resolve when the referencing item is indexed.** Collections published in the same run as their new
  titles came into Discovery with those titles missing, and stayed so until the collections were published again.
  Publish the targets first (people, products, folders), then the items that point at them, **in each language**:
  a title published in `no` before its people had a Norwegian name listed none of them in `no`.
- **Images and video**: an item published before its image renditions or video playlists existed keeps
  `variants: []`, `width: null` or `playlists: []` in Discovery until it is published again. Wait for the media to be
  processed, then publish ([[media]]).
- **A replaced image** (`registerImageRevision`) shows in Discovery only once the items using it are re-indexed.
- **A component made discoverable after publishing** needs a republish (and the ignite above).
- Bookable products appeared in Discovery about a minute after publish, with no ignite.

## Under load

- **HTTP 200 with `errors: [{ message: "Response Error" }]`** came back after about 900 prerendered pages in one
  build, on different pages each run, and during an ignite. Retry on that message as well as on 429 and 5xx, cap
  prerender concurrency, or render on demand and cache instead of prerendering every page ([[storefront]]).
- **Totals and replicas flicker during re-indexing.** Counts differ between consecutive requests, and a full cursor
  scan can stop early (`hasMoreHits: false` at 173 of 590). A complete index (sitemap, feed, llms-full.txt) needs
  retries, the union of passes, and a check against `summary.totalHits`.
- Market price fields (`…PriceFor`, `…PriceForEveryone`) are the slowest reads under load; request them only where
  they are shown.

## Fail-safe reads in a storefront

- **Cached reads must never throw.** With Next.js `'use cache'`, a read that throws during warming leaves no entry,
  and a failing query inside a cached scope breaks background revalidation even when the caller catches it. Return
  an `{ error }` value with a short cache life instead, and render a fallback.
- Prefer shape-filtered queries and fragments that tolerate a missing type while a schema rolls out.
- Revalidate on publish with a Core webhook (`concern: items`), and expect the Discovery answer to lag the webhook
  by seconds: revalidate again shortly after, or keep the cache life short for freshly published content
  ([[mutation]], [[storefront]]).

## Checklist after a change

| You changed                     | Then                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| Content of existing items       | Publish; expect seconds; verify with a fresh operation name                                |
| Many items                      | Publish; wait for published ≥ draft per item; republish laggards; check counts             |
| A shape or discoverable field   | Ignite; wait 5-10 minutes; sample the schema until it answers every time; then deploy code |
| Stock locations, price variants | Ignite, as above                                                                           |
| Images or video                 | Wait for renditions or playlists in Core, then publish the items that use them             |
| Related items                   | Publish targets first, then referrers, per language                                        |
| Deleted items                   | Expect 1-3 minutes before they disappear                                                   |
