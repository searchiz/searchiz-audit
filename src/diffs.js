import { isAllowed, parseRobots } from "./vendor/robots.js";

// Ready-to-apply changes. Nothing here states a fact about the business: a
// template marks what only the owner can fill in.
export function robotsPatch(original, blocked, path = "/") {
  const addition = ["", "# Let AI search crawlers read this site (searchiz-audit)", ...blocked.flatMap((name) => [`User-agent: ${name}`, `Allow: ${path}`, ""])].join("\n");
  const updated = `${original.replace(/\s*$/, "")}\n${addition}`;
  const groups = parseRobots(updated);
  if (blocked.some((name) => !isAllowed(groups, name, path))) return null;
  const before = original.split("\n");
  const after = updated.split("\n");
  const lines = ["--- a/robots.txt", "+++ b/robots.txt", `@@ -1,${before.length} +1,${after.length} @@`, ...before.map((line) => ` ${line}`), ...after.slice(before.length).map((line) => `+${line}`)];
  return `${lines.join("\n")}\n`;
}

export function jsonLdTemplate(url) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "REPLACE: your business name, exactly as customers know it",
    url,
    description: "REPLACE: one true sentence about what you offer and where",
    sameAs: ["REPLACE: your profile URLs (Google Business, Instagram, LinkedIn), or remove this line"]
  };
  return `<!-- Add inside <head>. Use LocalBusiness instead of Organization if customers visit you. Fill in only true facts. -->\n<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>\n`;
}

export const canonicalTag = (url) => `<link rel="canonical" href="${url}">\n`;
export const descriptionTag = () => `<meta name="description" content="REPLACE: 50 to 160 characters that say what the page offers and for whom">\n`;

// Content Signals state the owner's choice; the line below allows search and
// AI answers and refuses training, the common choice. Change any value.
export const contentSignalsPatch = () => "# Add under User-agent: * in robots.txt (contentsignals.org). Change any value to match your choice.\nContent-Signal: search=yes, ai-input=yes, ai-train=no\n";
export const linkHeaderNote = (origin) => `# Send this header with your home page response (RFC 8288):\nLink: <${origin}/llms.txt>; rel="describedby"; type="text/plain"\n`;
