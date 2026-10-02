const LABELS = {
  page_reachable: "Page answers", https: "Served over HTTPS", indexable: "Search engines may index it", search_crawlers: "AI search crawlers may read it",
  sitemap: "Sitemap", llms_txt: "llms.txt", canonical: "Canonical address", structured_data: "Structured data about who you are",
  single_h1: "One main heading", title: "Title", meta_description: "Meta description", answers_questions: "Answers customer questions", content_depth: "Enough text to quote",
  markdown: "Markdown for agents", content_signals: "Content Signals in robots.txt", link_headers: "Link header for agents", ucp: "Shopping profile for agents (UCP)",
  api_catalog: "API catalog", mcp_card: "MCP server card"
};
const ENGINES = { chatgpt: "ChatGPT", gemini: "Gemini", copilot: "Copilot", perplexity: "Perplexity", google_ai_overviews: "Google AI Overviews", google_ai_mode: "Google AI Mode" };
const ICON = { pass: "pass", warn: "check", fail: "fix", info: "note", unknown: "unknown" };
const percent = (value) => (value < 0.1 ? `${(value * 100).toFixed(1)}%` : `${Math.round(value * 100)}%`);
const date = (value) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function markdown(result) {
  const lines = [`# AI search readiness: ${result.url}`, "", `Audited ${result.audited_at} as a ${result.profile} site. Overall ${result.score.overall ?? "n/a"}/100 (${Object.entries(result.score.categories).map(([name, value]) => `${name} ${value}`).join(", ")}).`, ""];
  lines.push("| Check | Result | Found | What the index shows |", "|---|---|---|---|");
  for (const check of result.checks) {
    const evidence = !check.evidence ? "" : check.evidence.source === "Cloudflare Radar"
      ? `${percent(check.evidence.pass_rate)} of ${check.evidence.sites.toLocaleString("en-US")} ${check.evidence.scope === "ecommerce" ? "online stores" : "sites"} Cloudflare scanned on ${date(check.evidence.date)} pass`
      : `${percent(check.evidence.pass_rate)} of the ${check.evidence.pages} pages AI answers cited most pass`;
    lines.push(`| ${LABELS[check.id] ?? check.id} | ${ICON[check.status]} | ${String(check.found).replaceAll("|", "/")} | ${evidence} |`);
  }
  const index = result.index;
  lines.push("", `Index evidence: ${index.valid_answers.toLocaleString("en-US")} valid answers to discovery questions from ${Object.keys(index.engines).map((engine) => ENGINES[engine] ?? engine).join(" and ")}, ${date(index.period.from)} to ${date(index.period.to)} (${index.source}; method: ${index.method}). ${percent(index.answers_citing_kind.directory)} of those answers cited a directory such as Yelp or Angi, so being listed there matters as much as your own pages. These are observations, not proof that a fix causes a citation.`);
  if (result.radar) lines.push("", `Agent checks follow Cloudflare's Agent Readiness criteria, judged for a ${result.profile} site: a check that does not apply is a note, never a failure, and no file is suggested for a capability the site does not have. Adoption figures: ${result.radar.source} (${result.radar.source_url}), ${result.radar.sites.toLocaleString("en-US")} sites scanned on ${date(result.radar.date)}.`);
  const files = Object.keys(result.diffs);
  if (files.length) lines.push("", "## Ready-made changes", "", ...files.map((file) => `- \`${file}\``), "", "Templates mark with REPLACE what only you can fill in; never publish a placeholder.");
  lines.push("", "Open source tells you what could be wrong. Searchiz tells you whether AI actually recommends you, and fixes it: https://searchiz.com");
  return `${lines.join("\n")}\n`;
}
