import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadCatalog} from '../dist/catalog-csv.js';
import {mergeCatalogData} from '../dist/catalog-data.js';
import {optimize} from '../dist/optimizer.js';

const read = url => readFile(url, 'utf8');

test('male catalog is separate, JAN-valid and contains priced cleanser/moisturizer choices', async () => {
  const female = await loadCatalog(read);
  const male = await loadCatalog(read, '../catalog-men/');
  const jans = new Set(female.products.map(p => p.jan));
  assert.equal(male.products.length, 77);
  assert.ok(male.products.every(p => !jans.has(p.jan)));
  assert.equal(new Set(male.products.map(p=>p.jan)).size, male.products.length);
  for (const p of male.products) {
    assert.ok(['メンズビオレ','ニベアメン','オキシー','uno','ギャツビー','ルシード','メラノCC Men','KNOWLEDGE','メンズオードムーゲ','メンズケシミン','毛穴撫子 男の子用','matsukiyo','オルビス ミスター','テックスメックス','ちのしお','SHISEIDO メン','プラウドメン'].includes(p.brand));
    assert.equal(male.pricing.prices[p.jan]?.jan, p.jan);
    assert.ok(p.sourceUrl.startsWith('https://'));
  }
  const products = mergeCatalogData(male.products, male.pricing, male.usage);
  for (const concern of ['dryness','pores','acne']) {
    const options={budget:5000,concerns:[concern],priority:'any',skinType:'unknown',finish:'any',ingredient:'none'};
    // Verify at least that the basic required two categories can be selected.
    const result=optimize(products,options);
    assert.ok(result.length>0, `No routine for ${concern}`);
    assert.ok(result[0].products.some(p=>p.category==='cleanser'));
    assert.ok(result[0].products.some(p=>p.category==='moisturizer'));
  }
});

test('men catalog supports makeup removal as standalone facial wash', async () => {
  const male = await loadCatalog(read, '../catalog-men/');
  const catalog = mergeCatalogData(male.products, male.pricing, male.usage);
  const lookup = new Map(catalog.map(p => [p.jan, p]));
  assert.equal(lookup.get('4901301389640').category, 'makeupRemover');
  assert.equal(lookup.get('4901301389640').doubleCleanseNotNeeded, true);
  assert.equal(lookup.get('4901301448484').category, 'cleanser');
  assert.equal(lookup.get('4901301257680').referenceUses, 130);
  assert.equal(male.pricing.prices['4901301267092'].retailer, 'ツルハグループe-shop');
  assert.equal(lookup.get('4901301420121').evidence.activeIngredients.length, 2);
  const best = optimize(catalog, {budget:5000, useMakeupRemover:true, concerns:['pores'],
    priority:'simple', skinType:'unknown', finish:'any', ingredient:'none'})[0];
  assert.ok(best, 'expected feasible makeup removal routine');
  assert.ok(best.products.some(p => p.jan === '4901301389640'));
  assert.ok(best.products.some(p => p.category === 'moisturizer'));
  assert.ok(!best.products.some(p => p.category === 'cleanser'));
});

test('additional men brands retain verified JAN, brand totals and evidence distinctions', async () => {
 const male=await loadCatalog(read,'../catalog-men/');
 const brands=male.products.reduce((out,p)=>{(out[p.brand]??=[]).push(p);return out;},{});
 assert.equal(brands['オキシー'].length,3);
 assert.equal(brands['uno'].length,6);
 assert.equal(brands['ギャツビー'].length,7);
 const byJan=new Map(male.products.map(p=>[p.jan,p]));
 assert.deepEqual(byJan.get('4902806117905').evidence.activeIngredients,['サリチル酸','グリチルリチン酸ジカリウム']);
 assert.equal(byJan.get('4550516495280').allInOne,true);
 assert.equal(byJan.get('4550516495280').category,'moisturizer');
 assert.equal(byJan.get('4987241199471').productType,'cosmetic');
 assert.equal(male.pricing.prices['4987241199457'].retailer,'ツルハグループe-shop');
 assert.equal(male.pricing.prices['4902806122077'].priceJPY,902);
});

test('LUCIDO products are isolated and drug actives use manufacturer-current formulas', async () => {
  const male=await loadCatalog(read,'../catalog-men/');
  const byJan=new Map(male.products.map(p=>[p.jan,p]));
  assert.equal(male.products.filter(p=>p.brand==='ルシード').length,11);
  assert.equal(byJan.get('4902806134452').allInOne,true);
  assert.equal(byJan.get('4902806134438').evidence.sensitiveSkinPatchTested,true);
  assert.deepEqual(byJan.get('4902806107296').evidence.activeIngredients,
    ['ナイアシンアミド','グリチルリチン酸ジカリウム']);
  assert.equal(byJan.get('4902806122053').category,'moisturizer');
  assert.equal(byJan.get('4550516474858').allInOne,true);
  assert.equal(byJan.get('4550516474858').evidence.activeIngredients.length,2);
  assert.equal(male.pricing.prices['4902806134452'].priceJPY,2200);
});

test('additional male face-care has separate price/evidence and new serum slot', async () => {
  const male=await loadCatalog(read,'../catalog-men/');
  const by=new Map(male.products.map(p=>[p.jan,p]));
  assert.equal(male.products.filter(p=>p.brand==='KNOWLEDGE').length,8);
  assert.equal(male.products.filter(p=>p.brand==='メラノCC Men').length,2);
  assert.equal(male.products.filter(p=>p.brand==='メンズケシミン').length,2);
  assert.equal(male.products.filter(p=>p.brand==='メンズオードムーゲ').length,2);
  assert.equal(by.get('4987241171507').category,'serum');
  assert.equal(by.get('4987241171507').evidence.activeIngredients.length,4);
  assert.equal(by.get('4902806131116').applicationOrder,'last');
  assert.equal(by.get('4902806128383').doubleCleanseNotNeeded,false);
  assert.equal(by.get('4987072042687').wipeOff,true);
  assert.equal(by.get('4987072088968').evidence.activeIngredients.length,2);
  assert.equal(male.pricing.prices['4987241202980'].retailer,'ツルハグループe-shop');
  const merged=mergeCatalogData(male.products,male.pricing,male.usage);
  assert.equal(merged.find(p=>p.jan==='4987241171507').referenceUses,165);
});

test('new male face washes have JAN-aligned retailer prices without drug-actives confusion', async () => {
  const male=await loadCatalog(read,'../catalog-men/');
  const byJan=new Map(male.products.map(p=>[p.jan,p]));
  for(const jan of ['4992440036328','4992440036335','4902806128376','4902806134674','4513574029439']){
    const product=byJan.get(jan);
    assert.equal(product.category,'cleanser');
    assert.equal(product.productType,'cosmetic');
    assert.equal(product.evidence.officialSource,true);
    assert.equal(product.evidence.activeIngredients?.length ?? 0,0);
    assert.equal(male.pricing.prices[jan].jan,jan);
    assert.equal(male.pricing.prices[jan].retailer,'マツキヨココカラオンライン');
  }
  assert.equal(byJan.get('4902806134674').volume,200);
  assert.equal(byJan.get('4992440036335').volume,100);
  assert.equal(male.pricing.prices['4513574029439'].priceJPY,327);
  assert.equal(male.products.filter(p=>p.brand==='KNOWLEDGE').length,8);
  assert.equal(male.products.filter(p=>p.brand==='毛穴撫子 男の子用').length,2);
});

test('Orbis Mr, SHISEIDO MEN and other male brands are registered by their JAN and true product classes', async () => {
  const male=await loadCatalog(read, '../catalog-men/');
  const byJan=new Map(male.products.map(p=>[p.jan,p]));
  assert.equal(male.products.filter(p=>p.brand==='オルビス ミスター').length,3);
  assert.equal(male.products.filter(p=>p.brand==='SHISEIDO メン').length,2);
  for(const jan of ['4908064090189','4908064090196','4908064090219']){
    const p=byJan.get(jan);
    assert.equal(p.productType,'quasiDrug');
    assert.deepEqual(p.evidence.activeIngredients,['グリチルリチン酸ジカリウム']);
  }
  const tex=byJan.get('4901604421870');
  assert.equal(tex.allInOne,true);
  assert.equal(tex.category,'moisturizer');
  assert.equal(tex.volume,150);
  assert.equal(tex.evidence.sensitiveSkinPatchTested,true);
  assert.equal(byJan.get('4982757916499').category,'toner');
  assert.equal(byJan.get('4982757916499').volume,400);
  const shiseido=byJan.get('4514254992418');
  assert.equal(shiseido.productType,'cosmetic');
  assert.equal(shiseido.category,'moisturizer');
  assert.equal(byJan.get('4528620301322').allInOne,true);
  assert.equal(male.pricing.prices['4528620301322'].retailer,'ツルハグループe-shop');
  assert.equal(male.pricing.prices['4982757916499'].priceJPY,785);
});
