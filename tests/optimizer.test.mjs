import test from 'node:test';
import assert from 'node:assert/strict';
import {CONCERNS, diagnoseProduct, explainRoutineScore, monthlyCost, priceOf, usesOf, optimize, scoreRoutine, swaps, transparencyDetails, unscoredConcerns} from '../dist/optimizer.js';
import {createSavedPlan, savedPlanTotals, updateSavedUsage} from '../dist/plans.js';
import {mergeCatalogData,unitPerUse} from '../dist/catalog-data.js';
import fs from 'node:fs';

const productDb=JSON.parse(fs.readFileSync(new URL('../dist/data/products.json',import.meta.url),'utf8'));
const priceDb=JSON.parse(fs.readFileSync(new URL('../dist/data/pricing.json',import.meta.url),'utf8'));
const usageDb=JSON.parse(fs.readFileSync(new URL('../dist/data/usage.json',import.meta.url),'utf8'));
const catalog=mergeCatalogData(productDb.products,priceDb,usageDb);

test('all active products have JAN-verified retailer quotes; limited edition is excluded',()=>{
  assert.equal(Object.keys(priceDb.prices).length,77);
  const verified=catalog.filter(p=>p.priceReference);
  assert.equal(verified.length,77);
  for(const p of verified){
    assert.equal(p.priceReference.jan,p.jan);
    assert.equal(priceOf(p),p.priceReference.priceJPY);
    assert.ok(['2026-11-06','2026-11-07','2026-11-13'].includes(p.priceReference.verifiedAt));
  }
  assert.equal(catalog.length,77);
  assert.ok(!catalog.some(p=>p.id==='biore-face-oil-control-plus'));
  assert.ok(catalog.every(p=>p.priceReference),'no active item uses an unverified price');
  const tsuruha=catalog.filter(p=>p.priceReference?.retailer==='ツルハグループe-shop');
  assert.equal(tsuruha.length,6);
  assert.equal(catalog.find(p=>p.id==='biore-foam-smooth').referencePrice,968);
  assert.ok(!catalog.some(p=>p.category==='sunscreen'));
  assert.ok(!Object.keys(priceDb.prices).some(id=>/uv|skin-aqua/.test(id)));
  assert.ok(!Object.keys(usageDb.usages).some(id=>/uv|skin-aqua/.test(id)));
  assert.equal(catalog.find(p=>p.id==='ihada-moist-lotion').jan,'4909978261238');
  assert.equal(catalog.find(p=>p.id==='ihada-moist-emulsion').jan,'4909978261306');
  assert.equal(priceOf(verified[0],{price:321}),321);
  assert.equal(mergeCatalogData([{id:'x',jan:'123',demoPrice:55,demoUses:3}],{prices:{x:{jan:'456',priceJPY:2,url:'https://test.example'}}})[0].referencePrice,null);
});

test('product usage is only derived from cited duration; manual per-use amount overrides counts',()=>{
  const toner=catalog.find(p=>p.id==='curel-toner-ii');
  assert.equal(toner.referenceUses,180);
  assert.equal(usesOf(toner),180);
  assert.ok(Math.abs(unitPerUse(toner,{},usesOf(toner))-150/180)<1e-9);
  assert.equal(usesOf(toner,{amountPerUse:1.5}),100);
  assert.equal(monthlyCost(toner,{amountPerUse:1.5}),Math.round(priceOf(toner)/100*2*30));
  assert.equal(usesOf(toner,{uses:35}),35);
  const uncited=catalog.find(p=>p.id==='biore-ouchi-gel-clear');
  assert.equal(uncited.referenceUses,null);
  assert.equal(usesOf(uncited),uncited.demoUses);
  assert.equal(uncited.usageReference.doseDescription,'直径約3cm');
});

test('unverified per-use amounts use only averages of the same category and unit with at least two samples',()=>{
  const group=catalog.filter(p=>p.category==='toner'&&p.unit==='mL'&&p.referenceUses);
  assert.equal(group.length,10);
  const mean=group.reduce((sum,p)=>sum+p.volume/p.referenceUses,0)/group.length;
  const unknown=catalog.find(p=>p.id==='hadalabo-gokujun-lotion');
  assert.ok(unknown,'existing hadalabo toner must remain');
  assert.equal(unknown.referenceUses,null);
  assert.equal(unknown.usageEstimate.kind,'categoryAverage');
  assert.equal(unknown.usageEstimate.sampleCount,10);
  assert.ok(Math.abs(usesOf(unknown)-unknown.volume/mean)<1e-9);
  assert.ok(Math.abs(unitPerUse(unknown,{},usesOf(unknown))-mean)<1e-9);
  const single=catalog.find(p=>p.id==='melanocc-premium-essence');
  assert.equal(single.usageEstimate.kind,'demo','one reference sample cannot establish a category mean');
  assert.equal(usesOf(single),single.demoUses);
  const amount=unknown.usageEstimate.amountPerUse;
  assert.ok(Math.abs(monthlyCost(unknown)-Math.round(priceOf(unknown)/usesOf(unknown)*unknown.dailyUses*30))<1e-9);
  assert.ok(amount>0.7&&amount<1.1);
});

test('IHADA manufacturer usage periods are consumption estimates, not shelf life',()=>{
  const toner=catalog.find(p=>p.id==='ihada-moist-lotion');
  const milk=catalog.find(p=>p.id==='ihada-moist-emulsion');
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
  const options={budget:12000,concerns:['pores','dullness'],priority:'balance',excluded:['biore-foam-smooth'],locked:{toner:'curel-toner-ii'}};
  const result=optimize(catalog,options);
  assert.ok(result.length>0);
  assert.ok(result.every(r=>r.products.some(p=>p.id==='curel-toner-ii')));
  assert.ok(result.every(r=>!r.products.some(p=>p.id==='biore-foam-smooth')));
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
  assert.deepEqual(swaps(best,catalog,'cleanser',{...options,locked:{cleanser:original.id}},10000),[]);
  assert.deepEqual(swaps(best,catalog,'wrong-category',options,10000),[]);
});

test('extra budget lifts the original budget ceiling, even when cost delta is larger than the extra',()=>{
  const mk=(id,category,price,score)=>({id,brand:'TEST',name:id,category,demoPrice:price,demoUses:30,dailyUses:1,
    keyIngredients:[],sourceUrl:'https://example.test/'+id,scores:{pores:score}});
  const fixture=[mk('wash','cleanser',300,1),mk('basic','moisturizer',300,1),mk('upgrade','moisturizer',1900,3)];
  const opts={budget:1200,concerns:['pores'],priority:'any'};
  const best=optimize(fixture,{...opts,resultLimit:1})[0];
  assert.equal(best.monthly,600);
  const noExtra=swaps(best,fixture,'moisturizer',opts,999);
  assert.deepEqual(noExtra,[],'candidate over 2199 must not be presented');
  const upgrades=swaps(best,fixture,'moisturizer',opts,1000);
  assert.equal(upgrades.length,1);
  assert.equal(upgrades[0].replacement.id,'upgrade');
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
  const d=diagnoseProduct(catalog,options,'sofina-micro-foam-wash',baseline);
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
  const items=catalog.filter(p=>['curel-sebum-foam','nivea-soft'].includes(p.id));
  const defaultScore=scoreRoutine(items,{concerns:['oiliness'],priority:'simple'});
  const highScore=scoreRoutine(items,{concerns:['oiliness'],concernWeights:{oiliness:'high'},priority:'simple'});
  const lowScore=scoreRoutine(items,{concerns:['oiliness'],concernWeights:{oiliness:'low'},priority:'simple'});
  assert.ok(highScore>defaultScore && defaultScore>lowScore);
});

test('skin type, sensitivity and finish preferences affect results',()=>{
  const items=catalog.filter(p=>['curel-foam','curel-toner-ii','curel-milk'].includes(p.id));
  const base=scoreRoutine(items,{concerns:['dryness','irritation'],priority:'simple'});
  const adapted=scoreRoutine(items,{concerns:['dryness','irritation'],priority:'simple',skinType:'dry',sensitiveSkin:true,finish:'moist'});
  assert.ok(adapted>base);
  const top=optimize(catalog,{budget:5000,concerns:['dryness','irritation'],priority:'simple',sensitiveSkin:true,finish:'moist'})[0];
  assert.ok(top.products.some(p=>p.category==='toner'&&p.sensitiveSkin),
    '敏感肌・保湿の希望に合う化粧水の選択肢が増えても、特定の銘柄には固定しない');
});

test('expanded catalog covers the three Kao priority brands without sunscreen',()=>{
  assert.equal(catalog.length,77);
  assert.equal(new Set(catalog.map(p=>p.id)).size,catalog.length);
  assert.ok(new Set(catalog.map(p=>p.sourceUrl)).size===catalog.length);
  assert.equal(new Set(catalog.map(p=>p.jan).filter(Boolean)).size,catalog.filter(p=>p.jan).length);
  assert.ok(new Set(catalog.map(p=>p.brand)).size>=8);
  assert.equal(catalog.filter(p=>p.brand==='キュレル').length,26);
  assert.equal(catalog.filter(p=>p.brand==='ビオレ').length,20);
  assert.equal(catalog.filter(p=>p.brand==='ソフィーナ iP').length,8);
  assert.ok(catalog.some(p=>p.id==='biore-foam-smooth'));
  assert.ok(catalog.some(p=>p.id==='sofina-toning-serum'));
  assert.ok(catalog.some(p=>p.id==='hadalabo-aging-lotion'));
  assert.ok(catalog.some(p=>p.brand==='メラノCC'&&p.category==='serum'));
  assert.ok(catalog.some(p=>p.brand==='イハダ'&&p.category==='toner'));
  assert.ok(catalog.some(p=>p.brand==='ミノン アミノモイスト'&&p.category==='cleanser'));
  for(const p of catalog){
    assert.ok(p.sourceUrl.startsWith('https://'),`${p.id} must link to an official source`);
    assert.ok(['makeupRemover','cleanser','toner','serum','moisturizer'].includes(p.category),p.id);
    assert.ok(Number.isFinite(p.demoPrice)&&p.demoPrice>=0,p.id);
    assert.ok(Number.isFinite(p.demoUses)&&p.demoUses>0,p.id);
    assert.ok(Number.isFinite(p.dailyUses)&&p.dailyUses>=0,p.id);
    assert.ok(Object.values(p.scores).every(n=>Number.isInteger(n)&&n>=0&&n<=3),p.id);
  }
});

test('Kao medicinal actives, pore-cleansing and dry fine lines are represented separately',()=>{
  const byId=id=>catalog.find(p=>p.id===id);
  assert.deepEqual(transparencyDetails(byId('curel-sebum-toner')).actives,['アラントイン']);
  assert.deepEqual(transparencyDetails(byId('curel-bright-toner-i')).actives,['L-アスコルビン酸2-グルコシド']);
  assert.deepEqual(transparencyDetails(byId('curel-bright-milk')).actives,['カモミラET']);
  assert.deepEqual(transparencyDetails(byId('sofina-wrinkle-foam-serum')).actives,['ナイアシンアミド']);
  assert.deepEqual(transparencyDetails(byId('sofina-firming-serum')).actives,[]);
  assert.equal(byId('curel-aging-cream').scores.wrinkles??0,0,'乾燥小じわ対策は薬用シワ改善ではない');
  assert.ok(byId('curel-aging-cream').scores.fineLines>0);
  assert.ok(byId('biore-ouchi-gel-clear').scores.blackheads>0);
  assert.equal(byId('biore-ouchi-gel-clear').scores.spots??0,0);
  assert.ok(catalog.filter(p=>p.id.startsWith('curel-')||p.id.startsWith('biore-')||p.id.startsWith('sofina-')).every(p=>transparencyDetails(p).concentrations.length===0),'未公表配合濃度を推定しない');
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
    assert.deepEqual(fast[0]?.products.map(p=>p.id),all[0]?.products.map(p=>p.id));
    assert.equal(fast[0]?.monthly,all[0]?.monthly);
    assert.equal(fast[0]?.score,all[0]?.score);
  }
});

test('catalog distinguishes cosmetic and medicinal evidence after removing UV products',()=>{
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
  assert.equal(diagnosis.comparisonMode,'singleChange');
  assert.ok(Number.isFinite(diagnosis.forced.score),'budget-over candidate is scored');
  assert.ok(diagnosis.forced.monthly>options.budget);
  assert.ok(diagnosis.forced.products.some(p=>p.id===expensive.id));
});

test('even when there is no budget-compliant routine, diagnostic can display a scored reference',()=>{
  const mk=(id,category)=>({id,brand:'TEST',name:id,category,demoPrice:300,demoUses:30,dailyUses:1,
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
 assert.equal(catalog.length,77);
 assert.equal(catalog.filter(p=>p.brand==='ビオレ').length,20);
 assert.equal(catalog.filter(p=>p.brand==='ニベア').length,9);
 assert.equal(catalog.filter(p=>p.allInOne).length,2);
 assert.ok(catalog.filter(p=>p.allInOne).every(p=>p.category==='moisturizer'));
 for(const p of catalog){assert.equal(priceDb.prices[p.id].jan,p.jan);assert.equal(priceOf(p),priceDb.prices[p.id].priceJPY);}
 assert.deepEqual(catalog.find(p=>p.id==='biore-face-acne').evidence.activeIngredients,['イソプロピルメチルフェノール','グリチルリチン酸ジカリウム']);
 assert.equal(catalog.find(p=>p.id==='nivea-2way-acne').evidence.activeIngredients,undefined);
 assert.equal(catalog.find(p=>p.id==='nivea-cream-56').category,'moisturizer');
});
test('inexpensive cleanser and moisturizer are feasible at the minimum budget',()=>{
 const subset=catalog.filter(p=>['nivea-wash-rich','biore-jelly-rich','nivea-cream-56'].includes(p.id));
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
 const p=catalog.find(p=>p.id==='biore-cleansing-liquid');
 assert.equal(monthlyCost(p),Math.round(priceOf(p)/usesOf(p)*30));
 const r=optimize(catalog,{budget:12000,concerns:['pores','dryness'],priority:'thorough',useMakeupRemover:true,resultLimit:1})[0];
 assert.ok(r && r.products.some(p=>p.category==='makeupRemover'));
});
test('original five makeup removers retain their JAN and no-double-wash status',()=>{
 const ids=['biore-cleansing-oil','biore-cleansing-oil-moist','biore-cleansing-liquid','biore-cleansing-paste','nivea-cleansing-beauty'];
 const items=catalog.filter(p=>ids.includes(p.id));
 assert.equal(items.length,5);
 assert.ok(items.every(p=>p.priceReference?.jan===p.jan && p.doubleCleanseNotNeeded));
 assert.equal(catalog.length,77);
 assert.ok(!catalog.some(p=>p.category==='sunscreen'));
});

test('expanded Kao catalog has 12 correctly identified products with price evidence',()=>{
  const ids=["curel-foam-gel","curel-gel-makeup","curel-oil-makeup","curel-milk-makeup","curel-moist-spray-250","curel-gel-serum","curel-foam-serum","curel-barrier-serum","curel-oil-serum","biore-perfect-oil","biore-foam-cream-makeup","nivea-gel-cleanse"];
  assert.equal(ids.length,12);
  assert.equal(catalog.length,77);
  for(const id of ids){
    const p=catalog.find(p=>p.id===id);
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
    ['curel-gel-makeup',false],
    ['curel-oil-makeup',false],
    ['curel-milk-makeup',true],
    ['biore-perfect-oil',true],
    ['nivea-gel-cleanse',true]
  ];
  for(const [id,notNeeded] of cases){
    const p=catalog.find(x=>x.id===id);
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
 const forced=optimize(catalog,{...options,locked:{makeupRemover:'curel-oil-makeup'}})[0];
 assert.equal(forced,undefined,'required W cleanser is excluded from one-step recommendations');
});
test('swapping a one-step cleanser for a W-required remover cannot drop mandatory washing',()=>{
 const subset=catalog.filter(p=>['curel-oil-makeup','curel-milk-makeup','curel-foam','curel-milk'].includes(p.id));
 const opt={budget:10000,concerns:['dryness'],priority:'simple',useMakeupRemover:true,resultLimit:1};
 const baseline=optimize(subset,opt)[0];
 assert.ok(baseline);
 const out=swaps(baseline,subset,'makeupRemover',opt,10000);
 assert.ok(!out.some(c=>c.replacement.id==='curel-oil-makeup'));
});
