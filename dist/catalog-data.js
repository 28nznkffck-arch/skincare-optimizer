import {monthlyCost} from './optimizer.js?v=0.8.17';

export const DEFAULT_BUDGET = 5000;
export const DIPOTASSIUM_GLYCYRRHIZATE = 'グリチルリチン酸ジカリウム';

// しっかりケアで全品目を選べるときの月額を、スライダーの上限に使う。
export function getBudgetRange(catalog) {
  const min = 300;
  const step = 100;
  const maxByCategory = new Map();
  let standaloneRemover = null;
  for (const product of catalog) {
    const cost = monthlyCost(product);
    if (!Number.isFinite(cost)) continue;
    maxByCategory.set(product.category, Math.max(maxByCategory.get(product.category) ?? 0, cost));
    if (product.category === 'makeupRemover' && product.doubleCleanseNotNeeded) {
      standaloneRemover = Math.max(standaloneRemover ?? 0, cost);
    }
  }
  const cleanser = maxByCategory.get('cleanser');
  const cleansing = cleanser === undefined ? standaloneRemover : cleanser + (maxByCategory.get('makeupRemover') ?? 0);
  const moisturizer = maxByCategory.get('moisturizer');
  if (cleansing === null || moisturizer === undefined) return {min, max: min, step};

  const highestMonthly = cleansing + moisturizer + ['toner', 'serum', 'eyeCare']
    .reduce((sum, category) => sum + (maxByCategory.get(category) ?? 0), 0);
  return {min, max: Math.max(min, Math.ceil(highestMonthly / step) * step), step};
}

export function clampBudget(value, {min, max}) {
  return Math.max(min, Math.min(max, Number(value) || DEFAULT_BUDGET));
}

// 外部で確認した価格・使用期間は元の商品DBの仮値と分けて保管する。
// JANが一致しない情報は採用しない。メーカー表示の「約」は概算として扱う。
export function mergeCatalogData(products, pricing={}, usage={}) {
  const prices=pricing.prices||{};
  const usages=usage.usages||{};
  const merged=products.map(product=>{
    const price=prices[product.jan];
    const validPrice=price?.jan===product.jan && Number.isFinite(price.priceJPY) && price.priceJPY>=0 && /^https:\/\//.test(price.url||'');
    const amount=usages[product.jan];
    const validUsage=amount && /^https:\/\//.test(amount.sourceUrl||'');
    const duration=Number(amount?.durationDays);
    const times=Number(amount?.referenceDailyUses);
    // 個包装に書かれた「1回分×32個」は使用期間でなく確定使用回数。
    const packageUses=Number(amount?.verifiedUses);
    const verifiedPackage=validUsage && Number.isInteger(packageUses) && packageUses>0;
    const durationUses=validUsage && Number.isFinite(duration) && duration>0 && Number.isFinite(times) && times>0 ? duration*times : null;
    const referenceUses=verifiedPackage?packageUses:durationUses;
    return {
      ...product,
      priceReference:validPrice?price:null,
      referencePrice:validPrice?price.priceJPY:null,
      usageReference:validUsage?amount:null,
      referenceUses
    };
  });
  // 実際の使用期間を確認した商品だけを母集団とし、品目と容量単位ごとに
  // 1回量を平均する。異なる剤型を跨がない／サンプル1件を全体の標準としない。
  const samples=new Map();
  for(const product of merged){
    if(!product.referenceUses || product.usageReference?.excludeFromCategoryAverages ||
      !Number.isFinite(Number(product.volume)) || Number(product.volume)<=0)continue;
    const key=`${product.category}/${product.unit}`;
    if(!samples.has(key))samples.set(key,[]);
    samples.get(key).push(Number(product.volume)/product.referenceUses);
  }
  return merged.map(product=>{
    if(product.referenceUses)return {...product,usageEstimate:{kind:product.usageReference?.verifiedUses?'packageCount':'duration',sampleCount:1}};
    const amounts=samples.get(`${product.category}/${product.unit}`)||[];
    if(amounts.length<2)return {...product,estimatedUses:null,usageEstimate:{kind:'demo',sampleCount:amounts.length}};
    const mean=amounts.reduce((sum,n)=>sum+n,0)/amounts.length;
    const volume=Number(product.volume);
    if(!Number.isFinite(volume)||volume<=0 || !Number.isFinite(mean)||mean<=0)
      return {...product,estimatedUses:null,usageEstimate:{kind:'demo',sampleCount:amounts.length}};
    return {...product,estimatedUses:volume/mean,
      usageEstimate:{kind:'categoryAverage',sampleCount:amounts.length,amountPerUse:mean,category:product.category,unit:product.unit}};
  });
}

export function unitPerUse(product, override={}, effectiveUses) {
  const volume=Number(product.volume);
  if(!Number.isFinite(volume) || volume<=0 || !Number.isFinite(effectiveUses) || effectiveUses<=0)return null;
  return volume/effectiveUses;
}

// 掲載終了や品目変更で無効になった固定・手動選択を候補の探索に持ち込まない。
export function reconcileCatalogState(state, catalog) {
  const categories = new Map(catalog.map(product => [product.jan, product.category]));
  const locked = Object.fromEntries(Object.entries(state.locked ?? {}).filter(
    ([category, id]) => categories.get(id) === category
  ));
  const manualCategories = Array.isArray(state.manual) ? state.manual.map(id => categories.get(id)) : [];
  const manual = manualCategories.length && !manualCategories.includes(undefined)
    && new Set(manualCategories).size === manualCategories.length ? state.manual : null;
  const ingredient = state.ingredient === 'グリチルリチン酸2K' ? DIPOTASSIUM_GLYCYRRHIZATE : state.ingredient;
  return {...state, ingredient, locked, manual, excluded: state.excluded ?? {}};
}
