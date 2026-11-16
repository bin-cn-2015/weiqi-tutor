import type { ParsedTsumego, SgfColor } from "../sgf/types.js";
import { GoBoard, type MoveFacts } from "../rules/go-board.js";

export interface ValidatedMove { index:number; color:SgfColor; x:number; y:number; legal:boolean; reason?:string; facts?:MoveFacts; }
export interface BranchValidation { branchIndex:number; verdict:"valid"|"illegal"|"incomplete"; moves:ValidatedMove[]; errors:string[]; }
export interface PuzzleValidation { branches:BranchValidation[]; summary:{valid:number;illegal:number;incomplete:number}; }
export function validateTsumego(puzzle:ParsedTsumego):PuzzleValidation{
  const branches:BranchValidation[]=puzzle.branches.map(branch=>{
    const board=new GoBoard(puzzle.boardSize,puzzle.setup);
    const moves:ValidatedMove[]=[];const errors:string[]=[];
    for(let i=0;i<branch.moves.length;i++){
      const move=branch.moves[i]!;
      const result=board.play(move.color,{x:move.x,y:move.y});
      const entry:ValidatedMove={index:i+1,color:move.color,x:move.x,y:move.y,legal:result.legal};
      if(result.reason)entry.reason=result.reason;if(result.facts)entry.facts=result.facts;moves.push(entry);
      if(!result.legal){errors.push("第"+(i+1)+"手 "+move.color+"("+move.x+","+move.y+") 非法："+result.reason);break;}
    }
    const verdict:BranchValidation["verdict"]=errors.length?"illegal":moves.length===0?"incomplete":"valid";
    return{branchIndex:branch.index,verdict,moves,errors};
  });
  return{branches,summary:{valid:branches.filter(b=>b.verdict==="valid").length,illegal:branches.filter(b=>b.verdict==="illegal").length,incomplete:branches.filter(b=>b.verdict==="incomplete").length}};
}