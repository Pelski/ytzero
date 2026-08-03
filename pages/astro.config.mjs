import { defineConfig } from "astro/config";
import { unified } from "@astrojs/markdown-remark";

function remarkWikiLinks() {
  return (tree, file) => {
    const source = file.history?.[0] ?? "";
    if (!source.includes("/wiki/")) return;

    const visit = (node) => {
      if (node?.type === "link" && typeof node.url === "string") {
        const url = node.url;
        if (!/^(?:[a-z]+:|\/|#)/i.test(url)) {
          const [slug, fragment] = url.split("#", 2);
          node.url = `/docs/${slug}/${fragment ? `#${fragment}` : ""}`;
        }
      }
      if (Array.isArray(node?.children)) node.children.forEach(visit);
    };

    visit(tree);
  };
}

export default defineConfig({
  site: "https://ytzero.app",
  output: "static",
  publicDir: "../docs/assets",
  trailingSlash: "always",
  markdown: {
    processor: unified({ remarkPlugins: [remarkWikiLinks] }),
  },
});
