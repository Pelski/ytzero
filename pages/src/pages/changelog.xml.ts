import { getCollection } from "astro:content";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function GET({ site }: { site?: URL }) {
  const baseUrl = site ?? new URL("https://ytzero.app");
  const updates = (await getCollection("updates")).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf()
  );

  const items = updates.map((entry) => {
    const link = new URL(`/changelog/${entry.id}/`, baseUrl).toString();
    return `<item>
      <title>${escapeXml(entry.data.title)}</title>
      <link>${link}</link>
      <guid>${link}</guid>
      <pubDate>${entry.data.date.toUTCString()}</pubDate>
      <description>${escapeXml(entry.data.description)}</description>
    </item>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>YT Zero changelog</title>
    <link>${new URL("/changelog/", baseUrl)}</link>
    <description>New features, meaningful improvements, and project news from YT Zero.</description>
    <language>en</language>
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
