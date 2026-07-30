## Privacy

YT Zero does not require a Google account or a YouTube Data API key. It stores app data in the database you control: SQLite by default or PostgreSQL after an explicit migration. The app still connects to YouTube to fetch RSS feeds, metadata, thumbnails, pages, and embedded videos.

Optional automatic update checks contact the GitHub Releases API. The bundled
changelog remains available when checks are disabled or GitHub cannot be
reached.

Watch-page comments are disabled by default. When enabled for a profile, they
are fetched through yt-dlp only after the viewer scrolls to the comments
section. Configured YouTube access cookies may be used for restricted content;
cookie files are per profile, machine-local secrets and never enter portable
backups.

### DeArrow

The optional [DeArrow](https://dearrow.ajay.app/) integration is disabled by default. Replacement titles and thumbnails can be enabled independently under **Settings → Privacy**.

- For title and branding lookups, the YT Zero server sends only the first four characters of the video's SHA-256 hash to `sponsor.ajay.app`. The response contains a group of possible matches, and YT Zero selects the entry for the requested video locally.
- When a community thumbnail is available and thumbnail replacement is enabled, the image request to `dearrow-thumb.ajay.app` contains the YouTube video ID and selected timestamp.
- Branding lookup results are cached in server memory for 15 minutes. They are not written to the library, and a missing or failed lookup falls back to the original title and thumbnail.
- The switches are portable per-profile preferences. Replacement responses and caches are not included in portable backups.

DeArrow/SponsorBlock community data is available under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

## Limitations

- RSS feeds expose only a limited recent set of videos per channel.
- YouTube page structure can change, which may affect metadata, live detection, Shorts detection, or playlist parsing.
- Embedded playback is still YouTube playback and follows YouTube embed behavior.
- Multi-user support is profile-based on a single self-hosted install, not multi-tenant. Each profile follows channels independently and starts empty; underlying channel/video data is shared and deduplicated across the install for efficiency, but subscriptions and all other state are per-profile.

## Trademark notice

YouTube is a trademark of Google LLC. This project is not affiliated with, endorsed by, sponsored by, or otherwise associated with YouTube or Google LLC.

## Acknowledgements

- **[SponsorBlock](https://sponsor.ajay.app)** — community-driven database of skippable segments in YouTube videos (sponsors, intros, outros, and more). YT Zero optionally queries the SponsorBlock API to automatically skip segments while watching. SponsorBlock is an open-source project by [Ajay Ramachandran](https://github.com/ajayyy) — thank you to everyone who contributes segments to the database. Ajay is doing an amazing job and the project is well worth supporting — you can do so at [sponsor.ajay.app/donate](https://sponsor.ajay.app/donate).
- **[DeArrow](https://dearrow.ajay.app/)** — community-created titles and thumbnail timestamps that reduce clickbait without changing the underlying video. YT Zero uses this data only when the corresponding profile settings are enabled.

## License

This project is licensed under the **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`).

See [LICENSE](https://github.com/Pelski/ytzero/blob/main/LICENSE) for the full license text.
