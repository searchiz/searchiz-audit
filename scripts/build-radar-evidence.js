#!/usr/bin/env node
// Refreshes evidence/radar-evidence.json from Cloudflare Radar's public
// datasets: agent standards adoption (agent readiness scans, weekly) and the
// share of AI crawler requests by user agent (last 28 days).
// Usage: CLOUDFLARE_API_TOKEN=<token with Radar Read> node scripts/build-radar-evidence.js
import { writeFileSync } from "node:fs";

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) { console.error("Set CLOUDFLARE_API_TOKEN (Radar Read)."); process.exit(1); }
const radar = async (path, query = {}) => {
  const url = `https://api.cloudflare.com/client/v4/radar${path}?${new URLSearchParams(query)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  if (!body.success) throw new Error(`${path}: ${JSON.stringify(body.errors)}`);
  return body.result;
};
const CHECKS = ["robotsTxt", "sitemap", "linkHeaders", "markdownNegotiation", "robotsTxtAiRules", "contentSignals", "apiCatalog", "oauthProtectedResource", "mcpServerCard", "agentSkills", "ucp", "acp", "x402"];
const pick = (summary) => Object.fromEntries(CHECKS.map((check) => [check, Number(summary[check] ?? 0)]));
const all = await radar("/agent_readiness/summary/CHECK");
const categories = Object.fromEntries(all.meta.domainCategories.map((row) => [row.name, row.value]));
const ecommerce = await radar("/agent_readiness/summary/CHECK", { domainCategory: "Ecommerce" });
const bots = await radar("/ai/bots/summary/user_agent", { dateRange: "28d", limitPerGroup: 10 });
const evidence = {
  source: "Cloudflare Radar", source_url: "https://radar.cloudflare.com/ai-insights", generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  agent_readiness: { date: all.meta.date, domains: all.meta.successfulDomains, checks: pick(all.summary_0),
    ecommerce: { domains: categories.Ecommerce ?? null, checks: pick(ecommerce.summary_0) } },
  ai_crawler_requests: { period: bots.meta.dateRange[0], share_percent: Object.fromEntries(Object.entries(bots.summary_0).map(([name, value]) => [name, Math.round(Number(value) * 10) / 10])) }
};
writeFileSync(new URL("../evidence/radar-evidence.json", import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Agent readiness ${evidence.agent_readiness.date}: ${evidence.agent_readiness.domains} domains`);
