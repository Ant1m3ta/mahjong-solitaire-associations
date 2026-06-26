import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unfillLevel } from '../src/editor/unfill';
import { solveSkeleton } from '../src/editor/solver/solverCore';
import type { LevelData } from '../src/types';
const levelsDir = process.argv[2];
const files = readdirSync(levelsDir).filter((f) => f.endsWith('.json'));
let totalMs=0, totalStates=0, timeouts=0, solved=0;
const rows:any[]=[];
for (const file of files) {
  const data = JSON.parse(readFileSync(join(levelsDir, file),'utf-8')) as LevelData;
  let skel; try { skel = unfillLevel(data);} catch { continue; }
  const t0=performance.now();
  // TRUE optimal: admissible heuristic, weight 1
  const r = solveSkeleton(skel,{maxStates:1_000_000,maxMs:17000,useAdmissibleHeuristic:true,greedyWeight:1});
  const ms=performance.now()-t0;
  totalMs+=ms; totalStates+=r.stats.statesExplored;
  if(r.status==='timeout')timeouts++; if(r.status==='solved')solved++;
  rows.push({file,status:r.status,moves:r.movesUsed,states:r.stats.statesExplored,ms,proven:r.optimalityProven});
}
rows.sort((a,b)=>b.ms-a.ms);
for(const r of rows.slice(0,12)) console.log(`${r.file.padEnd(12)} ${r.status.padEnd(9)} moves=${String(r.moves??'-').padStart(3)} states=${String(r.states).padStart(8)} ${Math.round(r.ms).toString().padStart(7)}ms proven=${r.proven}`);
console.log(`\nOPTIMAL-MODE TOTAL: ${Math.round(totalMs)}ms  ${totalStates} states  solved=${solved}/${rows.length}  timeouts=${timeouts}`);
