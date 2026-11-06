import test from 'node:test';
import assert from 'node:assert/strict';
import {CONCERNS, monthlyCost, optimize, scoreRoutine, swaps, unscoredConcerns} from '../dist/optimizer.js';
import {createSavedPlan, savedPlanTotals, updateSavedUsage} from '../dist/plans.js';
import fs from 'node:fs';

const catalog=JSON.parse(fs.readFileSync(new URL('../dist/data/products.json',import.meta.url),'utf8')).products;

test('monthly estimate is rounded and usage-aware',()=>{
  const item={demoPrice:1500,demoUses:100,dailyUses:2};
  assert.equal(monthlyCost(item),900);
  assert.equal(monthlyCost(item,{uses:50}),1800);
});

test('optimizer fits budget and covers mandatory categories',()=>{
  const result=optimize(catalog,{budget:5000,concerns:['pores','dullness'],priority:'simple'});
  assert.ok(result.length>0);
  assert.ok(result[0].monthly<=5000);
  for (const category of ['cleanser','moisturizer','sunscreen']) assert.ok(result[0].products.some(p=>p.category===category));
});

test('exclusions and fixed products are respected',()=>{
  const options={budget:12000,concerns:['pores','dullness'],priority:'balance',excluded:['biore-foam-smooth'],locked:{toner:'curel-toner-ii'}};
  const result=optimize(catalog,options);
  assert.ok(result.length>0);
  assert.ok(result.every(r=>r.products.some(p=>p.id==='curel-toner-ii')));
  assert.ok(result.every(r=>!r.products.some(p=>p.id==='biore-foam-smooth')));
});

test('swap never exceeds requested delta and budget',()=>{
  const options={budget:5000,concerns:['pores','dullness'],priority:'simple'};
  const result=optimize(catalog,options)[0];
  const category='sunscreen';
  assert.ok(swaps(result,catalog,category,options,100).every(x=>x.delta<=100 && x.monthly<=5000));
});

test('no impossible routine returned under zero budget',()=>{
  assert.deepEqual(optimize(catalog,{budget:0}),[]);
});

test('toner is not systematically excluded by the simplicity penalty',()=>{
  const options={budget:5000,concerns:['pores','dullness'],priority:'simple'};
  const recommendation=optimize(catalog,options)[0];
  assert.ok(recommendation.products.some(p=>p.category==='toner'));
  // 手軽さ重視でも、悩みへの追加適合性が勝れば化粧水を採用する。
});

test('expanded concern names are registered without inventing unsupported scores',()=>{
  for(const key of ['oiliness','shine','irritation','wrinkles','freckles','blackheads']) assert.ok(CONCERNS[key]);
  assert.equal(CONCERNS.firmness,'ハリ不足・たるみ');
  assert.deepEqual(unscoredConcerns(catalog,['oiliness','irritation','wrinkles','freckles']),['wrinkles','freckles']);
});

test('concern importance strengthens its influence on a routine',()=>{
  const items=catalog.filter(p=>['curel-sebum-foam','nivea-soft','biore-uv-aqua'].includes(p.id));
  const defaultScore=scoreRoutine(items,{concerns:['oiliness'],priority:'simple'});
  const highScore=scoreRoutine(items,{concerns:['oiliness'],concernWeights:{oiliness:'high'},priority:'simple'});
  const lowScore=scoreRoutine(items,{concerns:['oiliness'],concernWeights:{oiliness:'low'},priority:'simple'});
  assert.ok(highScore>defaultScore && defaultScore>lowScore);
});

test('skin type, sensitivity and finish preferences affect results',()=>{
  const items=catalog.filter(p=>['curel-foam','curel-toner-ii','curel-milk','curel-uv'].includes(p.id));
  const base=scoreRoutine(items,{concerns:['dryness','irritation'],priority:'simple'});
  const adapted=scoreRoutine(items,{concerns:['dryness','irritation'],priority:'simple',skinType:'dry',sensitiveSkin:true,finish:'moist'});
  assert.ok(adapted>base);
  const top=optimize(catalog,{budget:5000,concerns:['dryness','irritation'],priority:'simple',sensitiveSkin:true,finish:'moist'})[0];
  assert.ok(top.products.some(p=>p.id==='curel-toner-ii'));
});

test('care style controls optional steps without rewarding price alone',()=>{
  const simple=optimize(catalog,{budget:5000,concerns:['pores','dullness'],priority:'simple'})[0];
  const thorough=optimize(catalog,{budget:5000,concerns:['pores','dullness'],priority:'thorough'})[0];
  assert.ok(thorough.products.filter(p=>['toner','serum'].includes(p.category)).length>=simple.products.filter(p=>['toner','serum'].includes(p.category)).length);
  assert.equal(scoreRoutine(simple.products,{concerns:['pores'],overrides:{'nivea-soft':{price:480}}}),
    scoreRoutine(simple.products,{concerns:['pores'],overrides:{'nivea-soft':{price:3000}}}));
});

test('saved routines preserve independent prices, frequencies and budget',()=>{
  const routine=optimize(catalog,{budget:5000,concerns:['pores','dullness'],priority:'simple'})[0];
  const sharedOverrides={};
  const plan=createSavedPlan(routine,{budget:5000,concerns:['pores'],priority:'simple',overrides:sharedOverrides},'test-plan','2026-11-06T00:00:00Z');
  assert.deepEqual(plan.productIds,routine.products.map(p=>p.id));
  assert.equal(plan.budget,5000);
  const before=savedPlanTotals(plan,catalog);
  sharedOverrides[plan.productIds[0]]={price:99999};
  assert.equal(savedPlanTotals(plan,catalog).monthly,before.monthly);
  const id=plan.productIds[0];
  assert.equal(updateSavedUsage(plan,id,'uses',1),true);
  assert.ok(savedPlanTotals(plan,catalog).monthly>before.monthly);
  assert.equal(updateSavedUsage(plan,id,'uses',0),false);
  assert.equal(updateSavedUsage(plan,'missing','price',100),false);
  assert.equal(updateSavedUsage(plan,id,'frequency',0),true);
  assert.equal(monthlyCost(catalog.find(p=>p.id===id),plan.overrides[id]),0);
});
