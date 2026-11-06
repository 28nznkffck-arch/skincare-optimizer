import {monthlyCost, priceOf} from './optimizer.js';

// 保存した組み合わせの使用条件は、その時点の値を個別に保持する。
// 価格などの共通編集が、過去の保存プランを書き換えないようにするため。
export function createSavedPlan(routine, options, id, createdAt) {
  if (!routine?.products?.length || !id) throw new Error('保存対象がありません');
  return {
    id,
    name:'組み合わせ',
    createdAt,
    budget:Number(options.budget ?? 5000),
    productIds:routine.products.map(p=>p.id),
    overrides:Object.fromEntries(routine.products.map(p=>[p.id,{
      price:Number(options.overrides?.[p.id]?.price ?? p.demoPrice),
      uses:Number(options.overrides?.[p.id]?.uses ?? p.demoUses),
      frequency:Number(options.overrides?.[p.id]?.frequency ?? p.dailyUses)
    }])),
    conditions:{
      concerns:[...(options.concerns||[])],
      concernWeights:{...(options.concernWeights||{})},
      skinType:options.skinType||'unknown',
      sensitiveSkin:Boolean(options.sensitiveSkin),
      finish:options.finish||'any',
      priority:options.priority||'any',
      ingredient:options.ingredient||'none',
      ingredientMode:options.ingredientMode||'prefer'
    }
  };
}

export function savedPlanTotals(plan, catalog) {
  const lookup=new Map(catalog.map(p=>[p.id,p]));
  const items=plan.productIds.map(id=>lookup.get(id)).filter(Boolean);
  const missing=plan.productIds.filter(id=>!lookup.has(id));
  const monthly=items.reduce((sum,p)=>sum+monthlyCost(p,plan.overrides?.[p.id]),0);
  const initial=items.reduce((sum,p)=>sum+priceOf(p,plan.overrides?.[p.id]),0);
  return {items,missing,monthly,initial,budget:Number(plan.budget),remaining:Number(plan.budget)-monthly};
}

export function updateSavedUsage(plan, productId, field, value) {
  const number=Number(value);
  if (!plan.productIds.includes(productId) || !['price','uses','frequency'].includes(field)) return false;
  if (!Number.isFinite(number) || number<(field==='uses'?1:0)) return false;
  plan.overrides??={};
  plan.overrides[productId]??={};
  plan.overrides[productId][field]=number;
  return true;
}
