import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { explainMove } from "../explanation/move-explainer.js";
import type { SupervisionRecord } from "../dataset/supervision.js";

interface PuzzlePolicySample {
  schemaVersion: 1;
  taskType: "first-move-policy";
  puzzleId: string;
  boardSize: number;
  initialPlayer: "B" | "W";
  setup: SupervisionRecord["setup"];
  puzzleContext: SupervisionRecord["puzzleContext"];
  input: { task: string };
  target: {
    recommendedMoves: Array<{
      color: "B" | "W";
      x: number;
      y: number;
      explanation: ReturnType<typeof explainMove>;
    }>;
  };
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

const SYSTEM_PROMPT = [
  "你是围棋启蒙教练，需要根据题目初始局面给出第一手推荐。",
  "只输出题库中经过规则引擎验证的正解首手及其棋理解释，不得虚构坐标或事实。",
  "如果存在多个不同的正解首手，可以列出多个选择。",
  "使用 JSON 格式回答，并用初学者能懂的中文说明理由。",
].join("");

async function main() {
  const inputArg = process.argv[2], outputArg = process.argv[3];
  if (!inputArg || !outputArg) {
    console.error("Usage: npm run build:puzzle-policy -- <supervision.jsonl> <policy.jsonl>");
    process.exitCode = 2;
    return;
  }
  const input = resolve(inputArg), output = resolve(outputArg);
  const rows = (await readFile(input, "utf8")).split(/\r?\n/).filter(line => line.trim());
  const groups = new Map<string, SupervisionRecord[]>();
  for (const line of rows) {
    const record = JSON.parse(line) as SupervisionRecord;
    const group = groups.get(record.puzzleId) ?? [];
    group.push(record);
    groups.set(record.puzzleId, group);
  }

  const samples: PuzzlePolicySample[] = [];
  let skipped = 0;
  for (const [puzzleId, branches] of groups) {
    const correct = branches.filter(branch =>
      branch.sourceLabel === "correct" &&
      branch.trainingEligible &&
      branch.ruleStatus === "valid" &&
      branch.moves.length > 0
    );
    const unique = new Map<string, PuzzlePolicySample["target"]["recommendedMoves"][number]>();
    for (const branch of correct) {
      const first = branch.moves[0]!;
      const key = first.color + ":" + first.x + ":" + first.y;
      if (!unique.has(key)) {
        unique.set(key, {
          color: first.color,
          x: first.x,
          y: first.y,
          explanation: explainMove(first),
        });
      }
    }
    if (!unique.size) {
      skipped++;
      continue;
    }
    const sample = branches[0]!;
    const recommendedMoves = [...unique.values()];
    const userPayload = {
      task: "请根据初始局面给出这道死活题的第一手推荐，并解释原因。",
      boardSize: sample.boardSize,
      initialPlayer: sample.initialPlayer,
      setup: sample.setup,
      puzzleContext: sample.puzzleContext,
    };
    const assistantPayload = { recommendedMoves };
    samples.push({
      schemaVersion: 1,
      taskType: "first-move-policy",
      puzzleId,
      boardSize: sample.boardSize,
      initialPlayer: sample.initialPlayer,
      setup: sample.setup,
      puzzleContext: sample.puzzleContext,
      input: { task: userPayload.task },
      target: { recommendedMoves },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(userPayload) },
        { role: "assistant", content: JSON.stringify(assistantPayload) },
      ],
    });
  }

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, samples.map(sample => JSON.stringify(sample)).join("\n") + (samples.length ? "\n" : ""), "utf8");
  console.log(JSON.stringify({
    input,
    output,
    puzzles: groups.size,
    policySamples: samples.length,
    skippedWithoutVerifiedCorrectFirstMove: skipped,
  }, null, 2));
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
