import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface ChatSample {
  puzzleId: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}
function validationBucket(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}
async function main() {
  const inputArg = process.argv[2], outputDirArg = process.argv[3];
  const ratioArg = process.argv[4];
  if (!inputArg || !outputDirArg) {
    console.error("Usage: npm run split:dataset -- <chat.jsonl> <output-directory> [validation-percent=10]");
    process.exitCode = 2;
    return;
  }
  const validationPercent = ratioArg === undefined ? 10 : Number(ratioArg);
  if (!Number.isInteger(validationPercent) || validationPercent < 1 || validationPercent > 40) {
    throw new Error("validation-percent must be an integer from 1 to 40");
  }
  const input = resolve(inputArg), outputDir = resolve(outputDirArg);
  const lines = (await readFile(input, "utf8")).split(/\r?\n/).filter(line => line.trim());
  const train: string[] = [], validation: string[] = [];
  const trainGroups = new Set<string>(), validationGroups = new Set<string>();
  for (const line of lines) {
    const sample = JSON.parse(line) as ChatSample;
    if (!sample.puzzleId || !Array.isArray(sample.messages) || sample.messages.length !== 3) {
      throw new Error("Invalid chat sample: missing puzzleId or three-message conversation");
    }
    if (validationBucket(sample.puzzleId) < validationPercent) {
      validation.push(line);
      validationGroups.add(sample.puzzleId);
    } else {
      train.push(line);
      trainGroups.add(sample.puzzleId);
    }
  }
  const overlap = [...trainGroups].filter(id => validationGroups.has(id));
  if (overlap.length) throw new Error("Puzzle leakage detected between train and validation");
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "train.jsonl"), train.join("\n") + (train.length ? "\n" : ""), "utf8");
  await writeFile(resolve(outputDir, "validation.jsonl"), validation.join("\n") + (validation.length ? "\n" : ""), "utf8");
  console.log(JSON.stringify({
    input,
    outputDir,
    totalSamples: lines.length,
    trainSamples: train.length,
    validationSamples: validation.length,
    trainPuzzles: trainGroups.size,
    validationPuzzles: validationGroups.size,
    validationPercent,
    puzzleLeakage: overlap.length,
  }, null, 2));
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
