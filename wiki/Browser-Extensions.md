# Browser Extensions

YT Zero works without a browser extension. Extensions are optional companions that can make navigation and embedded playback feel more integrated.

## Recommended: YT Zero Enhance

**[Pelski/ytzero-enhance](https://github.com/Pelski/ytzero-enhance)** is the recommended companion extension for the best YT Zero browser experience.

Install the extension from the Chrome Web Store or Firefox Add-ons. For other browsers, use the [manual installation](https://github.com/Pelski/ytzero-enhance#build-and-install-manually) instructions until their store listings are public.

<p align="center">
  <a href="https://chromewebstore.google.com/detail/yt-zero-enhance/dibdidnkdjnbnoicdmbklmmpchkfmmhd?hl=pl&amp;authuser=0"><img src="https://developer.chrome.com/static/docs/webstore/branding/image/iNEddTyWiMfLSwFD6qGq.png" height="58" alt="Available in the Chrome Web Store"></a>
  <a href="https://addons.mozilla.org/en-US/firefox/addon/yt-zero-enhance/"><img src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg" height="58" alt="Get the add-on for Firefox"></a>
</p>

It can:

- connect securely to a signed-in self-hosted YT Zero instance;
- redirect supported watch, Shorts, live, and short-link URLs to that instance;
- apply the active profile's playback, quality, caption, seek, chapter, SponsorBlock, and screenshot settings;
- replace the embedded player's controls with a YT Zero-style control bar;
- provide keyboard shortcuts without requiring the iframe to be focused first;
- add chapters, SponsorBlock markers, picture-in-picture, fullscreen, theatre mode, and frame capture.

The extension supports Chromium-based browsers, Firefox, and Safari. Browser-specific notes are available in the [YT Zero Enhance repository](https://github.com/Pelski/ytzero-enhance#install).

YT Zero Enhance requires a running YT Zero instance. It is not a standalone client and does not bypass authentication, advertisements, DRM, region restrictions, or bot protection.

## Redirect-only alternative

[YTZero Redirect](https://github.com/pekempy/YTZero-Redirect) by [@pekempy](https://github.com/pekempy) is a lightweight Firefox and Chrome extension for users who only want supported video URLs to open on their YT Zero instance. It does not include the enhanced embedded-player integration provided by YT Zero Enhance.
