import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseSgf } from "../sgf/parser.js";
import { extractTsumego } from "../tsumego/extract.js";
import { validateTsumego } from "../validation/replay.js";
import {
  buildSupervisionRecords,
  summarizeSupervision,
  type SourcePuzzleMetadata,
} from "../dataset/supervision.js";

async function collectSgf(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return collectSgf(path);
    return extname(entry.name).toLowerCase() === ".sgf" ? [path] : [];
  }));
  return nested.flat();
}

async function readMetadata(file: string): Promise<SourcePuzzleMetadata> {
  const metadataPath = file.slice(0, -4) + ".json";
  try {
    const raw = JSON.parse(await readFile(metadataPath, "utf8")) as SourcePuzzleMetadata;
    return { id: raw.id ?? basename(file, ".sgf"), ...(raw.label ? { label: raw.label } : {}), ...(raw.date ? { date: raw.date } : {}) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { id: basename(file, ".sgf") };
    }
    throw error;
  }
}

async function main() {
  const inputArg = process.argv[2], outputArg = process.argv[3];
  if (!inputArg || !outputArg) {
    console.error("Usage: npm run build:dataset -- <sgf-directory> <output.jsonl>");
    process.exitCode = 2;
    return;
  }

  const input = resolve(inputArg), output = resolve(outputArg);
  const files = await collectSgf(input);
  const records: ReturnType<typeof buildSupervisionRecords>[number][] = [];
  const errors: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    try {
      const puzzle = extractTsumego(parseSgf(await readFile(file, "utf8")));
      const validation = validateTsumego(puzzle);
      const metadata = await readMetadata(file);
      records.push(...buildSupervisionRecords(puzzle, validation, file, metadata));
    } catch (error) {
      errors.push({ file, error: error instanceof Error ? error.message : String(error) });
    }
  }

  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    records.map(record => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""),
    "utf8",
  );
  console.log(JSON.stringify({
    files: files.length,
    failed: errors.length,
    output,
    ...summarizeSupervision(records),
    errors: errors.slice(0, 30),
  }, null, 2));
  if (errors.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
