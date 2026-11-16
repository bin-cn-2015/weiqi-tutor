import type { SgfColor } from "../sgf/types.js";

export interface Point { x:number; y:number; }
export interface StoneGroup { color:SgfColor; stones:Point[]; liberties:Point[]; }
export interface MoveFacts {
  color:SgfColor; point:Point; captured:Point[]; ownGroupSize:number; ownLiberties:number;
  adjacentFriendlyGroups:number; adjacentEnemyGroups:number; enemyGroupsPutInAtari:number;
  friendlyGroupsConnected:number;
}
export interface PlayResult { legal:boolean; reason?:string; facts?:MoveFacts; }
export class GoBoard {
  readonly size:number;
  private cells:(SgfColor|null)[];
  private koPoint:Point|null=null;
  private history=new Set<string>();
  constructor(size:number,setup:Array<{x:number;y:number;color:SgfColor}> = []){
    if(!Number.isInteger(size)||size<2||size>25)throw new Error("Unsupported board size: "+size);
    this.size=size;this.cells=Array(size*size).fill(null);
    for(const s of setup){if(!this.valid(s)||this.get(s.x,s.y)!==null)throw new Error("Invalid or duplicate setup stone");this.cells[this.index(s.x,s.y)]=s.color;}
    this.history.add(this.positionKey());
  }
  private index(x:number,y:number){return y*this.size+x;}
  valid(p:Point){return Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.y>=0&&p.x<this.size&&p.y<this.size;}
  get(x:number,y:number):SgfColor|null{return this.valid({x,y})?this.cells[this.index(x,y)]??null:null;}
  private neighbours(p:Point):Point[]{return[{x:p.x-1,y:p.y},{x:p.x+1,y:p.y},{x:p.x,y:p.y-1},{x:p.x,y:p.y+1}].filter(q=>this.valid(q));}
  group(start:Point):StoneGroup{
    const color=this.get(start.x,start.y);if(!color)return{color:"B",stones:[],liberties:[]};
    const queue=[start],seen=new Set<number>(),libs=new Map<number,Point>(),stones:Point[]=[];
    while(queue.length){const p=queue.pop()!,id=this.index(p.x,p.y);if(seen.has(id))continue;seen.add(id);stones.push(p);
      for(const q of this.neighbours(p)){const qi=this.index(q.x,q.y),v=this.cells[qi];if(v===null)libs.set(qi,q);else if(v===color&&!seen.has(qi))queue.push(q);}
    }
    return{color,stones,liberties:[...libs.values()]};
  }
  private positionKey(){return this.cells.map(v=>v??".").join("");}
  play(color:SgfColor,p:Point):PlayResult{
    if(!this.valid(p))return{legal:false,reason:"out-of-bounds"};
    const at=this.index(p.x,p.y);if(this.cells[at]!==null)return{legal:false,reason:"occupied"};
    if(this.koPoint&&this.koPoint.x===p.x&&this.koPoint.y===p.y)return{legal:false,reason:"ko"};
    const adjacent=this.neighbours(p),friendly=new Map<number,StoneGroup>(),enemy=new Map<number,StoneGroup>();
    for(const q of adjacent){const c=this.get(q.x,q.y);if(!c)continue;const g=this.group(q);const id=this.index(g.stones[0]!.x,g.stones[0]!.y);(c===color?friendly:enemy).set(id,g);}
    this.cells[at]=color;const captured:Point[]=[];
    for(const g of enemy.values())if(g.liberties.length===1&&g.liberties[0]!.x===p.x&&g.liberties[0]!.y===p.y){for(const s of g.stones){this.cells[this.index(s.x,s.y)]=null;captured.push(s);}}
    const own=this.group(p);
    if(own.liberties.length===0){this.cells[at]=null;for(const s of captured)this.cells[this.index(s.x,s.y)]=color==="B"?"W":"B";return{legal:false,reason:"suicide"};}
    const key=this.positionKey();
    if(this.history.has(key)){this.cells[at]=null;for(const s of captured)this.cells[this.index(s.x,s.y)]=color==="B"?"W":"B";return{legal:false,reason:"positional-superko"};}
    this.history.add(key);
    const enemiesAtari=[...enemy.values()].filter(g=>g.liberties.length===2&&g.liberties.some(l=>l.x===p.x&&l.y===p.y)).length;
    const facts:MoveFacts={color,point:p,captured,ownGroupSize:own.stones.length,ownLiberties:own.liberties.length,adjacentFriendlyGroups:friendly.size,adjacentEnemyGroups:enemy.size,enemyGroupsPutInAtari:enemiesAtari,friendlyGroupsConnected:friendly.size>0?friendly.size+1:1};
    this.koPoint=null;
    if(captured.length===1&&own.stones.length===1&&own.liberties.length===1)this.koPoint=captured[0]!;
    return{legal:true,facts};
  }
  snapshot():Array<{x:number;y:number;color:SgfColor}>{const out=[];for(let y=0;y<this.size;y++)for(let x=0;x<this.size;x++){const color=this.get(x,y);if(color)out.push({x,y,color});}return out;}
}