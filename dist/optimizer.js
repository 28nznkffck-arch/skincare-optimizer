export const CATEGORIES = ["cleanser", "toner", "serum", "moisturizer", "sunscreen"];
export const CATEGORY_LABELS = {
  cleanser: "洗顔", toner: "化粧水", serum: "美容液", moisturizer: "保湿", sunscreen: "日焼け止め"
};
export const CONCERN_GROUPS = [
  {label:"毛穴", items:{pores:"毛穴の目立ち", blackheads:"黒ずみ・角栓"}},
  {label:"肌の色", items:{dullness:"くすみ", spots:"シミ予防", freckles:"そばかす", unevenTone:"色ムラ"}},
  {label:"エイジング", items:{wrinkles:"シワ", fineLines:"小ジワ", firmness:"ハリ不足"}},
  {label:"皮脂", items:{oiliness:"ベタつき", shine:"テカリ"}},
  {label:"肌荒れ", items:{acne:"ニキビ", redness:"赤み", irritation:"肌荒れ"}},
  {label:"保湿", items:{dryness:"乾燥"}}
];
export const CONCERNS = Object.assign({}, ...CONCERN_GROUPS.map(group=>group.items));
export const CONCERN_WEIGHTS = {high:1.6, normal:1, low:0.55};

export function unscoredConcerns(catalog, concerns=[]) {
  return concerns.filter(id=>!catalog.some(p=>(p.scores?.[id]||0)>0));
}

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
  const concerns = Array.isArray(options.concerns) ? options.concerns : ["pores", "dullness"];
  let score = 0;
  for (const concern of concerns) {
    const ranked = products.map(p => p.scores?.[concern] || 0).sort((a,b)=>b-a);
    const importance=CONCERN_WEIGHTS[options.concernWeights?.[concern]] || 1;
    score += ((ranked[0]||0)*7 + (ranked[1]||0)*3 + (ranked[2]||0))*importance;
  }
  // 化粧水・美容液は省略可能。ただし一律で高く減点すると、肌悩みの
  // 適合性が高い化粧水までほぼ必ず落選するので、少ない手順の利点は
  // 小さな「手間コスト」として扱い、悩みへの追加適合性と比較する。
  const stepPenalty = options.priority === "simple" ? 5 : options.priority === "cost" ? 4 : 2;
  score -= products.filter(p=>p.category==="toner" || p.category==="serum").length * stepPenalty;
  // 肌質・使用感は商品DBの暫定的な適合情報で加点。刺激の有無を保証するものではない。
  if(options.skinType==="dry") score+=Math.max(0,...products.map(p=>p.scores?.dryness||0))*1.8;
  if(options.skinType==="oily") score+=Math.max(0,...products.map(p=>p.scores?.oiliness||0))*1.8;
  if(options.skinType==="combination") score+=(Math.max(0,...products.map(p=>p.scores?.dryness||0))+Math.max(0,...products.map(p=>p.scores?.oiliness||0)))*0.9;
  if(options.sensitiveSkin) score+=products.filter(p=>p.sensitiveSkin).length*3;
  if(options.finish && options.finish!=="any") {
    score+=products.filter(p=>["toner","moisturizer"].includes(p.category) && p.feel===options.finish).length*2;
  }
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
