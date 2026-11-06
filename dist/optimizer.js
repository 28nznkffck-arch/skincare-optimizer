export const CATEGORIES = ["cleanser", "toner", "serum", "moisturizer", "sunscreen"];
export const CATEGORY_LABELS = {
  cleanser: "洗顔", toner: "化粧水", serum: "美容液", moisturizer: "保湿", sunscreen: "日焼け止め"
};
export const CONCERN_GROUPS = [
  {label:"毛穴", items:{pores:"毛穴の目立ち", blackheads:"黒ずみ・角栓"}},
  {label:"肌の色", items:{dullness:"くすみ", spots:"シミ予防", freckles:"そばかす予防", unevenTone:"色ムラ"}},
  {label:"エイジング", items:{wrinkles:"シワ", fineLines:"小ジワ", firmness:"ハリ不足・たるみ"}},
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
  const price = priceOf(product,override);
  const uses = usesOf(product,override);
  const frequency = Number(override.frequency ?? product.dailyUses);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(uses) || uses <= 0 || !Number.isFinite(frequency) || frequency < 0) return Infinity;
  return Math.round(price / uses * frequency * 30);
}

export function priceOf(product, override={}) {
  return Number(override.price ?? product.referencePrice ?? product.demoPrice);
}

export function usesOf(product, override={}) {
  const amount=Number(override.amountPerUse);
  const volume=Number(product.volume);
  if(override.amountPerUse!=null && Number.isFinite(amount) && amount>0 && Number.isFinite(volume) && volume>0)
    return volume/amount;
  return Number(override.uses ?? product.referenceUses ?? product.demoUses);
}

// 「情報が未確認」は「配合されていない」や「非公表」と同義ではない。
// 濃度は出典付きの数値のみを認め、成分表の掲載順から推定しない。
export function transparencyDetails(product) {
  const evidence=product.evidence||{};
  const official=Boolean(evidence.officialSource || /^https:\/\/(www\.)?kao-kirei\.com\//.test(product.sourceUrl||''));
  const actives=Array.isArray(evidence.activeIngredients)?evidence.activeIngredients.filter(x=>typeof x==='string'&&x.trim()):[];
  const concentrations=Array.isArray(evidence.concentrations)?evidence.concentrations.filter(x=>
    x && typeof x.name==='string' && Number.isFinite(x.value) && x.value>0 &&
    typeof x.unit==='string' && x.unit.trim() && /^https:\/\//.test(x.sourceUrl||'')
  ):[];
  const level=official?(concentrations.length?3:actives.length?2:1):0;
  return {level,official,actives,concentrations,verifiedAt:evidence.verifiedAt||null};
}

const round2=n=>Math.round((n+Number.EPSILON)*100)/100;

export function explainRoutineScore(products, options={}) {
  const concerns = Array.isArray(options.concerns) ? options.concerns : ["pores", "dullness"];
  const parts=[];
  const push=(id,label,value,detail='')=>parts.push({id,label,value:round2(value),detail});
  for (const concern of concerns) {
    const ranked = products.map(p=>({name:`${p.brand} ${p.name}`,points:p.scores?.[concern]||0})).sort((a,b)=>b.points-a.points);
    const importance=CONCERN_WEIGHTS[options.concernWeights?.[concern]] || 1;
    const factors=[7,3,1];
    const points=ranked.slice(0,3).reduce((sum,p,i)=>sum+p.points*factors[i],0)*importance;
    push(`concern:${concern}`,CONCERNS[concern]||concern,points,
      ranked.slice(0,3).filter(p=>p.points).map(p=>`${p.name} ${p.points}点`).join(' / ')||'登録データに該当スコアなし');
  }
  // 化粧水・美容液は省略可能。ただし一律で高く減点すると、肌悩みの
  // 適合性が高い化粧水までほぼ必ず落選するので、少ない手順の利点は
  // 小さな「手間コスト」として扱い、悩みへの追加適合性と比較する。
  const stepPenalty = options.priority === "simple" ? 5 : options.priority === "thorough" ? 0 : 2;
  push('steps','追加ステップの手間',-products.filter(p=>p.category==="toner" || p.category==="serum").length * stepPenalty,
    `化粧水・美容液 1品あたり ${stepPenalty}点の手間コスト`);
  // 肌質・使用感は商品DBの暫定的な適合情報で加点。刺激の有無を保証するものではない。
  if(options.skinType==="dry") push('skin','乾燥肌との適合',Math.max(0,...products.map(p=>p.scores?.dryness||0))*1.8);
  if(options.skinType==="oily") push('skin','脂性肌との適合',Math.max(0,...products.map(p=>p.scores?.oiliness||0))*1.8);
  if(options.skinType==="combination") push('skin','混合肌との適合',(Math.max(0,...products.map(p=>p.scores?.dryness||0))+Math.max(0,...products.map(p=>p.scores?.oiliness||0)))*0.9);
  if(options.sensitiveSkin) push('sensitive','敏感肌向けの設計情報',products.filter(p=>p.sensitiveSkin).length*3);
  if(options.finish && options.finish!=="any") {
    push('finish','使用感の好み',products.filter(p=>["toner","moisturizer"].includes(p.category) && p.feel===options.finish).length*2);
  }
  if (options.ingredient && options.ingredient !== "none") {
    const matches = products.filter(p=>p.keyIngredients?.some(k=>k.includes(options.ingredient)));
    push('ingredient','使ってみたい成分',matches.length ? 10 : 0,`${options.ingredient}：${matches.length}品該当`);
  }
  // 予算は optimize() 側の上限制約。費用を適合スコアに混ぜず、
  // 同点の候補だけ安いほうを先に並べる。
  const distinct = new Set(products.flatMap(p=>p.keyIngredients||[]));
  push('diversity','成分の種類',Math.min(distinct.size,12) * 0.25,`登録された主要成分 ${distinct.size}種類`);
  const meanTransparency=products.length?products.reduce((sum,p)=>sum+transparencyDetails(p).level,0)/products.length:0;
  // 個数の多い組み合わせを有利にしないため「1品あたり平均」で小さく加点。
  push('transparency','情報公開の確認状況',round2(meanTransparency*0.35),'公式情報や公表濃度の確認レベルの平均。効果の強さではありません');
  const subtotal=round2(parts.filter(p=>p.id!=='transparency').reduce((sum,p)=>sum+p.value,0));
  return {parts,subtotal,transparency:parts.at(-1).value,total:round2(subtotal+parts.at(-1).value)};
}

export function scoreRoutine(products, options={}) {return explainRoutineScore(products,options).total;}

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
  // 通常画面・採否診断では首位候補のみ必要。全件の配列生成とソートを省き、
  // 商品DB拡張後も選定結果の厳密性とモバイル操作の軽さを両立する。
  const firstOnly=options.resultLimit===1;
  const minimumMonthly=options.objective==='minimumMonthly';
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
  let best=null;
  function enumerate(index,chosen,spent){
    if(spent>budget || (firstOnly && minimumMonthly && best && spent>=best.monthly)) return;
    if (index===grouped.length) {
      const products=chosen.filter(Boolean);
      if(options.ingredientMode==="required" && options.ingredient && options.ingredient!=="none" && !products.some(p=>p.keyIngredients?.some(k=>k.includes(options.ingredient)))) return;
      const result=evaluate(products,options);
      if (result.monthly>budget) return;
      if(firstOnly){
        if(!best || (minimumMonthly ? result.monthly<best.monthly : result.score>best.score || (result.score===best.score && result.monthly<best.monthly))) best=result;
      } else all.push(result);
      return;
    }
    for(const product of grouped[index]) {
      chosen.push(product);
      enumerate(index+1,chosen,spent+(product?monthlyCost(product,options.overrides?.[product.id]):0));
      chosen.pop();
    }
  }
  enumerate(0,[],0);
  if(firstOnly) return best?[best]:[];
  all.sort((a,b)=>minimumMonthly?a.monthly-b.monthly:b.score-a.score || a.monthly-b.monthly);
  return all;
}

// 商品単独の点数ではなく「その商品を採用した最良の組み合わせ」を比較する。
// 高コストの再探索はデバッグ画面で商品を指定した時だけ実行する。
export function diagnoseProduct(catalog,options={},productId,baseline=null) {
  const product=catalog.find(p=>p.id===productId);
  if(!product)return {status:'missing',reason:'商品DBに存在しません。'};
  if(!options.concerns?.length)return {status:'no_concern',reason:'先にメイン画面で肌悩みを選択してください。'};
  const excluded=new Set(options.excluded||[]);
  if(excluded.has(productId))return {status:'excluded',reason:'ユーザーの「合わない・除外」設定で候補から外れています。'};
  if(options.locked?.[product.category]&&options.locked[product.category]!==productId)
    return {status:'locked',reason:'同じ品目で別の商品が固定されているため、候補に入れられません。'};
  const best=baseline||optimize(catalog,{...options,resultLimit:1})[0]||null;
  if(!best)return {status:'no_base',reason:'現在の予算・固定・必須成分の条件で成立する組み合わせがありません。'};
  if(best.products.some(p=>p.id===productId))
    return {status:'selected',reason:'自動選定の最良の組み合わせに採用されています。',best,forced:best,scoreGap:0,monthlyGap:0};
  const forcedOptions={...options,locked:{...(options.locked||{}),[product.category]:productId}};
  const forced=optimize(catalog,{...forcedOptions,resultLimit:1})[0]||null;
  if(!forced){
    const cheapest=optimize(catalog,{...forcedOptions,budget:Number.MAX_SAFE_INTEGER,resultLimit:1,objective:'minimumMonthly'})[0];
    const minimum=cheapest?.monthly??null;
    if(minimum!==null && minimum>Number(options.budget??5000))
      return {status:'budget',reason:`この商品を入れて必須品目を揃えるには最低でも月${minimum.toLocaleString('ja-JP')}円必要です。`,best,minimum};
    return {status:'unavailable',reason:'現在の固定・除外・必須成分条件を満たす組み合わせが作れません。',best};
  }
  const scoreGap=round2(best.score-forced.score),monthlyGap=forced.monthly-best.monthly;
  const reason=scoreGap>0.005?`採用すると組み合わせ全体の評価が${scoreGap.toFixed(2)}点低くなるため、今回は不採用です。`:
    monthlyGap>0?`評価は同点ですが、月額が${monthlyGap.toLocaleString('ja-JP')}円高いため不採用です。`:
    '他の同等候補が先に選ばれています。';
  return {status:'not_selected',reason,best,forced,scoreGap,monthlyGap};
}

export function swaps(routine, catalog, category, options={}, extra=100) {
  if (!routine) return [];
  const current = routine.products.find(p=>p.category===category);
  // 「入れ替える」は追加ではない。固定品を勝手に変更してもいけない。
  if(!current || options.locked?.[category]) return [];
  const excluded=new Set(options.excluded||[]);
  const output=[];
  for(const product of catalog.filter(p=>p.category===category && p.id!==current?.id && !excluded.has(p.id))){
    const next=current ? routine.products.map(p=>p.id===current.id?product:p) : [...routine.products,product];
    if(options.ingredientMode==="required" && options.ingredient && options.ingredient!=="none" && !next.some(p=>p.keyIngredients.some(k=>k.includes(options.ingredient)))) continue;
    const candidate=evaluate(next,options);
    if(candidate.monthly<=Number(options.budget??5000) && candidate.monthly-routine.monthly<=extra){
      output.push({...candidate,replacement:product,delta:candidate.monthly-routine.monthly,scoreDelta:candidate.score-routine.score});
    }
  }
  return output.sort((a,b)=>b.scoreDelta-a.scoreDelta || a.delta-b.delta);
}
