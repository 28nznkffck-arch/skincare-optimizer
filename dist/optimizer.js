export const CATEGORIES = ["makeupRemover", "cleanser", "toner", "serum", "moisturizer", "eyeCare"];
export const CATEGORY_LABELS = {
  makeupRemover: "メイク落とし", cleanser: "洗顔", toner: "化粧水", serum: "美容液", moisturizer: "保湿", eyeCare: "目元ケア"
};
export const CONCERN_GROUPS = [
  {label:"毛穴", items:{pores:"毛穴の目立ち", blackheads:"黒ずみ・角栓"}},
  {label:"肌の色", items:{dullness:"くすみ", spots:"シミ", freckles:"そばかす", unevenTone:"色ムラ"}},
  {label:"目元", items:{eyeDryness:"目元の乾燥", darkCircles:"クマ"}},
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
  return Number(override.uses ?? product.referenceUses ?? product.estimatedUses ?? product.demoUses);
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

const concernWeight = (options, concern) => CONCERN_WEIGHTS[options.concernWeights?.[concern]] || 1;
const stepPenaltyFor = options => options.priority === "simple" ? 5 : options.priority === "thorough" ? 0 : 2;
const isExtraStep = category => ["toner", "serum", "eyeCare"].includes(category);
const matchesFinish = (product, options) => options.finish && options.finish !== "any"
  && ["toner", "moisturizer"].includes(product.category) && product.feel === options.finish;
const matchesIngredient = (product, options) => Boolean(options.ingredient && options.ingredient !== "none"
  && product.keyIngredients?.some(name => name.includes(options.ingredient)));

const round2=n=>Math.round((n+Number.EPSILON)*100)/100;

export function explainRoutineScore(products, options={}) {
  const concerns = Array.isArray(options.concerns) ? options.concerns : ["pores", "dullness"];
  const parts=[];
  const push=(id,label,value,detail='')=>parts.push({id,label,value:round2(value),detail});
  for (const concern of concerns) {
    const ranked = products.map(p=>({name:`${p.brand} ${p.name}`,points:p.scores?.[concern]||0})).sort((a,b)=>b.points-a.points);
    const importance=concernWeight(options, concern);
    const factors=[7,3,1];
    const points=ranked.slice(0,3).reduce((sum,p,i)=>sum+p.points*factors[i],0)*importance;
    push(`concern:${concern}`,CONCERNS[concern]||concern,points,
      ranked.slice(0,3).filter(p=>p.points).map(p=>`${p.name} ${p.points}点`).join(' / ')||'登録データに該当スコアなし');
  }
  // 化粧水・美容液は省略可能。ただし一律で高く減点すると、肌悩みの
  // 適合性が高い化粧水までほぼ必ず落選するので、少ない手順の利点は
  // 小さな「手間コスト」として扱い、悩みへの追加適合性と比較する。
  const stepPenalty = stepPenaltyFor(options);
  push('steps','追加ステップの手間',-(products.filter(p=>isExtraStep(p.category)).length + (options.useMakeupRemover && products.some(p=>p.category==="cleanser")?1:0)) * stepPenalty,
    `化粧水・美容液 1品あたり ${stepPenalty}点の手間コスト`);
  // 肌質・使用感は商品DBの暫定的な適合情報で加点。刺激の有無を保証するものではない。
  if(options.skinType==="dry") push('skin','乾燥肌との適合',Math.max(0,...products.map(p=>p.scores?.dryness||0))*1.8);
  if(options.skinType==="oily") push('skin','脂性肌との適合',Math.max(0,...products.map(p=>p.scores?.oiliness||0))*1.8);
  if(options.skinType==="combination") push('skin','混合肌との適合',(Math.max(0,...products.map(p=>p.scores?.dryness||0))+Math.max(0,...products.map(p=>p.scores?.oiliness||0)))*0.9);
  if(options.sensitiveSkin) push('sensitive','敏感肌向けの設計情報',products.filter(p=>p.sensitiveSkin).length*3);
  if(options.finish && options.finish!=="any") {
    push('finish','使用感の好み',products.filter(p=>matchesFinish(p, options)).length*2);
  }
  if (options.ingredient && options.ingredient !== "none") {
    const matches = products.filter(p=>matchesIngredient(p, options));
    push('ingredient','使ってみたい成分',matches.length ? 10 : 0,`${options.ingredient}：${matches.length}品該当`);
  }
  // 予算は optimize() 側の上限制約。費用を適合スコアに混ぜず、
  // 同点の候補だけ安いほうを先に並べる。
  if (concerns.length) {
    const distinct = new Set(products.flatMap(p=>p.keyIngredients||[]));
    push('diversity','成分の種類',Math.min(distinct.size,12) * 0.25,`登録された主要成分 ${distinct.size}種類`);
  }
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
    monthly: products.reduce((sum,p)=>sum+monthlyCost(p, options.overrides?.[p.jan]),0),
    initial: products.reduce((sum,p)=>sum+priceOf(p, options.overrides?.[p.jan]),0),
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
    let choices = catalog.filter(p=>p.category===cat && !excluded.has(p.jan));
    if (locked[cat]) choices=choices.filter(p=>p.jan===locked[cat]);
    if (cat==="makeupRemover") {
      if (!options.useMakeupRemover) choices=[null];
    } else if (cat==="eyeCare") {
      // 目元乾燥を選択した人だけ部分ケアを任意追加する。
      if (!options.concerns?.includes("eyeDryness")) choices=[null];
      else if (!locked[cat]) choices=[null,...choices];
    } else if (cat==="cleanser" && options.useMakeupRemover) {
      // メイク落としで洗浄が完結する場合、洗顔は任意。手軽さ重視は省く。
      if (!locked[cat]) choices=options.priority==="simple"?[null]:[null,...choices];
    } else if (cat==="toner" || cat==="serum") {
      if (!locked[cat]) choices=[null,...choices];
    }
    return choices;
  });
  if (grouped.some(x=>!x.length)) return [];
  if (firstOnly && !minimumMonthly) return findBestRoutine(grouped, budget, options);
  const all=[];
  let best=null;
  function enumerate(index,chosen,spent){
    if(spent>budget || (firstOnly && minimumMonthly && best && spent>=best.monthly)) return;
    if (index===grouped.length) {
      const products=chosen.filter(Boolean);
      if(options.useMakeupRemover && !products.some(p=>p.category==="makeupRemover")) return;
      if(options.useMakeupRemover && !products.some(p=>p.category==="cleanser") && products.some(p=>p.category==="makeupRemover" && !p.doubleCleanseNotNeeded)) return;
      if(options.priority==="simple" && options.useMakeupRemover && !locked.cleanser && products.some(p=>p.category==="cleanser")) return;
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
      enumerate(index+1,chosen,spent+(product?monthlyCost(product,options.overrides?.[product.jan]):0));
      chosen.pop();
    }
  }
  enumerate(0,[],0);
  if(firstOnly) return best?[best]:[];
  all.sort((a,b)=>minimumMonthly?a.monthly-b.monthly:b.score-a.score || a.monthly-b.monthly);
  return all;
}

// 残りの品目を最も有利に見積もり、首位を更新できる組み合わせだけを探索する。
function findBestRoutine(grouped, budget, options) {
  const concerns = Array.isArray(options.concerns) ? options.concerns : ["pores", "dullness"];
  const weights = concerns.map(concern => concernWeight(options, concern));
  const requireIngredient = options.ingredientMode === "required" && options.ingredient && options.ingredient !== "none";
  const stepPenalty = stepPenaltyFor(options);
  // 洗浄・保湿から試す。完全同点時の判定と出力は元の品目順に従う。
  const visitOrder = ["makeupRemover", "cleanser", "moisturizer", "toner", "serum", "eyeCare"]
    .map(category => CATEGORIES.indexOf(category));
  const cleanserSlot = CATEGORIES.indexOf("cleanser");
  const groups = visitOrder.map(slot => {
    const entries = grouped[slot].map((product, order) => ({
      product, order,
      cost: product ? monthlyCost(product, options.overrides?.[product.jan]) : 0,
      points: concerns.map(concern => Math.max(0, product?.scores?.[concern] || 0)),
      dryness: product?.scores?.dryness || 0,
      oiliness: product?.scores?.oiliness || 0,
      ingredients: product?.keyIngredients?.length || 0,
      match: product ? matchesIngredient(product, options) : false,
      sensitive: Number(Boolean(options.sensitiveSkin && product?.sensitiveSkin)),
      finish: Number(Boolean(product && matchesFinish(product, options))),
      penalty: product && (isExtraStep(product.category) || (product.category === "cleanser" && options.useMakeupRemover)) ? stepPenalty : 0,
      transparency: product ? transparencyDetails(product).level : 0,
    })).filter(entry => entry.cost <= budget);
    if (entries.length > 1 && grouped[slot][0] !== null) {
      for (const entry of entries) entry.singleScore = scoreRoutine([entry.product], options);
      entries.sort((a, b) => b.singleScore - a.singleScore || a.order - b.order);
    }
    return entries;
  });
  if (groups.some(group => !group.length)) return [];

  const maxima = groups.map(group => ({
    points: concerns.map((_, i) => Math.max(...group.map(entry => entry.points[i]))),
    cost: Math.min(...group.map(entry => entry.cost)),
    penalty: Math.min(...group.map(entry => entry.penalty)),
    dryness: Math.max(...group.map(entry => entry.dryness)),
    oiliness: Math.max(...group.map(entry => entry.oiliness)),
    ingredients: Math.max(...group.map(entry => entry.ingredients)),
    match: group.some(entry => entry.match),
    sensitive: Math.max(...group.map(entry => entry.sensitive)),
    finish: Math.max(...group.map(entry => entry.finish)),
    transparency: Math.max(...group.map(entry => entry.transparency)),
    canOmit: group.some(entry => entry.product === null),
    canInclude: group.some(entry => entry.product !== null),
  }));
  const empty = {cost: 0, penalty: 0, dryness: 0, oiliness: 0, ingredients: 0,
    match: false, sensitive: 0, finish: 0, transparency: 0, count: 0};
  const remaining = new Array(groups.length + 1);
  remaining[groups.length] = {...empty, transparencyByCount: [0]};
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = maxima[i];
    const rest = remaining[i + 1];
    // 平均の加点は品数でも変わるので、追加する品数ごとに上限を持つ。
    const transparencyByCount = new Array(rest.transparencyByCount.length + 1).fill(-Infinity);
    for (const [count, total] of rest.transparencyByCount.entries()) {
      if (group.canOmit) transparencyByCount[count] = Math.max(transparencyByCount[count], total);
      if (group.canInclude) transparencyByCount[count + 1] = Math.max(transparencyByCount[count + 1], total + group.transparency);
    }
    remaining[i] = {...combineSearchValues(group, rest), transparencyByCount};
  }

  const chosen = new Array(groups.length);
  const depthBySlot = CATEGORIES.map((_, slot) => visitOrder.indexOf(slot));
  let best, bestOrder;
  function scoreCeiling(depth, used) {
    const rest = remaining[depth];
    let score = -used.penalty - rest.penalty;
    for (let i = 0; i < weights.length; i++) {
      let first = 0, second = 0, third = 0;
      for (let j = 0; j < groups.length; j++) {
        const points = (j < depth ? chosen[j] : maxima[j]).points[i];
        if (points > first) { third = second; second = first; first = points; }
        else if (points > second) { third = second; second = points; }
        else if (points > third) third = points;
      }
      score += round2((first * 7 + second * 3 + third) * weights[i]);
    }
    const dryness = Math.max(used.dryness, rest.dryness);
    const oiliness = Math.max(used.oiliness, rest.oiliness);
    if (options.skinType === "dry") score += round2(dryness * 1.8);
    if (options.skinType === "oily") score += round2(oiliness * 1.8);
    if (options.skinType === "combination") score += round2((dryness + oiliness) * 0.9);
    score += (used.sensitive + rest.sensitive) * 3 + (used.finish + rest.finish) * 2
      + (used.match || rest.match ? 10 : 0);
    // 成分数の合計は重複を含むため、異なる成分数の上限になる。
    if (concerns.length) score += Math.min(used.ingredients + rest.ingredients, 12) * 0.25;
    let transparency = 0;
    for (let count = 0; count < rest.transparencyByCount.length; count++) {
      if (used.count + count > 0)
        transparency = Math.max(transparency, (used.transparency + rest.transparencyByCount[count]) / (used.count + count));
    }
    return round2(round2(score) + round2(transparency * 0.35));
  }

  function visit(depth, used) {
    const rest = remaining[depth];
    const minCost = used.cost + rest.cost;
    if (minCost > budget || (requireIngredient && !used.match && !rest.match)) return;
    if (best) {
      const ceiling = scoreCeiling(depth, used);
      if (ceiling < best.score || (ceiling === best.score && minCost > best.monthly)) return;
    }
    if (depth === groups.length) {
      const entries = depthBySlot.map(i => chosen[i]);
      const products = entries.map(entry => entry.product).filter(Boolean);
      const candidate = {
        products,
        monthly: used.cost,
        initial: products.reduce((sum, product) => sum + priceOf(product, options.overrides?.[product.jan]), 0),
        score: scoreRoutine(products, options),
      };
      const firstDifference = bestOrder ? entries.findIndex((entry, i) => entry.order !== bestOrder[i]) : -1;
      const earlier = firstDifference >= 0 && entries[firstDifference].order < bestOrder[firstDifference];
      if (!best || candidate.score > best.score || (candidate.score === best.score &&
        (candidate.monthly < best.monthly || (candidate.monthly === best.monthly && earlier)))) {
        best = candidate;
        bestOrder = entries.map(entry => entry.order);
      }
      return;
    }
    for (const entry of groups[depth]) {
      // メイク落としが単独で使えない場合は洗顔を省略できない。
      if (visitOrder[depth] === cleanserSlot && !entry.product &&
          chosen[0].product && !chosen[0].product.doubleCleanseNotNeeded) continue;
      chosen[depth] = entry;
      visit(depth + 1, combineSearchValues(used, entry, Number(Boolean(entry.product))));
    }
  }
  visit(0, empty);
  return best ? [best] : [];
}

function combineSearchValues(a, b, addedCount = 0) {
  return {
    cost: a.cost + b.cost,
    penalty: a.penalty + b.penalty,
    dryness: Math.max(a.dryness, b.dryness),
    oiliness: Math.max(a.oiliness, b.oiliness),
    ingredients: a.ingredients + b.ingredients,
    match: a.match || b.match,
    sensitive: a.sensitive + b.sensitive,
    finish: a.finish + b.finish,
    transparency: a.transparency + b.transparency,
    count: (a.count || 0) + addedCount,
  };
}

// 商品単独の点数ではなく「その商品を採用した最良の組み合わせ」を比較する。
// 高コストの再探索はデバッグ画面で商品を指定した時だけ実行する。
export function diagnoseProduct(catalog,options={},productJan,baseline=null) {
  const product=catalog.find(p=>p.jan===productJan);
  if(!product)return {status:'missing',reason:'商品DBに存在しません。'};
  const excluded=new Set(options.excluded||[]);
  if(excluded.has(productJan))return {status:'excluded',reason:'ユーザーの「合わない・除外」設定で候補から外れています。'};
  if(options.locked?.[product.category]&&options.locked[product.category]!==productJan)
    return {status:'locked',reason:'同じ品目で別の商品が固定されているため、候補に入れられません。'};
  const best=baseline||optimize(catalog,{...options,resultLimit:1})[0]||null;
  if(!best){
    // 予算内で候補を作れなくても、費用最小の成立例については採点できる。
    const cheapest=optimize(catalog,{...options,budget:Number.MAX_SAFE_INTEGER,resultLimit:1,objective:'minimumMonthly'})[0]||null;
    if(!cheapest)return {status:'no_base',reason:'予算を外しても、現在の固定・除外・必須成分の条件を満たす組み合わせがありません。'};
    const current=cheapest.products.find(p=>p.category===product.category);
    const next=current?cheapest.products.map(p=>p.jan===current.jan?product:p):[...cheapest.products,product];
    if(options.ingredientMode==='required' && options.ingredient && options.ingredient!=='none' && !next.some(p=>p.keyIngredients?.some(k=>k.includes(options.ingredient))))
      return {status:'unavailable',reason:'この1品の置き換えでは、必須成分の条件が成立しません。'};
    const preview=evaluate(next,options);
    return {status:'budget',reason:`現予算内に成立する組み合わせはありませんが、予算を外して1品を置き換えた場合も評価できます。この例の月額は${preview.monthly.toLocaleString('ja-JP')}円です。`,
      best:cheapest,forced:preview,comparisonMode:'unbudgetedExample'};
  }
  if(best.products.some(p=>p.jan===productJan))
    return {status:'selected',reason:'自動選定の最良の組み合わせに採用されています。',best,forced:best,scoreGap:0,monthlyGap:0};
  const forcedOptions={...options,locked:{...(options.locked||{}),[product.category]:productJan}};
  // 予算内に組み直せた場合も、他の商品の入れ替えを伴わない純粋な1品交換を
  // 別途採点する。安い組み合わせへ再探索したために高額アップグレードの
  // 得点が隠れてしまう事態を避ける。
  const prior=best.products.find(p=>p.category===product.category);
  const next=prior?best.products.map(p=>p.jan===prior.jan?product:p):[...best.products,product];
  const meetsIngredient=options.ingredientMode!=='required'||!options.ingredient||options.ingredient==='none'||next.some(p=>p.keyIngredients?.some(k=>k.includes(options.ingredient)));
  const singleChange=meetsIngredient?evaluate(next,options):null;
  const forced=optimize(catalog,{...forcedOptions,resultLimit:1})[0]||null;
  if(!forced){
    // 予算の判定を採点より後にする。高額だからという理由で評価点を消さない。
    if(!singleChange)
      return {status:'unavailable',reason:'この1品の置き換えでは、必須成分の条件が成立しません。',best};
    const cheapest=optimize(catalog,{...forcedOptions,budget:Number.MAX_SAFE_INTEGER,resultLimit:1,objective:'minimumMonthly'})[0];
    const minimum=cheapest?.monthly??null;
    if(minimum!==null && minimum>Number(options.budget??5000))
      return {status:'budget',reason:`元の組み合わせの${prior?'1品を入れ替え':'任意品目として追加'}ると月${singleChange.monthly.toLocaleString('ja-JP')}円で、現在の予算を超えます。評価点は予算に関係なく計算しています。`,
        best,forced:singleChange,minimum,comparisonMode:'singleChange',scoreGap:round2(best.score-singleChange.score),monthlyGap:singleChange.monthly-best.monthly};
    return {status:'unavailable',reason:'現在の固定・除外・必須成分条件を満たす組み合わせが作れません。',best};
  }
  const scoreGap=round2(best.score-forced.score),monthlyGap=forced.monthly-best.monthly;
  const reason=scoreGap>0.005?`採用すると組み合わせ全体の評価が${scoreGap.toFixed(2)}点低くなるため、今回は不採用です。`:
    monthlyGap>0?`評価は同点ですが、月額が${monthlyGap.toLocaleString('ja-JP')}円高いため不採用です。`:
    '他の同等候補が先に選ばれています。';
  return {status:'not_selected',reason,best,forced,scoreGap,monthlyGap,comparisonMode:'reoptimized',
    overbudgetPreview:singleChange?.monthly>Number(options.budget??5000)?singleChange:null};
}

export function swaps(routine, catalog, category, options={}, extra=100) {
  if (!routine) return [];
  const current = routine.products.find(p=>p.category===category);
  // 「入れ替える」は追加ではない。固定品を勝手に変更してもいけない。
  if(!current || options.locked?.[category]) return [];
  const excluded=new Set(options.excluded||[]);
  const maxBudget=Number(options.budget??5000)+Math.max(0,Number(extra)||0);
  const output=[];
  for(const product of catalog.filter(p=>p.category===category && p.jan!==current?.jan && !excluded.has(p.jan))){
    const next=current ? routine.products.map(p=>p.jan===current.jan?product:p) : [...routine.products,product];
    if(options.ingredientMode==="required" && options.ingredient && options.ingredient!=="none" && !next.some(p=>p.keyIngredients.some(k=>k.includes(options.ingredient)))) continue;
    // W洗顔がメーカー指定のクレンジングへの1品交換で、洗顔料を失うのを防ぐ。
    if(options.useMakeupRemover && next.some(p=>p.category==="makeupRemover" && !p.doubleCleanseNotNeeded) && !next.some(p=>p.category==="cleanser")) continue;
    const candidate=evaluate(next,options);
    // 通常予算内の最高得点を起点とするため、改善には予算上限の拡大が必要。
    // 価格を採点前に足切りせず、採点→改善判定→拡張予算の順で選別する。
    if(candidate.score>routine.score+0.005 && candidate.monthly<=maxBudget){
      output.push({...candidate,replacement:product,delta:candidate.monthly-routine.monthly,scoreDelta:candidate.score-routine.score});
    }
  }
  return output.sort((a,b)=>b.scoreDelta-a.scoreDelta || a.delta-b.delta);
}
