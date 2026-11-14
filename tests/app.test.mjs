import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadCatalog} from '../dist/catalog-csv.js';
import {createSavedPlan, savedPlanTotals} from '../dist/plans.js';
import {mergeCatalogData} from '../dist/catalog-data.js';
import {monthlyCost, optimize} from '../dist/optimizer.js';

const settingsKey = 'skincare-lab-settings-jan';
const plansKey = 'skincare-lab-saved-routines-jan';
const read = url => readFile(url, 'utf8');
const {products, pricing, usage} = await loadCatalog(read);
const catalog = mergeCatalogData(products, pricing, usage);

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
    click: (action, id) => handlers.get('click')({target: {closest: () => ({dataset: {action, id}})}})
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
