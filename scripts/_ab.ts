import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unfillLevel } from '../src/editor/unfill';
import { solveSkeleton } from '../src/editor/solver/solverCore';
const dir=process.argv[2];
const files=readdirSync(dir).filter(f=>f.endsWith('.json'));
let totMs=0, totStates=0;
const res:Record<string,string>={};
for (const f of files){
  const skel=unfillLevel(JSON.parse(readFileSync(join(dir,f),'utf-8')));
  const t=performance.now();
  const r=solveSkeleton(skel,{maxStates:1_000_000,maxMs:17000});
  const ms=performance.now()-t; totMs+=ms; totStates+=r.stats.statesExplored;
  res[f]=`${r.status}:${r.movesUsed}:${r.stats.statesExplored}`;
}
console.log(JSON.stringify({totMs:Math.round(totMs), totStates, res}));
