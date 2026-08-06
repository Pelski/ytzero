YT Zero has an import wizard that brings in **NewPipe subscriptions** or YouTube data from a [Google Takeout](https://takeout.google.com) export: **channel subscriptions**, **playlists**, and **watch history**. Open it from **Settings → Import data**, or from the button on the empty home feed.

## Exporting subscriptions from NewPipe

From NewPipe's subscriptions screen, choose **Import / Export → Export to** and
upload the resulting JSON file to YT Zero. Both the complete export (including
`app_version` metadata) and a minimal document containing only
`subscriptions` are supported. Only YouTube entries (`service_id: 0`) are
imported; subscriptions for other NewPipe services are skipped.

## Exporting from Google Takeout

1. Go to [takeout.google.com](https://takeout.google.com).
2. Select only **YouTube and YouTube Music**.
3. Include subscriptions, playlists, and history.
4. Download the archive.

## Importing

1. Drop a NewPipe subscription JSON or the whole Takeout `.zip` onto the import page. Loose Takeout files also work: `subscriptions.csv`, playlist CSVs, `watch-history.json` or `.html`. You can combine files from both sources before analyzing.
2. Click **Analyze files**. YT Zero recognizes the contents (localized exports work too — file names and dates in Polish or German are handled).
3. Pick what to import: toggle whole sections, deselect individual channels or playlists.
4. For watch history, choose **Everything** or **From date**. Entries are matched by video and marked as watched. They remain available in history and the library, but do not appear in the feed as unwatched videos later.

Note: in **From date** mode, entries older than the cutoff (and entries without a readable date) are skipped entirely. Choose **Everything** if you want your full history marked as watched.

## After importing

Everything appears in the library immediately, but titles, thumbnails, and channel data for imported videos are filled in gradually in the background. The pace is deliberately throttled so YouTube doesn't block the requests — the result screen shows an estimate based on your settings (`IMPORT_ENRICH_BATCH_SIZE`, `IMPORT_ENRICH_INTERVAL_MINUTES`). Subscribed channels start filling the feed via their RSS feeds, as described in [How It Works](How-It-Works).
