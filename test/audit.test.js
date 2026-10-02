import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { audit, score } from "../src/audit.js";
import { markdown } from "../src/report.js";
import { isAllowed } from "../src/vendor/robots.js";
import { robotsPatch } from "../src/diffs.js";

const vectors = JSON.parse(readFileSync(new URL("./robots-vectors.json", import.meta.url), "utf8"));

test("robots matching is the same as the Searchiz app and searchiz-bots", () => {
  for (const item of vectors.cases) assert.equal(isAllowed(item.robots, item.agent, item.path), item.allowed);
});

const site = (pages) => async (url) => {
  const page = pages[url];
  if (!page) return { url, status: 404, headers: new Headers(), text: async () => "" };
  return { url, status: page.status ?? 200, headers: new Headers(page.headers ?? {}), text: async () => page.body };
};

test("a thin page blocked to AI search gets failing checks, index evidence and fixes", async () => {
  const fetchImpl = site({
    "https://shop.example.com/": { body: "<html><head><title>Hi</title></head><body><h1>Shop</h1><p>Welcome</p></body></html>" },
    "https://shop.example.com/robots.txt": { body: "User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /" }
  });
  const result = await audit("shop.example.com", { fetchImpl });
  const byId = Object.fromEntries(result.checks.map((check) => [check.id, check]));
  assert.equal(byId.search_crawlers.status, "fail");
  assert.match(byId.search_crawlers.found, /OAI-SearchBot/);
  assert.equal(byId.structured_data.status, "fail");
  assert.equal(byId.sitemap.status, "warn");
  assert.ok(byId.structured_data.evidence.pages >= 10);
  assert.ok(result.diffs["robots.txt.patch"].includes("+User-agent: OAI-SearchBot"));
  assert.ok(result.diffs["structured-data.html"].includes("REPLACE"));
  const report = markdown(result);
  assert.match(report, /valid answers to discovery questions/);
  assert.doesNotMatch(report, /[–—]/);
});

test("an unreadable site is unknown, never a failure about the business", async () => {
  const result = await audit("down.example.com", { fetchImpl: async () => { throw new Error("offline"); } });
  const byId = Object.fromEntries(result.checks.map((check) => [check.id, check]));
  assert.equal(byId.page_reachable.status, "unknown");
  assert.equal(byId.search_crawlers.status, "unknown");
  assert.equal(result.score.overall, null);
});

test("the robots patch really releases every blocked crawler", () => {
  const patch = robotsPatch("User-agent: *\nDisallow: /", ["OAI-SearchBot", "PerplexityBot"]);
  const after = "User-agent: *\nDisallow: /\n" + patch.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1)).join("\n");
  assert.ok(isAllowed(after, "OAI-SearchBot", "/"));
  assert.ok(isAllowed(after, "PerplexityBot", "/"));
  assert.ok(!isAllowed(after, "GPTBot", "/"));
});

test("scores count warnings as half and ignore notes", () => {
  assert.deepEqual(score([{ category: "a", status: "pass" }, { category: "a", status: "warn" }, { category: "b", status: "info" }]), { overall: 75, categories: { a: 75 } });
});

const byId = (result) => Object.fromEntries(result.checks.map((check) => [check.id, check]));

test("a Shopify store is asked for Markdown, Content Signals and UCP, with Radar adoption as evidence", async () => {
  const fetchImpl = async (url, options) => {
    const accept = options.headers.Accept;
    const pages = {
      "https://shop.example.com/": { body: '<html><script src="https://cdn.shopify.com/s/x.js"></script><title>Shop</title></html>' },
      "https://shop.example.com/robots.txt": { body: "User-agent: *\nAllow: /", headers: { "content-type": "text/plain" } },
      "https://shop.example.com/llms.txt": { body: "# Shop", headers: { "content-type": "text/plain" } }
    };
    const page = accept === "text/markdown" ? pages["https://shop.example.com/"] : pages[url];
    if (!page) return { url, status: 404, headers: new Headers({ "content-type": "text/html" }), text: async () => "" };
    return { url, status: 200, headers: new Headers(page.headers ?? { "content-type": "text/html" }), text: async () => page.body };
  };
  const result = await audit("shop.example.com", { fetchImpl });
  const checks = byId(result);
  assert.equal(result.profile, "store");
  assert.equal(checks.markdown.status, "fail");
  assert.equal(checks.content_signals.status, "fail");
  assert.equal(checks.link_headers.status, "fail");
  assert.equal(checks.ucp.status, "fail");
  assert.equal(checks.api_catalog, undefined);
  assert.equal(checks.markdown.evidence.source, "Cloudflare Radar");
  assert.equal(checks.markdown.evidence.scope, "ecommerce");
  assert.ok(result.diffs["content-signals.txt"].includes("Content-Signal: search=yes"));
  assert.ok(result.diffs["link-header.txt"].includes('rel="describedby"'));
  const report = markdown(result);
  assert.match(report, /as a store site/);
  assert.match(report, /online stores Cloudflare scanned on/);
  assert.match(report, /Open source tells you what could be wrong\. Searchiz tells you whether AI actually recommends you, and fixes it/);
  assert.doesNotMatch(report, /[–—]/);
});

test("a site with Content Signals, Markdown and no API passes and is not asked for an API catalog or MCP card", async () => {
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/robots.txt")) return { url, status: 200, headers: new Headers({ "content-type": "text/plain" }), text: async () => "User-agent: *\nContent-Signal: search=yes, ai-train=no\nAllow: /" };
    if (url === "https://app.example.com/" && options.headers.Accept === "text/markdown") return { url, status: 200, headers: new Headers({ "content-type": "text/markdown; charset=utf-8" }), text: async () => "# App" };
    if (url === "https://app.example.com/") return { url, status: 200, headers: new Headers({ "content-type": "text/html" }), text: async () => '<script type="application/ld+json">{"@type":"SoftwareApplication"}</script>' };
    return { url, status: 404, headers: new Headers(), text: async () => "" };
  };
  const result = await audit("app.example.com", { fetchImpl });
  const checks = byId(result);
  assert.equal(result.profile, "software");
  assert.equal(checks.markdown.status, "pass");
  assert.equal(checks.content_signals.found, "search=yes, ai-train=no");
  assert.equal(checks.api_catalog.status, "info");
  assert.equal(checks.mcp_card.status, "info");
  assert.equal(checks.link_headers.status, "info");
  assert.equal(result.score.categories.agents, 100);
});

test("an MCP server without a card is pointed out; an unreadable probe is unknown", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/.well-known/oauth-protected-resource")) return { url, status: 200, headers: new Headers({ "content-type": "application/json" }), text: async () => JSON.stringify({ resource: "https://app.example.com/mcp" }) };
    if (url.endsWith("/.well-known/oauth-authorization-server")) throw new Error("timeout");
    if (url === "https://app.example.com/") return { url, status: 200, headers: new Headers({ "content-type": "text/html" }), text: async () => "<p>app</p>" };
    return { url, status: 404, headers: new Headers(), text: async () => "" };
  };
  const result = await audit("app.example.com", { fetchImpl, profile: "software" });
  const checks = byId(result);
  assert.equal(checks.mcp_card.status, "fail");
  assert.match(checks.mcp_card.found, /app\.example\.com\/mcp/);
  assert.equal(checks.api_catalog.status, "unknown");
});

test("a local business is never asked for API or link files", async () => {
  const result = await audit("plumber.example.com", { fetchImpl: async (url) => ({ url, status: 200, headers: new Headers({ "content-type": "text/html" }), text: async () => '<script type="application/ld+json">{"@type":"Plumber"}</script>' }), profile: "auto" });
  assert.equal(result.profile, "local");
  assert.deepEqual(result.checks.filter((check) => check.category === "agents").map((check) => check.id), ["markdown", "content_signals"]);
});
