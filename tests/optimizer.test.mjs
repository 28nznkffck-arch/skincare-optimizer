import test from 'node:test';
import assert from 'node:assert/strict';
import {CONCERNS, diagnoseProduct, explainRoutineScore, monthlyCost, optimize, scoreRoutine, swaps, transparencyDetails, unscoredConcerns} from '../dist/optimizer.js';
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
  assert.equal(CONCERNS.freckles,'そばかす予防');
  assert.deepEqual(unscoredConcerns(catalog,['oiliness','irritation','wrinkles','freckles','blackheads']),['blackheads']);
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
  assert.ok(top.products.some(p=>p.category==='toner'&&p.sensitiveSkin),
    '敏感肌・保湿の希望に合う化粧水の選択肢が増えても、特定の銘柄には固定しない');
});

test('expanded catalog is unique, traceable and covers multiple manufacturers',()=>{
  assert.equal(catalog.length,30);
  assert.equal(new Set(catalog.map(p=>p.id)).size,catalog.length);
  assert.ok(new Set(catalog.map(p=>p.sourceUrl)).size===catalog.length);
  assert.ok(new Set(catalog.map(p=>p.brand)).size>=9);
  assert.ok(catalog.some(p=>p.brand==='メラノCC'&&p.category==='serum'));
  assert.ok(catalog.some(p=>p.brand==='イハダ'&&p.category==='toner'));
  assert.ok(catalog.some(p=>p.brand==='ミノン アミノモイスト'&&p.category==='cleanser'));
  for(const p of catalog){
    assert.ok(p.sourceUrl.startsWith('https://'),`${p.id} must link to an official source`);
    assert.ok(['cleanser','toner','serum','moisturizer','sunscreen'].includes(p.category),p.id);
    assert.ok(Number.isFinite(p.demoPrice)&&p.demoPrice>=0,p.id);
    assert.ok(Number.isFinite(p.demoUses)&&p.demoUses>0,p.id);
    assert.ok(Number.isFinite(p.dailyUses)&&p.dailyUses>=0,p.id);
    assert.ok(Object.values(p.scores).every(n=>Number.isInteger(n)&&n>=0&&n<=3),p.id);
  }
});

test('catalog does not mistake UV prevention for improvement of existing dullness',()=>{
  for(const uv of catalog.filter(p=>p.category==='sunscreen')){
    assert.equal(uv.scores.dullness??0,0,uv.id);
    assert.ok(uv.scores.spots>0&&uv.scores.freckles>0,uv.id);
  }
  for(const p of catalog.filter(p=>p.id.startsWith('minon-'))){
    assert.deepEqual(transparencyDetails(p).actives,[],`${p.id} is a cosmetic, not a quasi-drug`);
    assert.deepEqual(transparencyDetails(p).concentrations,[]);
  }
  assert.equal(transparencyDetails(catalog.find(p=>p.id==='hadalabo-aging-lotion')).level,2);
  assert.equal(transparencyDetails(catalog.find(p=>p.id==='melanocc-premium-essence')).level,2);
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

test('score breakdown adds exactly to the optimization score',()=>{
  const options={budget:12000,concerns:['pores','dullness','dryness'],concernWeights:{pores:'high'},
    priority:'thorough',skinType:'combination',sensitiveSkin:true,finish:'moist',ingredient:'ナイアシンアミド'};
  const best=optimize(catalog,options)[0];
  assert.ok(best);
  const breakdown=explainRoutineScore(best.products,options);
  assert.equal(breakdown.total,best.score);
  assert.equal(breakdown.total,scoreRoutine(best.products,options));
  assert.equal(breakdown.total,Math.round(breakdown.parts.reduce((sum,p)=>sum+p.value,0)*100)/100);
  for(const key of ['concern:pores','steps','skin','sensitive','finish','ingredient','diversity','transparency'])
    assert.ok(breakdown.parts.some(p=>p.id===key),`${key} is visible in the breakdown`);
});

test('official active ingredients are verified; unknown concentration is not zero',()=>{
  const item=catalog.find(p=>p.id==='curel-toner-ii');
  const evidence=transparencyDetails(item);
  assert.equal(evidence.level,2);
  assert.deepEqual(evidence.actives,['アラントイン']);
  assert.deepEqual(evidence.concentrations,[]);
  const unchecked=catalog.find(p=>p.id==='curel-foam');
  assert.equal(transparencyDetails(unchecked).level,1);
  assert.deepEqual(transparencyDetails(unchecked).actives,[]);
  const imaginary={sourceUrl:'https://maker.example/product',evidence:{officialSource:true,activeIngredients:['成分X'],
    concentrations:[{name:'成分X',value:1.5,unit:'%',sourceUrl:'https://maker.example/disclosure'}]}};
  assert.equal(transparencyDetails(imaginary).level,3);
  assert.equal(transparencyDetails({...imaginary,evidence:{...imaginary.evidence,
    concentrations:[{name:'成分X',value:1.5,unit:'%'}]}}).level,2);
});

test('information transparency adds a small, product-count-neutral tie-breaker',()=>{
  const product={brand:'A',name:'B',category:'toner',scores:{},keyIngredients:[],sourceUrl:'https://maker.example'};
  const verified={...product,evidence:{officialSource:true,activeIngredients:['成分X']}};
  const options={concerns:[],priority:'thorough'};
  const plain=explainRoutineScore([product],options);
  const trusted=explainRoutineScore([verified],options);
  assert.equal(trusted.subtotal,plain.subtotal);
  assert.ok(trusted.total>plain.total);
  assert.ok(trusted.total-plain.total<=1.05);
  assert.equal(explainRoutineScore([verified,verified],options).transparency,trusted.transparency);
});

test('diagnostic explains selected, excluded, competing locked and no-concern cases',()=>{
  const options={budget:9000,concerns:['dryness','irritation'],priority:'thorough'};
  const best=optimize(catalog,options)[0];
  assert.ok(best);
  const chosen=best.products.find(p=>p.category==='toner');
  assert.ok(chosen);
  assert.equal(diagnoseProduct(catalog,options,chosen.id,best).status,'selected');
  assert.equal(diagnoseProduct(catalog,{...options,excluded:[chosen.id]},chosen.id,best).status,'excluded');
  const rival=catalog.find(p=>p.category==='toner'&&p.id!==chosen.id);
  assert.equal(diagnoseProduct(catalog,{...options,locked:{toner:chosen.id}},rival.id,best).status,'locked');
  assert.equal(diagnoseProduct(catalog,{...options,concerns:[]},chosen.id,best).status,'no_concern');
});

test('diagnostic reruns a forced candidate, including its whole-routine cost',()=>{
  const options={budget:9000,concerns:['pores','dullness'],priority:'thorough'};
  const best=optimize(catalog,options)[0];
  const challenger=catalog.find(p=>p.category==='toner'&&!best.products.some(x=>x.id===p.id));
  assert.ok(challenger);
  const diagnostic=diagnoseProduct(catalog,options,challenger.id,best);
  assert.equal(diagnostic.status,'not_selected');
  assert.ok(diagnostic.forced.products.some(p=>p.id===challenger.id));
  assert.ok(diagnostic.forced.monthly<=options.budget);
  assert.equal(diagnostic.scoreGap,Math.round((best.score-diagnostic.forced.score)*100)/100);
  assert.ok(diagnostic.scoreGap>=0);
});

test('diagnostic distinguishes a budget failure from an ingredient incompatibility',()=>{
  const options={budget:3500,concerns:['dryness'],priority:'simple'};
  const best=optimize(catalog,options)[0];
  assert.ok(best);
  const expensive=catalog.find(p=>p.id==='sofina-toning-serum');
  const diagnosis=diagnoseProduct(catalog,options,expensive.id,best);
  assert.equal(diagnosis.status,'budget');
  assert.ok(diagnosis.minimum>options.budget);
});
