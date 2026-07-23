You add channels in **Settings → Channels**.

> Coming from YouTube with a full Takeout export? The [Takeout import wizard](Importing-from-Google-Takeout) brings in subscriptions, playlists, and watch history in one go — this page covers adding individual channels and plain subscription lists.

## Supported inputs

- A YouTube channel URL, for example `https://www.youtube.com/@handle`
- A channel ID URL, for example `https://www.youtube.com/channel/UC...`
- OPML files from tools such as NewPipe, FreeTube, or Invidious
- Google Takeout `subscriptions.csv`

## Exporting from Google Takeout

1. Go to [takeout.google.com](https://takeout.google.com).
2. Select only **YouTube and YouTube Music**.
3. Include subscriptions.
4. Download the archive.
5. Import `subscriptions.csv` in YT Zero settings.

## After importing

Once channels are added, YT Zero begins filling the local database from their public RSS feeds and refreshing metadata in the background. See [How It Works](How-It-Works) for what gets fetched and stored.
