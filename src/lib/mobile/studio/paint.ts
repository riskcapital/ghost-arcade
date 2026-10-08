import type {Surface,Point} from './model';
export type Brush='light'|'smoke'|'slime';
export type Edge='top'|'right'|'bottom'|'left';
export type PaintSample={surface:string;u:number;v:number;beat:number;pressure:number};
export type PaintStroke={id:string;brush:Brush;color:string;size:number;life:number;samples:PaintSample[]};
export type PaintLink={from:string;edge:Edge;to:string;entry:Edge;flip:boolean};
export type PaintConfig={enabled:boolean;isolate:boolean;brush:Brush;color:string;size:number;life:number;gravity:number;hold:boolean;loop:boolean;beats:number;strokes:PaintStroke[];links:PaintLink[]};
export const defaultPaint=():PaintConfig=>({enabled:true,isolate:false,brush:'light',color:'#5cdaff',size:.055,life:8,gravity:.5,hold:false,loop:false,beats:8,strokes:[],links:[]});
const clamp=(n:unknown,min:number,max:number,fallback:number)=>typeof n==='number'&&Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
const edges=['top','right','bottom','left'];
export function normalizePaint(raw:Partial<PaintConfig>|undefined):PaintConfig{
 const d=defaultPaint();if(!raw)return d;
 let budget=10000;
 const brush=(v:unknown):Brush=>v==='smoke'||v==='slime'?v:'light';
 const color=(v:unknown)=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)?v:d.color;
 return{...d,enabled:raw.enabled!==false,isolate:!!raw.isolate,brush:brush(raw.brush),color:color(raw.color),size:clamp(raw.size,.015,.16,d.size),life:clamp(raw.life,1,30,d.life),gravity:clamp(raw.gravity,0,1,d.gravity),hold:false,loop:!!raw.loop,beats:[4,8,16,32].includes(raw.beats!)?raw.beats!:8,
 strokes:(Array.isArray(raw.strokes)?raw.strokes:[]).slice(-64).filter(s=>s&&typeof s.id==='string').map(s=>({id:s.id,brush:brush(s.brush),color:color(s.color),size:clamp(s.size,.015,.16,d.size),life:clamp(s.life,1,30,d.life),
 samples:(Array.isArray(s.samples)?s.samples:[]).slice(0,budget).filter(p=>p&&typeof p.surface==='string').map(p=>{budget--;return{surface:p.surface,u:clamp(p.u,0,1,.5),v:clamp(p.v,0,1,.5),beat:clamp(p.beat,0,100000,0),pressure:clamp(p.pressure,.1,1,.5)};})})),
 links:(Array.isArray(raw.links)?raw.links:[]).slice(0,32).filter(l=>l&&typeof l.from==='string'&&typeof l.to==='string'&&l.from!==l.to&&edges.includes(l.edge)&&edges.includes(l.entry)).map(l=>({...l,flip:!!l.flip}))};
}
export type PaintParticle={stroke:string;surface:string;u:number;v:number;vx:number;vy:number;age:number;life:number;size:number;kind:number;color:number[];seed:number};
export function crossPaintEdge(p:PaintParticle,links:PaintLink[],surfaces:Surface[]):boolean{
 const edge:Edge|undefined=p.u<0?'left':p.u>1?'right':p.v<0?'top':p.v>1?'bottom':undefined;
 if(!edge)return true;
 const forward=links.find(l=>l.from===p.surface&&l.edge===edge);
 const reverse=links.find(l=>l.to===p.surface&&l.entry===edge);
 const link=forward??(reverse?{from:reverse.to,edge:reverse.entry,to:reverse.from,entry:reverse.edge,flip:reverse.flip}:undefined);
 if(!link||!surfaces.some(s=>s.id===link.to&&s.enabled))return false;
 let t=edge==='left'||edge==='right'?p.v:p.u;
 let tangent=edge==='left'||edge==='right'?p.vy:p.vx;
 const normal=Math.max(.025,Math.abs(edge==='left'||edge==='right'?p.vx:p.vy));
 if(link.flip){t=1-t;tangent=-tangent;}t=Math.max(.001,Math.min(.999,t));
 p.surface=link.to;
 switch(link.entry){
 case 'top':p.u=t;p.v=.001;p.vx=tangent;p.vy=normal;break;
 case 'bottom':p.u=t;p.v=.999;p.vx=tangent;p.vy=-normal;break;
 case 'left':p.u=.001;p.v=t;p.vx=normal;p.vy=tangent;break;
 case 'right':p.u=.999;p.v=t;p.vx=-normal;p.vy=tangent;break;
 }
 return true;
}
