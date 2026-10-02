import { readFileSync } from "node:fs";
import { get } from "./fetch.js";
import { pageChecks, siteChecks } from "./checks.js";
import { canonicalTag, contentSignalsPatch, descriptionTag, jsonLdTemplate, linkHeaderNote, robotsPatch } from "./diffs.js";
import { agentChecks, detectProfile, PROFILES, RADAR_CHECK } from "./agents.js";

const EVIDENCE = JSON.parse(readFileSync(new URL("../evidence/index-evidence.json", import.meta.url), "utf8"));
const RADAR = JSON.parse(readFileSync(new URL("../evidence/radar-evidence.json", import.meta.url), "utf8"));

// How many sites Cloudflare scanned pass the same agent check (Radar).
function radarEvidence(id, profile) {
  const name = RADAR_CHECK[id];
  if (!name) return null;
  const scope = profile === "store" && RADAR.agent_readiness.ecommerce?.domains ? RADAR.agent_readiness.ecommerce : RADAR.agent_readiness;
  return { source: RADAR.source, date: RADAR.agent_readiness.date, sites: scope.domains, scope: scope === RADAR.agent_readiness ? "all" : "ecommerce", pass_rate: Math.round((10000 * scope.checks[name]) / scope.domains) / 10000 };
}
const WEIGHT = { pass: 1, warn: 0.5, fail: 0 };

export function normalizeUrl(input) {
  let text = String(input ?? "").trim();
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  const url = new URL(text);
  if (!url.hostname.includes(".")) throw new Error("Enter a public site such as example.com");
  return url.href;
}

export function score(checks) {
  const categories = {};
  for (const check of checks) {
    if (!(check.status in WEIGHT)) continue;
    (categories[check.category] ??= []).push(WEIGHT[check.status]);
  }
  const result = Object.fromEntries(Object.entries(categories).map(([name, values]) => [name, Math.round((100 * values.reduce((a, b) => a + b, 0)) / values.length)]));
  const values = Object.values(result);
  return { overall: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null, categories: result };
}

export async function audit(input, { fetchImpl = fetch, profile = "auto" } = {}) {
  const url = normalizeUrl(input);
  const origin = new URL(url).origin;
  const [page, robots, sitemap, llms, markdownPage] = await Promise.all([
    get(url, { fetchImpl }), get(`${origin}/robots.txt`, { fetchImpl, accept: "text/plain" }),
    get(`${origin}/sitemap.xml`, { fetchImpl, accept: "application/xml" }), get(`${origin}/llms.txt`, { fetchImpl, accept: "text/plain" }),
    get(url, { fetchImpl, accept: "text/markdown" })
  ]);
  const path = new URL(page.url || url).pathname || "/";
  const kind = profile === "auto" ? detectProfile(page) : profile;
  if (!PROFILES[kind]) throw new Error(`Unknown profile ${profile}; use store, service, local or software`);
  const json = "application/json";
  const extra = {};
  if (kind === "store") extra.ucp = await get(`${origin}/.well-known/ucp`, { fetchImpl, accept: json });
  if (kind === "software") {
    [extra.apiCatalog, extra.oauthServer, extra.openapi, extra.protectedResource, extra.serverCard] = await Promise.all([
      get(`${origin}/.well-known/api-catalog`, { fetchImpl, accept: "application/linkset+json" }), get(`${origin}/.well-known/oauth-authorization-server`, { fetchImpl, accept: json }),
      get(`${origin}/openapi.json`, { fetchImpl, accept: json }), get(`${origin}/.well-known/oauth-protected-resource`, { fetchImpl, accept: json }),
      get(`${origin}/.well-known/mcp/server-card.json`, { fetchImpl, accept: json })
    ]);
  }
  const agents = page.status && page.status < 400 ? agentChecks(kind, { page, markdown: markdownPage, robots, llms, ...extra }) : [];
  const checks = [...siteChecks({ robots, sitemap, llms, path }), ...pageChecks(page, { path })].map((check) => ({ ...check, evidence: EVIDENCE.checks?.[check.id] ?? null }))
    .concat(agents.map((check) => ({ ...check, evidence: radarEvidence(check.id, kind) })));
  const diffs = {};
  for (const check of checks) {
    if (check.fix === "robots") {
      const patch = robotsPatch(robots.status === 200 ? robots.body : "", check.blocked, path);
      if (patch) diffs["robots.txt.patch"] = patch;
    }
    if (check.fix === "json_ld") diffs["structured-data.html"] = jsonLdTemplate(origin);
    if (check.fix === "canonical") diffs["canonical.html"] = canonicalTag(page.url || url);
    if (check.fix === "meta_description") diffs["meta-description.html"] = descriptionTag();
    if (check.fix === "content_signals") diffs["content-signals.txt"] = contentSignalsPatch();
    if (check.fix === "link_header") diffs["link-header.txt"] = linkHeaderNote(origin);
  }
  return {
    tool: "searchiz-audit", version: "1.1.0", url, profile: kind, audited_at: new Date().toISOString(),
    score: score(checks), checks: checks.map(({ fix, blocked, ...check }) => check), diffs,
    radar: { source: RADAR.source, source_url: RADAR.source_url, date: RADAR.agent_readiness.date, sites: RADAR.agent_readiness.domains },
    index: { period: EVIDENCE.period, valid_answers: EVIDENCE.valid_answers, engines: EVIDENCE.engines, answers_citing_kind: EVIDENCE.answers_citing_kind, source: EVIDENCE.source, method: EVIDENCE.method }
  };
}
