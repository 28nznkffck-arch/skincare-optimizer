import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareConcernBound} from '../dist/concern-bound.js';

const round2=value=>Math.round((value+Number.EPSILON)*100)/100;
function concernNet(entries,weights){
  let score=-entries.reduce((sum,entry)=>sum+entry.penalty,0);
  for(let i=0;i<weights.length;i++){
    const ranks=entries.map(entry=>entry.points[i]).sort((a,b)=>b-a);
    score+=round2(((ranks[0]||0)*7+(ranks[1]||0)*3+(ranks[2]||0))*weights[i]);
  }
  return round2(score);
}

test('linear concern bounds dominate every completion, including decimal scores, priorities and omission',()=>{
  let seed=135792468;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
  const choose=values=>values[Math.floor(random()*values.length)];
  for(let sample=0;sample<60;sample++){
    const weights=Array.from({length:1+sample%6},()=>choose([0.55,1,1.6]));
    const groups=Array.from({length:4+sample%3},(_,g)=>Array.from({length:3},(_,p)=>({
      points:weights.map(()=>p===0&&g%2?0:choose([0,0.01,0.1,0.5,1,1.25,2,2.5,3])),
      penalty:p===0&&g%2?0:choose([0,2,5]),
    })));
    const reference=groups.map(group=>choose(group));
    const upper=prepareConcernBound(groups,weights,reference,concernNet(reference,weights));
    function enumerate(depth,prefix,ancestors){
      const bound=upper(depth,prefix);
      if(depth===groups.length){
        const actual=concernNet(prefix,weights);
        for(const ceiling of [...ancestors,bound])assert(ceiling+1e-8>=actual,`unsafe bound in sample ${sample}: ${ceiling} < ${actual}`);
        return;
      }
      for(const entry of groups[depth])enumerate(depth+1,[...prefix,entry],[...ancestors,bound]);
    }
    enumerate(0,[],[]);
  }
});

test('the bound removes incompatible category maxima without removing actual products',()=>{
  const groups=Array.from({length:4},()=>[
    {points:[3,0],penalty:0}, {points:[0,3],penalty:0},
  ]),weights=[1,1],reference=groups.map((group,i)=>group[i%2]);
  const upper=prepareConcernBound(groups,weights,reference,concernNet(reference,weights));
  // Pretending every product covers both concerns gives 66; the true best is 60.
  assert(upper(0,[])<61);assert(upper(0,[])>=60);
  assert.equal(groups.flat().length,8);
});
