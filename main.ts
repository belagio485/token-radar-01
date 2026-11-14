// Token Radar entrypoint.
//
// Reads the sealed snapshot of protocols, ranks every protocol that records
// no token by the implied value of its launch, and writes the board, the
// dashboard data, the dashboard itself, the screenshots, and the dossier
// into the output directory. Deterministic: no network, no randomness, no
// wall clock. Run it the way the harness does:
//
//   node main.ts --input /input/snapshot.json
//
// with MAKEFUN_OUTPUT_DIR set to the output directory (default /output).

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoard } from "./lib/model.ts";
import type { BoardRow, Snapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const DEFAULT_INPUT = "/input/snapshot.json";
const DOSSIER_TEXT_MAX_BYTES = 65536;

function parseInputPath(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input" && i + 1 < argv.length) return argv[i + 1];
    if (arg.startsWith("--input=")) return arg.slice("--input=".length);
  }
  return DEFAULT_INPUT;
}

function readSnapshot(inputPath: string): Snapshot {
  const raw = fs.readFileSync(inputPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`snapshot is not an object: ${inputPath}`);
  }
  const snap = parsed as Record<string, unknown>;
  if (typeof snap.as_of !== "string") throw new Error("snapshot as_of is not a string");
  if (!Array.isArray(snap.protocols)) throw new Error("snapshot protocols is not an array");
  if (!Array.isArray(snap.watchlist)) throw new Error("snapshot watchlist is not an array");
  for (const p of snap.protocols) {
    if (typeof p !== "object" || p === null) throw new Error("snapshot protocol entry is not an object");
    const rec = p as Record<string, unknown>;
    if (typeof rec.slug !== "string" || typeof rec.name !== "string") {
      throw new Error("snapshot protocol entry is missing slug or name");
    }
    if (typeof rec.tvl_usd !== "number" || !Number.isFinite(rec.tvl_usd)) {
      throw new Error(`snapshot protocol ${rec.slug} has no finite tvl_usd`);
    }
    if (!Array.isArray(rec.chains)) throw new Error(`snapshot protocol ${rec.slug} has no chains array`);
  }
  return parsed as Snapshot;
}

interface GatedRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

function gatedRows(rows: BoardRow[]): GatedRow[] {
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));
}

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function copyTree(srcDir: string, destDir: string): number {
  // Always create the destination directory, even when the source is empty:
  // the dossier builder requires the screenshots directory to exist before
  // it reads the output tree, and an empty source must not silently drop it.
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copied += copyTree(src, dest);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      copied += 1;
    }
  }
  return copied;
}

function formatUsd(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

async function main(): Promise<void> {
  const inputPath = parseInputPath(process.argv.slice(2));
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  const entryRoot = path.dirname(fileURLToPath(import.meta.url));

  const snapshot = readSnapshot(inputPath);
  const board = buildBoard(snapshot);
  if (board.rows.length === 0) {
    throw new Error("no protocol in the snapshot records no token; the board would be empty");
  }
  const covered = new Set(board.rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((slug) => !covered.has(slug));
  if (missing.length > 0) {
    throw new Error(`watchlist protocols missing from the board: ${missing.join(", ")}`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  writeText(
    path.join(outDir, "board.json"),
    `${JSON.stringify({ rows: gatedRows(board.rows) }, null, 2)}\n`,
  );

  const dashboardData = {
    as_of: snapshot.as_of,
    total_protocols: snapshot.protocols.length,
    watchlist_count: snapshot.watchlist.length,
    total_implied_value_usd: board.total_implied_value_usd,
    global_multiple: board.global_multiple,
    category_multiples: board.category_multiples,
    traded_reference: board.traded_reference,
    rows: board.rows,
  };
  writeText(
    path.join(outDir, "data.js"),
    `window.RADAR_DATA = ${JSON.stringify(dashboardData, null, 2)};\n`,
  );

  const dashboardFiles = copyTree(path.join(entryRoot, "dashboard"), path.join(outDir, "dashboard"));
  const screenshotFiles = copyTree(path.join(entryRoot, "screenshots"), path.join(outDir, "screenshots"));

  const dossierBytes = await buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_MAX_BYTES });
  fs.writeFileSync(path.join(outDir, "dossier.json"), dossierBytes);

  const top = board.rows[0];
  console.log(`protocols scanned: ${snapshot.protocols.length}`);
  console.log(`board rows: ${board.rows.length}`);
  console.log(`watchlist covered: ${snapshot.watchlist.length}/${snapshot.watchlist.length}`);
  console.log(`total implied value: ${formatUsd(board.total_implied_value_usd)}`);
  console.log(`top row: #${top.rank} ${top.name} (${formatUsd(top.implied_value_usd)})`);
  console.log(`dashboard files copied: ${dashboardFiles}`);
  console.log(`screenshot files copied: ${screenshotFiles}`);
  console.log(`dossier bytes: ${dossierBytes.length}`);
  console.log(`output dir: ${outDir}`);
}

await main();
