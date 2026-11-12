import {CATEGORY_LABELS, monthlyCost, priceOf, usesOf, optimize} from './optimizer.js?v=0.7.10';
import {renderContext,renderEvidence,renderRawScores,renderProductAnalysis} from './debug-analysis.js?v=0.7.10';
import {mergeCatalogData,unitPerUse} from './catalog-data.js?v=0.7.10';

const STORE_KEY='skincare-lab-v1';
const PAGE_SIZE=25;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=n=>Number.isFinite(n)?Math.round(n).toLocaleString('ja-JP')+'円':'—';
let catalog=[];
let page=0;
let selectedId=null;
let analysisOptions=null;
let bestRoutine=null;
const diagnosisCache=new Map();
const search=document.getElementById('debugSearch');
const category=document.getElementById('debugCategory');
const items=document.getElementById('debugItems');
const count=document.getElementById('debugCount');
const pagination=document.getElementById('debugPagination');
const debugContext=document.getElementById('debugContext');

function getState(){
  try {return JSON.parse(localStorage.getItem(STORE_KEY)||'{}')||{};}
  catch{return {};}
}
function updateState(next){localStorage.setItem(STORE_KEY,JSON.stringify(next));}

function getOptions(){
  const state=getState();
  return {
    budget:Number(state.budget??5000),useMakeupRemover:Boolean(state.useMakeupRemover),concerns:Array.isArray(state.concerns)?state.concerns:[],
    concernWeights:state.concernWeights||{},skinType:state.skinType||'unknown',
    sensitiveSkin:Boolean(state.sensitiveSkin),finish:state.finish||'any',
    priority:['simple','any','thorough'].includes(state.priority)?state.priority:'any',
    ingredient:state.ingredient||'none',ingredientMode:state.ingredientMode||'prefer',
    excluded:Object.keys(state.excluded||{}),locked:state.locked||{},overrides:state.overrides||{}
  };
}

function refreshAnalysis(){
  analysisOptions=getOptions();
  bestRoutine=analysisOptions.concerns.length?optimize(catalog,{...analysisOptions,resultLimit:1})[0]||null:null;
  diagnosisCache.clear();
  debugContext.innerHTML=renderContext(catalog,analysisOptions,bestRoutine);
  renderRows();
}

function diagnosisFor(p){
  if(!diagnosisCache.has(p.id))diagnosisCache.set(p.id,renderProductAnalysis(catalog,analysisOptions,p,bestRoutine));
  return diagnosisCache.get(p.id);
}

function renderRows(){
  const q=search.value.trim().toLocaleLowerCase('ja-JP');
  const selected=category.value;
  const matching=catalog.filter(p=>(selected==='all'||p.category===selected) &&
    (!q||[p.brand,p.name,p.jan,...(p.keyIngredients||[]),...(p.evidence?.activeIngredients||[])].join(' ').toLocaleLowerCase('ja-JP').includes(q)));
  const pages=Math.max(1,Math.ceil(matching.length/PAGE_SIZE));
  page=Math.min(page,pages-1);
  const visible=matching.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
  const state=getState();
  count.textContent=`${catalog.length}商品中 ${matching.length}件 / ${pages}ページ`;
  items.innerHTML=visible.map(p=>{
    const v=state.overrides?.[p.id]||{};
    const price=priceOf(p,v),uses=usesOf(p,v),frequency=v.frequency??p.dailyUses;
    const perUse=unitPerUse(p,v,uses);
    const priceSource=p.priceReference?`通販価格（税込）：<a href="${escape(p.priceReference.url)}" target="_blank" rel="noopener noreferrer">${escape(p.priceReference.retailer)}</a>（${escape(p.priceReference.verifiedAt)}確認）`:'価格：出典未確認の試算用仮値';
    const useSource=p.usageReference?`1回の目安：${escape(p.usageReference.doseDescription||'公式の使用期間を参照')}。${p.referenceUses?`約${p.referenceUses}回分（${p.usageReference.durationDays}日 × 1日${p.usageReference.referenceDailyUses}回）`:'容器あたりの回数は未確認'}。<a href="${escape(p.usageReference.sourceUrl)}" target="_blank" rel="noopener noreferrer">使用量の根拠 ↗</a>`:p.usageEstimate?.kind==='categoryAverage'?'この商品の使用量・使い切り期間は未確認。同品目・同単位の参考商品から仮推定しています。':'この商品の使用量・使い切り期間は未確認。1本の回数は従来の試算用仮値です。';
    const estimate=p.referenceUses?'使い切り期間に基づく逆算値（品質の使用期限とは別）':p.usageEstimate?.kind==='categoryAverage'?`同品目・同単位の出典付き${p.usageEstimate.sampleCount}商品の1回量平均 ${p.usageEstimate.amountPerUse.toFixed(2)}${escape(p.unit)}/回を仮適用。個別商品の実測値ではありません。`:'同品目・同単位で参考例が2商品未満のため、従来の試算用仮回数を維持。';
    return `<article class="debug-item"><div class="debug-item-head"><div><small>${escape(p.brand)}・${escape(CATEGORY_LABELS[p.category])} / JAN ${escape(p.jan||'未確認')}</small><h2>${escape(p.name)}</h2><p>${escape(p.keyIngredients.join('・'))}</p></div><a href="${escape(p.sourceUrl)}" class="source" target="_blank" rel="noopener noreferrer">メーカー公式 ↗</a></div>
      ${renderEvidence(p)}
      <div class="debug-provenance"><span>${priceSource}</span><span>${useSource}</span><small>${estimate}${p.usageReference?.referenceBasis?` ${escape(p.usageReference.referenceBasis)}。`:''} 数値は仮推定や逆算を含みます。</small></div>
      <div class="debug-edit-fields"><label>購入価格（円）<input type="number" min="0" step="1" data-edit="price" data-id="${escape(p.id)}" value="${price}"></label><label>1回の量（${escape(p.unit)}）<input type="number" min="0.01" step="0.01" data-edit="amountPerUse" data-id="${escape(p.id)}" value="${perUse?.toFixed(2)??''}"></label><label>1本の使用回数<input type="number" min="1" step="1" data-edit="uses" data-id="${escape(p.id)}" value="${Math.round(uses)}"></label><label>1日使用回数<input type="number" min="0" step="0.5" data-edit="frequency" data-id="${escape(p.id)}" value="${frequency}"></label><div class="debug-month">${yen(monthlyCost(p,v))}<small> / 月</small></div></div>
      <div class="debug-item-actions"><button type="button" class="button ${selectedId===p.id?'button-dark':''}" data-analyze="${escape(p.id)}">${selectedId===p.id?'検証結果を閉じる':'この商品の採否理由を検証'}</button><button type="button" class="link-button" data-reset="${escape(p.id)}" ${state.overrides?.[p.id]?'':'disabled'}>使用条件の補正を解除</button></div>
      ${renderRawScores(p,analysisOptions)}
      ${selectedId===p.id?diagnosisFor(p):''}
    </article>`;
  }).join('') || '<div class="empty">該当する商品はありません。</div>';
  pagination.innerHTML=`<button class="button" data-page="prev" ${page===0?'disabled':''}>前へ</button><span>${page+1} / ${pages}</span><button class="button" data-page="next" ${page>=pages-1?'disabled':''}>次へ</button>`;
}

search.addEventListener('input',()=>{page=0;renderRows();});
category.addEventListener('change',()=>{page=0;renderRows();});
pagination.addEventListener('click',e=>{
  const btn=e.target.closest('[data-page]');if(!btn)return;
  page=Math.max(0,page+(btn.dataset.page==='next'?1:-1));renderRows();
});
items.addEventListener('change',e=>{
  const edit=e.target.dataset.edit;
  if(!edit)return;
  const id=e.target.dataset.id;
  const n=Number(e.target.value);
  if(!Number.isFinite(n)||n<(['uses'].includes(edit)?1:edit==='amountPerUse'?0.01:0)){renderRows();return;}
  const state=getState();state.overrides??={};state.overrides[id]??={};state.overrides[id][edit]=n;
  if(edit==='amountPerUse')delete state.overrides[id].uses;
  if(edit==='uses')delete state.overrides[id].amountPerUse;
  updateState(state);refreshAnalysis();
});
items.addEventListener('click',e=>{
  const analyze=e.target.closest('[data-analyze]');
  if(analyze){selectedId=selectedId===analyze.dataset.analyze?null:analyze.dataset.analyze;renderRows();return;}
  const btn=e.target.closest('[data-reset]');if(!btn)return;
  const state=getState();if(state.overrides)delete state.overrides[btn.dataset.reset];
  updateState(state);refreshAnalysis();
});
window.addEventListener('storage',e=>{if(e.key===STORE_KEY)refreshAnalysis();});
const fetchJSON=url=>fetch(url,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(`商品データを読み込めません：${url}`);return r.json();});
Promise.all([fetchJSON('./data/products.json'),fetchJSON('./data/pricing.json'),fetchJSON('./data/usage.json')]).then(([db,pricing,usage])=>{
  catalog=mergeCatalogData(db.products,pricing,usage);refreshAnalysis();
}).catch(e=>{count.textContent=e.message;});
