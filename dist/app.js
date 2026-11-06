import {CATEGORIES, CATEGORY_LABELS, CONCERNS, CONCERN_GROUPS, unscoredConcerns, monthlyCost, evaluate, optimize, swaps} from './optimizer.js';

const STORE_KEY='skincare-lab-v1';
const DEFAULT={budget:5000, concerns:[], concernWeights:{}, skinType:'unknown', sensitiveSkin:false, finish:'any', priority:'simple', ingredient:'none', ingredientMode:'prefer', excluded:{}, locked:{}, overrides:{}, manual:null, swapCategory:'moisturizer', swapExtra:100, catalogOpen:false};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=n=>Number.isFinite(n)?Math.round(n).toLocaleString('ja-JP')+'円':'—';
const app=document.getElementById('app');
let catalog=[];
let meta={};
let state=load();
let current=null;
let pendingExclude=null;

function load(){
  try {const saved=JSON.parse(localStorage.getItem(STORE_KEY)||'{}'); return {...structuredClone(DEFAULT),...saved};}
  catch {return structuredClone(DEFAULT);}
}
function save(){localStorage.setItem(STORE_KEY,JSON.stringify(state));}
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
      <div class="period">${escape(p.volume)}${escape(p.unit)} / 約${escape(humanUses(p))}回分（仮定） / 1日${escape(state.overrides[p.id]?.frequency??p.dailyUses)}回</div>
      <p class="product-description">${escape(p.explanation)}</p>
      <div class="ingredient-row">${p.keyIngredients.map(x=>`<span class="ingredient">${escape(x)}</span>`).join('')}</div>
      ${matchLabels.length?`<div class="fit-note">仮評価の対象：${matchLabels.map(escape).join('・')}</div>`:''}
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
      <label class="sensitive-check"><input type="checkbox" data-field="sensitiveSkin" ${state.sensitiveSkin?'checked':''}> 刺激を感じやすい・敏感肌</label><p class="note">敏感肌向けの商品を優先しますが、肌に合うことを保証するものではありません。</p>
    </div>
    <div class="field"><label class="field-title" for="finish">好みの使用感</label><select id="finish" class="select" data-field="finish">${[['any','こだわらない'],['light','さっぱり・みずみずしい'],['moist','しっとり'],['rich','とてもしっとり']].map(([id,label])=>`<option value="${id}" ${state.finish===id?'selected':''}>${label}</option>`).join('')}</select></div>
    <div class="field"><span class="field-title">何を優先する？</span><div class="segmented">
      ${[['simple','手軽さ'],['balance','バランス'],['cost','コスパ']].map(([v,l])=>`<button class="segment ${state.priority===v?'selected':''}" data-action="priority" data-id="${v}" aria-pressed="${state.priority===v}">${l}</button>`).join('')}
    </div></div>
    <div class="field"><label class="field-title" for="ingredient">使ってみたい成分</label><select class="select" id="ingredient" data-field="ingredient">
      ${ingredients.map(x=>`<option value="${escape(x)}" ${state.ingredient===x?'selected':''}>${x==='none'?'指定なし':escape(x)}</option>`).join('')}
    </select><div class="radio-line"><label><input type="radio" name="ingredientMode" value="prefer" ${state.ingredientMode==='prefer'?'checked':''}> 優先</label><label><input type="radio" name="ingredientMode" value="required" ${state.ingredientMode==='required'?'checked':''}> 必須</label></div></div>
    <div class="controls-foot"><p class="note">現在の条件・商品固定・除外・試算額の変更は、このブラウザ内に保存します。</p><button class="link-button" data-action="reset">設定を初期化</button></div>
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
  </section>`;
}

function resultHtml(){
  if(!current) return '';
  const sorted=[...current.products].sort((a,b)=>CATEGORIES.indexOf(a.category)-CATEGORIES.indexOf(b.category));
  const am=sorted.filter(p=>p.category==='sunscreen'||(p.category!=='cleanser'&&(state.overrides[p.id]?.frequency??p.dailyUses)>1));
  const pm=sorted.filter(p=>p.category!=='sunscreen');
  return `<section class="panel recommendation">
    <div class="reco-head"><div><span class="eyebrow">02 / RECOMMENDATION</span><h2>朝と夜のルーティン</h2></div><span class="tag orange">試作版</span></div>
    <p class="summary-note">朝：${am.map(p=>CATEGORY_LABELS[p.category]).join(' → ')}<br>夜：${pm.map(p=>CATEGORY_LABELS[p.category]).join(' → ')}<br>※朝の洗顔方法や使用頻度は個別に調整できます。UVの塗り直し費用は未算入。</p>
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
    <p class="note">この比較は、他の品目を固定した差分計算です。点数は医学的効果の予測ではなく、試作用の適合スコアです。</p>
  </section>`;
}

function catalogHtml(){
  const rejected=Object.keys(state.excluded).length;
  return `<section class="panel catalog-panel"><div class="catalog-top"><div><span class="eyebrow">PRODUCT DATABASE</span><h2>登録データと使用量</h2></div><button class="button" data-action="catalog">${state.catalogOpen?'閉じる':'編集する'} · ${catalog.length}品</button></div>
    <p class="note">商品DBは <code>data/products.json</code> に独立保存。商品ごとの購入価格・1本の使用回数・1日使用回数はここで補正できます。</p>
    ${rejected?`<div class="warning">除外中：${Object.keys(state.excluded).map(id=>{const p=catalog.find(x=>x.id===id);return p?`${escape(p.brand)} ${escape(p.name)}（${escape(state.excluded[id])}） <button data-action="unexclude" data-id="${id}" class="link-button">解除</button>`:''}).join('<br>')}</div>`:''}
    ${state.catalogOpen?`<div class="catalog-labels"><span>商品名</span><span>仮価格</span><span>全使用回数</span><span>1日回数</span></div><div class="catalog-table">${catalog.map(p=>`<div class="catalog-item"><div><b>${escape(p.brand)} ${escape(p.name)}</b><small>${escape(CATEGORY_LABELS[p.category])}</small></div><input type="number" aria-label="${escape(nameOf(p))} の購入価格" data-edit="price" data-id="${p.id}" min="0" step="10" value="${humanPrice(p)}"><input type="number" aria-label="${escape(nameOf(p))} の使用可能回数" data-edit="uses" data-id="${p.id}" min="1" step="1" value="${humanUses(p)}"><input type="number" aria-label="${escape(nameOf(p))} の1日使用回数" data-edit="frequency" data-id="${p.id}" min="1" max="8" step="1" value="${state.overrides[p.id]?.frequency??p.dailyUses}"></div>`).join('')}</div><p class="catalog-help">※価格・回数はすべて初期状態では仮値。実際の購入価格や、使い切った日数から得た実績を入力すると月額計算へ反映されます。成分名は公式情報の主要部分のみを抜粋しています。</p>`:''}
  </section>`;
}

function render(){
  pickCurrent();
  app.innerHTML=`<div class="shell">
    <header class="topbar"><div class="logo"><span class="logo-mark" aria-hidden="true">✿</span><span>SKINCARE LAB</span></div><div class="topnav"><span>スキンケア組合せ最適化</span><span class="tag">PROTOTYPE v0.2</span></div></header>
    <section class="hero"><div><div class="eyebrow">SMART ROUTINE, SMALL BUDGET</div><h1>肌にも、予算にも。<br>ちょうどいい組み合わせ。</h1><p>肌悩み・好み・使用コストから、必要なアイテムを探す実験室。<br>メーカー公式に確認できる情報を出発点にしています。</p></div><div class="hero-accent" aria-hidden="true"><i class="mini-bottle a"></i><i class="mini-bottle b"></i><i class="mini-bottle c"></i></div></section>
    <div class="layout">${formHtml()}<div class="main-column">
      <div class="warning"><strong>デモデータについて：</strong>${escape(meta.notice)} 肌への適合スコアは試作用で、効果を保証するものではありません。</div>
      ${summaryHtml()}${resultHtml()}${swapHtml()}${catalogHtml()}
    </div></div><footer class="footer">SKINCARE LAB — 個人開発プロトタイプ / 化粧品の比較検討用。診断・治療を行うアプリではありません。商品の改良により公式情報が変わる場合があります。最終確認は製品パッケージで行ってください。</footer></div>`;
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
  if(action==='catalog')state.catalogOpen=!state.catalogOpen;
  if(action==='reset' && confirm('このブラウザに保存した条件・価格補正・商品除外を初期化しますか？'))state=structuredClone(DEFAULT);
  if(['concern','clearConcerns','priority','lock','exclude','unexclude','reset'].includes(action))state.manual=null;
  save();render();
});

app.addEventListener('change',e=>{
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
  if(e.target.dataset.edit){
    const {id,edit}=e.target.dataset;
    const number=Number(e.target.value);
    if(Number.isFinite(number)&&number>=(edit==='price'?0:1)){
      state.overrides[id]??={};state.overrides[id][edit]=number;state.manual=null;
    }
  }
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

fetch('./data/products.json').then(r=>{if(!r.ok)throw Error('商品DBが読み込めません');return r.json();}).then(db=>{
  catalog=db.products;meta=db.meta;
  // Persisted IDs no longer in the catalog are ignored safely.
  state.excluded??={};state.locked??={};state.overrides??={};
  render();
}).catch(error=>{app.innerHTML=`<main class="error">商品データを読み込めませんでした。<br>${escape(error.message)}</main>`;});
