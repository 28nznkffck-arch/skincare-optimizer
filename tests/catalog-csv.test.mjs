import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadCatalog, parseCatalog} from '../dist/catalog-csv.js';
import {DIPOTASSIUM_GLYCYRRHIZATE, mergeCatalogData, reconcileCatalogState} from '../dist/catalog-data.js';
import {renderEvidence} from '../dist/debug-analysis.js';
import {CONCERNS, optimize} from '../dist/optimizer.js';

const headers = {};
for (const name of ['products', 'prices', 'scores']) {
  const source = await readFile(new URL(`../catalog/${name}.csv`, import.meta.url), 'utf8');
  headers[name] = source.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].split(',');
}

function csv(name, rows) {
  const columns = headers[name];
  return '\uFEFF' + [columns.join(','), ...rows.map(row => columns.map(column =>
    `"${String(row[column] ?? '').replaceAll('"', '""')}"`
  ).join(','))].join('\r\n');
}

const jan = '0000000000123';
const product = {
  JAN: jan, ブランド: '検証用', 商品名: '洗顔料, "しっとり"\r\n通常版', 品目: '洗顔',
  内容量: 120, 単位: 'g', 公式URL: 'https://example.test/product', '1日使用回数（試算）': 2,
  使用量の出典URL: 'https://example.test/usage', 使い切り日数: 60, '使い切り日数の基準回数／日': 2,
};
const quote = {JAN: jan, '価格の確認日': '2026/11/14', '価格の出典URL': 'https://example.test/shop'};
const data = {
  productsCsv: csv('products', [product]),
  pricesCsv: csv('prices', [{...quote, 販売店: 'ツルハ', '税込価格（円）': 900},
    {...quote, 販売店: 'マツキヨ', '税込価格（円）': 1200}]),
  scoresCsv: csv('scores', [{JAN: jan, 乾燥: 0, くすみ: 2, '黒ずみ・角栓': 3}]),
};

test('CSV preserves JAN and quoted cells and feeds the existing usage and pricing calculation', () => {
  const {products, pricing, usage} = parseCatalog(data);
  const [item] = mergeCatalogData(products, pricing, usage);
  assert.equal(item.jan, jan);
  assert.equal(item.name, product.商品名);
  assert.equal(item.referencePrice, 1200);
  assert.equal(item.priceReference.verifiedAt, '2026-11-14');
  assert.equal(item.referenceUses, 120);
  assert.deepEqual(item.scores, {blackheads: 3, dullness: 2, dryness: 0});
});

test('CSV keeps archived products available to saved routines', () => {
  const {products, archivedProducts} = parseCatalog({
    ...data, productsCsv: csv('products', [{...product, 掲載状態: '掲載終了'}]),
  });
  assert.deepEqual(products, []);
  assert.equal(archivedProducts[0].jan, jan);
});

test('CSV rejects duplicate JANs, orphaned prices, and invalid scores', () => {
  assert.throws(() => parseCatalog({
    ...data, productsCsv: csv('products', [product, product]),
  }), /products\.csv:4:.*重複/);
  assert.throws(() => parseCatalog({
    ...data, productsCsv: csv('products', []),
  }), /prices\.csv:2:.*商品マスターにありません/);
  assert.throws(() => parseCatalog({
    ...data, scoresCsv: csv('scores', [{JAN: jan, 乾燥: 4}]),
  }), /scores\.csv:2:.*0〜3/);
});

test('the shared loader reads the repository CSV files', async () => {
  const {products, pricing, usage, meta} = await loadCatalog(url => readFile(url, 'utf8'));
  assert.ok(products.length > 0 && meta.notice);
  const catalog = mergeCatalogData(products, pricing, usage);
  assert.equal(catalog.length, products.length);
  assert.ok(catalog.every(item => /^\d{13}$/.test(item.jan) && Number.isFinite(item.demoPrice)));
});

test('catalog uses the manufacturer-verified active ingredients for corrected products', async () => {
  const {products} = await loadCatalog(url => readFile(url, 'utf8'));
  const byJan = new Map(products.map(item => [item.jan, item]));
  assert.deepEqual(byJan.get('4901301269348').evidence.activeIngredients, ['グリチルリチン酸ジカリウム']);
  assert.deepEqual(byJan.get('4901301236210').evidence.activeIngredients, ['アラントイン']);
  const gel = byJan.get('4901301281715');
  assert.deepEqual(gel.evidence.activeIngredients, ['アラントイン']);
  assert.ok(!gel.keyIngredients.includes('グリチルリチン酸ジカリウム'));
  assert.deepEqual(byJan.get('4973167383551').evidence.activeIngredients,
    ['L-アスコルビン酸 2-グルコシド', 'グリチルリチン酸ジカリウム']);
  assert.deepEqual(byJan.get('4973167383575').evidence.activeIngredients,
    ['L-アスコルビン酸 2-グルコシド', 'グリチルリチン酸ジカリウム']);
  assert.ok(byJan.get('4987241169658').evidence.activeIngredients.includes('トコフェロール酢酸エステル'));
  assert.equal(byJan.get('4987107670236').evidence?.activeIngredients, undefined);
});

test('debug shows a cosmetic as outside the medicinal ingredient field only when its type is recorded', () => {
  const verifiedProduct = {...product, 公式情報確認済み: true, 公式情報の確認日: '2026-11-14'};
  const showEvidence = row => renderEvidence(parseCatalog({
    ...data, productsCsv: csv('products', [row]),
  }).products[0]);
  const cosmetic = showEvidence({...verifiedProduct, 製品区分: '化粧品', 主要成分: 'グリセリン'});
  assert.match(cosmetic, /確認済み有効成分：対象外（化粧品）/);
  assert.match(cosmetic, /公式製品情報の確認日 2026-11-14/);
  assert.match(showEvidence(verifiedProduct), /確認済み有効成分：未調査・未登録/);
  const quasiDrug = {...product, 製品区分: '医薬部外品'};
  assert.match(showEvidence(quasiDrug), /確認済み有効成分：未調査・未登録/);
  const labeled = showEvidence({...quasiDrug, 有効成分: 'アラントイン'});
  assert.match(labeled, /確認済み有効成分：アラントイン/);
  assert.match(labeled, /公式製品情報の確認日 未登録/);
});

test('the saved ingredient preference matches both former spellings in the catalog', async () => {
  const {products, pricing, usage} = await loadCatalog(url => readFile(url, 'utf8'));
  const catalog = mergeCatalogData(products, pricing, usage);
  const settings = reconcileCatalogState({
    budget: 500, concerns: ['dryness'], ingredient: 'グリチルリチン酸2K', ingredientMode: 'required'
  }, catalog);
  assert.equal(settings.ingredient, DIPOTASSIUM_GLYCYRRHIZATE);
  assert.ok(catalog.find(p => p.jan === '4901301269348').keyIngredients.includes(settings.ingredient));
  assert.ok(catalog.find(p => p.jan === '4901301265678').keyIngredients.includes(settings.ingredient));
  const [routine] = optimize(catalog, {...settings, excluded: [], resultLimit: 1});
  assert.ok(routine?.monthly <= settings.budget);
  assert.ok(routine.products.some(p => p.keyIngredients.includes(settings.ingredient)));
});

test('revised concern scores distinguish medicinal action, formula action and indirect evidence', async () => {
  const {products} = await loadCatalog(url => readFile(url, 'utf8'));
  const byJan = new Map(products.map(item => [item.jan, item.scores]));
  assert.ok(products.every(item => Object.keys(CONCERNS).every(key => Object.hasOwn(item.scores, key))));
  assert.ok(products.every(item => item.scores.darkCircles === 0));
  const gel = byJan.get('4901301281715');
  assert.equal(gel.irritation, 3);
  assert.equal(gel.wrinkles, 0);
  assert.equal(gel.fineLines, 2);
  assert.equal(gel.redness, 0);
  const wrinkleCream = byJan.get('4973167040980');
  assert.equal(wrinkleCream.wrinkles, 3);
  assert.equal(wrinkleCream.spots, 2);
  assert.equal(wrinkleCream.unevenTone, 1);
  assert.equal(wrinkleCream.redness, 1);
  assert.equal(byJan.get('4901301416919').blackheads, 0);
  assert.equal(byJan.get('4973167383551').irritation, 2);
  assert.equal(byJan.get('4973167019108').brightness, 3);
  assert.equal(byJan.get('4973167383551').brightness, 2);
  assert.equal(byJan.get('4901301458964').brightness, 3);
  assert.equal(byJan.get('4973167535622').brightness, 2);
  assert.equal(byJan.get('4987241169658').brightness, 0);
});
