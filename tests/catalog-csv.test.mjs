import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadCatalog, parseCatalog} from '../dist/catalog-csv.js';
import {mergeCatalogData} from '../dist/catalog-data.js';

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
