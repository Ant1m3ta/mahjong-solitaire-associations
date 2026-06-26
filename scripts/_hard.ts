import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unfillLevel } from '../src/editor/unfill';
import { solveSkeleton } from '../src/editor/solver/solverCore';
const dir=process.argv[2];
const rows:any[]=[];
for(const f of readdirSync(dir).filter(x=>x.endsWith('.json'))){
  const skel=unfillLevel(JSON.parse(readFileSync(join(dir,f),'utf-8')));
  const t=performance.now();
  const r=solveSkeleton(skel,{maxStates:400000,maxMs:12000});
  rows.push({f,status:r.status,states:r.stats.statesExplored,ms:Math.round(performance.now()-t)});
}
rows.sort((a,b)=>b.ms-a.ms);
for(const r of rows.slice(0,8)) console.log(`${r.f.padEnd(13)} ${r.status.padEnd(9)} states=${String(r.states).padStart(7)} ${String(r.ms).padStart(6)}ms`);
