import type { SgfColor } from "../sgf/types.js";
import type { ValidatedMove } from "../validation/replay.js";

export interface MoveExplanation {
  moveNumber:number;
  player:"黑棋"|"白棋";
  coordinate:string;
  facts:string[];
  concepts:Array<"提子"|"打吃"|"连接"|"气数"|"眼位"|"非法着法">;
  legal:boolean;
}
function playerName(color:SgfColor):"黑棋"|"白棋"{return color==="B"?"黑棋":"白棋";}
function illegalReason(reason:string|undefined):string{
  switch(reason){
    case"occupied":return"这个交叉点已经有棋子，不能重复落子。";
    case"out-of-bounds":return"这个位置超出了棋盘范围。";
    case"suicide":return"落子后自己的棋块没有任何气，而且没有提掉对方棋子，因此属于自杀着。";
    case"ko":return"这一步立即打回了劫点，违反了劫禁。";
    case"positional-superko":return"这一步会让棋盘回到此前出现过的局面，违反当前规则引擎采用的全局同形禁入规则。";
    case"wrong-turn":return"这一步不是当前应落子的棋手。";
    default:return"这一步未通过规则合法性检查。";
  }
}
/** Convert verified move facts into conservative, beginner-readable local explanations. */
export function explainMove(move:ValidatedMove):MoveExplanation{
  const coordinate="第"+(move.x+1)+"列、第"+(move.y+1)+"行（从左上角起算）";
  if(!move.legal)return{moveNumber:move.index,player:playerName(move.color),coordinate,facts:[illegalReason(move.reason)],concepts:["非法着法"],legal:false};
  const f=move.facts;
  if(!f)return{moveNumber:move.index,player:playerName(move.color),coordinate,facts:["这一步通过了规则检查，但当前没有足够的棋理特征来生成更具体的解释。"],concepts:[],legal:true};
  const facts:string[]=[],concepts:MoveExplanation["concepts"]=[];
  if(f.captured.length){facts.push("这一步提掉了对方"+f.captured.length+"颗棋子。");concepts.push("提子");}
  if(f.enemyGroupsPutInAtari>0){facts.push("这一步让对方"+f.enemyGroupsPutInAtari+"块棋只剩一口气，形成打吃。");concepts.push("打吃");}
  if(f.adjacentFriendlyGroups>0){facts.push("这一步与相邻的"+f.adjacentFriendlyGroups+"块己方棋连成一体。");concepts.push("连接");}
  if(f.ownLiberties===1){facts.push("落子后己方这块棋只有一口气，已经处于被打吃状态。");concepts.push("气数");}
  else if(f.ownLiberties===2){facts.push("落子后己方这块棋有两口气，仍需要留意对方紧气。");concepts.push("气数");}
  else{facts.push("落子后己方这块棋有"+f.ownLiberties+"口气。");concepts.push("气数");}
  if(f.fillsOwnTrueEye){facts.push("这一步填入了己方真眼，会占掉一个眼位；通常需要有明确战术目的才值得这样下。");concepts.push("眼位");}
  return{moveNumber:move.index,player:playerName(move.color),coordinate,facts,concepts:[...new Set(concepts)],legal:true};
}
