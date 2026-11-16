export type SgfColor = "B" | "W";
export type PlayerColor = "black" | "white";

export interface SgfNode {
  properties: Record<string, string[]>;
  children: SgfNode[];
}

export interface SgfGame {
  boardSize: number;
  initialPlayer: SgfColor;
  setup: Array<{ color: SgfColor; x: number; y: number }>;
  root: SgfNode;
}

export type BranchVerdict = "correct" | "wrong" | "variation" | "unknown";

export interface TsumegoBranch {
  index: number;
  verdict: BranchVerdict;
  label: string;
  moves: Array<{ color: SgfColor; x: number; y: number }>;
}

export interface TsumegoContext {
  title: string;
  comments: string[];
}

export interface ParsedTsumego {
  context: TsumegoContext;
  boardSize: number;
  initialPlayer: SgfColor;
  setup: Array<{ color: SgfColor; x: number; y: number }>;
  branches: TsumegoBranch[];
  warnings: string[];
}
