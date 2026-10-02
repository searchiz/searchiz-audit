#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { audit } from "../src/audit.js";
import { markdown } from "../src/report.js";

const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index === -1 ? null : args[index + 1]; };
const target = args.find((arg, index) => !arg.startsWith("--") && !["--format", "--out", "--diffs", "--profile"].includes(args[index - 1]));
if (!target || args.includes("--help")) {
  console.log(`Usage: searchiz-audit <site or page URL> [--format md|json] [--out file] [--diffs dir] [--profile auto|store|service|local|software]

Checks whether AI search crawlers can read a page and whether it says clearly
who you are, with ready-made fixes. Each check shows how the pages AI answers
cite most do on it, from the Searchiz public index. Agent checks (Markdown,
Content Signals, Link header, UCP, API catalog, MCP card) apply by kind of
site and show adoption from Cloudflare Radar. No account, no telemetry: the
only requests go to the site you name.`);
  process.exit(target ? 0 : 1);
}
try {
  const result = await audit(target, { profile: option("--profile") ?? "auto" });
  const output = option("--format") === "json" ? `${JSON.stringify(result, null, 2)}\n` : markdown(result);
  if (option("--out")) writeFileSync(option("--out"), output); else process.stdout.write(output);
  const dir = option("--diffs");
  if (dir) {
    mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(result.diffs)) writeFileSync(join(dir, file), content);
    console.error(`${Object.keys(result.diffs).length} change files written to ${dir}`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
