// 外部で確認した価格・使用期間は元の商品DBの仮値と分けて保管する。
// JANが一致しない情報は採用しない。メーカー表示の「約」は概算として扱う。
export function mergeCatalogData(products, pricing={}, usage={}) {
  const prices=pricing.prices||{};
  const usages=usage.usages||{};
  return products.map(product=>{
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
}

export function unitPerUse(product, override={}, effectiveUses) {
  const volume=Number(product.volume);
  if(!Number.isFinite(volume) || volume<=0 || !Number.isFinite(effectiveUses) || effectiveUses<=0)return null;
  return volume/effectiveUses;
}
