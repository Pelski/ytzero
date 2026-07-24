const DEFAULT_APP_NAME = "YT Zero";

export function createAppManifest(configuredName: string | null | undefined) {
  const name = configuredName?.trim() || DEFAULT_APP_NAME;

  return {
    name,
    short_name: name,
    description: "Self-hosted YouTube subscriptions reader",
    theme_color: "#0f0f0f",
    background_color: "#0f0f0f",
    display: "standalone",
    orientation: "any",
    start_url: "/",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  };
}
