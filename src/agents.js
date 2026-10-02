import { jsonLd, types } from "./html.js";

// Whether AI agents can find and read the site, judged by the kind of site:
// a local business is not asked for an API catalog, and no file is
// recommended for a capability the site does not have (no API catalog
// without an API, no MCP card without an MCP server). Same rules as the
// Searchiz app (AgentReadiness). Checks follow Cloudflare's Agent Readiness
// criteria where they apply.
export const PROFILES = {
  store: ["markdown", "content_signals", "link_headers", "ucp"],
  service: ["markdown", "content_signals", "link_headers"],
  local: ["markdown", "content_signals"],
  software: ["markdown", "content_signals", "link_headers", "api_catalog", "mcp_card"]
};
const USEFUL_RELS = ["api-catalog", "service-desc", "service-doc", "describedby"];
// Cloudflare Radar check names, for the adoption evidence.
export const RADAR_CHECK = { markdown: "markdownNegotiation", content_signals: "contentSignals", link_headers: "linkHeaders", ucp: "ucp", api_catalog: "apiCatalog", mcp_card: "mcpServerCard" };

const shopify = (page) => /cdn\.shopify\.com|Shopify\.shop/.test(page.body ?? "");

export function detectProfile(page) {
  const found = types(jsonLd(page.body ?? ""));
  if (shopify(page) || found.some((type) => ["Product", "Offer", "OnlineStore", "Store"].includes(type))) return "store";
  if (found.includes("SoftwareApplication")) return "software";
  if (found.some((type) => /LocalBusiness|Plumber|Electrician|Restaurant|Dentist|HomeAndConstructionBusiness/.test(type))) return "local";
  return "service";
}

export function contentSignals(robotsBody) {
  return Object.fromEntries([...String(robotsBody ?? "").matchAll(/^\s*content-signal:\s*(.+)$/gim)]
    .flatMap((match) => match[1].split(",")).map((pair) => pair.split("=").map((part) => part.trim().toLowerCase()))
    .filter(([name]) => ["search", "ai-input", "ai-train"].includes(name)));
}

const readable = (response) => response.status !== null && response.status < 500;
const ok = (response, type) => response.status === 200 && String(response.headers.get("content-type") ?? "").toLowerCase().startsWith(type);

// probes: { page, markdown, robots, llms, ucp, apiCatalog, oauthServer, openapi, protectedResource, serverCard }
export function agentChecks(profile, probes) {
  const checks = [];
  const add = (id, status, found, extra = {}) => checks.push({ id, category: "agents", status, found, ...extra });
  for (const id of PROFILES[profile]) {
    if (id === "markdown") {
      const { markdown } = probes;
      if (!readable(markdown)) add(id, "unknown", "could not be read");
      else add(id, ok(markdown, "text/markdown") ? "pass" : "fail", ok(markdown, "text/markdown") ? "Markdown for Accept: text/markdown" : `HTTP ${markdown.status}, ${markdown.headers.get("content-type") ?? "no type"}`, { fix: ok(markdown, "text/markdown") ? null : "markdown" });
    } else if (id === "content_signals") {
      const { robots } = probes;
      if (robots.status === null || robots.status >= 500) add(id, "unknown", "robots.txt could not be read");
      else {
        const signals = contentSignals(robots.status === 200 ? robots.body : "");
        const found = Object.entries(signals).map(([name, value]) => `${name}=${value}`).join(", ");
        add(id, found ? "pass" : "fail", found || "no Content-Signal in robots.txt", { fix: found ? null : "content_signals" });
      }
    } else if (id === "link_headers") {
      const rels = String(probes.page.headers.get("link") ?? "").match(/rel="?([^";,]+)/gi)?.map((rel) => rel.replace(/rel="?/i, "").toLowerCase()) ?? [];
      if (rels.some((rel) => USEFUL_RELS.includes(rel))) add(id, "pass", `Link: ${rels.join(", ")}`);
      else if (probes.llms.status === 200) add(id, "fail", "no Link header pointing agents to /llms.txt", { fix: "link_header" });
      else add(id, "info", "not needed: nothing to point agents to");
    } else if (id === "ucp") {
      if (!shopify(probes.page)) add(id, "info", "not judged: no standard to recommend outside Shopify");
      else if (!readable(probes.ucp)) add(id, "unknown", "could not be read");
      else add(id, ok(probes.ucp, "application/json") ? "pass" : "fail", ok(probes.ucp, "application/json") ? "/.well-known/ucp" : "no /.well-known/ucp: check Agentic Storefronts in the Shopify admin");
    } else if (id === "api_catalog") {
      if (ok(probes.apiCatalog, "application/linkset+json") || ok(probes.apiCatalog, "application/json")) add(id, "pass", "/.well-known/api-catalog");
      else if (![probes.oauthServer, probes.openapi].every(readable)) add(id, "unknown", "could not be read");
      else if (ok(probes.oauthServer, "application/json") || ok(probes.openapi, "application/json")) add(id, "fail", "an API exists but is not listed at /.well-known/api-catalog");
      else add(id, "info", "not needed: no public API found");
    } else if (id === "mcp_card") {
      let resource = "";
      try { resource = ok(probes.protectedResource, "application/json") ? String(JSON.parse(probes.protectedResource.body).resource ?? "") : ""; } catch { resource = ""; }
      if (ok(probes.serverCard, "application/json")) add(id, "pass", "/.well-known/mcp/server-card.json");
      else if (!readable(probes.protectedResource)) add(id, "unknown", "could not be read");
      else if (/\/(mcp|sse)\/?$/.test(resource)) add(id, "fail", `MCP server ${resource} has no server card`);
      else add(id, "info", "not needed: no MCP server found");
    }
  }
  return checks;
}
