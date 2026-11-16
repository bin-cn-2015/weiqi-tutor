import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { explainMove } from "../explanation/move-explainer.js";
import type { SupervisionRecord } from "../dataset/supervision.js";

interface ExplanationRecord {
 schemaVersion:1;puzzleId:string;boardSize:number;initialPlayer:"B"|"W";setup:SupervisionRecord["setup"];puzzleContext:SupervisionRecord["puzzleContext"];
 branchIndex:number;answerLabel:"correct"|"wrong";scope:"verified-local-move-facts";
 input:{moves:Array<{number:number;player:"B"|"W";x:number;y:number}>};
 target:{moves:ReturnType<typeof explainMove>[];disclaimer:string};
}
async function main(){
 const inputArg=process.argv[2],outputArg=process.argv[3];
 if(!inputArg||!outputArg){console.error("Usage: npm run build:explanations -- <supervision.jsonl> <explanations.jsonl>");process.exitCode=2;return;}
 const input=resolve(inputArg),output=resolve(outputArg),raw=await readFile(input,"utf8");
 const records:ExplanationRecord[]=[];let skipped=0;
 for(const line of raw.split(/\r?\n/)){
  if(!line.trim())continue;
  const record=JSON.parse(line) as SupervisionRecord;
  if(!record.trainingEligible||record.ruleStatus!=="valid"||(record.sourceLabel!=="correct"&&record.sourceLabel!=="wrong")){skipped++;continue;}
  records.push({
   schemaVersion:1,puzzleId:record.puzzleId,boardSize:record.boardSize,initialPlayer:record.initialPlayer,setup:record.setup,puzzleContext:record.puzzleContext,
   branchIndex:record.branchIndex,answerLabel:record.sourceLabel,scope:"verified-local-move-facts",
   input:{moves:record.moves.map(move=>({number:move.index,player:move.color,x:move.x,y:move.y}))},
   target:{moves:record.moves.map(explainMove),disclaimer:"以上只解释规则引擎已经验证的局部棋理事实；不能仅凭这些局部事实断言整道死活题已做活或已杀死。"}
  });
 }
 await mkdir(dirname(output),{recursive:true});
 await writeFile(output,records.map(record=>JSON.stringify(record)).join("\n")+(records.length?"\n":""),"utf8");
 console.log(JSON.stringify({input,output,sourceLines:records.length+skipped,explanationSamples:records.length,skipped},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
