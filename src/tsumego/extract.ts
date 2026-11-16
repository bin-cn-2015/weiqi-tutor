import { readMove } from "../sgf/parser.js";
import type { BranchVerdict, ParsedTsumego, SgfNode, TsumegoBranch } from "../sgf/types.js";

function labelOf(node: SgfNode): string {
  return [ ...(node.properties.C ?? []), ...(node.properties.N ?? []) ].join(" ").trim();
}

function classify(label: string): BranchVerdict {
  if (/正解|正确|成功|答案/.test(label)) return "correct";
  if (/失败|错误|错解|不成立/.test(label)) return "wrong";
  if (/变化|参考|分支/.test(label)) return "variation";
  return "unknown";
}

function collectMainLine(start: SgfNode, boardSize: number): TsumegoBranch["moves"] {
  const moves: TsumegoBranch["moves"] = [];
  let node: SgfNode | undefined = start;
  while (node) {
    const move = readMove(node, boardSize);
    if (move) moves.push(move);
    node = node.children[0];
  }
  return moves;
}

/**
 * Extracts first-move alternatives from the SGF root.
 * Labels are preserved verbatim; unlabelled branches are never guessed to be correct.
 */
export function extractTsumego(sgf: {
  boardSize: number;
  initialPlayer: "B" | "W";
  setup: ParsedTsumego["setup"];
  root: SgfNode;
}): ParsedTsumego {
  const warnings: string[] = [];
  const branches: TsumegoBranch[] = sgf.root.children.map((node, index) => {
    const label = labelOf(node);
    const moves = collectMainLine(node, sgf.boardSize);
    if (moves.length === 0) warnings.push(`Branch ${index} has no playable moves`);
    return { index, verdict: classify(label), label, moves };
  });

  if (branches.length === 0) warnings.push("No answer branches found at SGF root");
  if (!branches.some(branch => branch.verdict === "correct")) {
    warnings.push("No explicitly labeled correct branch found; do not infer one from branch order");
  }
  return {
    boardSize: sgf.boardSize,
    initialPlayer: sgf.initialPlayer,
    setup: sgf.setup,
    branches,
    warnings
  };
}
