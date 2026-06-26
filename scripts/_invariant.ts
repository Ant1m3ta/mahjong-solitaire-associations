import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unfillLevel } from '../src/editor/unfill';
import { buildSolverInput } from '../src/editor/solver/buildState';
import { enumerateMoves } from '../src/editor/solver/enumerate';
import { getChainEntries } from '../src/game/coverage';
import { applyAction, isWon } from '../src/game/moves';
import { hashState } from '../src/editor/solver/hash';
import type { GameState } from '../src/types';
const dir=process.argv[2];
let maxChain=1, maxRevealedPerSlot=1, checked=0;
for(const f of readdirSync(dir).filter(x=>x.endsWith('.json'))){
  const { initialState } = buildSolverInput(unfillLevel(JSON.parse(readFileSync(join(dir,f),'utf-8'))));
  const seen=new Set<string>([hashState(initialState)]);
  const q:GameState[]=[initialState]; let n=0;
  while(q.length && n<20000){ const s=q.shift()!; n++; checked++;
    for(const slot of s.boardSlots){
      const rev=slot.cards.filter(c=>c.revealed).length;
      if(rev>maxRevealedPerSlot)maxRevealedPerSlot=rev;
      const ch=getChainEntries(slot as any); if(ch.length>maxChain)maxChain=ch.length;
    }
    if(isWon(s))continue;
    for(const a of enumerateMoves(s,{drawOnlyWhenHandEmpty:false})){
      let nx; try{nx=applyAction(s,a);}catch{continue;}
      const h=hashState(nx); if(!seen.has(h)){seen.add(h);q.push(nx);}
    }
  }
}
console.log(`checked ${checked} states; max revealed-per-slot=${maxRevealedPerSlot}; max chain length=${maxChain}`);
console.log(maxChain===1 && maxRevealedPerSlot===1 ? 'INVARIANT HOLDS: single-card board moves only' : 'INVARIANT VIOLATED: must handle multi-card chains');
