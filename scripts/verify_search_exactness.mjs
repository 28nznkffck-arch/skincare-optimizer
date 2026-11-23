// Deterministic small-catalog parity check. Never enumerate the entire live catalog.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as engine from '../dist/optimizer.js';
import {loadCatalog} from '../dist/catalog-csv.js';
import {mergeCatalogData} from '../dist/catalog-data.js';
let seed=246813579;
const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
const choose=values=>values[Math.floor(random()*values.length)];
const concerns=Object.keys(engine.CONCERNS);
const cases=360;
for(let index=0;index<cases;index++){
  const selected=concerns.filter(()=>random()<0.25);
  if(!selected.length)selected.push(choose(concerns));
  const items=engine.CATEGORIES.flatMap(category=>Array.from({length:2+Number(index%7===0)},(_,i)=>({
    jan:`${category}-${i}`,category,brand:'検証',name:`${category}-${i}`,referencePrice:choose([0,100,200,350,900]),
    referenceUses:choose([30,60]),dailyUses:choose([0.5,1,2]),doubleCleanseNotNeeded:random()<0.5,
    sensitiveSkin:random()<0.5,feel:choose(['light','moist','rich']),
    ingredients:Array.from({length:Math.floor(random()*8)},()=>`成分${Math.floor(random()*16)}`),
    scores:Object.fromEntries(concerns.map(c=>[c,choose([0,0.1,0.5,1,1.25,2,2.5,3])])),
    evidence:random()<0.3?{concentrations:[{name:'成分',value:1,unit:'%',sourceUrl:'https://example.test/'}]}:{},
  })));
  const options={budget:choose([100,500,1200,5000,Infinity]),concerns:selected,
    concernWeights:Object.fromEntries(selected.map(c=>[c,choose(['high','normal','low'])])),
    priority:choose(['simple','any','thorough']),skinType:choose(['normal','dry','oily','combination']),
    sensitiveSkin:random()<0.5,finish:choose(['any','light','moist','rich']),useMakeupRemover:random()<0.5,
    ingredient:choose(['none','成分0','成分1','成分15']),ingredientMode:choose(['preferred','required'])};
  if(index%3===0)options.excluded=[choose(items).jan];
  if(index%5===0){const locked=choose(items);options.locked={[locked.category]:locked.jan};}
  if(index%7===0){const override=choose(items);options.overrides={[override.jan]:{price:0,frequency:2}};}
  const all=engine.optimize(items,options).slice(0,1);
  const events=[];
  const candidate=engine.optimize(items,{...options,resultLimit:1},event=>events.push(event));
  assert.deepEqual(candidate,all,`pruned/exhaustive mismatch in case ${index}`);
  const last=events.at(-1);
  assert.equal(BigInt(last.evaluated)+BigInt(last.skipped),BigInt(last.total));
  assert.equal(last.percent,100);
}
let realCases=0;
for(const folder of ['../catalog/','../catalog-men/']){
  const data=await loadCatalog(url=>readFile(url,'utf8'),folder);
  const items=mergeCatalogData(data.products,data.pricing,data.usage);
  const sample=engine.CATEGORIES.flatMap(category=>items.filter(p=>p.category===category).slice(0,3));
  for(const settings of [
    {concerns:['pores','dullness']},
    {concerns:['dryness'],priority:'simple'},
    {concerns:['dryness','eyeDryness'],useMakeupRemover:true,priority:'thorough'},
    {concerns:['spots','wrinkles','fineLines','firmness'],ingredient:'ナイアシンアミド',ingredientMode:'required',sensitiveSkin:true,skinType:'dry'},
    {concerns:['oiliness','blackheads'],concernWeights:{oiliness:'high',blackheads:'low'},skinType:'oily',useMakeupRemover:true},
    {concerns:concerns,skinType:'combination',finish:'moist'},
  ]){
    for(const budget of [300,1000,5000]){
      const options={budget,priority:'any',...settings};
      assert.deepEqual(engine.optimize(sample,{...options,resultLimit:1}),engine.optimize(sample,options).slice(0,1));
      realCases++;
    }
  }
}
console.log(JSON.stringify({randomCases:cases,realSubsetCases:realCases,passed:true}));
