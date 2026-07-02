## Privacy

YT Zero does not require a Google account or a YouTube Data API key. It stores app data locally in SQLite. The app still connects to YouTube to fetch RSS feeds, metadata, thumbnails, pages, and embedded videos.

## Limitations

- RSS feeds expose only a limited recent set of videos per channel.
- YouTube page structure can change, which may affect metadata, live detection, Shorts detection, or playlist parsing.
- Embedded playback is still YouTube playback and follows YouTube embed behavior.
- Multi-user support is profile-based on a single self-hosted install, not multi-tenant. Each profile follows channels independently and starts empty; underlying channel/video data is shared and deduplicated across the install for efficiency, but subscriptions and all other state are per-profile.

## Trademark notice

YouTube is a trademark of Google LLC. This project is not affiliated with, endorsed by, sponsored by, or otherwise associated with YouTube or Google LLC.

## Acknowledgements

- **[SponsorBlock](https://sponsor.ajay.app)** — community-driven database of skippable segments in YouTube videos (sponsors, intros, outros, and more). YT Zero optionally queries the SponsorBlock API to automatically skip segments while watching. SponsorBlock is an open-source project by [Ajay Ramachandran](https://github.com/ajayyy) — thank you to everyone who contributes segments to the database. Ajay is doing an amazing job and the project is well worth supporting — you can do so at [sponsor.ajay.app/donate](https://sponsor.ajay.app/donate).

## License

This project is licensed under the **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`).

See [LICENSE](https://github.com/Pelski/ytzero/blob/main/LICENSE) for the full license text.
