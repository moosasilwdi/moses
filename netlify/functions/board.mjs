// MOSES meeting place on Netlify. The ambulance writes where it is; drivers read it. One small board, kept in Netlify Blobs.
import { getStore } from '@netlify/blobs';
const EMPTY={active:null,trips:{},tripv:{},pos:{},drivers:{}};
export function apply(board,body,now,code){
  board=board||JSON.parse(JSON.stringify(EMPTY));board.trips=board.trips||{};board.tripv=board.tripv||{};board.pos=board.pos||{};board.drivers=board.drivers||{};
  for(const k in board.drivers)if(now-(board.drivers[k].t||0)>30000)delete board.drivers[k];
  for(const k in board.pos)if(now-(board.pos[k].t||0)>900000){delete board.pos[k];delete board.trips[k];delete board.tripv[k];}
  const op=body.op||'read';let changed=false;code=code||'';
  if(op==='crew')return {board,changed:false,out:{now,ok:!!code&&body.code===code,unset:!code}};
  if((op==='active'||op==='trip'||op==='pos')&&(!code||body.crew!==code))return {board,changed:false,out:{now,error:'crew'},status:403};
  if(op==='active'&&body.tripId){board.active={tripId:body.tripId,t:now};changed=true;}
  else if(op==='trip'&&body.id&&body.trip){board.trips[body.id]=body.trip;board.tripv[body.id]=now;changed=true;}
  else if(op==='pos'&&body.id&&body.pos){body.pos.t=now;board.pos[body.id]=body.pos;changed=true;}
  else if(op==='driver'&&body.id&&body.d){body.d.t=now;board.drivers[body.id]=body.d;changed=true;}
  else if(op==='rmdriver'&&body.id){delete board.drivers[body.id];changed=true;}
  const out=op==='gettrip'?{now,trip:board.trips[body.id]||null}:{now,active:board.active,tripv:board.tripv,pos:board.pos,drivers:board.drivers};
  return {board,changed,out};
}
export default async (req)=>{
  const headers={'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'POST,GET,OPTIONS','access-control-allow-headers':'content-type'};
  if(req.method==='OPTIONS')return new Response('',{headers});
  let body={};if(req.method==='POST'){try{body=await req.json();}catch(e){body={};}}
  let code='';try{code=(globalThis.Netlify&&Netlify.env&&Netlify.env.get('MOSES_CREW_CODE'))||process.env.MOSES_CREW_CODE||'';}catch(e){code='';}
  let r;
  // 'strong' = every read sees the newest board, not a copy up to a minute old
  try{r=await run(getStore({name:'moses',consistency:'strong'}),body,code,Date.now);}
  catch(e){if(e&&e.name==='BlobsConsistencyError')r=await run(getStore('moses'),body,code,Date.now);else r={out:{now:Date.now(),error:'store'},status:503};}
  r.out.v='v107700';
  return new Response(JSON.stringify(r.out),{status:r.status||200,headers});
};
// v107700: safe writing. Read the board, change it, and write it back only if nobody else wrote in between; if somebody did, do it again.
const pause=(i)=>new Promise(r=>setTimeout(r,15*(i+1)+Math.floor(Math.random()*40)));
export async function run(store,body,code,clock){
  const TRIES=10;
  for(let i=0;i<TRIES;i++){
    let cur;
    try{cur=await store.getWithMetadata('board',{type:'json'});}catch(e){if(e&&e.name==='BlobsConsistencyError')throw e;await pause(i);continue;}
    const board=cur?cur.data:null,etag=cur?cur.etag:null;
    const r=apply(board,body,clock(),code);
    if(!r.changed)return r;
    let w=null;
    try{w=await store.setJSON('board',r.board,cur?(etag?{onlyIfMatch:etag}:{}):{onlyIfNew:true});}catch(e){w=null;}
    // an empty tag back means the write did not really happen (known fault of the storage library)
    if(w&&w.modified&&w.etag)return r;
    await pause(i);
  }
  return {out:{now:clock(),error:'busy'},status:503};
}
export const config={path:'/board'};
