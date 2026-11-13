import test from 'node:test';
import assert from 'node:assert/strict';
import {CONCERNS, diagnoseProduct, explainRoutineScore, monthlyCost, priceOf, usesOf, optimize, scoreRoutine, swaps, transparencyDetails, unscoredConcerns} from '../dist/optimizer.js';
import {createSavedPlan, savedPlanTotals, updateSavedUsage} from '../dist/plans.js';
import {mergeCatalogData, reconcileCatalogState, unitPerUse} from '../dist/catalog-data.js';
import fs from 'node:fs';

// Keep calculation examples reproducible when the editable catalog's prices or products change.
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/catalog-v0.8.3.json',import.meta.url),'utf8'));
const {pricing:priceDb, usage:usageDb}=fixture;
const catalog=mergeCatalogData(fixture.products,priceDb,usageDb);

test('all active products have JAN-verified retailer quotes; limited edition is excluded',()=>{
  assert.equal(Object.keys(priceDb.prices).length,120);
  const verified=catalog.filter(p=>p.priceReference);
  assert.equal(verified.length,120);
  for(const p of verified){
    assert.equal(p.priceReference.jan,p.jan);
    assert.equal(priceOf(p),p.priceReference.priceJPY);
    assert.ok(['2026-11-06','2026-11-07','2026-11-13'].includes(p.priceReference.verifiedAt));
  }
  assert.equal(catalog.length,120);
  assert.ok(!catalog.some(p=>p.name.includes('オイルコントロール') && p.name.includes('プラス')));
  assert.ok(catalog.every(p=>p.priceReference),'no active item uses an unverified price');
  const tsuruha=catalog.filter(p=>p.priceReference?.retailer==='ツルハグループe-shop');
  assert.equal(tsuruha.length,8);
  assert.equal(catalog.find(p=>p.jan==='4901301474407').referencePrice,968);
  assert.ok(!catalog.some(p=>p.category==='sunscreen'));
  assert.ok(Object.keys(priceDb.prices).every(jan=>catalog.some(p=>p.jan===jan)));
  assert.ok(Object.keys(usageDb.usages).every(jan=>catalog.some(p=>p.jan===jan)));
  assert.equal(catalog.find(p=>p.jan==='4909978261238').jan,'4909978261238');
  assert.equal(catalog.find(p=>p.jan==='4909978261306').jan,'4909978261306');
  assert.equal(priceOf(verified[0],{price:321}),321);
  assert.equal(mergeCatalogData([{jan:'123',demoPrice:55,demoUses:3}],{prices:{'123':{jan:'456',priceJPY:2,url:'https://test.example'}}})[0].referencePrice,null);
});

test('product usage is only derived from cited duration; manual per-use amount overrides counts',()=>{
  const toner=catalog.find(p=>p.jan==='4901301236197');
  assert.equal(toner.referenceUses,180);
  assert.equal(usesOf(toner),180);
  assert.ok(Math.abs(unitPerUse(toner,{},usesOf(toner))-150/180)<1e-9);
  assert.equal(usesOf(toner,{amountPerUse:1.5}),100);
  assert.equal(monthlyCost(toner,{amountPerUse:1.5}),Math.round(priceOf(toner)/100*2*30));
  assert.equal(usesOf(toner,{uses:35}),35);
  const uncited=catalog.find(p=>p.jan==='4901301463890');
  assert.equal(uncited.referenceUses,null);
  assert.equal(usesOf(uncited),uncited.demoUses);
  assert.equal(uncited.usageReference.doseDescription,'直径約3cm');
});

test('unverified per-use amounts use only averages of the same category and unit with at least two samples',()=>{
  const group=catalog.filter(p=>p.category==='toner'&&p.unit==='mL'&&p.referenceUses);
  assert.equal(group.length,11);
  const mean=group.reduce((sum,p)=>sum+p.volume/p.referenceUses,0)/group.length;
  const unknown=catalog.find(p=>p.jan==='4987241155712');
  assert.ok(unknown,'existing hadalabo toner must remain');
  assert.equal(unknown.referenceUses,null);
  assert.equal(unknown.usageEstimate.kind,'categoryAverage');
  assert.equal(unknown.usageEstimate.sampleCount,11);
  assert.ok(Math.abs(usesOf(unknown)-unknown.volume/mean)<1e-9);
  assert.ok(Math.abs(unitPerUse(unknown,{},usesOf(unknown))-mean)<1e-9);
  const single=catalog.find(p=>p.jan==='4987241168583');
  assert.equal(single.usageEstimate.kind,'demo','one reference sample cannot establish a category mean');
  assert.equal(usesOf(single),single.demoUses);
  const amount=unknown.usageEstimate.amountPerUse;
  assert.ok(Math.abs(monthlyCost(unknown)-Math.round(priceOf(unknown)/usesOf(unknown)*unknown.dailyUses*30))<1e-9);
  assert.ok(amount>0.7&&amount<1.1);
});

test('IHADA manufacturer usage periods are consumption estimates, not shelf life',()=>{
  const toner=catalog.find(p=>p.jan==='4909978261238');
  const milk=catalog.find(p=>p.jan==='4909978261306');
  assert.equal(toner.referenceUses,150);
  assert.equal(milk.referenceUses,180);
  assert.ok(Math.abs(unitPerUse(toner,{},usesOf(toner))-1.2)<1e-9);
  assert.ok(Math.abs(unitPerUse(milk,{},usesOf(milk))-0.75)<1e-9);
  assert.equal(toner.usageEstimate.kind,'duration');
  assert.equal(milk.usageEstimate.kind,'duration');
});

test('consumer page never exposes numerical evaluation scores',()=>{
  const html=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  assert.ok(!html.includes('x.score.toFixed'));
  assert.ok(!html.includes('x.scoreDelta.toFixed'));
  assert.ok(!html.includes('安くなるだけの候補は表示しません。'));
  assert.ok(html.includes('条件との相性がより良くなる1品交換'));
  assert.ok(html.includes("'仮推定'"),'short provisional label for consumers');
  assert.ok(!html.includes('根拠未確認の仮推定'));
  assert.ok(html.includes('※「仮推定」の試算方法'),'calculation explained in the footer');
  assert.ok(html.includes('min="1000" max="15000" step="100"'),'budget slider starts at 1000 yen');
  assert.ok(html.includes('<span>1,000円</span>'));
});

test('monthly estimate is rounded and usage-aware',()=>{
  const item={demoPrice:1500,demoUses:100,dailyUses:2};
  assert.equal(monthlyCost(item),900);
  assert.equal(monthlyCost(item,{uses:50}),1800);
});

test('optimizer fits budget and covers mandatory categories',()=>{
  const result=optimize(catalog,{budget:5000,concerns:['pores','dullness'],priority:'simple'});
  assert.ok(result.length>0);
  assert.ok(result[0].monthly<=5000);
  for (const category of ['cleanser','moisturizer']) assert.ok(result[0].products.some(p=>p.category===category));
});

test('lowest selectable 1000-yen budget can return a feasible routine',()=>{
  const results=optimize(catalog,{budget:1000,concerns:['pores'],priority:'any'});
  assert.ok(results.length>0);
  assert.ok(results[0].monthly<=1000);
  assert.deepEqual(['cleanser','moisturizer'].every(category=>results[0].products.some(p=>p.category===category)),true);
});

test('a single spots concern can recommend a complete routine without requiring a matching cleanser or preventive UV category',()=>{
  assert.equal(CONCERNS.spots,'シミ');
  assert.equal(catalog.filter(p=>p.category==='cleanser'&&(p.scores.spots||0)>0).length,0);
  const recommended=optimize(catalog,{budget:5000,concerns:['spots'],priority:'any',resultLimit:1})[0];
  assert.ok(recommended);
  assert.ok(recommended.products.some(p=>p.category==='cleanser'));
  assert.ok(recommended.products.some(p=>p.category==='moisturizer'));
  assert.ok(recommended.products.some(p=>(p.scores.spots||0)>0));
  assert.ok(recommended.products.every(p=>['cleanser','toner','serum','moisturizer'].includes(p.category)));
});

test('exclusions and fixed products are respected',()=>{
  const options={budget:12000,concerns:['pores','dullness'],priority:'balance',excluded:['4901301474407'],locked:{toner:'4901301236197'}};
  const result=optimize(catalog,options);
  assert.ok(result.length>0);
  assert.ok(result.every(r=>r.products.some(p=>p.jan==='4901301236197')));
  assert.ok(result.every(r=>!r.products.some(p=>p.jan==='4901301474407')));
});

test('swap never exceeds enlarged budget and only offers real improvements',()=>{
  const options={budget:5000,concerns:['pores','dullness'],priority:'simple'};
  const result=optimize(catalog,options)[0];
  const category='moisturizer';
  assert.ok(swaps(result,catalog,category,options,100).every(x=>x.scoreDelta>0 && x.monthly<=5100));
});

test('one-item replacement may return nothing when no actual improvement exists',()=>{
  const options={budget:15000,concerns:['pores','dryness'],priority:'thorough'};
  const best=optimize(catalog,{...options,resultLimit:1})[0];
  const alternatives=swaps(best,catalog,'cleanser',options,10000);
  assert.ok(alternatives.every(a=>a.replacement.category==='cleanser'));
  assert.ok(alternatives.every(a=>a.products.filter(p=>p.category==='cleanser').length===1));
  assert.deepEqual(alternatives,[],'a global maximum cannot be improved even with unlimited budget');
  const original=best.products.find(p=>p.category==='cleanser');
  assert.deepEqual(swaps(best,catalog,'cleanser',{...options,locked:{cleanser:original.jan}},10000),[]);
  assert.deepEqual(swaps(best,catalog,'wrong-category',options,10000),[]);
});

test('extra budget lifts the original budget ceiling, even when cost delta is larger than the extra',()=>{
  const mk=(id,category,price,score)=>({jan:id,brand:'TEST',name:id,category,demoPrice:price,demoUses:30,dailyUses:1,
    keyIngredients:[],sourceUrl:'https://example.test/'+id,scores:{pores:score}});
  const fixture=[mk('wash','cleanser',300,1),mk('basic','moisturizer',300,1),mk('upgrade','moisturizer',1900,3)];
  const opts={budget:1200,concerns:['pores'],priority:'any'};
  const best=optimize(fixture,{...opts,resultLimit:1})[0];
  assert.equal(best.monthly,600);
  const noExtra=swaps(best,fixture,'moisturizer',opts,999);
  assert.deepEqual(noExtra,[],'candidate over 2199 must not be presented');
  const upgrades=swaps(best,fixture,'moisturizer',opts,1000);
  assert.equal(upgrades.length,1);
  assert.equal(upgrades[0].replacement.jan,'upgrade');
  assert.equal(upgrades[0].monthly,2200);
  assert.equal(upgrades[0].delta,1600,'delta is not the budget ceiling increase');
  assert.ok(upgrades[0].scoreDelta>0);
  assert.deepEqual(swaps(best,fixture,'moisturizer',{...opts,excluded:['upgrade']},1000),[]);
});

test('real catalog can reveal a strictly better one-item upgrade only after increasing the budget',()=>{
  const options={budget:4000,concerns:['dullness'],priority:'any'};
  const best=optimize(catalog,{...options,resultLimit:1})[0];
  const noIncrease=swaps(best,catalog,'cleanser',options,0);
  assert.deepEqual(noIncrease,[],'within the original ceiling the globally optimal combination cannot improve');
  const moreBudget=swaps(best,catalog,'cleanser',options,2000);
  assert.ok(moreBudget.every(item=>item.scoreDelta>0 && item.monthly<=options.budget+2000));
  assert.ok(moreBudget.every(item=>item.products.filter(p=>p.category==='cleanser').length===1));
});

test('diagnostic retains the over-budget one-item improvement even if cheaper reoptimization is possible',()=>{
  const options={budget:4000,concerns:['dullness'],priority:'any'};
  const baseline=optimize(catalog,{...options,resultLimit:1})[0];
  const d=diagnoseProduct(catalog,options,'4901301463968',baseline);
  assert.ok(['selected','not_selected','budget'].includes(d.status));
  if(d.status==='not_selected'&&d.overbudgetPreview)assert.ok(Number.isFinite(d.overbudgetPreview.score)&&d.overbudgetPreview.monthly>4000);
  if(d.status==='budget')assert.ok(Number.isFinite(d.forced.score));
});

test('no impossible routine returned under zero budget',()=>{
  assert.deepEqual(optimize(catalog,{budget:0}),[]);
});

test('toner is not systematically excluded by the simplicity penalty',()=>{
  const options={budget:4000,concerns:['pores','dullness'],priority:'simple'};
  const recommendation=optimize(catalog,options)[0];
  assert.ok(recommendation.products.some(p=>p.category==='toner'));
  // 手軽さ重視でも、悩みへの追加適合性が勝れば化粧水を採用する。
});

test('expanded concern names are registered without inventing unsupported scores',()=>{
  for(const key of ['oiliness','shine','irritation','wrinkles','freckles','blackheads']) assert.ok(CONCERNS[key]);
  assert.equal(CONCERNS.firmness,'ハリ不足・たるみ');
  assert.equal(CONCERNS.freckles,'そばかす');
  assert.equal(CONCERNS.spots,'シミ');
  assert.deepEqual(unscoredConcerns(catalog,['oiliness','irritation','wrinkles','freckles','blackheads']),[]);
});

test('concern importance strengthens its influence on a routine',()=>{
  const items=catalog.filter(p=>['4901301264336','4901301043764'].includes(p.jan));
  const defaultScore=scoreRoutine(items,{concerns:['oiliness'],priority:'simple'});
  const highScore=scoreRoutine(items,{concerns:['oiliness'],concernWeights:{oiliness:'high'},priority:'simple'});
  const lowScore=scoreRoutine(items,{concerns:['oiliness'],concernWeights:{oiliness:'low'},priority:'simple'});
  assert.ok(highScore>defaultScore && defaultScore>lowScore);
});

test('skin type, sensitivity and finish preferences affect results',()=>{
  const items=catalog.filter(p=>['4901301269348','4901301236197','4901301236173'].includes(p.jan));
  const base=scoreRoutine(items,{concerns:['dryness','irritation'],priority:'simple'});
  const adapted=scoreRoutine(items,{concerns:['dryness','irritation'],priority:'simple',skinType:'dry',sensitiveSkin:true,finish:'moist'});
  assert.ok(adapted>base);
  const top=optimize(catalog,{budget:5000,concerns:['dryness','irritation'],priority:'simple',sensitiveSkin:true,finish:'moist'})[0];
  assert.ok(top.products.some(p=>p.category==='toner'&&p.sensitiveSkin),
    '敏感肌・保湿の希望に合う化粧水の選択肢が増えても、特定の銘柄には固定しない');
});

test('expanded catalog covers the three Kao priority brands without sunscreen',()=>{
  assert.equal(catalog.length,120);
  assert.ok(catalog.every(p=>/^\d{13}$/.test(p.jan) && !Object.hasOwn(p,'id')));
  assert.ok(new Set(catalog.map(p=>p.sourceUrl)).size===catalog.length);
  assert.equal(new Set(catalog.map(p=>p.jan).filter(Boolean)).size,catalog.filter(p=>p.jan).length);
  assert.ok(new Set(catalog.map(p=>p.brand)).size>=8);
  assert.equal(catalog.filter(p=>p.brand==='キュレル').length,27);
  assert.equal(catalog.filter(p=>p.brand==='ビオレ').length,21);
  assert.equal(catalog.filter(p=>p.brand==='ソフィーナ iP').length,8);
  assert.ok(catalog.some(p=>p.jan==='4901301474407'));
  assert.ok(catalog.some(p=>p.jan==='4901301460264'));
  assert.ok(catalog.some(p=>p.jan==='4987241171255'));
  assert.ok(catalog.some(p=>p.brand==='メラノCC'&&p.category==='serum'));
  assert.ok(catalog.some(p=>p.brand==='イハダ'&&p.category==='toner'));
  assert.ok(catalog.some(p=>p.brand==='ミノン アミノモイスト'&&p.category==='cleanser'));
  for(const p of catalog){
    assert.ok(p.sourceUrl.startsWith('https://'),`${p.jan} must link to an official source`);
    assert.ok(['makeupRemover','cleanser','toner','serum','moisturizer','eyeCare'].includes(p.category),p.jan);
    assert.ok(Number.isFinite(p.demoPrice)&&p.demoPrice>=0,p.jan);
    assert.ok(Number.isFinite(p.demoUses)&&p.demoUses>0,p.jan);
    assert.ok(Number.isFinite(p.dailyUses)&&p.dailyUses>=0,p.jan);
    assert.ok(Object.values(p.scores).every(n=>Number.isInteger(n)&&n>=0&&n<=3),p.jan);
  }
});

test('Kao medicinal actives, pore-cleansing and dry fine lines are represented separately',()=>{
  const byJan=id=>catalog.find(p=>p.jan===id);
  assert.deepEqual(transparencyDetails(byJan('4901301264343')).actives,['アラントイン']);
  assert.deepEqual(transparencyDetails(byJan('4901301240309')).actives,['L-アスコルビン酸2-グルコシド']);
  assert.deepEqual(transparencyDetails(byJan('4901301238795')).actives,['カモミラET']);
  assert.deepEqual(transparencyDetails(byJan('4901301416483')).actives,['ナイアシンアミド']);
  assert.deepEqual(transparencyDetails(byJan('4901301422750')).actives,[]);
  assert.equal(byJan('4901301334534').scores.wrinkles??0,0,'乾燥小じわ対策は薬用シワ改善ではない');
  assert.ok(byJan('4901301334534').scores.fineLines>0);
  assert.ok(byJan('4901301463890').scores.blackheads>0);
  assert.equal(byJan('4901301463890').scores.spots??0,0);
  assert.ok(catalog.filter(p=>['キュレル','ビオレ','ソフィーナ iP'].includes(p.brand)).every(p=>transparencyDetails(p).concentrations.length===0),'未公表配合濃度を推定しない');
});

test('fast one-result optimization exactly matches exhaustive ranking across conditions',()=>{
  const cases=[
    {budget:5000,concerns:['pores','dullness'],priority:'simple'},
    {budget:10000,concerns:['wrinkles','fineLines'],priority:'thorough',sensitiveSkin:true},
    {budget:6500,concerns:['oiliness','blackheads'],priority:'simple',skinType:'oily'},
    {budget:8500,concerns:['spots','freckles','dryness'],ingredient:'ナイアシンアミド',ingredientMode:'required'}
  ];
  for(const options of cases){
    const all=optimize(catalog,options);
    const fast=optimize(catalog,{...options,resultLimit:1});
    assert.equal(fast.length,all.length?1:0);
    assert.deepEqual(fast[0]?.products.map(p=>p.jan),all[0]?.products.map(p=>p.jan));
    assert.equal(fast[0]?.monthly,all[0]?.monthly);
    assert.equal(fast[0]?.score,all[0]?.score);
  }
});

test('catalog distinguishes cosmetic and medicinal evidence after removing UV products',()=>{
  for(const p of catalog.filter(p=>p.brand==='ミノン アミノモイスト')){
    assert.deepEqual(transparencyDetails(p).actives,[],`${p.jan} is a cosmetic, not a quasi-drug`);
    assert.deepEqual(transparencyDetails(p).concentrations,[]);
  }
  assert.equal(transparencyDetails(catalog.find(p=>p.jan==='4987241171255')).level,2);
  assert.equal(transparencyDetails(catalog.find(p=>p.jan==='4987241168583')).level,2);
});

test('care style controls optional steps without rewarding price alone',()=>{
  const simple=optimize(catalog,{budget:5000,concerns:['pores','dullness'],priority:'simple'})[0];
  const thorough=optimize(catalog,{budget:5000,concerns:['pores','dullness'],priority:'thorough'})[0];
  assert.ok(thorough.products.filter(p=>['toner','serum'].includes(p.category)).length>=simple.products.filter(p=>['toner','serum'].includes(p.category)).length);
  assert.equal(scoreRoutine(simple.products,{concerns:['pores'],overrides:{'4901301043764':{price:480}}}),
    scoreRoutine(simple.products,{concerns:['pores'],overrides:{'4901301043764':{price:3000}}}));
});

test('saved routines preserve independent prices, frequencies and budget',()=>{
  const routine=optimize(catalog,{budget:5000,concerns:['pores','dullness'],priority:'simple'})[0];
  const sharedOverrides={};
  const plan=createSavedPlan(routine,{budget:5000,concerns:['pores'],priority:'simple',overrides:sharedOverrides},'test-plan','2026-11-06T00:00:00Z');
  assert.deepEqual(plan.productJans,routine.products.map(p=>p.jan));
  assert.equal(plan.budget,5000);
  const before=savedPlanTotals(plan,catalog);
  sharedOverrides[plan.productJans[0]]={price:99999};
  assert.equal(savedPlanTotals(plan,catalog).monthly,before.monthly);
  const id=plan.productJans[0];
  assert.equal(updateSavedUsage(plan,id,'uses',1),true);
  assert.ok(savedPlanTotals(plan,catalog).monthly>before.monthly);
  assert.equal(updateSavedUsage(plan,id,'uses',0),false);
  assert.equal(updateSavedUsage(plan,'missing','price',100),false);
  assert.equal(updateSavedUsage(plan,id,'frequency',0),true);
  assert.equal(monthlyCost(catalog.find(p=>p.jan===id),plan.overrides[id]),0);
});

test('retiring a product clears its active selection and preserves its saved costs',()=>{
  const retiring=catalog.find(p=>p.jan==='4901301474407');
  const keeping=catalog.find(p=>p.jan==='4901301043764');
  const active=[keeping];
  const plan=createSavedPlan({products:[retiring,keeping]},{},'old-plan','2026-11-13T00:00:00Z');
  const previous=savedPlanTotals(plan,[retiring,keeping]);
  const state=reconcileCatalogState({
    locked:{cleanser:retiring.jan,moisturizer:keeping.jan},
    excluded:{[retiring.jan]:'合わない'},
    manual:[retiring.jan,keeping.jan],
    overrides:{[keeping.jan]:{price:600}},
  },active);
  assert.deepEqual(state.locked,{moisturizer:keeping.jan});
  assert.deepEqual(state.excluded,{[retiring.jan]:'合わない'});
  assert.equal(state.manual,null);
  assert.deepEqual(state.overrides,{[keeping.jan]:{price:600}});
  const archived={...retiring,referencePrice:5000};
  const saved=savedPlanTotals(plan,[keeping,archived]);
  assert.deepEqual(saved.missing,[]);
  assert.equal(saved.monthly,previous.monthly);
  assert.equal(saved.initial,previous.initial);
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
  const item=catalog.find(p=>p.jan==='4901301236197');
  const evidence=transparencyDetails(item);
  assert.equal(evidence.level,2);
  assert.deepEqual(evidence.actives,['アラントイン']);
  assert.deepEqual(evidence.concentrations,[]);
  const unchecked=catalog.find(p=>p.jan==='4901301269348');
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
  assert.equal(diagnoseProduct(catalog,options,chosen.jan,best).status,'selected');
  assert.equal(diagnoseProduct(catalog,{...options,excluded:[chosen.jan]},chosen.jan,best).status,'excluded');
  const rival=catalog.find(p=>p.category==='toner'&&p.jan!==chosen.jan);
  assert.equal(diagnoseProduct(catalog,{...options,locked:{toner:chosen.jan}},rival.jan,best).status,'locked');
  assert.equal(diagnoseProduct(catalog,{...options,concerns:[]},chosen.jan,best).status,'no_concern');
});

test('diagnostic reruns a forced candidate, including its whole-routine cost',()=>{
  const options={budget:9000,concerns:['pores','dullness'],priority:'thorough'};
  const best=optimize(catalog,options)[0];
  const challenger=catalog.find(p=>p.category==='toner'&&!best.products.some(x=>x.jan===p.jan));
  assert.ok(challenger);
  const diagnostic=diagnoseProduct(catalog,options,challenger.jan,best);
  assert.equal(diagnostic.status,'not_selected');
  assert.ok(diagnostic.forced.products.some(p=>p.jan===challenger.jan));
  assert.ok(diagnostic.forced.monthly<=options.budget);
  assert.equal(diagnostic.scoreGap,Math.round((best.score-diagnostic.forced.score)*100)/100);
  assert.ok(diagnostic.scoreGap>=0);
});

test('diagnostic distinguishes a budget failure from an ingredient incompatibility',()=>{
  const options={budget:3500,concerns:['dryness'],priority:'simple'};
  const best=optimize(catalog,options)[0];
  assert.ok(best);
  const expensive=catalog.find(p=>p.jan==='4901301460264');
  const diagnosis=diagnoseProduct(catalog,options,expensive.jan,best);
  assert.equal(diagnosis.status,'budget');
  assert.ok(diagnosis.minimum>options.budget);
  assert.equal(diagnosis.comparisonMode,'singleChange');
  assert.ok(Number.isFinite(diagnosis.forced.score),'budget-over candidate is scored');
  assert.ok(diagnosis.forced.monthly>options.budget);
  assert.ok(diagnosis.forced.products.some(p=>p.jan===expensive.jan));
});

test('even when there is no budget-compliant routine, diagnostic can display a scored reference',()=>{
  const mk=(id,category)=>({jan:id,brand:'TEST',name:id,category,demoPrice:300,demoUses:30,dailyUses:1,
    keyIngredients:[],sourceUrl:'https://example.test/'+id,scores:{pores:2}});
  const items=[mk('wash','cleanser'),mk('milk','moisturizer')];
  const options={budget:500,concerns:['pores']};
  assert.deepEqual(optimize(items,{...options,resultLimit:1}),[]);
  const diagnosis=diagnoseProduct(items,options,'milk');
  assert.equal(diagnosis.status,'budget');
  assert.equal(diagnosis.comparisonMode,'unbudgetedExample');
  assert.equal(diagnosis.forced.monthly,600);
  assert.ok(Number.isFinite(diagnosis.forced.score));
});

test('15 new Kao products have matching price sources and face-appropriate categories',()=>{
 assert.equal(catalog.length,120);
 assert.equal(catalog.filter(p=>p.brand==='ビオレ').length,21);
 assert.equal(catalog.filter(p=>p.brand==='ニベア').length,9);
 assert.equal(catalog.filter(p=>p.allInOne).length,2);
 assert.ok(catalog.filter(p=>p.allInOne).every(p=>p.category==='moisturizer'));
 for(const p of catalog){assert.equal(priceDb.prices[p.jan].jan,p.jan);assert.equal(priceOf(p),priceDb.prices[p.jan].priceJPY);}
 assert.deepEqual(catalog.find(p=>p.jan==='4901301408396').evidence.activeIngredients,['イソプロピルメチルフェノール','グリチルリチン酸ジカリウム']);
 assert.equal(catalog.find(p=>p.jan==='4901301451132').evidence.activeIngredients,undefined);
 assert.equal(catalog.find(p=>p.jan==='4901301008497').category,'moisturizer');
});
test('inexpensive cleanser and moisturizer are feasible at the minimum budget',()=>{
 const subset=catalog.filter(p=>['4901301335456','4901301287663','4901301008497'].includes(p.jan));
 const best=optimize(subset,{budget:1000,concerns:['dryness'],priority:'simple',resultLimit:1})[0];
 assert.ok(best&&best.monthly<=1000);
 assert.ok(best.products.some(p=>p.category==='cleanser'));
 assert.ok(best.products.some(p=>p.category==='moisturizer'));
});

test('makeup switch adds one night remover and omits W washing for simple care',()=>{
 const off=optimize(catalog,{budget:3000,concerns:['dryness'],priority:'simple',useMakeupRemover:false,resultLimit:1})[0];
 assert.ok(off?.products.some(p=>p.category==='cleanser'));
 assert.ok(!off.products.some(p=>p.category==='makeupRemover'));
 const on=optimize(catalog,{budget:3000,concerns:['dryness'],priority:'simple',useMakeupRemover:true,resultLimit:1})[0];
 assert.ok(on && on.monthly<=3000);
 assert.equal(on.products.filter(p=>p.category==='makeupRemover').length,1);
 assert.ok(!on.products.some(p=>p.category==='cleanser'));
 assert.ok(on.products.some(p=>p.category==='moisturizer'));
});
test('makeup-removal cost assumes one use per evening; thorough routine permits double cleansing',()=>{
 const p=catalog.find(p=>p.jan==='4901301263049');
 assert.equal(monthlyCost(p),Math.round(priceOf(p)/usesOf(p)*30));
 const r=optimize(catalog,{budget:12000,concerns:['pores','dryness'],priority:'thorough',useMakeupRemover:true,resultLimit:1})[0];
 assert.ok(r && r.products.some(p=>p.category==='makeupRemover'));
});
test('original five makeup removers retain their JAN and no-double-wash status',()=>{
 const ids=['4901301417008','4901301440365','4901301263049','4901301246769','4901301388902'];
 const items=catalog.filter(p=>ids.includes(p.jan));
 assert.equal(items.length,5);
 assert.ok(items.every(p=>p.priceReference?.jan===p.jan && p.doubleCleanseNotNeeded));
 assert.equal(catalog.length,120);
 assert.ok(!catalog.some(p=>p.category==='sunscreen'));
});

test('expanded Kao catalog has 12 correctly identified products with price evidence',()=>{
  const ids=["4901301458964","4901301236203","4901301346995","4901301422095","4901301379924","4901301281715","4901301458957","4901301463937","4901301471338","4901301761385","4901301388063","4901301443182"];
  assert.equal(ids.length,12);
  assert.equal(catalog.length,120);
  for(const id of ids){
    const p=catalog.find(p=>p.jan===id);
    assert.ok(p, 'missing '+id);
    assert.equal(priceDb.prices[id].jan,p.jan);
    assert.equal(priceOf(p),priceDb.prices[id].priceJPY);
    assert.equal(priceDb.prices[id].retailer,'マツキヨココカラオンライン');
    assert.ok(Number.isFinite(monthlyCost(p)) && monthlyCost(p)>0);
    assert.ok(p.evidence.officialSource);
  }
});
test('Curel gel and oil makeup removers require separate cleanser while milk does not',()=>{
  const cases=[
    ['4901301236203',false],
    ['4901301346995',false],
    ['4901301422095',true],
    ['4901301761385',true],
    ['4901301443182',true]
  ];
  for(const [id,notNeeded] of cases){
    const p=catalog.find(x=>x.jan===id);
    assert.equal(p.doubleCleanseNotNeeded,notNeeded);
    const options={budget:15000,concerns:['dryness'],useMakeupRemover:true,priority:'thorough',locked:{makeupRemover:id},resultLimit:1};
    const best=optimize(catalog,options)[0];
    assert.ok(best,'thorough routine should be feasible for '+id);
    if(!notNeeded) assert.ok(best.products.some(x=>x.category==='cleanser'),'must W wash '+id);
  }
});
test('simple makeup care will not propose mandatory-W-wash removers',()=>{
 const options={budget:15000,concerns:['dryness'],priority:'simple',useMakeupRemover:true,resultLimit:1};
 const best=optimize(catalog,options)[0];
 assert.ok(best);
 assert.ok(best.products.some(x=>x.category==='makeupRemover' && x.doubleCleanseNotNeeded));
 assert.ok(!best.products.some(x=>x.category==='cleanser'));
 const forced=optimize(catalog,{...options,locked:{makeupRemover:'4901301346995'}})[0];
 assert.equal(forced,undefined,'required W cleanser is excluded from one-step recommendations');
});
test('swapping a one-step cleanser for a W-required remover cannot drop mandatory washing',()=>{
 const subset=catalog.filter(p=>['4901301346995','4901301422095','4901301269348','4901301236173'].includes(p.jan));
 const opt={budget:10000,concerns:['dryness'],priority:'simple',useMakeupRemover:true,resultLimit:1};
 const baseline=optimize(subset,opt)[0];
 assert.ok(baseline);
 const out=swaps(baseline,subset,'makeupRemover',opt,10000);
 assert.ok(!out.some(c=>c.replacement.jan==='4901301346995'));
});

test('regular Biore Black Gel uses JAN-matched Tsuruha quote and needs no W wash',()=>{
  const p=catalog.find(p=>p.jan==='4901301416919');
  assert.ok(p);
  assert.equal(p.jan,'4901301416919');
  assert.equal(p.priceReference.jan,p.jan);
  assert.equal(p.priceReference.priceJPY,1098);
  assert.equal(p.priceReference.retailer,'ツルハグループe-shop');
  assert.equal(p.priceReference.url,'https://shop.tsuruha.co.jp/10162529.html');
  assert.equal(p.doubleCleanseNotNeeded,true);
});

test('new eye concerns appear independently and unscored dark circles warn',()=>{
 assert.equal(CONCERNS.eyeDryness,'目元の乾燥');
 assert.equal(CONCERNS.darkCircles,'クマ');
 assert.ok(unscoredConcerns(catalog,['darkCircles']).includes('darkCircles'));
 assert.ok(!unscoredConcerns(catalog,['eyeDryness']).includes('eyeDryness'));
});
test('eye care appears only for eye dryness and cannot replace whole-face moisturizer',()=>{
 const usual=optimize(catalog,{budget:10000,concerns:['dryness'],priority:'thorough',resultLimit:1})[0];
 assert.ok(usual && !usual.products.some(p=>p.category==='eyeCare'));
 const eye=optimize(catalog,{budget:10000,concerns:['eyeDryness'],priority:'thorough',resultLimit:1})[0];
 assert.ok(eye && eye.products.some(p=>p.jan==='4901301382528'));
 assert.ok(eye.products.some(p=>p.category==='moisturizer'));
 assert.ok(eye.products.some(p=>p.category==='cleanser'));
 assert.ok(eye.monthly<=10000);
});
test('eye cream has source-verified JAN price and is optional at low budget',()=>{
 const p=catalog.find(p=>p.jan==='4901301382528');
 assert.equal(p.jan,'4901301382528');
 assert.equal(p.priceReference.jan,p.jan);
 assert.equal(p.priceReference.priceJPY,3080);
 assert.equal(monthlyCost(p),Math.round(3080/usesOf(p)*2*30));
 const low=optimize(catalog,{budget:1000,concerns:['eyeDryness'],priority:'simple',resultLimit:1})[0];
 assert.ok(low && low.monthly<=1000);
 assert.ok(!low.products.some(p=>p.category==='eyeCare'));
});

test('SOFINA BASIC plus uses JAN-verified full-size products and maker usage duration',()=>{
 const found=catalog.filter(p=>p.brand==='SOFINA BASIC＋');
 assert.equal(found.length,2);
 assert.deepEqual(found.map(p=>p.category).sort(),['moisturizer','toner']);
 assert.ok(found.every(p=>p.scores.dryness===3 && !(p.scores.spots||0) && !(p.scores.wrinkles||0)));
 assert.ok(found.every(p=>p.referenceUses===180&&p.usageEstimate.kind==='duration'));
 assert.ok(found.every(p=>p.priceReference?.jan===p.jan));
 const t=found.find(p=>p.category==='toner'),m=found.find(p=>p.category==='moisturizer');
 assert.equal(t.jan,'4901301466648');
 assert.equal(m.jan,'4901301466679');
 assert.equal(priceOf(t),1430);
 assert.equal(priceOf(m),1650);
 assert.equal(monthlyCost(t),477);
 assert.equal(monthlyCost(m),550);
});
test('SOFINA BASIC plus products can be recommended with a separate mandatory cleanser',()=>{
 const subset=catalog.filter(p=>['4901301335456','4901301466648','4901301466679'].includes(p.jan));
 const best=optimize(subset,{budget:2000,concerns:['dryness'],priority:'thorough',resultLimit:1})[0];
 assert.ok(best&&best.monthly<=2000);
 assert.ok(best.products.some(p=>p.category==='cleanser'));
 assert.ok(best.products.some(p=>p.category==='moisturizer'));
 assert.ok(best.products.some(p=>p.brand==='SOFINA BASIC＋'));
});

test('Kanebo cosmetics products from suisai and DEW have unique JAN and quoted price',()=>{
 const k=catalog.filter(p=>p.manufacturer==='カネボウ化粧品');
 assert.equal(k.length,39);
 assert.equal(k.filter(p=>p.brand==='suisai').length,10);
 assert.equal(k.filter(p=>p.brand==='DEW').length,29);
 assert.ok(k.every(p=>p.priceReference?.jan===p.jan && ['マツキヨココカラオンライン','ツルハグループe-shop'].includes(p.priceReference.retailer)));
 assert.ok(k.every(p=>p.sourceUrl.startsWith('https://www.kao-kirei.com/ja/item/kbb/')));
 assert.ok(k.every(p=>p.evidence.officialSource));
 assert.ok(k.every(p=>!('sunscreen'===p.category)));
});
test('unit-dose suisai powder has manufacturer-counted 32 uses without contaminating generic cleanser consumption',()=>{
 const x=catalog.find(p=>p.jan==='4973167823859');
 assert.equal(x.referenceUses,32);
 assert.equal(x.usageEstimate.kind,'packageCount');
 assert.equal(x.usageReference.verifiedUses,32);
 assert.equal(monthlyCost(x),Math.round(2090/32*30));
 const other=catalog.find(p=>p.jan==='4901301335456');
 const estimateBefore=mergeCatalogData([other],{prices:{[other.jan]:priceDb.prices[other.jan]}},{usages:{}})[0];
 assert.ok(!x.usageEstimate?.amountPerUse);
 assert.ok(other.usageEstimate?.kind!=='packageCount');
 assert.equal(estimateBefore.referenceUses,null);
 assert.ok(catalog.filter(p=>p.brand==='suisai'&&p.name.includes('パウダーウォッシュ')&& !p.name.includes('ピーリング')).every(p=>p.referenceUses===32));
});
test('DEW medicinal product claims separate preventive spots, texture and dry fine-lines',()=>{
 const bright=catalog.find(p=>p.jan==='4973167553046');
 assert.ok(bright.evidence.activeIngredients.includes('L-アスコルビン酸 2-グルコシド'));
 assert.equal(bright.scores.spots,3);
 const milk=catalog.find(p=>p.jan==='4973167019108');
 assert.ok(milk.evidence.activeIngredients.includes('カモミラET'));
 assert.equal(milk.scores.spots,3);
 const regular=catalog.find(p=>p.jan==='4973167251911');
 assert.equal(regular.scores.spots||0,0);
 const emulsion=catalog.find(p=>p.jan==='4973167252512');
 assert.ok(emulsion.scores.fineLines>0);
 assert.equal(emulsion.scores.wrinkles||0,0);
});
test('Kanebo products are usable in feasible scored routines while 1000 yen budget remains feasible',()=>{
 const low=optimize(catalog,{budget:1000,concerns:['dryness'],priority:'simple',resultLimit:1})[0];
 assert.ok(low&&low.monthly<=1000);
 const bright=optimize(catalog,{budget:10000,concerns:['spots','freckles'],priority:'thorough',resultLimit:1})[0];
 assert.ok(bright&&bright.monthly<=10000);
 assert.ok(bright.products.some(p=>p.category==='cleanser'));
 assert.ok(bright.products.some(p=>p.category==='moisturizer'));
});

test('eleven more Kanebo products have distinct JAN and Matsukiyo reference prices',()=>{
 const ids=["4973167531198","4973167024485","4973167251607","4973167251584","4973167251614","4973167251720","4973167376164","4973167040980","4973167550601","4973167022726","4973167864920"];
 assert.equal(ids.length,11);
 assert.equal(catalog.length,120);
 const items=catalog.filter(p=>ids.includes(p.jan));
 assert.equal(items.length,11);
 assert.ok(items.every(p=>p.priceReference?.jan===p.jan));
 assert.ok(items.every(p=>p.priceReference?.retailer==='マツキヨココカラオンライン'));
 assert.ok(items.every(p=>p.manufacturer==='カネボウ化粧品'));
 assert.equal(new Set(catalog.map(p=>p.jan)).size,catalog.length);
});
test('DEW cleansing products are only proposed with face wash and not one-step simple makeup care',()=>{
 for(const id of ['4973167251607','4973167251584']){
  const p=catalog.find(p=>p.jan===id);
  assert.equal(p.doubleCleanseNotNeeded,false);
  const simple=optimize(catalog,{budget:15000,concerns:['dryness'],useMakeupRemover:true,priority:'simple',locked:{makeupRemover:id},resultLimit:1})[0];
  assert.equal(simple,undefined);
  const thorough=optimize(catalog,{budget:15000,concerns:['dryness'],useMakeupRemover:true,priority:'thorough',locked:{makeupRemover:id},resultLimit:1})[0];
  assert.ok(thorough && thorough.products.some(p=>p.category==='cleanser'));
 }
});
test('preventive whitening and actual wrinkle improvement are kept separate',()=>{
 const c=catalog.find(p=>p.jan==='4973167376164');
 assert.equal(c.scores.wrinkles||0,0);
 assert.equal(c.scores.fineLines,2);
 assert.deepEqual(c.evidence.activeIngredients,['カモミラET']);
 const w=catalog.find(p=>p.jan==='4973167040980');
 assert.equal(w.scores.wrinkles,3);
 assert.ok(w.evidence.activeIngredients.includes('ナイアシンアミド'));
 const wrinkle=catalog.find(p=>p.jan==='4973167864920');
 assert.equal(wrinkle.category,'serum');
 assert.equal(wrinkle.scores.wrinkles,3);
});
test('refining toner is identified as wipe-off rather than normal hydrating toner',()=>{
 const p=catalog.find(p=>p.jan==='4973167024485');
 assert.equal(p.category,'toner');
 assert.equal(p.wipeOff,true);
 assert.ok(p.explanation.includes('保湿化粧水とは用途が異なり'));
 assert.equal(p.scores.dryness||0,0);
});
test('new 108-product catalog retains a feasible 1000 yen routine',()=>{
 const p=optimize(catalog,{budget:1000,concerns:['dryness'],priority:'simple',resultLimit:1})[0];
 assert.ok(p && p.monthly<=1000);
 assert.ok(p.products.some(x=>x.category==='cleanser'));
 assert.ok(p.products.some(x=>x.category==='moisturizer'));
});

test('new DEW texture variants and suisai balm are JAN matched and have distinct retailer provenance',()=>{
 const ids=["4973167251645","4973167251935","4973167251683","4973167252529","4973167382264","4973167383438","4973167552995"];
 assert.equal(ids.length,7);
 const p=catalog.filter(x=>ids.includes(x.jan));
 assert.equal(p.length,7);
 assert.ok(p.every(x=>x.manufacturer==='カネボウ化粧品' && x.priceReference?.jan===x.jan));
 assert.equal(p.filter(x=>x.priceReference.retailer==='マツキヨココカラオンライン').length,6);
 assert.equal(p.filter(x=>x.priceReference.retailer==='ツルハグループe-shop').length,1);
 const balm=p.find(x=>x.jan==='4973167552995');
 assert.equal(priceOf(balm),2750);
 assert.equal(balm.doubleCleanseNotNeeded,false);
});
test('DEW preventive whitening differs from dry fine-lines, and no old type has been lost',()=>{
 const lotion=catalog.find(x=>x.jan==='4973167251935');
 assert.equal(priceOf(lotion),3850);
 assert.equal(lotion.feel,'rich');
 const med=catalog.find(x=>x.jan==='4973167382264');
 assert.ok(med.evidence.activeIngredients.includes('L-アスコルビン酸 2-グルコシド'));
 assert.equal(med.scores.spots,3);
 const normal=catalog.find(x=>x.jan==='4973167252529');
 assert.equal(normal.scores.wrinkles||0,0);
 assert.ok(normal.scores.fineLines>0);
 const light=catalog.find(x=>x.jan==='4973167383438');
 assert.deepEqual(light.evidence.activeIngredients,['カモミラET']);
 assert.ok(catalog.some(x=>x.jan==='4973167252512'));
});
test('suisai balm W wash status cannot be forced in simple one-step cleansing',()=>{
 const base={budget:15000,concerns:['dryness'],priority:'simple',useMakeupRemover:true,locked:{makeupRemover:'4973167552995'},resultLimit:1};
 assert.equal(optimize(catalog,base)[0],undefined);
 const thorough=optimize(catalog,{...base,priority:'thorough'})[0];
 assert.ok(thorough && thorough.products.some(x=>x.category==='cleanser'));
});
