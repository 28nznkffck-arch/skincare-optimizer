import {CATEGORIES, CATEGORY_LABELS, CONCERNS, CONCERN_GROUPS, unscoredConcerns, monthlyCost, priceOf, usesOf, evaluate, optimize, swaps} from './optimizer.js?v=0.8.8';
import {createSavedPlan, savedPlanTotals, updateSavedUsage} from './plans.js?v=0.8.8';
import {clampBudget, DEFAULT_BUDGET, getBudgetRange, mergeCatalogData, reconcileCatalogState, unitPerUse} from './catalog-data.js?v=0.8.8';
import {loadCatalog} from './catalog-csv.js?v=0.8.8';

const STORE_KEY='skincare-lab-settings-jan';
const SAVED_KEY='skincare-lab-saved-routines-jan';
const DEFAULT={budget:DEFAULT_BUDGET, useMakeupRemover:false, concerns:[], concernWeights:{}, skinType:'unknown', sensitiveSkin:false, finish:'any', priority:'any', ingredient:'none', ingredientMode:'prefer', excluded:{}, locked:{}, overrides:{}, manual:null, manualExtraBudget:0, swapCategory:'moisturizer', swapExtra:100};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=n=>Number.isFinite(n)?Math.round(n).toLocaleString('ja-JP')+'円':'—';
const app=document.getElementById('app');
let catalog=[];
let budgetRange=getBudgetRange(catalog);
let savedPlanCatalog=[];
let catalogLoaded=false;
let meta={};
let state=structuredClone(DEFAULT);
let savedPlans=loadSavedPlans();
let current=null;
let isManual=false;
let pendingExclude=null;
let expandedPlanId=null;

function load(){
  try {
    const saved=JSON.parse(localStorage.getItem(STORE_KEY)||'{}');
    const merged={...structuredClone(DEFAULT),...saved};
    if(!['simple','any','thorough'].includes(merged.priority))merged.priority='any';
    if(!CATEGORIES.includes(merged.swapCategory))merged.swapCategory=DEFAULT.swapCategory;
    merged.budget=clampBudget(merged.budget,budgetRange);
    return merged;
  }
  catch {return {...structuredClone(DEFAULT),budget:clampBudget(DEFAULT.budget,budgetRange)};}
}
function save(){localStorage.setItem(STORE_KEY,JSON.stringify(state));}
function loadSavedPlans(){
  try {const value=JSON.parse(localStorage.getItem(SAVED_KEY)||'[]');return Array.isArray(value)?value.filter(p=>p && typeof p.id==='string' && Array.isArray(p.productJans)):[];}
  catch{return [];}
}
function savePlans(){localStorage.setItem(SAVED_KEY,JSON.stringify(savedPlans));}
function options(){return {...state,excluded:Object.keys(state.excluded||{})};}
function humanMonth(p){return monthlyCost(p,state.overrides[p.jan]);}
function humanPrice(p){return priceOf(p,state.overrides[p.jan]);}
function humanUses(p){return usesOf(p,state.overrides[p.jan]);}
function humanUnit(p){const n=unitPerUse(p,state.overrides[p.jan],humanUses(p));return n==null?'—':`${n.toFixed(2)}${p.unit}`;}
function useEstimateLabel(p){return state.overrides[p.jan]?.amountPerUse!=null||state.overrides[p.jan]?.uses!=null?'ユーザー補正':p.usageEstimate?.kind==='packageCount'?'個包装の使用回数':p.referenceUses?'使い切り期間から逆算':'仮推定';}
function nameOf(p){return p?`${p.brand} ${p.name}`:'';}
function missingConcernLabels(){return unscoredConcerns(catalog,state.concerns).map(id=>CONCERNS[id]||id);}
function findManual(){
  if(!state.manual?.length)return null;
  const ids=new Set(state.manual);
  const products=catalog.filter(p=>ids.has(p.jan));
  if(products.length!==ids.size || products.some(p=>state.excluded[p.jan])) return null;
  for(const mandatory of [state.useMakeupRemover?'makeupRemover':'cleanser','moisturizer']) if(!products.some(p=>p.category===mandatory))return null;
  if(!state.useMakeupRemover && products.some(p=>p.category==='makeupRemover'))return null;
  if(!state.concerns.includes('eyeDryness') && products.some(p=>p.category==='eyeCare'))return null;
  if(state.useMakeupRemover && !products.some(p=>p.category==='cleanser') && products.some(p=>p.category==='makeupRemover' && !p.doubleCleanseNotNeeded))return null;
  if(products.some(p=>state.locked[p.category] && state.locked[p.category]!==p.jan)) return null;
  const result=evaluate(products,options());
  return result.monthly<=state.budget+Math.max(0,Number(state.manualExtraBudget)||0)?result:null;
}

function pickCurrent(){
  if(!state.concerns.length){current=null;isManual=false;return current;}
  const ranked=optimize(catalog,{...options(),resultLimit:1});
  const manual=findManual();
  isManual=Boolean(manual);
  current=manual||ranked[0]||null;
  return current;
}

function productCard(p){
  const locked=state.locked[p.category]===p.jan;
  const matchLabels=state.concerns.filter(id=>(p.scores?.[id]||0)>0).map(id=>CONCERNS[id]||id);
  return `<article class="product">
    <div class="product-visual ${p.category}" aria-hidden="true">✧</div>
    <div>
      <div class="product-brand">${escape(p.brand)}　・　${escape(CATEGORY_LABELS[p.category])}</div>
      <div class="product-top"><h3 class="product-name">${escape(p.name)}</h3><div class="product-cost">${yen(humanMonth(p))}<small>月額試算</small></div></div>
      <div class="period">${escape(p.volume)}${escape(p.unit)} / 約${Math.round(humanUses(p))}回分 / 1回約${humanUnit(p)}（${escape(useEstimateLabel(p))}） / 1日${escape(state.overrides[p.jan]?.frequency??p.dailyUses)}回</div>
      <div class="period">購入価格 ${yen(humanPrice(p))}（${state.overrides[p.jan]?.price!=null?'ユーザー補正値':p.priceReference?`${escape(p.priceReference.retailer)}・確認済み`:'出典未確認の仮価格'}）</div>
      <p class="product-description">${escape(p.explanation)}</p>${p.category==='eyeCare'?'<div class="fit-note">部分ケア・顔全体の保湿の後に使用</div>':''}${p.wipeOff?'<div class="fit-note">ふき取りタイプ・コットン代は月額に含みません</div>':''}${p.category==='makeupRemover'?'<div class="fit-note">夜のみ・'+(p.doubleCleanseNotNeeded?'W洗顔不要':'W洗顔が必要')+(p.waterproof?'・落ちにくいメイク対応':'')+'</div>':''}
      <div class="ingredient-row">${p.keyIngredients.map(x=>`<span class="ingredient">${escape(x)}</span>`).join('')}</div>
      ${matchLabels.length?`<div class="fit-note">関連する悩み：${matchLabels.map(escape).join('・')}</div>`:''}
      ${state.sensitiveSkin && p.sensitiveSkin?'<div class="fit-note">敏感肌向けの設計情報を考慮</div>':''}
      <div class="product-actions">
        <button type="button" class="tiny-action ${locked?'active':''}" data-action="lock" data-id="${p.jan}">${locked?'◆ 固定中':'◇ この商品を固定'}</button>
        <button type="button" class="tiny-action" data-action="exclude" data-id="${p.jan}">合わない・除外</button>
        <a class="source" href="${escape(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">公式成分表 ↗</a>
      </div>
    </div>
  </article>`;
}

function formHtml(){
  const ingredients=['none','ナイアシンアミド','セラミド機能成分','アラントイン','ヒアルロン酸Na','グリチルリチン酸2K'];
  const excluded=catalog.filter(product=>Object.hasOwn(state.excluded,product.jan));
  return `<aside class="panel controls" aria-label="選定条件">
    <div class="section-heading"><h2>あなたの条件</h2><span class="step-number">01 / SETTINGS</span></div>
    <div class="field"><div class="budget-row"><label class="field-title" for="budget">月額予算</label><span class="budget-value">${yen(state.budget)}<small> / 月</small></span></div>
      <input id="budget" data-field="budget" type="range" min="${budgetRange.min}" max="${budgetRange.max}" step="${budgetRange.step}" value="${state.budget}">
      <div class="range-label"><span>${yen(budgetRange.min)}</span><span>${yen(budgetRange.max)}</span></div>
    </div>
    <div class="field"><div class="concern-heading"><span class="field-title">肌の悩み <small>複数選択可</small></span>${state.concerns.length?'<button type="button" class="link-button" data-action="clearConcerns">選択をクリア</button>':''}</div>
      <div class="concern-groups">${CONCERN_GROUPS.map((group,index)=>`<details class="concern-group" ${(index===0 && !state.concerns.length)||Object.keys(group.items).some(id=>state.concerns.includes(id))?'open':''}><summary>${escape(group.label)} <span>${Object.keys(group.items).filter(id=>state.concerns.includes(id)).length||''}</span></summary><div class="chips">${Object.entries(group.items).map(([id,label])=>`<button class="chip ${state.concerns.includes(id)?'selected':''}" data-action="concern" data-id="${id}" aria-pressed="${state.concerns.includes(id)}">${escape(label)}</button>`).join('')}</div></details>`).join('')}</div>
      ${state.concerns.length?`<div class="concern-priorities"><span class="micro muted">悩みごとの優先度</span>${state.concerns.map(id=>`<label class="priority-row"><span>${escape(CONCERNS[id]||id)}</span><select class="select" data-importance="${escape(id)}"><option value="high" ${state.concernWeights?.[id]==='high'?'selected':''}>最優先</option><option value="normal" ${!state.concernWeights?.[id]||state.concernWeights?.[id]==='normal'?'selected':''}>気になる</option><option value="low" ${state.concernWeights?.[id]==='low'?'selected':''}>軽く気になる</option></select></label>`).join('')}</div>`:''}
    </div>
    <div class="field"><span class="field-title">夜の洗浄</span><label class="sensitive-check"><input type="checkbox" data-field="useMakeupRemover" ${state.useMakeupRemover?'checked':''}> メイク落としを使う</label><div class="micro muted">チェック時は毎晩使う前提で試算します。「手軽に」はW洗顔を省きます。</div></div>
    <div class="field"><label class="field-title" for="skinType">肌質</label><select id="skinType" class="select" data-field="skinType">${[['unknown','わからない・指定なし'],['dry','乾燥肌'],['oily','脂性肌'],['combination','混合肌'],['normal','普通肌']].map(([id,label])=>`<option value="${id}" ${state.skinType===id?'selected':''}>${label}</option>`).join('')}</select>
      <label class="sensitive-check"><input type="checkbox" data-field="sensitiveSkin" ${state.sensitiveSkin?'checked':''}> 刺激を感じやすい・敏感肌</label>
    </div>
    <div class="field"><label class="field-title" for="finish">好みの使用感</label><select id="finish" class="select" data-field="finish">${[['any','こだわらない'],['light','さっぱり・みずみずしい'],['moist','しっとり'],['rich','とてもしっとり']].map(([id,label])=>`<option value="${id}" ${state.finish===id?'selected':''}>${label}</option>`).join('')}</select></div>
    <div class="field"><span class="field-title">お手入れの手間</span><div class="segmented">
      ${[['simple','手軽に'],['any','こだわらない'],['thorough','しっかり']].map(([v,l])=>`<button class="segment ${state.priority===v?'selected':''}" data-action="priority" data-id="${v}" aria-pressed="${state.priority===v}">${l}</button>`).join('')}
    </div></div>
    <div class="field"><label class="field-title" for="ingredient">使ってみたい成分</label><select class="select" id="ingredient" data-field="ingredient">
      ${ingredients.map(x=>`<option value="${escape(x)}" ${state.ingredient===x?'selected':''}>${x==='none'?'指定なし':escape(x)}</option>`).join('')}
    </select><div class="radio-line"><label><input type="radio" name="ingredientMode" value="prefer" ${state.ingredientMode==='prefer'?'checked':''}> 優先</label><label><input type="radio" name="ingredientMode" value="required" ${state.ingredientMode==='required'?'checked':''}> 必須</label></div></div>
    <div class="controls-foot">
      ${excluded.length?`<div class="excluded-list"><strong>除外中の商品：${excluded.length}品</strong>${excluded.map(p=>`<div>${escape(nameOf(p))}（${escape(state.excluded[p.jan])}） <button class="link-button" data-action="unexclude" data-id="${escape(p.jan)}">解除</button></div>`).join('')}</div>`:''}
      <button class="link-button" data-action="reset">選定条件を初期化</button>
    </div>
  </aside>`;
}

function summaryHtml(){
  if(!state.concerns.length) return `<section class="panel summary"><span class="tag">まずは肌悩みを選択</span><h2>どんなお肌の悩みがある？</h2><p class="summary-note">左の「肌の悩み」から1つ以上選ぶと、予算や好みも考慮して組み合わせを提案します。最初から特定の悩みは選択していません。</p></section>`;
  if(!current) return `<section class="panel summary"><span class="tag orange">条件に合う候補なし</span><h2>組み合わせを作れませんでした</h2><p class="summary-note">予算や「必須成分」、固定・除外条件を見直してみてください。条件を無断で緩めて商品を出すことはありません。</p></section>`;
  const effectiveBudget=state.budget+(isManual?Math.max(0,Number(state.manualExtraBudget)||0):0);
  const used=Math.min(100,Math.round(current.monthly/effectiveBudget*100));
  const optional=current.products.filter(p=>p.category==='toner'||p.category==='serum'||p.category==='eyeCare').length+(state.useMakeupRemover && current.products.some(p=>p.category==='cleanser')?1:0);
  const missing=missingConcernLabels();
  return `<section class="panel summary">
    <div class="summary-top"><span class="eyebrow">${isManual?'YOUR CUSTOM ROUTINE':'YOUR BEST MATCH'}</span><span class="tag">${current.monthly>state.budget?'追加予算込み':'月額予算内'}</span></div>
    <h2>${isManual?'入れ替え後の組み合わせ':'おすすめの組み合わせ'}</h2><div class="summary-number">${yen(current.monthly)}<small> / 月</small></div>
    <div class="meter" role="progressbar" aria-label="予算使用率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${used}"><span style="width:${used}%"></span></div>
    <div class="summary-note">${isManual&&state.manualExtraBudget?`通常予算 ${yen(state.budget)} ＋ 追加上限 ${yen(state.manualExtraBudget)}。`:''}残り予算 <strong>${yen(Math.max(0,effectiveBudget-current.monthly))}</strong>。${isManual?'手動で選んだ組み合わせです。通常のおすすめとは異なる場合があります。':'無理に予算を使い切りません。'}</div>
    ${missing.length?`<div class="unscored-warning">データ未整備：${missing.map(escape).join('・')}。現在の${catalog.length}商品では根拠となる情報がなく、この項目は選定に反映していません。</div>`:''}
    <div class="summary-stats"><div><span class="stat-label">初回購入費（試算）</span><span class="stat-value">${yen(current.initial)}</span></div><div><span class="stat-label">選定商品数</span><span class="stat-value">${current.products.length}<small> 品</small></span></div><div><span class="stat-label">追加ステップ</span><span class="stat-value">${optional}<small> 個</small></span></div></div>
    <button type="button" class="button button-dark save-routine" data-action="saveRoutine">この組み合わせを保存</button>
    ${isManual?'<button type="button" class="button save-routine" data-action="resetSwap">自動のおすすめに戻す</button>':''}
  </section>`;
}

function resultHtml(){
  if(!current) return '';
  const sorted=[...current.products].sort((a,b)=>CATEGORIES.indexOf(a.category)-CATEGORIES.indexOf(b.category));
  const am=sorted.filter(p=>!['makeupRemover','cleanser'].includes(p.category)&&(state.overrides[p.jan]?.frequency??p.dailyUses)>1);
  const pm=sorted;
  return `<section class="panel recommendation">
    <div class="reco-head"><div><span class="eyebrow">02 / RECOMMENDATION</span><h2>朝と夜のルーティン</h2></div><span class="tag orange">試作版</span></div>
    <p class="summary-note">朝：${am.map(p=>CATEGORY_LABELS[p.category]).join(' → ')||'なし'}<br>夜：${pm.map(p=>CATEGORY_LABELS[p.category]).join(' → ')}</p>
    ${state.useMakeupRemover?'<p class="micro muted">毎晩メイク落とし1回。洗顔料が続く場合はW洗顔ですが、メーカーが必須とする意味ではありません。</p>':''}
    <div class="product-list">${sorted.map(productCard).join('')}</div>
  </section>`;
}

function swapHtml(){
  if(!state.concerns.length)return '';
  const category=state.swapCategory;
  const previous=current?.products.find(p=>p.category===category);
  const isLocked=Boolean(state.locked[category]);
  const items=current?swaps(current,catalog,category,options(),state.swapExtra):[];
  const alternatives=items.slice(0,5);
  return `<section class="panel swap-panel">
    <div class="reco-head"><div><span class="eyebrow">03 / TINY UPGRADE</span><h2>1品だけ入れ替える</h2></div></div>
    <div class="swap-row"><label for="swapCategory">変更する品目</label><select id="swapCategory" class="select" data-field="swapCategory">${CATEGORIES.map(c=>`<option value="${c}" ${c===category?'selected':''}>${CATEGORY_LABELS[c]}</option>`).join('')}</select><label for="swapExtra">予算上限を増やす</label><select id="swapExtra" class="select" data-field="swapExtra">${[0,100,300,500,1000,2000,5000].map(n=>`<option value="${n}" ${state.swapExtra===n?'selected':''}>＋${yen(n)}/月</option>`).join('')}</select></div>
    <p class="micro muted">通常予算 ${yen(state.budget)} → 今回の上限 ${yen(state.budget+state.swapExtra)}。${previous?`現在：${escape(nameOf(previous))}。`:'現在の組み合わせにこの品目はありません。'}条件との相性がより良くなる1品交換だけを表示します。</p>
    ${isLocked?'<div class="empty">この品目の商品が固定されています。入れ替えるには上の「この商品を固定」を解除してください。</div>':!previous?'<div class="empty">入れ替え対象がありません。現在使っている品目を選択してください。</div>':alternatives.length?`<div class="swap-items">${alternatives.map(x=>`<div class="swap-item"><div><strong>${escape(nameOf(x.replacement))}</strong><span class="micro">月額 ${yen(x.monthly)}（現在との差額 ${x.delta>0?'＋':x.delta<0?'−':'±'}${yen(Math.abs(x.delta))}）</span></div><button class="button button-dark" data-action="swap" data-id="${x.replacement.jan}">この商品に変更</button></div>`).join('')}</div>`:'<div class="empty">この品目には、追加予算を使っても評価が上がる1品交換はありません。商品DBにより良い選択肢がなければ表示しない仕様です。</div>'}
  </section>`;
}

function savedPlansHtml(){
  const plans=savedPlans.map((plan,index)=>{
    const total=savedPlanTotals(plan,savedPlanCatalog);
    const expanded=expandedPlanId===plan.id || (expandedPlanId===null && index===0);
    const budgetTag=total.remaining>=0?'<span class="tag">予算内</span>':'<span class="tag orange">予算超過</span>';
    return `<article class="saved-plan">
      <div class="saved-plan-head"><div><span class="micro muted">保存 ${escape(new Date(plan.createdAt).toLocaleDateString('ja-JP'))}</span><h3>${escape(plan.name)}</h3><span class="micro muted">${plan.productJans.length}品</span></div><div class="saved-totals"><strong>${yen(total.monthly)}<small> / 月</small></strong><span>月予算 ${yen(total.budget)}</span>${budgetTag}</div></div>
      <button type="button" class="link-button" data-action="toggleSaved" data-id="${escape(plan.id)}">${expanded?'編集を閉じる':'内訳・使用量を編集'}</button>
      ${expanded?`<div class="saved-plan-detail">
        <div class="saved-meta"><label>組み合わせ名<input type="text" class="select" maxlength="70" data-plan-name="${escape(plan.id)}" value="${escape(plan.name)}"></label><label>月予算（円）<input type="number" class="select" min="0" step="100" data-plan-budget="${escape(plan.id)}" value="${total.budget}"></label></div>
        <div class="saved-cost-summary"><span>月額合計 <strong>${yen(total.monthly)}</strong></span><span>初回購入額 <strong>${yen(total.initial)}</strong></span><span>予算との差 <strong>${total.remaining<0?'超過 '+yen(-total.remaining):'残り '+yen(total.remaining)}</strong></span></div>
        <div class="saved-product-list">${total.items.map(p=>{const v=plan.overrides?.[p.jan]||{};const savedUses=usesOf(p,v);const amount=unitPerUse(p,v,savedUses);return `<div class="saved-product-row"><div class="saved-product-name"><strong>${escape(nameOf(p))}</strong><small>${escape(CATEGORY_LABELS[p.category])} / 1回約${amount?.toFixed(2)??'—'}${escape(p.unit)}（逆算）</small></div><label>購入価格（円）<input type="number" min="0" step="10" data-plan-usage="price" data-plan-id="${escape(plan.id)}" data-product-jan="${escape(p.jan)}" value="${v.price??priceOf(p)}"></label><label>1本の使用回数<input type="number" min="1" step="1" data-plan-usage="uses" data-plan-id="${escape(plan.id)}" data-product-jan="${escape(p.jan)}" value="${Math.round(savedUses)}"></label><label>1日使用回数<input type="number" min="0" step="0.5" data-plan-usage="frequency" data-plan-id="${escape(plan.id)}" data-product-jan="${escape(p.jan)}" value="${v.frequency??p.dailyUses}"></label><div class="saved-item-total">${yen(monthlyCost(p,v))}<small> / 月</small></div></div>`}).join('')}</div>
        ${total.items.some(p=>p.archived)?`<p class="micro muted">掲載終了した商品：${total.items.filter(p=>p.archived).map(p=>escape(nameOf(p))).join('、')}</p>`:''}
        ${total.missing.length?`<div class="unscored-warning">商品DBに見つからないJAN：${total.missing.map(escape).join('、')}</div>`:''}
        <div class="saved-footer"><button type="button" class="link-button danger" data-action="deleteSaved" data-id="${escape(plan.id)}">この組み合わせを削除</button></div>
      </div>`:''}
    </article>`;
  }).join('');
  return `<section class="panel saved-panel"><div class="catalog-top"><div><span class="eyebrow">MY ROUTINES</span><h2>保存した組み合わせ</h2></div><span class="tag">${savedPlans.length}件</span></div>
    ${savedPlans.length?`<div class="saved-plans">${plans}</div>`:'<div class="empty">まだ保存した組み合わせはありません。<br>気に入ったおすすめが出たら「この組み合わせを保存」で残せます。</div>'}
    <div class="debug-entry"><button type="button" class="button" data-action="openDebug">登録商品DBを別画面で開く（デバッグ） ↗</button></div>
  </section>`;
}

function render(){
  pickCurrent();
  app.innerHTML=`<div class="shell">
    <header class="topbar"><div class="logo"><span class="logo-mark" aria-hidden="true">✿</span><span>SKINCARE LAB</span></div><div class="topnav"><span>スキンケア組合せ最適化</span><span class="tag">PROTOTYPE v0.8.8</span></div></header>
    <section class="hero"><div><div class="eyebrow">SMART ROUTINE, SMALL BUDGET</div><h1>肌にも、予算にも。<br>ちょうどいい組み合わせ。</h1><p>肌悩み・好み・使用コストから、必要なアイテムを探す実験室。<br>メーカー公式に確認できる情報を出発点にしています。</p></div><div class="hero-accent" aria-hidden="true"><i class="mini-bottle a"></i><i class="mini-bottle b"></i><i class="mini-bottle c"></i></div></section>
    <div class="layout">${formHtml()}<div class="main-column">
      ${summaryHtml()}${resultHtml()}${swapHtml()}${savedPlansHtml()}
    </div></div><footer class="footer">
      <p class="estimate-note">※「仮推定」の試算方法：同じ品目・同じ単位（mL／g）で、使い切り期間が確認できる商品が2品以上あれば、それぞれの「内容量÷使用回数」で求めた1回量の平均を採用し、対象商品の内容量から使用回数を逆算します。比較できる商品が足りない場合は、試作時の仮の使用回数を使います。いずれも対象商品の実測値ではありません。</p>
      <details class="disclaimer"><summary>データ・試算についての注意事項</summary><div class="disclaimer-body">
      <p>${escape(meta.notice)}</p>
      <ul><li>肌悩みや使用感との相性は試作用の適合評価であり、実際の美容効果や安全性を予測・保証するものではありません。</li>
      <li>敏感肌向けと登録された商品でも、すべての人に合うわけではありません。合わなかった商品の除外は商品単位で、原因成分を特定するものではありません。</li>
      <li>登録77商品の購入価格は、JAN一致で確認したマツキヨココカラ通販・ツルハグループe-shopの税込価格です。店頭価格や将来の価格とは異なることがあります。</li>
      <li>1本の使用回数は「朝晩で約3か月」などの使い切り期間から逆算し、未確認品は同品目・同容量単位の2商品以上の参考値の平均を仮採用します。平均できない商品は旧来の仮値です。使用期限とは区別します。プッシュ数・泡の直径から容量を決めつけません。</li>
      <li>目元の乾燥を選ぶと目元専用クリームを任意で追加できます。顔全体の保湿とは別枠です。月額使用回数は仮推定。クマは商品未採点のため選択時に警告を表示します。</li>
      <li>メイク落としはチェック時に毎晩使う前提。「手軽に」はW洗顔を省略、ほかの手間設定ではW洗顔も選択可能。花王の登録製品はW洗顔不要で、追加洗顔が必須とは限りません。化粧の濃さにより適合は変わります。</li>
      <li>「手軽に」は任意の化粧水・美容液の追加手順を控えめに評価し、「しっかり」は有用な追加手順を許容します。価格は月予算を上限とし、評価が同等の場合のみ安い候補を優先します。</li>
      <li>公式情報が確認できた商品に、小さな情報透明性ボーナスを加えます。これは美容効果や成分濃度の高さを表すものではなく、配合量が未確認の商品を0％と評価することもありません。採点内訳は商品DBのデバッグ画面で確認できます。</li>
      <li>保存した組み合わせはブラウザ内にのみ保存します。端末やブラウザを変えると共有されず、ブラウザデータの消去で失われます。</li>
      <li>商品情報が改訂されることがあります。最終確認はメーカー公式ページまたは製品パッケージで行ってください。皮膚疾患の診断・治療を目的とするサービスではありません。</li></ul>
    </div></details><span>SKINCARE LAB — 個人開発プロトタイプ</span></footer></div>`;
}

app.addEventListener('click',e=>{
  const btn=e.target.closest('[data-action]'); if(!btn)return;
  const {action,id}=btn.dataset;
  if(action==='concern') state.concerns=state.concerns.includes(id)?state.concerns.filter(x=>x!==id):[...state.concerns,id];
  if(action==='clearConcerns'){state.concerns=[];state.concernWeights={};}
  if(action==='priority')state.priority=id;
  if(action==='sensitivity')state.sensitiveSkin=!state.sensitiveSkin;
  if(action==='lock'){
    const p=catalog.find(p=>p.jan===id);
    if(p){if(state.locked[p.category]===id)delete state.locked[p.category];else state.locked[p.category]=id;}
  }
  if(action==='exclude'){
    pendingExclude=id;const p=catalog.find(p=>p.jan===id);
    document.getElementById('excludeName').textContent=nameOf(p);
    document.querySelectorAll('#excludeForm input[name=reason]').forEach(x=>x.checked=false);
    document.getElementById('excludeDialog').showModal();return;
  }
  if(action==='unexclude')delete state.excluded[id];
  if(action==='swap'){
    const selected=catalog.find(p=>p.jan===id);
    if(selected && current){
      const valid=swaps(current,catalog,selected.category,options(),state.swapExtra).some(x=>x.replacement.jan===selected.jan);
      if(valid){state.manual=[...current.products.filter(p=>p.category!==selected.category).map(p=>p.jan),selected.jan];state.manualExtraBudget=state.swapExtra;}
    }
  }
  if(action==='resetSwap'){state.manual=null;state.manualExtraBudget=0;}
  if(action==='saveRoutine' && current){
    const plan=createSavedPlan(current,{...state,budget:state.budget+(isManual?Math.max(0,Number(state.manualExtraBudget)||0):0)},crypto.randomUUID(),new Date().toISOString());
    plan.name=`組み合わせ ${savedPlans.length+1}`;
    savedPlans.unshift(plan);
    expandedPlanId=plan.id;
    savePlans();
  }
  if(action==='toggleSaved'){
    const isOpen=expandedPlanId===id || (expandedPlanId===null && savedPlans[0]?.id===id);
    expandedPlanId=isOpen?'closed':id;
  }
  if(action==='deleteSaved'){
    const plan=savedPlans.find(x=>x.id===id);
    if(plan && confirm(`「${plan.name}」を削除しますか？`)){
      savedPlans=savedPlans.filter(x=>x.id!==id);
      if(expandedPlanId===id)expandedPlanId=null;
      savePlans();
    }
  }
  if(action==='openDebug'){
    const tab=window.open('./debug.html','skincare-product-debug','width=1080,height=800');
    if(!tab)alert('別画面を開けませんでした。ブラウザのポップアップ設定を確認してください。');
    return;
  }
  if(action==='reset' && confirm('選定条件・共通価格補正・商品除外を初期化しますか？ 保存した組み合わせは残ります。'))state={...structuredClone(DEFAULT),budget:clampBudget(DEFAULT.budget,budgetRange)};
  if(['concern','clearConcerns','priority','lock','exclude','unexclude','reset'].includes(action))state.manual=null;
  save();render();
});

app.addEventListener('change',e=>{
  const planId=e.target.dataset.planId||e.target.dataset.planName||e.target.dataset.planBudget;
  if(planId){
    const plan=savedPlans.find(p=>p.jan===planId);
    if(!plan)return;
    if(e.target.dataset.planName){const name=e.target.value.trim();if(name)plan.name=name;}
    if(e.target.dataset.planBudget){const n=Number(e.target.value);if(Number.isFinite(n)&&n>=0)plan.budget=n;}
    if(e.target.dataset.planUsage)updateSavedUsage(plan,e.target.dataset.productJan,e.target.dataset.planUsage,e.target.value);
    savePlans();render();return;
  }
  if(e.target.dataset.importance){
    state.concernWeights??={};
    state.concernWeights[e.target.dataset.importance]=e.target.value;
    state.manual=null;
  }
  const field=e.target.dataset.field;
  if(field){
    if(field==='budget')state.budget=clampBudget(e.target.value,budgetRange);
    else if(field==='sensitiveSkin'||field==='useMakeupRemover')state[field]=e.target.checked;
    else if(field==='swapExtra')state.swapExtra=Number(e.target.value);
    else state[field]=e.target.value;
    if(!['swapCategory','swapExtra'].includes(field))state.manual=null;
  }
  if(e.target.name==='ingredientMode'){state.ingredientMode=e.target.value;state.manual=null;}
  save();render();
});

document.getElementById('closeDialog').addEventListener('click',()=>document.getElementById('excludeDialog').close());
document.getElementById('cancelExclude').addEventListener('click',()=>document.getElementById('excludeDialog').close());
document.getElementById('excludeForm').addEventListener('submit',e=>{
  e.preventDefault();
  if(pendingExclude){
    const selected=document.querySelector('#excludeForm input[name=reason]:checked');
    state.excluded[pendingExclude]=selected?.value||'ユーザー指定';
    const p=catalog.find(x=>x.jan===pendingExclude);
    if(p && state.locked[p.category]===p.jan) delete state.locked[p.category];
    state.manual=null;save();render();
  }
  document.getElementById('excludeDialog').close();pendingExclude=null;
});

loadCatalog().then(({products, archivedProducts, pricing, usage, meta: catalogMeta})=>{
  catalog=mergeCatalogData(products,pricing,usage);meta=catalogMeta;
  budgetRange=getBudgetRange(catalog);
  const archived=mergeCatalogData(archivedProducts,pricing,usage);
  savedPlanCatalog=[...catalog,...archived.map(product=>({...product,archived:true}))];
  state=reconcileCatalogState(load(),catalog);
  savedPlans=loadSavedPlans();
  catalogLoaded=true;
  render();
}).catch(error=>{app.innerHTML=`<main class="error">商品データを読み込めませんでした。<br>${escape(error.message)}</main>`;});

window.addEventListener('storage',e=>{
  if(!catalogLoaded)return;
  if(e.key===STORE_KEY){state=reconcileCatalogState(load(),catalog);render();}
  if(e.key===SAVED_KEY){savedPlans=loadSavedPlans();render();}
});
