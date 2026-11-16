import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { explainMove } from "../explanation/move-explainer.js";
import type { SupervisionRecord } from "../dataset/supervision.js";
import type { ValidatedMove } from "../validation/replay.js";

interface ExplanationRecord {
  schemaVersion: 1;
  puzzleId: string;
  boardSize: number;
  initialPlayer: "B" | "W";
  setup: SupervisionRecord["setup"];
  puzzleContext: SupervisionRecord["puzzleContext"];
  branchIndex: number;
  answerLabel: "correct" | "wrong";
  scope: "verified-local-move-facts";
  input: { moves: ValidatedMove[] };
  target: {
    verdict: "正解" | "错解";
    moves: ReturnType<typeof explainMove>[];
    summary: string;
    disclaimer: string;
  };
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

const SYSTEM_PROMPT = [
  "你是一名面向初学者的围棋启蒙教练。",
  "棋盘规则和每手棋的棋理事实由规则引擎提供；你负责把这些事实解释清楚。",
  "必须以输入中的合法性、提子、气数、打吃、连接和眼位事实为依据，不得编造未提供的棋理事实。",
  "题目标签给出的正解/错解是监督答案；局部棋理事实不足以证明整道题的最终生死，不要声称已经完成全局证明。",
  "使用简洁、自然、适合初学者的中文，按着法顺序解释。",
].join("");

function toPlayerLabel(label: "correct" | "wrong"): "正解" | "错解" {
  return label === "correct" ? "正解" : "错解";
}

async function main() {
  const inputArg = process.argv[2], outputArg = process.argv[3];
  if (!inputArg || !outputArg) {
    console.error("Usage: npm run build:explanations -- <supervision.jsonl> <explanations.jsonl>");
    process.exitCode = 2;
    return;
  }

  const input = resolve(inputArg), output = resolve(outputArg);
  const raw = await readFile(input, "utf8");
  const records: ExplanationRecord[] = [];
  let skipped = 0;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as SupervisionRecord;
    if (
      !record.trainingEligible ||
      record.ruleStatus !== "valid" ||
      (record.sourceLabel !== "correct" && record.sourceLabel !== "wrong")
    ) {
      skipped++;
      continue;
    }

    const moveExplanations = record.moves.map(explainMove);
    const verdict = toPlayerLabel(record.sourceLabel);
    const inputPayload = {
      task: "判断并解释这条死活题变化线。",
      boardSize: record.boardSize,
      initialPlayer: record.initialPlayer,
      setup: record.setup,
      puzzleContext: record.puzzleContext,
      moves: record.moves,
    };
    const targetPayload = {
      verdict,
      steps: moveExplanations.map(move => ({
        moveNumber: move.moveNumber,
        player: move.player,
        coordinate: move.coordinate,
        facts: move.facts,
      })),
      disclaimer: "这些步骤解释的是规则引擎验证过的局部事实；正解/错解标签来自题库标注，不代表本样本已经完成独立的全局死活证明。",
    };

    records.push({
      schemaVersion: 1,
      puzzleId: record.puzzleId,
      boardSize: record.boardSize,
      initialPlayer: record.initialPlayer,
      setup: record.setup,
      puzzleContext: record.puzzleContext,
      branchIndex: record.branchIndex,
      answerLabel: record.sourceLabel,
      scope: "verified-local-move-facts",
      input: { moves: record.moves },
      target: {
        verdict,
        moves: moveExplanations,
        summary: "这条变化被题库标注为" + verdict + "。",
        disclaimer: targetPayload.disclaimer,
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(inputPayload) },
        { role: "assistant", content: JSON.stringify(targetPayload) },
      ],
    });
  }

  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    records.map(record => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""),
    "utf8",
  );
  console.log(JSON.stringify({
    input,
    output,
    sourceLines: records.length + skipped,
    explanationSamples: records.length,
    skipped,
    format: "chat-messages-jsonl",
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
