import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadCatalog} from '../dist/catalog-csv.js';
import {createSavedPlan, savedPlanTotals} from '../dist/plans.js';
import {mergeCatalogData} from '../dist/catalog-data.js';
import {monthlyCost, optimize, usesOf} from '../dist/optimizer.js';

const settingsKey = 'skincare-lab-settings-jan';
const plansKey = 'skincare-lab-saved-routines-jan';
const read = url => readFile(url, 'utf8');
const {products, pricing, usage} = await loadCatalog(read);
const catalog = mergeCatalogData(products, pricing, usage);

test('background selection renders controls first and rejects results from superseded conditions', async () => {
  const original=globalThis.Worker,workers=[];
  class PendingWorker {
    constructor(url,options){assert.match(String(url),/routine-worker\.js\?v=/);assert.equal(options.type,'module');workers.push(this);}
    postMessage(request){this.request=request;}
    terminate(){this.terminated=true;}
  }
  globalThis.Worker=PendingWorker;
  try {
    const settings={budget:5000,concerns:['pores','dullness'],priority:'simple'};
    const {app,change}=await openApp('background-selection',{[settingsKey]:settings});
    assert.match(app.markup,/選定条件/);assert.match(app.markup,/組み合わせを計算中/);assert.match(app.markup,/成分の解説/);
    const beforeProgress=app.markup;
    workers[0].onmessage({data:{progress:{phase:'recommendation',title:'提案の探索',stage:'search',percent:25,current:'組み合わせの採点',evaluated:'1',skipped:'3',completed:'4',total:'16'}}});
    assert.equal(app.markup,beforeProgress,'progress must not replace the condition controls');
    assert.match(document.getElementById('recommendation-progress').innerHTML,/25%/);
    assert.match(document.getElementById('recommendation-progress').innerHTML,/組み合わせの採点/);
    assert.match(app.markup,/class="progress-screen"/);
    const first=workers[0];change({dataset:{field:'budget'},value:'6000'});
    assert(first.terminated);assert.equal(workers.length,2);
    first.onmessage({data:{routine:null,minimumMonthly:12345}});
    assert.match(app.markup,/組み合わせを計算中/);assert.doesNotMatch(app.markup,/12,345円/);
    const second=workers[1],routine=optimize(catalog,{...second.request.options,resultLimit:1})[0];
    second.onmessage({data:{routine,minimumMonthly:null}});
    assert(second.terminated);assert.equal(workers.length,2);assert.match(app.markup,/class="panel recommendation"/);assert.doesNotMatch(app.markup,/組み合わせを計算中/);
    change({dataset:{field:'budget'},value:'300'});
    workers[2].onmessage({data:{routine:null,minimumMonthly:371}});
    assert.match(app.markup,/月額371円/);assert.doesNotMatch(app.markup,/組み合わせを計算中/);
  } finally {
    for(const worker of workers)if(!worker.terminated)worker.onerror?.();
    if(original===undefined)delete globalThis.Worker;else globalThis.Worker=original;
  }
});

test('ingredient choices use Japanese reading order while preserving guide destinations',async()=>{
  const {app}=await openApp('ingredient-reading-order',{[settingsKey]:{ingredient:'ナイアシンアミド'}});
  const select=app.markup.match(/<select[^>]*id="ingredient"[\s\S]*?<\/select>/)[0];
  assert.deepEqual([...select.matchAll(/<option value="([^"]+)"/g)].map(match=>match[1]),['none','アラントイン','グリチルリチン酸ジカリウム','セラミド機能成分','ナイアシンアミド','ヒアルロン酸Na']);
  assert.match(app.markup,/ingredients\.html#niacinamide/);
  const guide=await readFile(new URL('../dist/ingredients.html',import.meta.url),'utf8');
  assert.deepEqual([...guide.matchAll(/<article class="panel ingredient-card" id="([^"]+)"/g)].map(match=>match[1]),['allantoin','glycyrrhizate','ceramide','niacinamide','hyaluronate']);
});

test('background selection failure offers retry without deleting saved plans', async () => {
  const original=globalThis.Worker,workers=[];
  class PendingWorker{constructor(){workers.push(this);}postMessage(){}terminate(){this.terminated=true;}}
  globalThis.Worker=PendingWorker;
  try {
    const storedPlan={id:'retained-plan',name:'保持する組み合わせ',productJans:[catalog.find(p=>p.category==='cleanser').jan,catalog.find(p=>p.category==='moisturizer').jan]};
    const {app,click,saved}=await openApp('background-failure',{[settingsKey]:{concerns:['pores']},[plansKey]:[storedPlan]});
    workers[0].onerror();assert.match(app.markup,/計算を完了できませんでした/);assert.match(app.markup,/もう一度計算する/);assert.deepEqual(saved(plansKey),[storedPlan]);
    click('retryRecommendation');assert.equal(workers.length,2);assert.match(app.markup,/組み合わせを計算中/);assert.deepEqual(saved(plansKey),[storedPlan]);
    workers[1].onerror();
  } finally {
    for(const worker of workers)if(!worker.terminated)worker.onerror?.();
    if(original===undefined)delete globalThis.Worker;else globalThis.Worker=original;
  }
});

async function openApp(name, savedState) {
  const handlers = new Map();
  const storage = new Map(Object.entries(savedState).map(([key, value]) => [key, JSON.stringify(value)]));
  let finishRender;
  const rendered = new Promise(resolve => { finishRender = resolve; });
  const app = {
    markup: '',
    set innerHTML(markup) { this.markup = markup; finishRender(); },
    addEventListener(type, handler) { handlers.set(type, handler); }
  };
  const stub = {addEventListener() {}};
  globalThis.document = {getElementById: id => id === 'app' ? app : stub};
  globalThis.window = stub;
  globalThis.localStorage = {
    getItem: key => storage.get(key),
    setItem: (key, value) => storage.set(key, value)
  };
  globalThis.fetch = async url => new Response(await read(url));
  await import(`../dist/app.js?${name}`);
  await rendered;
  assert.match(app.markup, /PROTOTYPE/);
  return {
    app,
    saved: key => JSON.parse(storage.get(key)),
    change: target => handlers.get('change')({target}),
    click: (action, id, button={dataset: {action, id}}) => handlers.get('click')({target: {closest: () => button}})
  };
}

test('saved edits select the plan ID and update totals without replacing the inputs', {timeout: 5000}, async () => {
  const product = catalog[0];
  const routine = {products: [product]};
  const createdAt = '2026-11-14T00:00:00Z';
  const original = createSavedPlan(routine, {budget: 5000}, 'saved-plan-1', createdAt);
  const other = createSavedPlan(routine, {budget: 5000}, 'saved-plan-2', createdAt);
  const {app, change, saved} = await openApp('saved-edits', {[plansKey]: [original, other]});
  const markup = app.markup;
  const fields = new Map();
  const card = {querySelector(selector) {
    if (!fields.has(selector)) fields.set(selector, {});
    return fields.get(selector);
  }};
  const edit = (dataset, value) => {
    const input = {dataset, value, valueAsNumber: value ? Number(value) : NaN, closest: () => card};
    change(input);
    return input;
  };
  const editUsage = (planUsage, value) => edit({planId: original.id, planUsage, productJan: product.jan}, value);

  edit({planName: original.id}, '編集済み');
  edit({planBudget: original.id}, '1234');
  editUsage('price', '2100');
  editUsage('uses', '60');
  editUsage('frequency', '0.5');
  assert.equal(editUsage('price', '').value, 2100);
  assert.equal(edit({planBudget: original.id}, '').value, 1234);

  const [plan, untouched] = saved(plansKey);
  assert.equal(plan.name, '編集済み');
  assert.equal(plan.budget, 1234);
  assert.deepEqual(plan.overrides[product.jan], {price: 2100, uses: 60, frequency: 0.5});
  assert.deepEqual(untouched, other);
  assert.equal(savedPlanTotals(plan, catalog).monthly, 525);
  assert.equal(fields.get('.saved-plan-head h3').textContent, '編集済み');
  assert.match(fields.get('.saved-totals').innerHTML, /525円.*月予算 1,234円/);
  assert.match(fields.get('.saved-cost-summary').innerHTML, /初回購入額 <strong>2,100円/);
  assert.match(fields.get('.saved-item-total').innerHTML, /525円/);
  assert.equal(app.markup, markup);
});

test('saved use counts keep the fraction used to calculate the original monthly cost', async () => {
  const product = catalog.find(item => item.jan === '4901301281715');
  const uses = usesOf(product);
  assert.ok(!Number.isInteger(uses));
  const plan = createSavedPlan({products: [product]}, {budget: 5000}, 'fractional-plan', '2026-11-14T00:00:00Z');
  const {app} = await openApp('fractional-plan', {[plansKey]: [plan]});
  const input = app.markup.match(/<input [^>]*data-plan-usage="uses"[^>]*value="([^"]+)"/);
  assert.equal(Number(input?.[1]), uses);
  assert.equal(monthlyCost(product, {uses: Number(input[1])}), savedPlanTotals(plan, catalog).monthly);
});

test('a remembered swap is skipped when it no longer satisfies the required ingredient or fixed item', async () => {
  const base = {budget: 5000, concerns: ['dryness'], manual: ['4901301269348', '4901301466679']};
  const required = await openApp('stale-ingredient', {[settingsKey]: {
    ...base, ingredient: 'ナイアシンアミド', ingredientMode: 'required',
  }});
  assert.match(required.app.markup, /class="panel recommendation"/);
  assert.doesNotMatch(required.app.markup, /入れ替え後の組み合わせ/);
  const fixed = await openApp('stale-lock', {[settingsKey]: {...base, locked: {toner: '4901301236197'}}});
  assert.doesNotMatch(fixed.app.markup, /入れ替え後の組み合わせ/);
  assert.match(fixed.app.markup, /data-action="lock" data-id="4901301236197" aria-pressed="true"/);
  const unrelated = await openApp('stale-unrelated-serum', {[settingsKey]: {
    ...base, concerns: ['blackheads'], manual: [...base.manual, '4987241169658'],
  }});
  assert.match(unrelated.app.markup, /class="panel recommendation"/);
  assert.doesNotMatch(unrelated.app.markup, /入れ替え後の組み合わせ/);
});

test('cancelling the settings reset keeps the manually swapped routine', async () => {
  const settings = {budget:600, concerns:['brightness'], priority:'thorough',
    manual:['4973167018156','4901301043764'], manualExtraBudget:500};
  const {app,click,saved}=await openApp('cancel-reset',{[settingsKey]:settings});
  assert.match(app.markup,/入れ替え後の組み合わせ/);
  const originalConfirm=globalThis.confirm;
  try {
    globalThis.confirm=()=>false;
    click('reset');
    assert.deepEqual(saved(settingsKey),settings);
    assert.match(app.markup,/入れ替え後の組み合わせ/);
    globalThis.confirm=()=>true;
    click('reset');
    assert.equal(saved(settingsKey).manual,null);
    assert.match(app.markup,/肌悩みを選ぶと提案します/);
  } finally {
    globalThis.confirm=originalConfirm;
  }
});

test('a deleted catalog entry still contributes its saved costs', async () => {
  const product=catalog[0];
  const removed={...catalog[1],jan:'0000000000000'};
  const plan=createSavedPlan({products:[product,removed]},{budget:0},'removed-entry','2026-11-15T00:00:00Z');
  const expected=savedPlanTotals(plan,[product,removed]);
  const actual=savedPlanTotals(plan,catalog);
  assert.deepEqual(actual.missing,[removed.jan]);
  assert.equal(actual.monthly,expected.monthly);
  assert.equal(actual.initial,expected.initial);
  const {app}=await openApp('deleted-entry',{[plansKey]:[plan]});
  assert.match(app.markup,/商品DBに見つからないJAN/);
  assert.match(app.markup,/予算超過/);
  const incomplete={...plan,overrides:{[product.jan]:plan.overrides[product.jan]}};
  const invalid=await openApp('deleted-entry-without-cost',{[plansKey]:[incomplete]});
  assert.match(invalid.app.markup,/月額未確定/);
  assert.doesNotMatch(invalid.app.markup,/予算超過|予算内/);
});

test('disabling makeup keeps its lock available and labels it as outside the current routine', async () => {
  const jan = '4901301417008';
  const {app, change, saved} = await openApp('paused-makeup', {[settingsKey]: {
    budget: 5000, concerns: ['dryness'], useMakeupRemover: true,
    locked: {makeupRemover: jan}, swapCategory: 'makeupRemover',
  }});
  change({dataset: {field: 'useMakeupRemover'}, checked: false});
  assert.equal(saved(settingsKey).locked.makeupRemover, jan);
  assert.match(app.markup, /現在は提案対象外/);
  const options=app.markup.match(/<select id="swapCategory"[^>]*>(.*?)<\/select>/)?.[1];
  assert.ok(options);
  assert.doesNotMatch(options, /value="makeupRemover"/);
  assert.match(options, /value="moisturizer" selected/);
  change({dataset: {field: 'useMakeupRemover'}, checked: true});
  assert.doesNotMatch(app.markup, /現在は提案対象外/);
  assert.match(app.markup, new RegExp(`data-action="lock" data-id="${jan}" aria-pressed="true"`));
});

test('no-candidate feedback distinguishes budget from a fixed double-cleansing conflict', async () => {
  const settings={budget:300,concerns:['dryness'],priority:'simple'};
  const low=await openApp('minimum-budget',{[settingsKey]:settings});
  const [cheapest]=optimize(catalog,{...settings,budget:Infinity,resultLimit:1,objective:'minimumMonthly'});
  assert.match(low.app.markup,new RegExp(`最安の組み合わせは月額${cheapest.monthly}円`));
  assert.doesNotMatch(low.app.markup,/class="panel recommendation"/);
  const conflict=await openApp('cleansing-conflict',{[settingsKey]:{
    ...settings,budget:5000,useMakeupRemover:true,locked:{makeupRemover:'4973167251607'},
  }});
  assert.match(conflict.app.markup,/固定中のメイク落としは、このアプリでは洗顔料と併用/);
  assert.match(conflict.app.markup,/固定を解除/);
  assert.doesNotMatch(conflict.app.markup,/最安の組み合わせ/);
});

test('rerendering keeps keyboard focus on the changed control', async () => {
  const {app,click,change}=await openApp('keyboard-focus',{});
  const focused=[];
  const oldButton={dataset:{action:'concern',id:'dryness'}};
  const newButton={dataset:oldButton.dataset,focus:options=>focused.push(['concern',options])};
  globalThis.document.activeElement=oldButton;
  app.querySelectorAll=()=>[{dataset:{action:'concern',id:'acne'}},newButton];
  click('concern','dryness',oldButton);
  assert.match(app.markup,/data-id="dryness" aria-pressed="true"/);
  const oldSelect={dataset:{field:'finish'},value:'rich'};
  const newSelect={dataset:oldSelect.dataset,focus:options=>focused.push(['finish',options])};
  globalThis.document.activeElement=oldSelect;
  app.querySelectorAll=()=>[newSelect];
  change(oldSelect);
  assert.deepEqual(focused,[['concern',{preventScroll:true}],['finish',{preventScroll:true}]]);
});

test('lowering the budget does not hide the button for releasing a lock', {timeout: 5000}, async () => {
  const settings = {budget: 5000, concerns: ['pores', 'dullness'], priority: 'thorough'};
  const [routine] = optimize(catalog, {...settings, resultLimit: 1});
  const product = routine.products.find(item => monthlyCost(item) > 500);
  assert.ok(product, 'the first recommendation needs an item that alone exceeds the lower budget');
  const {app, change, click, saved} = await openApp('unlock', {[settingsKey]: settings});
  assert.ok(app.markup.includes(`data-action="lock" data-id="${product.jan}"`));
  click('lock', product.jan);
  change({dataset: {field: 'budget'}, value: '500'});
  assert.match(app.markup, /組み合わせを作れませんでした/);
  assert.doesNotMatch(app.markup, /class="panel recommendation"/);
  assert.match(app.markup, /固定中の商品：1品/);
  assert.ok(app.markup.includes(`data-action="unlock" data-id="${product.jan}"`));

  click('unlock', product.jan);
  assert.deepEqual(saved(settingsKey).locked, {});
  assert.equal(saved(settingsKey).budget, 500);
  assert.deepEqual(saved(settingsKey).concerns, settings.concerns);
  assert.doesNotMatch(app.markup, /固定中の商品/);
  assert.match(app.markup, /class="panel recommendation"/);
});

test('selecting skin brightness proposes products scored for that concern', {timeout: 5000}, async () => {
  const {app, click, saved} = await openApp('brightness', {[settingsKey]: {budget: 5000}});
  assert.match(app.markup, /data-id="brightness" aria-pressed="false">肌の明るさ（明るくしたい）/);
  click('concern', 'brightness');
  assert.deepEqual(saved(settingsKey).concerns, ['brightness']);
  assert.match(app.markup, /関連する悩み：肌の明るさ（明るくしたい）/);
});

test('a basic routine reports when the selected concern has no matching product in that budget', async () => {
  const {app, change} = await openApp('unmatched-brightness', {[settingsKey]: {budget: 400, concerns: ['brightness']}});
  assert.match(app.markup, /今回の組み合わせで対応できない悩み：肌の明るさ（明るくしたい）/);
  assert.match(app.markup, /class="panel recommendation"/);
  change({dataset: {field: 'budget'}, value: '1000'});
  assert.match(app.markup, /関連する悩み：肌の明るさ（明るくしたい）/);
  assert.doesNotMatch(app.markup, /今回の組み合わせで対応できない悩み/);
});

test('makeup routine explains when a fixed cleanser is still paired with remover', async () => {
  const settings = {
    budget: 5000, concerns: ['dryness'], useMakeupRemover: true, priority: 'simple',
    locked: {cleanser: '4901301269348', makeupRemover: '4973167251607'},
  };
  const {app} = await openApp('fixed-cleanser', {[settingsKey]: settings});
  assert.match(app.markup, /「手軽に」では、洗顔料を固定していない場合にW洗顔を省きます/);
  assert.match(app.markup, /夜：メイク落とし → 洗顔 →/);
  assert.match(app.markup, /夜のみ・W洗顔不要の記載なし/);
  for (const [remover, label] of [
    ['4973167552995', 'メーカーが洗顔を案内'],
    ['4901301417008', 'W洗顔不要'],
  ]) {
    const {app} = await openApp(remover, {[settingsKey]: {...settings, locked: {...settings.locked, makeupRemover: remover}}});
    assert.ok(app.markup.includes('夜のみ・'+label));
  }
});

test('morning and evening routines use the trial frequency and the product use order', async () => {
  const settings = {
    budget: 10000, concerns: ['dryness', 'wrinkles'],
    locked: {cleanser: '4901301463968', toner: '4901301236197', serum: '4901301412829',
      moisturizer: '4901301236210'},
  };
  for (const serum of ['4901301412829', '4901301416483']) {
    const {app} = await openApp(`before-toner-${serum}`, {[settingsKey]: {...settings, locked: {...settings.locked, serum}}});
    assert.match(app.markup, /朝：化粧水 → 保湿<br>夜：洗顔 → 美容液 → 化粧水 → 保湿/);
    assert.match(app.markup, /化粧水の前に使用/);
    assert.ok(app.markup.indexOf(`data-id="${serum}" aria-pressed="true"`)<app.markup.indexOf('data-id="4901301236197" aria-pressed="true"'));
  }
  const last = await openApp('after-moisturizer', {[settingsKey]: {...settings, locked: {...settings.locked, serum: '4973167864920'}}});
  assert.match(last.app.markup, /朝：化粧水 → 保湿 → 美容液<br>夜：洗顔 → 化粧水 → 保湿 → 美容液/);
  assert.match(last.app.markup, /お手入れの最後に使用/);
  assert.match(last.app.markup, /1回約0\.10g（メーカーの使用量目安から試算）/);
  assert.match(last.app.markup, /両目の目元に使う場合で試算/);

  const wipeOff = await openApp('wipe-off-first', {[settingsKey]: {...settings, locked: {...settings.locked, toner: '4973167024485'}}});
  assert.match(wipeOff.app.markup, /夜：洗顔 → ふき取り化粧水 → 美容液 → 保湿/);
});

test('morning-only skincare appears in the morning routine at one use per day', async () => {
  const settings = {
    budget: 10000, concerns: ['dryness'],
    locked: {
      cleanser: '4901301463968', toner: '4901301236197',
      serum: '4909978261337', moisturizer: '4909978261306',
    },
  };
  const {app} = await openApp('morning-only-skincare', {[settingsKey]: settings});
  assert.match(app.markup, /朝：美容液 → 化粧水 → 保湿<br>夜：洗顔 → 化粧水 → 保湿/);
  assert.match(app.markup, /朝のみ/);
});

test('a pre-toner eye serum follows its own order without the default after-moisturizer instruction', async () => {
  const settings = {
    budget: 20000, concerns: ['eyeDryness'],
    locked: {cleanser: '4901301463968', toner: '4901301236197',
      moisturizer: '4901301236210', eyeCare: '4909978180089'},
  };
  const {app} = await openApp('pre-toner-eye-serum', {[settingsKey]: settings});
  assert.doesNotMatch(app.markup, /朝：[^<]*目元ケア/);
  assert.match(app.markup, /夜：洗顔 → 目元ケア → 化粧水 → 保湿/);
  const eyeCard = app.markup.match(/<article class="product">(?:(?!<article)[\s\S])*?アイゾーンブースター[\s\S]*?<\/article>/)?.[0];
  assert.ok(eyeCard);
  assert.match(eyeCard, /化粧水の前に使用/);
  assert.doesNotMatch(eyeCard, /顔全体の保湿の後に使用/);
});
