import { createHash } from "node:crypto";
import type { ParsedTsumego, TsumegoBranch } from "../sgf/types.js";
import type { BranchValidation, PuzzleValidation, ValidatedMove } from "../validation/replay.js";
export interface SupervisionRecord {
 schemaVersion:1;puzzleId:string;sourceFile:string;boardSize:number;initialPlayer:"B"|"W";setup:ParsedTsumego["setup"];
 branchIndex:number;sourceLabel:TsumegoBranch["verdict"];sourceLabelText:string;ruleStatus:BranchValidation["verdict"];
 trainingEligible:boolean;labelConflict:boolean;moves:ValidatedMove[];ruleErrors:string[];
}
export function buildSupervisionRecords(puzzle:ParsedTsumego,validation:PuzzleValidation,sourceFile:string):SupervisionRecord[]{
 const puzzleId=createHash("sha256").update(sourceFile).digest("hex").slice(0,20);
 return puzzle.branches.map(branch=>{
  const checked=validation.branches.find(item=>item.branchIndex===branch.index);
  if(!checked)throw new Error("Missing rule validation for branch "+branch.index);
  const labelConflict=branch.verdict==="correct"&&checked.verdict==="illegal";
  const explicitLabel=branch.verdict==="correct"||branch.verdict==="wrong";
  const trainingEligible=explicitLabel&&checked.verdict==="valid"&&branch.moves.length>0&&!labelConflict;
  return{schemaVersion:1,puzzleId,sourceFile,boardSize:puzzle.boardSize,initialPlayer:puzzle.initialPlayer,setup:puzzle.setup,branchIndex:branch.index,sourceLabel:branch.verdict,sourceLabelText:branch.label,ruleStatus:checked.verdict,trainingEligible,labelConflict,moves:checked.moves,ruleErrors:checked.errors};
 });
}
export function summarizeSupervision(records:SupervisionRecord[]){
 return records.reduce((s,r)=>{s.branches++;s.eligible+=Number(r.trainingEligible);s.correct+=Number(r.sourceLabel==="correct");s.wrong+=Number(r.sourceLabel==="wrong");s.unknown+=Number(r.sourceLabel==="unknown");s.variation+=Number(r.sourceLabel==="variation");s.illegal+=Number(r.ruleStatus==="illegal");s.labelConflicts+=Number(r.labelConflict);return s;},{branches:0,eligible:0,correct:0,wrong:0,unknown:0,variation:0,illegal:0,labelConflicts:0});
}