export const CATEGORIES = ["cleanser", "toner", "serum", "moisturizer", "sunscreen"];
export const CATEGORY_LABELS = {
  cleanser: "洗顔", toner: "化粧水", serum: "美容液", moisturizer: "保湿", sunscreen: "日焼け止め"
};
export const CONCERNS = {pores:"毛穴", dullness:"くすみ", dryness:"乾燥"};

export function monthlyCost(product, override = {}) {
  const price = Number(override.price ?? product.demoPrice);
  const uses = Number(override.uses ?? product.demoUses);
  const frequency = Number(override.frequency ?? product.dailyUses);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(uses) || uses <= 0 || !Number.isFinite(frequency) || frequency < 0) return Infinity;
  return Math.round(price / uses * frequency * 30);
}

export function priceOf(product, override={}) {
  return Number(override.price ?? product.demoPrice);
}

export function scoreRoutine(products, options={}) {
  const concerns = options.concerns?.length ? options.concerns : ["pores", "dullness"];
  let score = 0;
  for (const concern of concerns) {
    const ranked = products.map(p => p.scores?.[concern] || 0).sort((a,b)=>b-a);
    score += (ranked[0]||0)*7 + (ranked[1]||0)*3 + (ranked[2]||0);
  }
  // 化粧水・美容液は省略可能。ただし一律で高く減点すると、肌悩みの
  // 適合性が高い化粧水までほぼ必ず落選するので、少ない手順の利点は
  // 小さな「手間コスト」として扱い、悩みへの追加適合性と比較する。
  const stepPenalty = options.priority === "simple" ? 5 : options.priority === "cost" ? 4 : 2;
  score -= products.filter(p=>p.category==="toner" || p.category==="serum").length * stepPenalty;
  if (options.ingredient && options.ingredient !== "none") {
    const matches = products.filter(p=>p.keyIngredients?.some(k=>k.includes(options.ingredient)));
    score += matches.length ? (options.priority === "simple" ? 7 : 10) : 0;
  }
  const cost = products.reduce((sum,p)=>sum+monthlyCost(p, options.overrides?.[p.id]),0);
  score -= cost * (options.priority === "cost" ? 0.005 : 0.0015);
  const distinct = new Set(products.flatMap(p=>p.keyIngredients||[]));
  score += Math.min(distinct.size,12) * 0.25;
  return Math.round(score*100)/100;
}

export function evaluate(products, options={}) {
  return {
    products,
    monthly: products.reduce((sum,p)=>sum+monthlyCost(p, options.overrides?.[p.id]),0),
    initial: products.reduce((sum,p)=>sum+priceOf(p, options.overrides?.[p.id]),0),
    score: scoreRoutine(products,options)
  };
}

export function optimize(catalog, options={}) {
  const budget = Number(options.budget ?? 5000);
  const excluded = new Set(options.excluded||[]);
  const locked = options.locked || {};
  const grouped = CATEGORIES.map(cat=>{
    let choices = catalog.filter(p=>p.category===cat && !excluded.has(p.id));
    if (locked[cat]) choices=choices.filter(p=>p.id===locked[cat]);
    if (cat==="toner" || cat==="serum") {
      if (!locked[cat]) choices=[null,...choices];
    }
    return choices;
  });
  if (grouped.some(x=>!x.length)) return [];
  const all=[];
  function enumerate(index,chosen){
    if (index===grouped.length) {
      const products=chosen.filter(Boolean);
      if(options.ingredientMode==="required" && options.ingredient && options.ingredient!=="none" && !products.some(p=>p.keyIngredients?.some(k=>k.includes(options.ingredient)))) return;
      const result=evaluate(products,options);
      if (result.monthly<=budget) all.push(result);
      return;
    }
    for(const product of grouped[index]) enumerate(index+1,[...chosen,product]);
  }
  enumerate(0,[]);
  all.sort((a,b)=>b.score-a.score || a.monthly-b.monthly);
  return all;
}

export function swaps(routine, catalog, category, options={}, extra=100) {
  if (!routine) return [];
  const current = routine.products.find(p=>p.category===category);
  const excluded=new Set(options.excluded||[]);
  const output=[];
  for(const product of catalog.filter(p=>p.category===category && p.id!==current?.id && !excluded.has(p.id))){
    const next=current ? routine.products.map(p=>p.id===current.id?product:p) : [...routine.products,product];
    if(options.ingredientMode==="required" && options.ingredient && options.ingredient!=="none" && !next.some(p=>p.keyIngredients.some(k=>k.includes(options.ingredient)))) continue;
    const candidate=evaluate(next,options);
    if(candidate.monthly<=Number(options.budget||5000) && candidate.monthly-routine.monthly<=extra){
      output.push({...candidate,replacement:product,delta:candidate.monthly-routine.monthly,scoreDelta:candidate.score-routine.score});
    }
  }
  return output.sort((a,b)=>b.scoreDelta-a.scoreDelta || a.delta-b.delta);
}
