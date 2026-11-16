import { readMove } from "../sgf/parser.js";
import type { BranchVerdict, ParsedTsumego, SgfNode, TsumegoBranch } from "../sgf/types.js";

function labelOf(node: SgfNode): string {
  return [...(node.properties.C ?? []), ...(node.properties.N ?? [])].join(" ").trim();
}
function classify(label: string): BranchVerdict {
  const wrong = /失败|错误|错解|不成立|wrong|incorrect/i.test(label);
  const correct = /正解|正确|成功|答案|correct|right answer/i.test(label);
  if (wrong && correct) return "unknown";
  if (wrong) return "wrong";
  if (correct) return "correct";
  if (/变化|参考|分支|variation/i.test(label)) return "variation";
  return "unknown";
}
interface LeafLine { moves:TsumegoBranch["moves"]; labels:string[]; }
function collectAllLines(start:SgfNode,boardSize:number):LeafLine[] {
  const lines:LeafLine[]=[];
  const visit=(node:SgfNode,moves:TsumegoBranch["moves"],labels:string[])=>{
    const label=labelOf(node);
    const nextLabels=label?[...labels,label]:labels;
    const move=readMove(node,boardSize);
    const nextMoves=move?[...moves,move]:moves;
    if(node.children.length===0){if(nextMoves.length)lines.push({moves:nextMoves,labels:nextLabels});return;}
    for(const child of node.children)visit(child,nextMoves,nextLabels);
  };
  visit(start,[],[]);
  return lines;
}

/**
 * Extract every root-to-leaf answer line, including nested SGF variations.
 * Explicit labels are retained; conflicting or absent labels remain unknown.
 */
export function extractTsumego(sgf:{
  boardSize:number;
  initialPlayer:"B"|"W";
  setup:ParsedTsumego["setup"];
  root:SgfNode;
}):ParsedTsumego {
  const warnings:string[]=[];
  const branches:TsumegoBranch[]=[];
  for(const child of sgf.root.children){
    for(const line of collectAllLines(child,sgf.boardSize)){
      const label=[...new Set(line.labels)].join(" | ");
      branches.push({index:branches.length,verdict:classify(label),label,moves:line.moves});
    }
  }
  if(!branches.length)warnings.push("No answer branches found in SGF variation tree");
  if(!branches.some(branch=>branch.verdict==="correct"))warnings.push("No explicitly labeled correct branch found; do not infer one from branch order");
  if(branches.some(branch=>branch.verdict==="unknown"))warnings.push("Some answer lines are unlabeled or have conflicting labels");
  return{boardSize:sgf.boardSize,initialPlayer:sgf.initialPlayer,setup:sgf.setup,branches,warnings};
}
