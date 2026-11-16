import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { ParsedTsumego, TsumegoBranch } from "../sgf/types.js";
import type { BranchValidation, PuzzleValidation, ValidatedMove } from "../validation/replay.js";

export interface SourcePuzzleMetadata {
  id?: string;
  label?: string;
  date?: string;
}

export interface SupervisionRecord {
  schemaVersion: 1;
  puzzleId: string;
  sourceFile: string;
  boardSize: number;
  initialPlayer: "B" | "W";
  setup: ParsedTsumego["setup"];
  puzzleContext: {
    title: string;
    comments: string[];
    label: string;
    category: string;
    difficulty: string;
    sourceDate: string;
  };
  branchIndex: number;
  sourceLabel: TsumegoBranch["verdict"];
  sourceLabelText: string;
  ruleStatus: BranchValidation["verdict"];
  trainingEligible: boolean;
  labelConflict: boolean;
  moves: ValidatedMove[];
  ruleErrors: string[];
}

export function buildSupervisionRecords(
  puzzle: ParsedTsumego,
  validation: PuzzleValidation,
  sourceFile: string,
  metadata: SourcePuzzleMetadata = {},
): SupervisionRecord[] {
  const filename = basename(sourceFile);
  const puzzleId = metadata.id ?? createHash("sha256").update(filename).digest("hex").slice(0, 20);
  const [category = "", difficulty = ""] = (metadata.label ?? "").split("·");

  return puzzle.branches.map(branch => {
    const checked = validation.branches.find(item => item.branchIndex === branch.index);
    if (!checked) throw new Error("Missing rule validation for branch " + branch.index);

    const labelConflict = branch.verdict === "correct" && checked.verdict === "illegal";
    const explicitLabel = branch.verdict === "correct" || branch.verdict === "wrong";
    const trainingEligible =
      explicitLabel && checked.verdict === "valid" && branch.moves.length > 0 && !labelConflict;

    return {
      schemaVersion: 1,
      puzzleId,
      sourceFile: filename,
      boardSize: puzzle.boardSize,
      initialPlayer: puzzle.initialPlayer,
      setup: puzzle.setup,
      puzzleContext: {
        title: puzzle.context.title,
        comments: puzzle.context.comments,
        label: metadata.label ?? "",
        category,
        difficulty,
        sourceDate: metadata.date ?? "",
      },
      branchIndex: branch.index,
      sourceLabel: branch.verdict,
      sourceLabelText: branch.label,
      ruleStatus: checked.verdict,
      trainingEligible,
      labelConflict,
      moves: checked.moves,
      ruleErrors: checked.errors,
    };
  });
}

export function summarizeSupervision(records: SupervisionRecord[]) {
  return records.reduce((summary, record) => {
    summary.branches++;
    summary.eligible += Number(record.trainingEligible);
    summary.correct += Number(record.sourceLabel === "correct");
    summary.wrong += Number(record.sourceLabel === "wrong");
    summary.unknown += Number(record.sourceLabel === "unknown");
    summary.variation += Number(record.sourceLabel === "variation");
    summary.illegal += Number(record.ruleStatus === "illegal");
    summary.labelConflicts += Number(record.labelConflict);
    return summary;
  }, {
    branches: 0,
    eligible: 0,
    correct: 0,
    wrong: 0,
    unknown: 0,
    variation: 0,
    illegal: 0,
    labelConflicts: 0,
  });
}
