import {CATEGORIES, CATEGORY_LABELS, CONCERNS, CONCERN_GROUPS, unscoredConcerns, monthlyCost, evaluate, optimize, swaps} from './optimizer.js?v=0.4.1';
import {createSavedPlan, savedPlanTotals, updateSavedUsage} from './plans.js?v=0.4.1';

const STORE_KEY='skincare-lab-v1';
const SAVED_KEY='skincare-lab-saved-routines-v1';
const DEFAULT={budget:5000, concerns:[], concernWeights:{}, skinType:'unknown', sensitiveSkin:false, finish:'any', priority:'any', ingredient:'none', ingredientMode:'prefer', excluded:{}, locked:{}, overrides:{}, manual:null, swapCategory:'moisturizer', swapExtra:100};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=n=>Number.isFinite(n)?Math.round(n).toLocaleString('ja-JP')+'円':'—';
const app=document.getElementById('app');
let catalog=[];
let meta={};
let state=load();
let savedPlans=loadSavedPlans();
let current=null;
let pendingExclude=null;
let expandedPlanId=null;

function load(){
  try {
    const saved=JSON.parse(localStorage.getItem(STORE_KEY)||'{}');
    const merged={...structuredClone(DEFAULT),...saved};
    if(!['simple','any','thorough'].includes(merged.priority))merged.priority='any';
    return merged;
  }
  catch {return structuredClone(DEFAULT);}
}
function save(){localStorage.setItem(STORE_KEY,JSON.stringify(state));}
function loadSavedPlans(){
  try {const value=JSON.parse(localStorage.getItem(SAVED_KEY)||'[]');return Array.isArray(value)?value.filter(p=>p && typeof p.id==='string' && Array.isArray(p.productIds)):[];}
  catch{return [];}
}
function savePlans(){localStorage.setItem(SAVED_KEY,JSON.stringify(savedPlans));}
function options(){return {...state,excluded:Object.keys(state.excluded||{})};}
function humanMonth(p){return monthlyCost(p,state.overrides[p.id]);}
function humanPrice(p){return Number(state.overrides[p.id]?.price??p.demoPrice);}
function humanUses(p){return Number(state.overrides[p.id]?.uses??p.demoUses);}
function nameOf(p){return p?`${p.brand} ${p.name}`:'';}
function missingConcernLabels(){return unscoredConcerns(catalog,state.concerns).map(id=>CONCERNS[id]||id);}
function findManual(){
  if(!state.manual?.length)return null;
  const ids=new Set(state.manual);
  const products=catalog.filter(p=>ids.has(p.id));
  if(products.length!==ids.size || products.some(p=>state.excluded[p.id])) return null;
  for(const mandatory of ['cleanser','moisturizer','sunscreen']) if(!products.some(p=>p.category===mandatory))return null;
  if(products.some(p=>state.locked[p.category] && state.locked[p.category]!==p.id)) return null;
  const result=evaluate(products,options());
  return result.monthly<=state.budget?result:null;
}

function pickCurrent(){
  if(!state.concerns.length){current=null;return current;}
  const ranked=optimize(catalog,options());
  current=findManual()||ranked[0]||null;
  return current;
}

function productCard(p){
  const locked=state.locked[p.category]===p.id;
  const matchLabels=state.concerns.filter(id=>(p.scores?.[id]||0)>0).map(id=>CONCERNS[id]||id);
  return `<article class="product">
    <div class="product-visual ${p.category}" aria-hidden="true">✧</div>
    <div>
      <div class="product-brand">${escape(p.brand)}　・　${escape(CATEGORY_LABELS[p.category])}</div>
      <div class="product-top"><h3 class="product-name">${escape(p.name)}</h3><div class="product-cost">${yen(humanMonth(p))}<small>月額試算</small></div></div>
      <div class="period">${escape(p.volume)}${escape(p.unit)} / 約${escape(humanUses(p))}回分 / 1日${escape(state.overrides[p.id]?.frequency??p.dailyUses)}回</div>
      <p class="product-description">${escape(p.explanation)}</p>
      <div class="ingredient-row">${p.keyIngredients.map(x=>`<span class="ingredient">${escape(x)}</span>`).join('')}</div>
      ${matchLabels.length?`<div class="fit-note">関連する悩み：${matchLabels.map(escape).join('・')}</div>`:''}
      ${state.sensitiveSkin && p.sensitiveSkin?'<div class="fit-note">敏感肌向けの設計情報を考慮</div>':''}
      <div class="product-actions">
        <button type="button" class="tiny-action ${locked?'active':''}" data-action="lock" data-id="${p.id}">${locked?'◆ 固定中':'◇ この商品を固定'}</button>
        <button type="button" class="tiny-action" data-action="exclude" data-id="${p.id}">合わない・除外</button>
        <a class="source" href="${escape(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">公式成分表 ↗</a>
      </div>
    </div>
  </article>`;
}

function formHtml(){
  const ingredients=['none','ナイアシンアミド','セラミド機能成分','アラントイン','ヒアルロン酸Na','グリチルリチン酸2K'];
  return `<aside class="panel controls" aria-label="選定条件">
    <div class="section-heading"><h2>あなたの条件</h2><span class="step-number">01 / SETTINGS</span></div>
    <div class="field"><div class="budget-row"><label class="field-title" for="budget">月額予算</label><span class="budget-value">${yen(state.budget)}<small> / 月</small></span></div>
      <input id="budget" data-field="budget" type="range" min="1500" max="15000" step="100" value="${state.budget}">
      <div class="range-label"><span>1,500円</span><span>15,000円</span></div>
    </div>
    <div class="field"><div class="concern-heading"><span class="field-title">肌の悩み <small>複数選択可</small></span>${state.concerns.length?'<button type="button" class="link-button" data-action="clearConcerns">選択をクリア</button>':''}</div>
      <div class="concern-groups">${CONCERN_GROUPS.map((group,index)=>`<details class="concern-group" ${(index===0 && !state.concerns.length)||Object.keys(group.items).some(id=>state.concerns.includes(id))?'open':''}><summary>${escape(group.label)} <span>${Object.keys(group.items).filter(id=>state.concerns.includes(id)).length||''}</span></summary><div class="chips">${Object.entries(group.items).map(([id,label])=>`<button class="chip ${state.concerns.includes(id)?'selected':''}" data-action="concern" data-id="${id}" aria-pressed="${state.concerns.includes(id)}">${escape(label)}</button>`).join('')}</div></details>`).join('')}</div>
      ${state.concerns.length?`<div class="concern-priorities"><span class="micro muted">悩みごとの優先度</span>${state.concerns.map(id=>`<label class="priority-row"><span>${escape(CONCERNS[id]||id)}</span><select class="select" data-importance="${escape(id)}"><option value="high" ${state.concernWeights?.[id]==='high'?'selected':''}>最優先</option><option value="normal" ${!state.concernWeights?.[id]||state.concernWeights?.[id]==='normal'?'selected':''}>気になる</option><option value="low" ${state.concernWeights?.[id]==='low'?'selected':''}>軽く気になる</option></select></label>`).join('')}</div>`:''}
    </div>
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
      ${Object.keys(state.excluded).length?`<div class="excluded-list"><strong>除外中の商品：${Object.keys(state.excluded).length}品</strong>${Object.entries(state.excluded).map(([id,reason])=>{const p=catalog.find(x=>x.id===id);return p?`<div>${escape(nameOf(p))}（${escape(reason)}） <button class="link-button" data-action="unexclude" data-id="${escape(id)}">解除</button></div>`:''}).join('')}</div>`:''}
      <button class="link-button" data-action="reset">選定条件を初期化</button>
    </div>
  </aside>`;
}

function summaryHtml(){
  if(!state.concerns.length) return `<section class="panel summary"><span class="tag">まずは肌悩みを選択</span><h2>どんなお肌の悩みがある？</h2><p class="summary-note">左の「肌の悩み」から1つ以上選ぶと、予算や好みも考慮して組み合わせを提案します。最初から特定の悩みは選択していません。</p></section>`;
  if(!current) return `<section class="panel summary"><span class="tag orange">条件に合う候補なし</span><h2>組み合わせを作れませんでした</h2><p class="summary-note">予算や「必須成分」、固定・除外条件を見直してみてください。条件を無断で緩めて商品を出すことはありません。</p></section>`;
  const used=Math.min(100,Math.round(current.monthly/state.budget*100));
  const optional=current.products.filter(p=>p.category==='toner'||p.category==='serum').length;
  const missing=missingConcernLabels();
  return `<section class="panel summary">
    <div class="summary-top"><span class="eyebrow">YOUR BEST MATCH</span><span class="tag">月額予算内</span></div>
    <h2>おすすめの組み合わせ</h2><div class="summary-number">${yen(current.monthly)}<small> / 月</small></div>
    <div class="meter" role="progressbar" aria-label="予算使用率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${used}"><span style="width:${used}%"></span></div>
    <div class="summary-note">残り予算 <strong>${yen(Math.max(0,state.budget-current.monthly))}</strong>。無理に予算を使い切りません。</div>
    ${missing.length?`<div class="unscored-warning">データ未整備：${missing.map(escape).join('・')}。現在の15商品では根拠のある採点情報がなく、この項目は選定点数に反映していません。</div>`:''}
    <div class="summary-stats"><div><span class="stat-label">初回購入費（試算）</span><span class="stat-value">${yen(current.initial)}</span></div><div><span class="stat-label">選定商品数</span><span class="stat-value">${current.products.length}<small> 品</small></span></div><div><span class="stat-label">追加ステップ</span><span class="stat-value">${optional}<small> 個</small></span></div></div>
    <button type="button" class="button button-dark save-routine" data-action="saveRoutine">この組み合わせを保存</button>
  </section>`;
}

function resultHtml(){
  if(!current) return '';
  const sorted=[...current.products].sort((a,b)=>CATEGORIES.indexOf(a.category)-CATEGORIES.indexOf(b.category));
  const am=sorted.filter(p=>p.category==='sunscreen'||(p.category!=='cleanser'&&(state.overrides[p.id]?.frequency??p.dailyUses)>1));
  const pm=sorted.filter(p=>p.category!=='sunscreen');
  return `<section class="panel recommendation">
    <div class="reco-head"><div><span class="eyebrow">02 / RECOMMENDATION</span><h2>朝と夜のルーティン</h2></div><span class="tag orange">試作版</span></div>
    <p class="summary-note">朝：${am.map(p=>CATEGORY_LABELS[p.category]).join(' → ')}<br>夜：${pm.map(p=>CATEGORY_LABELS[p.category]).join(' → ')}</p>
    <div class="product-list">${sorted.map(productCard).join('')}</div>
  </section>`;
}

function swapHtml(){
  if(!state.concerns.length)return '';
  const category=state.swapCategory;
  const items=current?swaps(current,catalog,category,options(),state.swapExtra):[];
  const improvement=items.filter(x=>x.scoreDelta>0.05).slice(0,3);
  return `<section class="panel swap-panel">
    <div class="reco-head"><div><span class="eyebrow">03 / TINY UPGRADE</span><h2>1品だけ入れ替える</h2></div></div>
    <div class="swap-row"><label for="swapCategory">変更する品目</label><select id="swapCategory" class="select" data-field="swapCategory">${CATEGORIES.map(c=>`<option value="${c}" ${c===category?'selected':''}>${CATEGORY_LABELS[c]}</option>`).join('')}</select><label for="swapExtra">追加予算</label><select id="swapExtra" class="select" data-field="swapExtra">${[0,100,300,500,1000].map(n=>`<option value="${n}" ${state.swapExtra===n?'selected':''}>＋${yen(n)}/月</option>`).join('')}</select></div>
    ${improvement.length?`<div class="swap-items">${improvement.map(x=>`<div class="swap-item"><div><strong>${escape(nameOf(x.replacement))}</strong><span class="micro">差額 ${x.delta<0?'−':'＋'}${yen(Math.abs(x.delta))} / 月　・　候補適合度 ${x.scoreDelta>0?'改善':'同等'}</span></div><button class="button button-dark" data-action="swap" data-id="${x.replacement.id}">入れ替え</button></div>`).join('')}</div>`:`<div class="empty">この条件で、適合度が改善する候補はありません。<br>変更せずに使い続ける選択もおすすめです。</div>`}
  </section>`;
}

function savedPlansHtml(){
  const plans=savedPlans.map((plan,index)=>{
    const total=savedPlanTotals(plan,catalog);
    const expanded=expandedPlanId===plan.id || (expandedPlanId===null && index===0);
    const budgetTag=total.remaining>=0?'<span class="tag">予算内</span>':'<span class="tag orange">予算超過</span>';
    return `<article class="saved-plan">
      <div class="saved-plan-head"><div><span class="micro muted">保存 ${escape(new Date(plan.createdAt).toLocaleDateString('ja-JP'))}</span><h3>${escape(plan.name)}</h3><span class="micro muted">${plan.productIds.length}品</span></div><div class="saved-totals"><strong>${yen(total.monthly)}<small> / 月</small></strong><span>月予算 ${yen(total.budget)}</span>${budgetTag}</div></div>
      <button type="button" class="link-button" data-action="toggleSaved" data-id="${escape(plan.id)}">${expanded?'編集を閉じる':'内訳・使用量を編集'}</button>
      ${expanded?`<div class="saved-plan-detail">
        <div class="saved-meta"><label>組み合わせ名<input type="text" class="select" maxlength="70" data-plan-name="${escape(plan.id)}" value="${escape(plan.name)}"></label><label>月予算（円）<input type="number" class="select" min="0" step="100" data-plan-budget="${escape(plan.id)}" value="${total.budget}"></label></div>
        <div class="saved-cost-summary"><span>月額合計 <strong>${yen(total.monthly)}</strong></span><span>初回購入額 <strong>${yen(total.initial)}</strong></span><span>予算との差 <strong>${total.remaining<0?'超過 '+yen(-total.remaining):'残り '+yen(total.remaining)}</strong></span></div>
        <div class="saved-product-list">${total.items.map(p=>{const v=plan.overrides?.[p.id]||{};return `<div class="saved-product-row"><div class="saved-product-name"><strong>${escape(nameOf(p))}</strong><small>${escape(CATEGORY_LABELS[p.category])}</small></div><label>購入価格（円）<input type="number" min="0" step="10" data-plan-usage="price" data-plan-id="${escape(plan.id)}" data-product-id="${escape(p.id)}" value="${v.price??p.demoPrice}"></label><label>1本の使用回数<input type="number" min="1" step="1" data-plan-usage="uses" data-plan-id="${escape(plan.id)}" data-product-id="${escape(p.id)}" value="${v.uses??p.demoUses}"></label><label>1日使用回数<input type="number" min="0" step="0.5" data-plan-usage="frequency" data-plan-id="${escape(plan.id)}" data-product-id="${escape(p.id)}" value="${v.frequency??p.dailyUses}"></label><div class="saved-item-total">${yen(monthlyCost(p,v))}<small> / 月</small></div></div>`}).join('')}</div>
        ${total.missing.length?`<div class="unscored-warning">商品DBに見つからない商品ID：${total.missing.map(escape).join('、')}</div>`:''}
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
    <header class="topbar"><div class="logo"><span class="logo-mark" aria-hidden="true">✿</span><span>SKINCARE LAB</span></div><div class="topnav"><span>スキンケア組合せ最適化</span><span class="tag">PROTOTYPE v0.4.1</span></div></header>
    <section class="hero"><div><div class="eyebrow">SMART ROUTINE, SMALL BUDGET</div><h1>肌にも、予算にも。<br>ちょうどいい組み合わせ。</h1><p>肌悩み・好み・使用コストから、必要なアイテムを探す実験室。<br>メーカー公式に確認できる情報を出発点にしています。</p></div><div class="hero-accent" aria-hidden="true"><i class="mini-bottle a"></i><i class="mini-bottle b"></i><i class="mini-bottle c"></i></div></section>
    <div class="layout">${formHtml()}<div class="main-column">
      ${summaryHtml()}${resultHtml()}${swapHtml()}${savedPlansHtml()}
    </div></div><footer class="footer"><details class="disclaimer"><summary>データ・試算についての注意事項</summary><div class="disclaimer-body">
      <p>${escape(meta.notice)}</p>
      <ul><li>肌悩みの点数と使用感の相性は試作用の適合評価であり、実際の美容効果や安全性を予測・保証するものではありません。</li>
      <li>敏感肌向けと登録された商品でも、すべての人に合うわけではありません。合わなかった商品の除外は商品単位で、原因成分を特定するものではありません。</li>
      <li>商品の購入価格・1本の使用回数・使用頻度は初期状態では仮値です。実際の値に修正できます。日焼け止めの塗り直し費用は初期試算に含めていません。</li>
      <li>「手軽に」は任意の化粧水・美容液の追加手順を控えめに評価し、「しっかり」は有用な追加手順を許容します。価格は月予算を上限とし、同点時のみ安い候補を優先します。</li>
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
    const p=catalog.find(p=>p.id===id);
    if(p){if(state.locked[p.category]===id)delete state.locked[p.category];else state.locked[p.category]=id;}
  }
  if(action==='exclude'){
    pendingExclude=id;const p=catalog.find(p=>p.id===id);
    document.getElementById('excludeName').textContent=nameOf(p);
    document.querySelectorAll('#excludeForm input[name=reason]').forEach(x=>x.checked=false);
    document.getElementById('excludeDialog').showModal();return;
  }
  if(action==='unexclude')delete state.excluded[id];
  if(action==='swap'){
    const selected=catalog.find(p=>p.id===id);
    if(selected && current){state.manual=[...current.products.filter(p=>p.category!==selected.category).map(p=>p.id),selected.id];}
  }
  if(action==='saveRoutine' && current){
    const plan=createSavedPlan(current,state,crypto.randomUUID(),new Date().toISOString());
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
  if(action==='reset' && confirm('選定条件・共通価格補正・商品除外を初期化しますか？ 保存した組み合わせは残ります。'))state=structuredClone(DEFAULT);
  if(['concern','clearConcerns','priority','lock','exclude','unexclude','reset'].includes(action))state.manual=null;
  save();render();
});

app.addEventListener('change',e=>{
  const planId=e.target.dataset.planId||e.target.dataset.planName||e.target.dataset.planBudget;
  if(planId){
    const plan=savedPlans.find(p=>p.id===planId);
    if(!plan)return;
    if(e.target.dataset.planName){const name=e.target.value.trim();if(name)plan.name=name;}
    if(e.target.dataset.planBudget){const n=Number(e.target.value);if(Number.isFinite(n)&&n>=0)plan.budget=n;}
    if(e.target.dataset.planUsage)updateSavedUsage(plan,e.target.dataset.productId,e.target.dataset.planUsage,e.target.value);
    savePlans();render();return;
  }
  if(e.target.dataset.importance){
    state.concernWeights??={};
    state.concernWeights[e.target.dataset.importance]=e.target.value;
    state.manual=null;
  }
  const field=e.target.dataset.field;
  if(field){
    if(field==='budget')state.budget=Number(e.target.value);
    else if(field==='sensitiveSkin')state.sensitiveSkin=e.target.checked;
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
    const p=catalog.find(x=>x.id===pendingExclude);
    if(p && state.locked[p.category]===p.id) delete state.locked[p.category];
    state.manual=null;save();render();
  }
  document.getElementById('excludeDialog').close();pendingExclude=null;
});

fetch('./data/products.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('商品DBが読み込めません');return r.json();}).then(db=>{
  catalog=db.products;meta=db.meta;
  // Persisted IDs no longer in the catalog are ignored safely.
  state.excluded??={};state.locked??={};state.overrides??={};
  render();
}).catch(error=>{app.innerHTML=`<main class="error">商品データを読み込めませんでした。<br>${escape(error.message)}</main>`;});

window.addEventListener('storage',e=>{
  if(e.key===STORE_KEY){state=load();if(catalog.length)render();}
  if(e.key===SAVED_KEY){savedPlans=loadSavedPlans();if(catalog.length)render();}
});
