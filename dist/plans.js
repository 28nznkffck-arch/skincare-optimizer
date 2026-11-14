import {monthlyCost, priceOf, usesOf} from './optimizer.js?v=0.8.9';

// 保存した組み合わせの使用条件は、その時点の値を個別に保持する。
// 価格などの共通編集が、過去の保存プランを書き換えないようにするため。
export function createSavedPlan(routine, options, id, createdAt) {
  if (!routine?.products?.length || !id) throw new Error('保存対象がありません');
  return {
    id,
    name:'組み合わせ',
    createdAt,
    budget:Number(options.budget ?? 5000),
    productJans:routine.products.map(p=>p.jan),
    overrides:Object.fromEntries(routine.products.map(p=>[p.jan,{
      price:priceOf(p,options.overrides?.[p.jan]),
      uses:usesOf(p,options.overrides?.[p.jan]),
      frequency:Number(options.overrides?.[p.jan]?.frequency ?? p.dailyUses)
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
  const lookup=new Map(catalog.map(p=>[p.jan,p]));
  const items=plan.productJans.map(id=>lookup.get(id)).filter(Boolean);
  const missing=plan.productJans.filter(id=>!lookup.has(id));
  const monthly=items.reduce((sum,p)=>sum+monthlyCost(p,plan.overrides?.[p.jan]),0);
  const initial=items.reduce((sum,p)=>sum+priceOf(p,plan.overrides?.[p.jan]),0);
  return {items,missing,monthly,initial,budget:Number(plan.budget),remaining:Number(plan.budget)-monthly};
}

export function updateSavedUsage(plan, productJan, field, value) {
  const number=Number(value);
  if (!plan.productJans.includes(productJan) || !['price','uses','frequency'].includes(field)) return false;
  if (!Number.isFinite(number) || number<(field==='uses'?1:0)) return false;
  plan.overrides??={};
  plan.overrides[productJan]??={};
  plan.overrides[productJan][field]=number;
  return true;
}
