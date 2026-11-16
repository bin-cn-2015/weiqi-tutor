import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { parseSgf } from "../sgf/parser.js";
import { extractTsumego } from "../tsumego/extract.js";
import { validateTsumego } from "../validation/replay.js";

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const full = join(root, entry.name);
    if (entry.isDirectory()) return collectFiles(full);
    return extname(entry.name).toLowerCase() === ".sgf" ? [full] : [];
  }));
  return nested.flat();
}

const root = process.argv[2];
if (!root) {
  process.stderr.write("Usage: npm run audit:sgf -- <directory>\\n");
  process.exitCode = 2;
} else {
  const files = await collectFiles(root);
  const totals = { files: files.length, parsed: 0, failed: 0, withCorrect: 0, withWrong: 0, unknownOnly: 0, legalBranches: 0, illegalBranches: 0, incompleteBranches: 0 };
  const errors: Array<{ file: string; error: string }> = [];
  for (const file of files) {
    try {
      const parsed = extractTsumego(parseSgf(await readFile(file, "utf8")));
      totals.parsed++;
      if (parsed.branches.some(branch => branch.verdict === "correct")) totals.withCorrect++;
      if (parsed.branches.some(branch => branch.verdict === "wrong")) totals.withWrong++;
      if (parsed.branches.length > 0 && parsed.branches.every(branch => branch.verdict === "unknown")) totals.unknownOnly++;
      const validation = validateTsumego(parsed);
      totals.legalBranches += validation.summary.valid;
      totals.illegalBranches += validation.summary.illegal;
      totals.incompleteBranches += validation.summary.incomplete;
    } catch (error) {
      totals.failed++;
      errors.push({ file, error: error instanceof Error ? error.message : String(error) });
    }
  }
  process.stdout.write(JSON.stringify({ totals, errors: errors.slice(0, 100) }, null, 2) + "\\n");
}
