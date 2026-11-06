// 外部で確認した価格・使用期間は元の商品DBの仮値と分けて保管する。
// JANが一致しない情報は採用しない。メーカー表示の「約」は概算として扱う。
export function mergeCatalogData(products, pricing={}, usage={}) {
  const prices=pricing.prices||{};
  const usages=usage.usages||{};
  const merged=products.map(product=>{
    const price=prices[product.id];
    const validPrice=price?.jan===product.jan && Number.isFinite(price.priceJPY) && price.priceJPY>=0 && /^https:\/\//.test(price.url||'');
    const amount=usages[product.id];
    const validUsage=amount && /^https:\/\//.test(amount.sourceUrl||'');
    const duration=Number(amount?.durationDays);
    const times=Number(amount?.referenceDailyUses);
    const referenceUses=validUsage && Number.isFinite(duration) && duration>0 && Number.isFinite(times) && times>0 ? duration*times : null;
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
    if(!product.referenceUses || !Number.isFinite(Number(product.volume)) || Number(product.volume)<=0)continue;
    const key=`${product.category}/${product.unit}`;
    if(!samples.has(key))samples.set(key,[]);
    samples.get(key).push(Number(product.volume)/product.referenceUses);
  }
  return merged.map(product=>{
    if(product.referenceUses)return {...product,usageEstimate:{kind:'duration',sampleCount:1}};
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
