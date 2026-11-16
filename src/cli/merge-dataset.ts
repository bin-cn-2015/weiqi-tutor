import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface ChatRecord {
  puzzleId: string;
  taskType?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}
async function main() {
  const outputArg = process.argv[2], inputs = process.argv.slice(3);
  if (!outputArg || inputs.length === 0) {
    console.error("Usage: npm run merge:dataset -- <output.jsonl> <input1.jsonl> [input2.jsonl...]");
    process.exitCode = 2;
    return;
  }
  const output = resolve(outputArg);
  const merged: string[] = [];
  const counts: Record<string, number> = {};
  for (const inputArg of inputs) {
    const input = resolve(inputArg);
    for (const line of (await readFile(input, "utf8")).split(/\r?\n/)) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as ChatRecord;
      if (!record.puzzleId || !Array.isArray(record.messages) || record.messages.length !== 3) {
        throw new Error("Invalid chat record in " + input);
      }
      const task = record.taskType ?? "branch-explanation";
      counts[task] = (counts[task] ?? 0) + 1;
      merged.push(line);
    }
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, merged.join("\n") + (merged.length ? "\n" : ""), "utf8");
  console.log(JSON.stringify({ output, samples: merged.length, taskCounts: counts }, null, 2));
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
