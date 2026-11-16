import { gunzipSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as seekBzipModule from "seek-bzip";

const DATA_BASE="https://raw.githubusercontent.com/zhangbin2025/weiqi-bot/main/clients/web/shared/assets/data/games";
type Meta={category:string;date:string;count:number;chunkSize:number;chunks:Array<{start:number;count:number;size:number}>;ids:string[];pw:string[]};
type TarEntry={name:string;data:Uint8Array};
export interface ImportOptions {difficulty?:string;type?:string;limit?:number;outputDir?:string;concurrency?:number;}
export interface ImportSummary {date:string;available:number;matched:number;downloadedChunks:number;written:number;outputDir:string;labels:Record<string,number>;}

function decodeBz2(data:Uint8Array):Uint8Array{
 const visit=(value:any,depth=0):((bytes:Uint8Array)=>Uint8Array)|null=>{
  if(!value||depth>4)return null;
  if(typeof value.decode==="function")return value.decode.bind(value);
  if(value.default)return visit(value.default,depth+1);
  return null;
 };
 const decoder=visit(seekBzipModule);
 if(!decoder)throw new Error("seek-bzip decoder export not found");
 return new Uint8Array(decoder(data));
}
async function download(url:string):Promise<Uint8Array>{
 let last:unknown;
 for(let attempt=0;attempt<3;attempt++){
  try{
   const response=await fetch(url,{headers:{"user-agent":"weiqi-tutor-dataset-importer"}});
   if(!response.ok)throw new Error("HTTP "+response.status+" for "+url);
   return new Uint8Array(await response.arrayBuffer());
  }catch(error){last=error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));}
 }
 throw last instanceof Error?last:new Error(String(last));
}
function gunzipJson<T>(data:Uint8Array):T{return JSON.parse(gunzipSync(data).toString("utf8")) as T;}
function tarString(data:Uint8Array,start:number,length:number):string{
 let end=start+length;for(let i=start;i<end;i++)if(data[i]===0){end=i;break;}
 return new TextDecoder("ascii").decode(data.subarray(start,end)).trim();
}
function parseTar(data:Uint8Array):TarEntry[]{
 const files:TarEntry[]=[];let offset=0;
 while(offset+512<=data.length){
  const header=data.subarray(offset,offset+512),name=tarString(header,0,100);
  if(!name||header[0]===0)break;
  const prefix=tarString(header,345,155),fullName=prefix?prefix+"/"+name:name;
  const sizeText=tarString(header,124,12),size=parseInt(sizeText,8);
  if(!Number.isFinite(size)||size<0)throw new Error("Invalid tar entry size for "+fullName);
  const type=header[156];offset+=512;
  if((type===0||type===48)&&size>0){
   if(offset+size>data.length)throw new Error("Truncated tar entry "+fullName);
   files.push({name:fullName,data:data.slice(offset,offset+size)});
  }
  offset+=Math.ceil(size/512)*512;
 }
 return files.filter(file=>file.name.toLowerCase().endsWith(".sgf")).sort((a,b)=>a.name.localeCompare(b.name));
}
function parseArgs(args:string[]):ImportOptions{
 const options:ImportOptions={difficulty:"15K",type:"死活",concurrency:4};
 for(let i=0;i<args.length;i++){
  const arg=args[i]!,value=args[i+1];
  if(arg==="--difficulty"&&value){options.difficulty=value;i++;}
  else if(arg==="--type"&&value){options.type=value;i++;}
  else if(arg==="--limit"&&value){options.limit=Number(value);i++;}
  else if(arg==="--output"&&value){options.outputDir=value;i++;}
  else if(arg==="--concurrency"&&value){options.concurrency=Number(value);i++;}
  else if(arg==="--help"){console.log("Usage: npm run import:library -- [--difficulty 15K] [--type 死活] [--limit N] [--output DIR] [--concurrency 4]");process.exit(0);}
  else throw new Error("Unknown or incomplete option: "+arg);
 }
 if(options.limit!==undefined&&(!Number.isInteger(options.limit)||options.limit<1))throw new Error("--limit must be a positive integer");
 if(!Number.isInteger(options.concurrency)||options.concurrency!<1||options.concurrency!>8)throw new Error("--concurrency must be between 1 and 8");
 return options;
}
export async function importLifeAndDeathLibrary(options:ImportOptions={}):Promise<ImportSummary>{
 const difficulty=options.difficulty??"15K",type=options.type??"死活",limit=options.limit??Number.POSITIVE_INFINITY;
 const outputDir=resolve(options.outputDir??("data/raw/"+difficulty.toLowerCase())),concurrency=options.concurrency??4;
 const index=gunzipJson<{categories?:Record<string,string[]>}>(await download(DATA_BASE+"/index.json.gz"));
 const dates=index.categories?.["life-and-death"]??[];
 if(!dates.length)throw new Error("The source index contains no life-and-death dates");
 const date=dates[0]!;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Invalid source date in index: "+date);
 const meta=gunzipJson<Meta>(await download(DATA_BASE+"/life-and-death/"+date+".meta.json.gz"));
 if(meta.ids.length!==meta.count||meta.pw.length!==meta.count)throw new Error("Metadata ids/pw length does not match count");
 const selected:number[]=[];
 const labels:Record<string,number>={};
 for(let i=0;i<meta.count;i++){
  const label=(meta.pw[i]??"").trim();
  labels[label]=(labels[label]??0)+1;
  const matchesType=!type||label.includes(type);
  const matchesDifficulty=!difficulty||difficulty.toUpperCase()==="ALL"||label.toUpperCase().includes("·"+difficulty.toUpperCase());
  if(matchesType&&matchesDifficulty&&selected.length<limit)selected.push(i);
 }
 const selectedSet=new Set(selected);\n const chunkIndexes=[...new Set(selected.map(i=>Math.floor(i/meta.chunkSize)))];
 await mkdir(outputDir,{recursive:true});
 let cursor=0,written=0;
 const worker=async()=>{
  while(true){
   const chunkIndex=cursor++;if(chunkIndex>=chunkIndexes.length)return;
   const part=chunkIndexes[chunkIndex]!,chunk=meta.chunks[part];
   if(!chunk)throw new Error("Missing chunk descriptor "+part);
   const url=DATA_BASE+"/life-and-death/"+date+".p"+String(part).padStart(4,"0")+".tar.bz2";
   const tar=parseTar(decodeBz2(await download(url)));
   if(tar.length!==chunk.count)throw new Error("Chunk "+part+" expected "+chunk.count+" SGFs, found "+tar.length);
   for(let local=0;local<tar.length;local++){
    const global=chunk.start+local;
    if(!selectedSet.has(global))continue;
    const id=meta.ids[global];
    if(!id||!/^[a-f0-9]{32}$/i.test(id))throw new Error("Invalid stable puzzle id at metadata index "+global);
    const filename=join(outputDir,id+".sgf");
    await writeFile(filename,tar[local]!.data);
    await writeFile(join(outputDir,id+".json"),JSON.stringify({id,label:meta.pw[global],date,index:global,source:"weiqi-bot/life-and-death"}));
    written++;
   }
  }
 };
 await Promise.all(Array.from({length:Math.min(concurrency,chunkIndexes.length)},()=>worker()));
 const manifest={source:"https://github.com/zhangbin2025/weiqi-bot",date,difficulty,type,available:meta.count,matched:selected.length,written,chunkIndexes,labels};
 await writeFile(join(outputDir,"manifest.json"),JSON.stringify(manifest,null,2));
 return{date,available:meta.count,matched:selected.length,downloadedChunks:chunkIndexes.length,written,outputDir,labels};
}
export async function runImportCli(args=process.argv.slice(2)){
 const options=parseArgs(args);
 const summary=await importLifeAndDeathLibrary(options);
 console.log(JSON.stringify(summary,null,2));
}
