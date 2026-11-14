import {CATEGORY_LABELS, CONCERNS} from './optimizer.js?v=0.8.7';

const RETAILERS = ['マツキヨココカラオンライン', 'ツルハグループe-shop', 'ウエルシア'];

function janCode(value) {
  if (!/^[0-9]{13}$/.test(value)) throw new Error('JANは13桁の数字で入力してください');
  const sum = [...value].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  if (sum % 10) throw new Error(`JAN ${value} のチェックディジットが一致しません`);
  return value;
}

function number(value) {
  const result = Number(value);
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(result) || result < 0)
    throw new Error('0以上の数値を入力してください');
  return result;
}

function positive(value) {
  const result = number(value);
  if (result <= 0) throw new Error('0より大きい数値を入力してください');
  return result;
}

function wholeNumber(value) {
  const result = number(value);
  if (!Number.isSafeInteger(result)) throw new Error('整数を入力してください');
  return result;
}

function positiveInteger(value) {
  const result = wholeNumber(value);
  if (!result) throw new Error('1以上の整数を入力してください');
  return result;
}

function score(value) {
  const result = wholeNumber(value);
  if (result > 3) throw new Error('点数は0〜3です');
  return result;
}

function httpsUrl(value) {
  if (!/^https:\/\/[^/\s]/i.test(value) || /\s/.test(value))
    throw new Error('httpsのURLを入力してください');
  new URL(value);
  return value;
}

function dateString(value) {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
  if (!match || match[1] === '0000') throw new Error('日付はYYYY-MM-DDで入力してください');
  const iso = [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-');
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso)
    throw new Error('日付が存在しません');
  return iso;
}

function ingredients(value) {
  const parts = value.split('|').map(part => part.trim());
  if (!parts.every(Boolean)) throw new Error('成分名を | で区切って入力してください');
  return parts;
}

function concentrations(value) {
  const items = JSON.parse(value);
  if (!Array.isArray(items) || items.some(item =>
    !item || typeof item.name !== 'string' || !item.name || typeof item.unit !== 'string' || !item.unit
    || !Number.isFinite(item.value) || item.value <= 0 || !httpsUrl(item.sourceUrl ?? '')
  )) throw new Error('配合濃度は成分名・数値・単位・出典URLの配列で入力してください');
  return items;
}

function choice(values) {
  return value => {
    if (!Object.hasOwn(values, value)) throw new Error(`選択肢は ${Object.keys(values).join('、')} です`);
    return values[value];
  };
}

const bool = choice({true: true, false: false});
const boolean = value => bool(value.toLowerCase());
const retailerAliases = new Map([['マツキヨ', RETAILERS[0]], ['ツルハ', RETAILERS[1]]]);
const retailerName = value => retailerAliases.get(value) ?? value;
const category = choice(Object.fromEntries(Object.entries(CATEGORY_LABELS).map(([key, label]) => [label, key])));
const feel = choice({さっぱり: 'light', しっとり: 'moist', とてもしっとり: 'rich'});

const PRODUCT_FIELDS = {
  ブランド: ['brand'], 商品名: ['name'], 品目: ['category', category], メーカー: ['manufacturer'],
  企業グループ: ['makerGroup'], 内容量: ['volume', positive], 単位: ['unit', choice({mL: 'mL', g: 'g'})],
  使用感の分類: ['feel', feel], 使用感メモ: ['tone'], 公式URL: ['sourceUrl', httpsUrl],
  主要成分: ['keyIngredients', ingredients], 商品説明: ['explanation'], 敏感肌向け: ['sensitiveSkin', boolean],
  オールインワン: ['allInOne', boolean], ふき取り: ['wipeOff', boolean],
  落ちにくいメイク対応: ['waterproof', boolean], 洗顔料なしで提案: ['doubleCleanseNotNeeded', boolean],
  洗顔の根拠メモ: ['cleansingGuidance'], '1日使用回数（試算）': ['dailyUses', number],
  '1本の仮使用回数': ['demoUses', positive], '試算価格（円）': ['demoPrice', wholeNumber], 使用方法メモ: ['usage'],
};
const USAGE_FIELDS = {
  '1回量の目安': ['doseDescription'], 使用量の出典URL: ['sourceUrl', httpsUrl],
  使用量の出典種別: ['sourceKind'], 使用量の確認日: ['verifiedAt', dateString], 使い切り日数: ['durationDays', positive],
  '使い切り日数の基準回数／日': ['referenceDailyUses', positive], 個包装の回数: ['verifiedUses', positiveInteger],
  使用回数の根拠: ['referenceBasis'], 使用回数の確認状況: ['usageCountStatus'], 使用量メモ: ['note'],
  品目平均から除外: ['excludeFromCategoryAverages', boolean],
};
const EVIDENCE_FIELDS = {
  公式情報確認済み: ['officialSource', boolean], 公式情報の確認日: ['verifiedAt', dateString],
  公式情報の確認メモ: ['sourceAccess'], 有効成分: ['activeIngredients', ingredients],
  '配合濃度（JSON）': ['concentrations', concentrations], 敏感肌のパッチテスト確認済み: ['sensitiveSkinPatchTested', boolean],
};
const PRICE_FIELDS = {
  販売店: ['retailer', retailerName], '税込価格（円）': ['priceJPY', wholeNumber],
  価格の出典URL: ['url', httpsUrl], 価格の確認日: ['verifiedAt', dateString], 価格の確認方法: ['verificationMethod'],
};
const SCORE_FIELDS = Object.fromEntries(Object.entries(CONCERNS).map(([key, label]) => [label, [key, score]]));

// UTF-8 BOM、ExcelのCRLF、セル内のカンマ・改行・二重引用符を扱う。
function* csvRows(source, name) {
  const input = source.replace(/^\uFEFF/, '');
  const field = /("(?:[^"]|"")*"|[^",\r\n]*)(,|\r\n|[\r\n]|$)/gy;
  let cells = [], line = 1, rowStart = 1;
  while (field.lastIndex < input.length) {
    const match = field.exec(input);
    if (!match) throw new Error(`${name}:${line}: CSVの引用符が正しくありません`);
    const [, raw, separator] = match;
    cells.push(raw.startsWith('"') ? raw.slice(1, -1).replaceAll('""', '"') : raw);
    line += (raw.match(/\r\n|[\r\n]/g) ?? []).length;
    if (separator === ',') continue;
    yield {cells, line: rowStart};
    cells = [];
    rowStart = ++line;
  }
  if (cells.length) yield {cells: [...cells, ''], line: rowStart};
}

function* table(source, name, columns) {
  const rows = csvRows(source, name);
  const headers = rows.next().value?.cells ?? [];
  const missing = columns.filter(column => !headers.includes(column));
  const unknown = headers.filter(column => !columns.includes(column));
  if (missing.length || unknown.length || new Set(headers).size !== headers.length)
    throw new Error(`${name}: 列名が一致しません（不足 ${missing.join('、') || 'なし'}／未定義 ${unknown.join('、') || 'なし'}）`);
  for (const {cells, line} of rows) {
    const location = `${name}:${line}`;
    if (cells.length > headers.length) throw new Error(`${location}: 列数が多すぎます`);
    if (!cells.some(value => value.trim())) continue;
    const row = Object.fromEntries(headers.map((header, i) => [header, cells[i]?.trim() ?? '']));
    let jan;
    try {
      jan = janCode(row.JAN);
    } catch (error) {
      throw new Error(`${location}: ${error.message}`);
    }
    yield {jan, row, location};
  }
}

function readFields(row, fields, location, required = []) {
  const result = {};
  for (const [heading, [key, convert = String]] of Object.entries(fields)) {
    const raw = row[heading];
    if (!raw) {
      if (required.includes(key)) throw new Error(`${location}: ${heading}が空欄です`);
      continue;
    }
    try {
      result[key] = convert(raw);
    } catch (error) {
      throw new Error(`${location}: ${heading}の値 ${JSON.stringify(raw)} を読み取れません（${error.message}）`);
    }
  }
  return result;
}

function compareRetailers(a, b) {
  const rank = retailer => RETAILERS.includes(retailer) ? RETAILERS.indexOf(retailer) : RETAILERS.length;
  return rank(a.retailer) - rank(b.retailer) || (a.retailer < b.retailer ? -1 : Number(a.retailer > b.retailer));
}

export function parseCatalog({productsCsv, pricesCsv, scoresCsv}) {
  const products = new Map(), usages = {}, retired = new Set();
  const columns = ['JAN', '掲載状態', ...Object.keys(PRODUCT_FIELDS), ...Object.keys(USAGE_FIELDS), ...Object.keys(EVIDENCE_FIELDS)];
  const required = ['brand', 'name', 'category', 'volume', 'unit', 'sourceUrl', 'dailyUses'];
  for (const {jan, row, location} of table(productsCsv, 'products.csv', columns)) {
    if (products.has(jan)) throw new Error(`${location}: JAN ${jan} が商品マスター内で重複しています`);
    const status = row.掲載状態 || '掲載中';
    if (status !== '掲載中' && status !== '掲載終了')
      throw new Error(`${location}: 掲載状態は「掲載中」か「掲載終了」です`);
    if (status === '掲載終了') retired.add(jan);

    const product = {jan, keyIngredients: [], ...readFields(row, PRODUCT_FIELDS, location, required)};
    const evidence = readFields(row, EVIDENCE_FIELDS, location);
    if (Object.keys(evidence).length) product.evidence = evidence;
    products.set(jan, product);

    const usage = readFields(row, USAGE_FIELDS, location);
    if (Object.keys(usage).length) {
      if (!usage.sourceUrl) throw new Error(`${location}: 使用量の出典URLが空欄です`);
      if (Object.hasOwn(usage, 'durationDays') !== Object.hasOwn(usage, 'referenceDailyUses'))
        throw new Error(`${location}: 使い切り日数と基準回数は一緒に入力してください`);
      usages[jan] = {doseDescription: null, ...usage};
    }
    const count = usage.verifiedUses ?? (usage.durationDays ?? 0) * (usage.referenceDailyUses ?? 0);
    if (count) product.demoUses ??= count;
    if (product.demoUses === undefined)
      throw new Error(`${location}: 使用回数を出典から算出できない場合は1本の仮使用回数を入力してください`);
  }

  const quotes = new Map();
  for (const {jan, row, location} of table(pricesCsv, 'prices.csv', ['JAN', ...Object.keys(PRICE_FIELDS)])) {
    if (!products.has(jan)) throw new Error(`${location}: JAN ${jan} が商品マスターにありません`);
    const quote = {jan, ...readFields(row, PRICE_FIELDS, location, ['retailer', 'priceJPY', 'url', 'verifiedAt'])};
    const url = new URL(quote.url);
    const retailerJan = url.hostname === 'www.matsukiyococokara-online.com'
      ? /^\/store\/catalog\/product\/view\/id\/([0-9]{13})\/?$/.exec(url.pathname)?.[1] : undefined;
    if (retailerJan && retailerJan !== jan)
      throw new Error(`${location}: JAN ${jan} が価格ページのJAN ${retailerJan} と一致しません`);
    if (!quotes.has(jan)) quotes.set(jan, new Map());
    const byRetailer = quotes.get(jan);
    if (byRetailer.has(quote.retailer)) throw new Error(`${location}: JAN ${jan} と販売店の組み合わせが重複しています`);
    byRetailer.set(quote.retailer, quote);
  }

  const scores = new Map();
  for (const {jan, row, location} of table(scoresCsv, 'scores.csv', ['JAN', ...Object.keys(SCORE_FIELDS), '採点メモ'])) {
    if (!products.has(jan)) throw new Error(`${location}: JAN ${jan} が商品マスターにありません`);
    if (scores.has(jan)) throw new Error(`${location}: JAN ${jan} が肌悩み別点数表で重複しています`);
    scores.set(jan, readFields(row, SCORE_FIELDS, location));
  }

  const activeProducts = [], archivedProducts = [], prices = {};
  for (const [jan, product] of products) {
    const quote = [...(quotes.get(jan)?.values() ?? [])].sort(compareRetailers)[0];
    if (quote) {
      prices[jan] = quote;
      product.demoPrice ??= quote.priceJPY;
    }
    if (product.demoPrice === undefined)
      throw new Error(`JAN ${jan} の販売店価格または試算価格を入力してください`);
    product.scores = scores.get(jan) ?? {};
    (retired.has(jan) ? archivedProducts : activeProducts).push(product);
  }
  return {products: activeProducts, archivedProducts, pricing: {prices}, usage: {usages}};
}

async function fetchCatalogFile(url) {
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw new Error(`商品データを読み込めません：${url.pathname.split('/').at(-1)}`);
  return response.text();
}

export async function loadCatalog(readFile = fetchCatalogFile) {
  const [productsCsv, pricesCsv, scoresCsv, metadata] = await Promise.all(
    ['products.csv', 'prices.csv', 'scores.csv', 'metadata.json'].map(name =>
      readFile(new URL(`../catalog/${name}`, import.meta.url))
    )
  );
  return {...parseCatalog({productsCsv, pricesCsv, scoresCsv}), meta: JSON.parse(metadata).products};
}
