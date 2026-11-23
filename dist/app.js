import {CATEGORIES, CATEGORY_LABELS, CONCERNS, unscoredConcerns, monthlyCost, priceOf, usesOf, evaluate, optimize, swaps, canIncludeRoutineProduct, meetsIngredientRequirement} from './optimizer.js?v=0.9.26';
import {createSavedPlan, savedPlanTotals, updateSavedUsage} from './plans.js?v=0.9.26';
import {clampBudget, DEFAULT_BUDGET, getBudgetRange, mergeCatalogData, reconcileCatalogState, unitPerUse} from './catalog-data.js?v=0.9.26';
import {loadCatalog} from './catalog-csv.js?v=0.9.26';
import {renderProgress} from './progress-view.js?v=0.9.26';
import {ingredientChoices} from './ingredient-options.js?v=0.9.26';
import {ingredientGuideId} from './ingredient-guide-index.js?v=0.9.26';

const IS_MEN=/(?:^|\/)men\/(?:index\.html)?$/.test(window.location?.pathname||'');
const STORE_KEY=IS_MEN?'skincare-lab-men-settings-jan':'skincare-lab-settings-jan';
const SAVED_KEY=IS_MEN?'skincare-lab-men-saved-routines-jan':'skincare-lab-saved-routines-jan';
const DEFAULT={budget:DEFAULT_BUDGET, useMakeupRemover:false, concerns:[], concernWeights:{}, skinType:'unknown', sensitiveSkin:false, finish:'any', priority:'any', ingredient:'none', ingredientMode:'prefer', excluded:{}, locked:{}, manual:null, manualExtraBudget:0, swapCategory:'moisturizer', swapExtra:100};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=n=>Number.isFinite(n)?Math.round(n).toLocaleString('ja-JP')+'円':'—';
const app=document.getElementById('app');
let catalog=[];
let availableIngredients=['none'];
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
let recommendationWorker=null;
let recommendationTimer=null;
let recommendationKey=null;
let recommendationResult=null;
let recommendationMinimum=null;
let recommendationPending=false;
let recommendationError='';
let recommendationProgress=null;
let catalogProgress=null;

function stopRecommendationWorker(){
  recommendationWorker?.terminate();
  recommendationWorker=null;
  clearTimeout(recommendationTimer);
}

function load(){
  try {
    const saved=JSON.parse(localStorage.getItem(STORE_KEY)||'{}');
    const merged={...structuredClone(DEFAULT),...saved};
    delete merged.overrides; // 旧デバッグ画面の共通補正。保存した組み合わせの補正は別に保持する。
    if(!Array.isArray(merged.concerns))merged.concerns=[];
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
function useEstimateLabel(p){
  return {
    packageCount:'個包装の使用回数',duration:'使い切り期間から逆算',dose:'メーカーの使用量目安から試算',
  }[p.usageEstimate?.kind] || '仮推定';
}
function nameOf(p){return p?`${p.brand} ${p.name}`:'';}
function isSlotEnabled(category){
  if(category==='makeupRemover')return state.useMakeupRemover;
  if(category==='eyeCare')return state.concerns.includes('eyeDryness');
  return true;
}
function findManual(){
  if(!state.concerns.length || !state.manual?.length)return null;
  const ids=new Set(state.manual);
  const products=catalog.filter(p=>ids.has(p.jan));
  if(products.length!==ids.size || products.some(p=>state.excluded[p.jan])) return null;
  for(const mandatory of [state.useMakeupRemover?'makeupRemover':'cleanser','moisturizer']) if(!products.some(p=>p.category===mandatory))return null;
  if(products.some(p=>!isSlotEnabled(p.category) || !canIncludeRoutineProduct(p,state)))return null;
  if(state.useMakeupRemover && !products.some(p=>p.category==='cleanser') && products.some(p=>p.category==='makeupRemover' && !p.doubleCleanseNotNeeded))return null;
  if(Object.entries(state.locked).some(([category, jan])=>isSlotEnabled(category) && !ids.has(jan)))return null;
  if(!meetsIngredientRequirement(products,state))return null;
  const result=evaluate(products,options());
  return result.monthly<=state.budget+Math.max(0,Number(state.manualExtraBudget)||0)?result:null;
}

function pickCurrent(){
  const manual=findManual();
  isManual=Boolean(manual);
  if(manual || !state.concerns.length){
    stopRecommendationWorker();recommendationKey=null;recommendationPending=false;recommendationError='';
    current=manual||null;
    return current;
  }
  // 重い探索を画面の描画から分ける。固定・採点・予算の判定は同じエンジンを使う。
  if(typeof Worker==='undefined'){
    current=optimize(catalog,{...options(),resultLimit:1})[0]||null;
    return current;
  }
  const {manual: ignoredManual,manualExtraBudget,swapCategory,swapExtra,...settings}=options();
  const key=JSON.stringify(settings);
  if(key!==recommendationKey){
    stopRecommendationWorker();recommendationKey=key;
    recommendationResult=null;recommendationMinimum=null;
    recommendationPending=true;recommendationError='';
    recommendationProgress={title:'候補の準備',stage:'preparing',percent:0,completed:0,total:CATEGORIES.length,unit:'品目',current:state.useMakeupRemover?'メイク落としの暫定一位を計算しています……':'洗顔の暫定一位を計算しています……'};
    try{
      const worker=new Worker(new URL('./routine-worker.js?v=0.9.26',import.meta.url),{type:'module'});
      recommendationWorker=worker;
      const failed=message=>{
        if(recommendationWorker!==worker)return;
        stopRecommendationWorker();recommendationPending=false;recommendationError=message;
        render();
      };
      worker.onmessage=event=>{
        if(recommendationWorker!==worker)return;
        if(event.data.progress){
          recommendationProgress=event.data.progress;
          const target=document.getElementById('recommendation-progress');
          if(target)target.innerHTML=recommendationProgressHtml();
          return;
        }
        if(event.data.error){failed(event.data.error);return;}
        const result=event.data.routine;
        const byJan=new Map(catalog.map(product=>[product.jan,product]));
        recommendationResult=result?{...result,products:result.products.map(product=>byJan.get(product.jan))}:null;
        recommendationMinimum=event.data.minimumMonthly;
        stopRecommendationWorker();recommendationPending=false;
        render();
      };
      worker.onerror=()=>failed('計算に必要なファイルを読み込めませんでした。もう一度計算するか、ページを読み込み直してください。');
      recommendationTimer=setTimeout(()=>failed('この条件の計算に時間がかかっています。条件を変更するか、もう一度計算してください。'),60000);
      worker.postMessage({catalog,options:settings});
    }catch(error){
      stopRecommendationWorker();recommendationPending=false;
      recommendationError='提案の計算を開始できませんでした。ページを読み込み直してください。';
    }
  }
  current=recommendationResult;
  return current;
}

function setBudget(value){
  state.budget=clampBudget(value,budgetRange);
  state.manual=null;
}

function cleansingLabel(product){
  if(product.doubleCleanseNotNeeded)return 'W洗顔不要';
  if(product.manufacturerAdvisesCleanser)return 'メーカーが洗顔を案内';
  return 'W洗顔不要の記載なし';
}

const applicationNotes={beforeToner:'化粧水の前に使用',last:'お手入れの最後に使用'};

function applicationRank(product){
  if(product.applicationOrder==='last')return CATEGORIES.length;
  const tonerRank=CATEGORIES.indexOf('toner');
  if(product.wipeOff)return tonerRank-0.5;
  if(product.applicationOrder==='beforeToner')return tonerRank-0.25;
  return CATEGORIES.indexOf(product.category);
}

// Category pictograms follow the approved outline design; they are not product packaging.
// Rounded bubbles overlap without a central peak or stacked tiers.
const foamShape='M12 30C7 22 12 13 20 15C22 7 34 7 38 16C47 11 56 19 52 28C60 30 63 38 58 44C55 49 49 51 43 48C38 55 29 55 24 49C15 54 6 50 4 43C1 37 5 32 12 30Z';
const categorySymbols={
  makeupRemover:`<path d="${foamShape}" fill="#d5dfd4"/>`,
  cleanser:`<path d="${foamShape}"/>`,
  toner:'<path d="M32 5C27 12 13 28 13 39A19 19 0 0 0 51 39C51 28 37 12 32 5Z"/>',
  moisturizer:'<path d="M8 42C9 33 20 29 31 28C38 27 41 23 39 19C45 20 50 25 51 31C58 35 61 42 57 47C51 54 13 55 7 47C6 45 7 43 8 42Z"/>',
  serum:'<path d="M29 13C27 26 23 30 11 33C23 36 27 40 29 53C32 40 36 36 48 33C36 30 32 26 29 13Z M49 7C48 12 46 14 41 16C46 18 48 20 49 25C51 20 53 18 58 16C53 14 51 12 49 7Z M12 45C11 49 9 51 5 52C9 53 11 55 12 59C14 55 16 53 20 52C16 51 14 49 12 45Z"/>',
  eyeCare:'<path d="M7 25Q32 47 57 25 M17 32L13 38 M32 36V43 M47 32L51 38" fill="none"/>',
};
function categoryIcon(category){
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" fill="white" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${categorySymbols[category]||''}</svg>`;
}

function productCard(p){
  const locked=state.locked[p.category]===p.jan;
  const matchLabels=state.concerns.filter(id=>(p.scores?.[id]||0)>0).map(id=>CONCERNS[id]||id);
  const uses=usesOf(p);
  const amount=unitPerUse(p,{},uses);
  const amountLabel=amount==null?'—':`${amount.toFixed(2)}${p.unit}`;
  return `<article class="product">
    <div class="product-visual" aria-hidden="true">${categoryIcon(p.category)}</div>
    <div>
      <div class="product-brand">${escape(p.brand)}　・　${escape(CATEGORY_LABELS[p.category])}</div>
      <div class="product-top"><h3 class="product-name">${escape(p.name)}</h3><div class="product-cost">${yen(monthlyCost(p))}<small>月額試算</small></div></div>
      <div class="product-actions">
        <button type="button" class="chip${locked?' selected':''}" data-action="lock" data-id="${p.jan}" aria-pressed="${locked}">${locked?'固定中':'この商品を固定'}</button>
        <button type="button" class="chip" data-action="exclude" data-id="${p.jan}">合わない・除外</button>
      </div>
      <div class="period">${escape(p.volume)}${escape(p.unit)} / 約${Math.round(uses)}回分 / 1回約${escape(amountLabel)}（${escape(useEstimateLabel(p))}） / 1日${escape(p.dailyUses)}回</div>
      ${p.usageEstimate?.kind==='dose' && p.usageReference.referenceBasis?`<div class="period">${escape(p.usageReference.referenceBasis)}</div>`:''}
      <div class="period">購入価格 ${yen(priceOf(p))}（${p.priceReference?`${escape(p.priceReference.retailer)}・確認済み`:'出典未確認の仮価格'}）</div>
      <p class="product-description">${escape(p.explanation)}</p>${p.category==='eyeCare'?`<div class="fit-note">部分ケア${p.applicationOrder?'':'・顔全体の保湿の後に使用'}</div>`:''}${p.wipeOff?'<div class="fit-note">ふき取りタイプ・コットン代は月額に含みません</div>':''}${p.category==='makeupRemover'?'<div class="fit-note">夜のみ・'+cleansingLabel(p)+(p.waterproof?'・落ちにくいメイク対応':'')+'</div>':''}
      ${p.applicationTime==='morning'?'<div class="fit-note">朝のみ</div>':''}
      ${p.applicationOrder?`<div class="fit-note">${applicationNotes[p.applicationOrder]}</div>`:''}
      <div class="ingredient-row">${p.keyIngredients.map(x=>`<span class="ingredient">${escape(x)}</span>`).join('')}</div>
      ${matchLabels.length?`<div class="fit-note">関連する悩み：${matchLabels.map(escape).join('・')}</div>`:''}
      ${state.sensitiveSkin && p.sensitiveSkin?'<div class="fit-note">敏感肌向けの設計情報を考慮</div>':''}
      <a class="source" href="${escape(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">公式成分表 ↗</a>
    </div>
  </article>`;
}

function formHtml(){
  // 指定なしは先頭に置き、成分は読みの五十音順にする。
  const ingredients=availableIngredients;
  const guideId=ingredientGuideId(state.ingredient);
  const ingredientGuideUrl=`${IS_MEN?'../dist/':''}ingredients.html${guideId?`#${guideId}`:''}`;
  const locked=catalog.filter(product=>state.locked[product.category]===product.jan);
  const excluded=catalog.filter(product=>Object.hasOwn(state.excluded,product.jan));
  const hasRemover=catalog.some(product=>product.category==='makeupRemover');
  return `<aside class="panel controls" aria-label="選定条件">
    <div class="section-heading"><h2>あなたの条件</h2><span class="step-number">01 / SETTINGS</span></div>
    <div class="field"><div class="budget-row"><label class="field-title" for="budget">月額予算</label><span class="budget-value">${yen(state.budget)}<small> / 月</small></span></div>
      <div class="budget-slider">
        <button type="button" class="budget-step" data-action="budgetStep" data-id="down" aria-label="月額予算を100円下げる" ${state.budget<=budgetRange.min?'disabled':''}>◀</button>
        <input id="budget" data-field="budget" type="range" min="${budgetRange.min}" max="${budgetRange.max}" step="${budgetRange.step}" value="${state.budget}">
        <button type="button" class="budget-step" data-action="budgetStep" data-id="up" aria-label="月額予算を100円上げる" ${state.budget>=budgetRange.max?'disabled':''}>▶</button>
      </div>
      <div class="range-label"><span>${yen(budgetRange.min)}</span><span>${yen(budgetRange.max)}</span></div>
    </div>
    <div class="field"><div class="concern-heading"><span class="field-title" id="concern-label">肌の悩み <small>1つ以上選択</small></span>${state.concerns.length?'<button type="button" class="link-button" data-action="clearConcerns">選択をクリア</button>':''}</div>
      <div class="chips" role="group" aria-labelledby="concern-label">
        ${Object.entries(CONCERNS).map(([id,label])=>{
          const selected=state.concerns.includes(id);
          return `<button type="button" class="chip${selected?' selected':''}" data-action="concern" data-id="${id}" aria-pressed="${selected}">${escape(label)}</button>`;
        }).join('')}
      </div>
      ${state.concerns.length?`<div class="concern-priorities"><span class="micro muted">悩みごとの優先度</span>${state.concerns.map(id=>`<label class="priority-row"><span>${escape(CONCERNS[id]||id)}</span><select class="select" data-importance="${escape(id)}"><option value="high" ${state.concernWeights?.[id]==='high'?'selected':''}>最優先</option><option value="normal" ${!state.concernWeights?.[id]||state.concernWeights?.[id]==='normal'?'selected':''}>気になる</option><option value="low" ${state.concernWeights?.[id]==='low'?'selected':''}>軽く気になる</option></select></label>`).join('')}</div>`:''}
    </div>
    <div class="field"><span class="field-title">夜の洗浄</span><label class="sensitive-check"><input type="checkbox" data-field="useMakeupRemover" ${state.useMakeupRemover?'checked':''} ${hasRemover?'':'disabled'}> メイク落としを使う</label><div class="micro muted">${hasRemover?'チェック時は毎晩使う前提で試算します。「手軽に」では、洗顔料を固定していない場合にW洗顔を省きます。':'メイク落としは商品未登録のため、現時点では選択できません。'}</div></div>
    <div class="field"><label class="field-title" for="skinType">肌質</label><select id="skinType" class="select" data-field="skinType">${[['unknown','わからない・指定なし'],['dry','乾燥肌'],['oily','脂性肌'],['combination','混合肌'],['normal','普通肌']].map(([id,label])=>`<option value="${id}" ${state.skinType===id?'selected':''}>${label}</option>`).join('')}</select>
      <label class="sensitive-check"><input type="checkbox" data-field="sensitiveSkin" ${state.sensitiveSkin?'checked':''}> 刺激を感じやすい・敏感肌</label>
    </div>
    <div class="field"><label class="field-title" for="finish">好みの使用感</label><select id="finish" class="select" data-field="finish">${[['any','こだわらない'],['light','さっぱり・みずみずしい'],['moist','しっとり'],['rich','とてもしっとり']].map(([id,label])=>`<option value="${id}" ${state.finish===id?'selected':''}>${label}</option>`).join('')}</select></div>
    <div class="field"><span class="field-title">お手入れの手間</span><div class="segmented">
      ${[['simple','手軽に'],['any','こだわらない'],['thorough','しっかり']].map(([v,l])=>`<button class="segment ${state.priority===v?'selected':''}" data-action="priority" data-id="${v}" aria-pressed="${state.priority===v}">${l}</button>`).join('')}
    </div></div>
    <div class="field"><div class="ingredient-heading"><label class="field-title" for="ingredient">使ってみたい成分</label><a class="ingredient-help" href="${ingredientGuideUrl}" target="_blank" rel="noopener noreferrer" aria-label="成分の解説（別タブで開きます）">成分の解説 <span aria-hidden="true">↗</span></a></div><select class="select" id="ingredient" data-field="ingredient">
      ${ingredients.map(x=>`<option value="${escape(x)}" ${state.ingredient===x?'selected':''}>${x==='none'?'指定なし':escape(x)}</option>`).join('')}
    </select><div class="radio-line"><label><input type="radio" name="ingredientMode" value="prefer" ${state.ingredientMode==='prefer'?'checked':''}> 優先</label><label><input type="radio" name="ingredientMode" value="required" ${state.ingredientMode==='required'?'checked':''}> 必須</label></div></div>
    <div class="controls-foot">
      ${locked.length?`<div class="product-filter-list"><strong>固定中の商品：${locked.length}品</strong>
        ${locked.map(p=>`<div>${escape(nameOf(p))}${isSlotEnabled(p.category)?'':'（現在は提案対象外）'} <button type="button" class="link-button" data-action="unlock" data-id="${escape(p.jan)}" aria-label="${escape(nameOf(p))}の固定を解除">固定解除</button></div>`).join('')}
      </div>`:''}
      ${excluded.length?`<div class="product-filter-list"><strong>除外中の商品：${excluded.length}品</strong>${excluded.map(p=>`<div>${escape(nameOf(p))}（${escape(state.excluded[p.jan])}） <button class="link-button" data-action="unexclude" data-id="${escape(p.jan)}">解除</button></div>`).join('')}</div>`:''}
      <button class="link-button" data-action="reset">選定条件を初期化</button>
    </div>
  </aside>`;
}

function recommendationProgressHtml(){
  const note=recommendationProgress?.phase==='minimum'?'提案の探索は100%完了。予算内の候補がなかったため、別工程で最低予算を調べています。':'';
  return renderProgress({...recommendationProgress,note});
}

function summaryHtml(){
  if(!state.concerns.length) return '<section class="panel summary"><h2>肌悩みを選ぶと提案します</h2></section>';
  if(recommendationPending)return `<section class="recommendation-loading" aria-label="条件に合う組み合わせを計算中" aria-busy="true"><div id="recommendation-progress">${recommendationProgressHtml()}</div></section>`;
  if(recommendationError)return `<section class="panel summary" role="alert"><h2>提案の計算を完了できませんでした</h2><p class="summary-note">${escape(recommendationError)}</p>${recommendationProgress?renderProgress(recommendationProgress,true):''}<button type="button" class="button" data-action="retryRecommendation">もう一度計算する</button></section>`;
  if(!current){
    const settings={...options(),budget:Infinity,resultLimit:1};
    const possible=typeof Worker==='undefined'?optimize(catalog,settings).length>0:false;
    const cheapest=typeof Worker==='undefined'?(possible?optimize(catalog,{...settings,objective:'minimumMonthly'})[0]:null):
      (recommendationMinimum===null?null:{monthly:recommendationMinimum});
    const remover=catalog.find(p=>p.jan===state.locked.makeupRemover);
    const cleansingConflict=state.useMakeupRemover && state.priority==='simple' && !state.locked.cleanser && remover && !remover.doubleCleanseNotNeeded;
    const reason=cheapest?`今の条件で組める最安の組み合わせは月額${yen(cheapest.monthly)}です。`:
      cleansingConflict?'固定中のメイク落としは、このアプリでは洗顔料と併用します。「お手入れの手間」を変更するか、メイク落としの固定を解除してください。':
      '必須成分や固定・除外の条件を見直すと、候補が見つかることがあります。';
    return `<section class="panel summary"><span class="tag orange">条件に合う候補なし</span><h2>組み合わせを作れませんでした</h2><p class="summary-note">${reason}</p></section>`;
  }
  const effectiveBudget=state.budget+(isManual?Math.max(0,Number(state.manualExtraBudget)||0):0);
  const used=Math.min(100,Math.round(current.monthly/effectiveBudget*100));
  const optional=current.products.filter(p=>p.category==='toner'||p.category==='serum'||p.category==='eyeCare').length+(state.useMakeupRemover && current.products.some(p=>p.category==='cleanser')?1:0);
  const missing=unscoredConcerns(current.products,state.concerns).map(id=>CONCERNS[id]||id);
  return `<section class="panel summary">
    <div class="summary-top"><span class="eyebrow">${isManual?'YOUR CUSTOM ROUTINE':'YOUR BEST MATCH'}</span><span class="tag">${current.monthly>state.budget?'追加予算込み':'月額予算内'}</span></div>
    <h2>${isManual?'入れ替え後の組み合わせ':'おすすめの組み合わせ'}</h2><div class="summary-number">${yen(current.monthly)}<small> / 月</small></div>
    <div class="meter" role="progressbar" aria-label="予算使用率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${used}"><span style="width:${used}%"></span></div>
    <div class="summary-note">${isManual&&state.manualExtraBudget?`通常予算 ${yen(state.budget)} ＋ 追加上限 ${yen(state.manualExtraBudget)}。`:''}残り予算 <strong>${yen(Math.max(0,effectiveBudget-current.monthly))}</strong>。${isManual?'手動で選んだ組み合わせです。通常のおすすめとは異なる場合があります。':'無理に予算を使い切りません。'}</div>
    ${missing.length?`<div class="unscored-warning">今回の組み合わせで対応できない悩み：${missing.map(escape).join('・')}</div>`:''}
    <div class="summary-stats"><div><span class="stat-label">初回購入費（試算）</span><span class="stat-value">${yen(current.initial)}</span></div><div><span class="stat-label">選定商品数</span><span class="stat-value">${current.products.length}<small> 品</small></span></div><div><span class="stat-label">追加ステップ</span><span class="stat-value">${optional}<small> 個</small></span></div></div>
    <button type="button" class="button button-dark save-routine" data-action="saveRoutine">この組み合わせを保存</button>
    ${isManual?'<button type="button" class="button save-routine" data-action="resetSwap">自動のおすすめに戻す</button>':''}
  </section>`;
}

function resultHtml(){
  if(!current) return '';
  const sorted=[...current.products].sort((a,b)=>applicationRank(a)-applicationRank(b));
  const am=sorted.filter(p=>p.category!=='makeupRemover' && (p.applicationTime==='morning' || p.dailyUses>1));
  const pm=sorted.filter(p=>p.applicationTime!=='morning');
  const steps=products=>products.map(p=>p.wipeOff?`ふき取り${CATEGORY_LABELS[p.category]}`:CATEGORY_LABELS[p.category]).join(' → ');
  return `<section class="panel recommendation">
    <div class="reco-head"><div><span class="eyebrow">02 / RECOMMENDATION</span><h2>朝と夜のルーティン</h2></div><span class="tag orange">試作版</span></div>
    <p class="summary-note">朝：${steps(am)||'なし'}<br>夜：${steps(pm)||'なし'}</p>
    <div class="product-list">${sorted.map(productCard).join('')}</div>
  </section>`;
}

function swapHtml(){
  if(!current)return '';
  const categories=CATEGORIES.filter(category=>current.products.some(p=>p.category===category));
  const category=categories.includes(state.swapCategory)?state.swapCategory:DEFAULT.swapCategory;
  const previous=current.products.find(p=>p.category===category);
  const isLocked=state.locked[category]===previous.jan;
  const items=current?swaps(current,catalog,category,options(),state.swapExtra):[];
  const alternatives=items.slice(0,5);
  return `<section class="panel swap-panel">
    <div class="reco-head"><div><span class="eyebrow">03 / TINY UPGRADE</span><h2>1品だけ入れ替える</h2></div></div>
    <div class="swap-row"><label for="swapCategory">変更する品目</label><select id="swapCategory" class="select" data-field="swapCategory">${categories.map(c=>`<option value="${c}" ${c===category?'selected':''}>${CATEGORY_LABELS[c]}</option>`).join('')}</select><label for="swapExtra">予算上限を増やす</label><select id="swapExtra" class="select" data-field="swapExtra">${[0,100,300,500,1000,2000,5000].map(n=>`<option value="${n}" ${state.swapExtra===n?'selected':''}>＋${yen(n)}/月</option>`).join('')}</select></div>
    <p class="micro muted">通常予算 ${yen(state.budget)} → 今回の上限 ${yen(state.budget+state.swapExtra)}。現在：${escape(nameOf(previous))}。条件との相性がより良くなる1品交換だけを表示します。</p>
    ${isLocked?'<div class="empty">この品目の商品が固定されています。入れ替えるには「固定中」のボタンを押してください。</div>':alternatives.length?`<div class="swap-items">${alternatives.map(x=>`<div class="swap-item"><div><strong>${escape(nameOf(x.replacement))}</strong><span class="micro">月額 ${yen(x.monthly)}（現在との差額 ${x.delta>0?'＋':x.delta<0?'−':'±'}${yen(Math.abs(x.delta))}）</span></div><button class="button button-dark" data-action="swap" data-id="${x.replacement.jan}">この商品に変更</button></div>`).join('')}</div>`:'<div class="empty">この品目には、追加予算を使っても評価が上がる1品交換はありません。</div>'}
  </section>`;
}

function savedHeaderTotals(total){
  const tag=total.remaining===null?'<span class="tag orange">月額未確定</span>':
    total.remaining>=0?'<span class="tag">予算内</span>':'<span class="tag orange">予算超過</span>';
  return `<strong>${yen(total.monthly)}<small> / 月</small></strong><span>月予算 ${yen(total.budget)}</span>${tag}`;
}

function savedCostSummary(total){
  const remaining=total.remaining===null?'—':total.remaining<0?'超過 '+yen(-total.remaining):'残り '+yen(total.remaining);
  return `<span>月額合計 <strong>${yen(total.monthly)}</strong></span><span>初回購入額 <strong>${yen(total.initial)}</strong></span><span>予算との差 <strong>${remaining}</strong></span>`;
}

function savedProductDose(p, usage){
  const amount=unitPerUse(p,usage,usesOf(p,usage));
  return `${CATEGORY_LABELS[p.category]} / 1回約${amount?.toFixed(2)??'—'}${p.unit}（逆算）`;
}

function savedItemMonthly(p, usage){
  return `${yen(monthlyCost(p,usage))}<small> / 月</small>`;
}

function savedProductRow(plan, p){
  const usage=plan.overrides?.[p.jan]||{};
  const data=`data-plan-id="${escape(plan.id)}" data-product-jan="${escape(p.jan)}"`;
  return `<div class="saved-product-row">
    <div class="saved-product-name"><strong>${escape(nameOf(p))}</strong><small>${escape(savedProductDose(p,usage))}</small></div>
    <label>購入価格（円）<input type="number" min="0" step="10" data-plan-usage="price" ${data} value="${priceOf(p,usage)}"></label>
    <label>1本の使用回数<input type="number" min="1" step="any" data-plan-usage="uses" ${data} value="${usesOf(p,usage)}"></label>
    <label>1日使用回数<input type="number" min="0" step="0.5" data-plan-usage="frequency" ${data} value="${usage.frequency??p.dailyUses}"></label>
    <div class="saved-item-total">${savedItemMonthly(p,usage)}</div>
  </div>`;
}

function savedPlansHtml(){
  const plans=savedPlans.map((plan,index)=>{
    const total=savedPlanTotals(plan,savedPlanCatalog);
    const expanded=expandedPlanId===plan.id || (expandedPlanId===null && index===0);
    return `<article class="saved-plan">
      <div class="saved-plan-head"><div><span class="micro muted">保存 ${escape(new Date(plan.createdAt).toLocaleDateString('ja-JP'))}</span><h3>${escape(plan.name)}</h3><span class="micro muted">${plan.productJans.length}品</span></div><div class="saved-totals">${savedHeaderTotals(total)}</div></div>
      <button type="button" class="link-button" data-action="toggleSaved" data-id="${escape(plan.id)}">${expanded?'編集を閉じる':'内訳・使用量を編集'}</button>
      ${expanded?`<div class="saved-plan-detail">
        <div class="saved-meta"><label>組み合わせ名<input type="text" class="select" maxlength="70" data-plan-name="${escape(plan.id)}" value="${escape(plan.name)}"></label><label>月予算（円）<input type="number" class="select" min="0" step="100" data-plan-budget="${escape(plan.id)}" value="${total.budget}"></label></div>
        <div class="saved-cost-summary">${savedCostSummary(total)}</div>
        <div class="saved-product-list">${total.items.map(p=>savedProductRow(plan,p)).join('')}</div>
        ${total.items.some(p=>p.archived)?`<p class="micro muted">掲載終了した商品：${total.items.filter(p=>p.archived).map(p=>escape(nameOf(p))).join('、')}</p>`:''}
        ${total.missing.length?`<div class="unscored-warning">商品DBに見つからないJAN：${total.missing.map(escape).join('、')}</div>`:''}
        <div class="saved-footer"><button type="button" class="link-button danger" data-action="deleteSaved" data-id="${escape(plan.id)}">この組み合わせを削除</button></div>
      </div>`:''}
    </article>`;
  }).join('');
  return `<section class="panel saved-panel"><div class="catalog-top"><div><span class="eyebrow">MY ROUTINES</span><h2>保存した組み合わせ</h2></div><span class="tag">${savedPlans.length}件</span></div>
    ${savedPlans.length?`<div class="saved-plans">${plans}</div>`:'<div class="empty">まだ保存した組み合わせはありません。<br>気に入ったおすすめが出たら「この組み合わせを保存」で残せます。</div>'}
  </section>`;
}

function editSavedPlan(input, planId){
  const plan=savedPlans.find(p=>p.id===planId);
  if(!plan)return;
  const {planName, planBudget, planUsage, productJan}=input.dataset;
  const card=input.closest('.saved-plan');
  if(planName){
    const name=input.value.trim();
    if(name)plan.name=name;
    input.value=plan.name;
    card.querySelector('.saved-plan-head h3').textContent=plan.name;
  }else if(planBudget){
    const budget=input.valueAsNumber;
    if(Number.isFinite(budget)&&budget>=0)plan.budget=budget;
    input.value=plan.budget;
  }else if(planUsage){
    const product=savedPlanCatalog.find(p=>p.jan===productJan);
    if(!product)return;
    const updated=updateSavedUsage(plan,productJan,planUsage,input.valueAsNumber);
    const usage=plan.overrides?.[productJan]||{};
    if(!updated){
      input.value={price:priceOf(product,usage),uses:usesOf(product,usage),frequency:usage.frequency??product.dailyUses}[planUsage];
      return;
    }
    const row=input.closest('.saved-product-row');
    row.querySelector('.saved-product-name small').textContent=savedProductDose(product,usage);
    row.querySelector('.saved-item-total').innerHTML=savedItemMonthly(product,usage);
  }
  savePlans();
  // 入力欄を差し替えず、次の入力欄へのフォーカス移動を保つ。
  const total=savedPlanTotals(plan,savedPlanCatalog);
  card.querySelector('.saved-totals').innerHTML=savedHeaderTotals(total);
  card.querySelector('.saved-cost-summary').innerHTML=savedCostSummary(total);
}

function render(){
  pickCurrent();
  app.innerHTML=`<div class="shell ${IS_MEN?'men-site':''}">
    <header class="topbar"><div class="logo"><span class="logo-mark" aria-hidden="true">${IS_MEN?'◆':'✿'}</span><span>${IS_MEN?'MEN’S SKINCARE LAB':'SKINCARE LAB'}</span></div><div class="topnav"><a class="variant-link" href="${IS_MEN?'../dist/':'../men/'}">${IS_MEN?'女性向け版':'男性向け版'}</a><span class="tag">${IS_MEN?'MEN / BETA':'PROTOTYPE'} v0.9.26</span></div></header>
    <section class="hero"><div><div class="eyebrow">${IS_MEN?'MEN’S SKINCARE, DATA FIRST':'SMART ROUTINE, SMALL BUDGET'}</div><h1>${IS_MEN?'男性向けスキンケアを、<br>予算と肌悩みから。':'肌にも、予算にも。<br>ちょうどいい組み合わせ。'}</h1><p>${IS_MEN?'男性向け商品の中から、洗顔と保湿を軸に組み合わせを提案します。<br>選定方法は共通、商品データは男性版専用です。':'肌悩み・好み・使用コストから、必要なアイテムを探す実験室。<br>メーカー公式に確認できる情報を出発点にしています。'}</p></div><div class="hero-accent" aria-hidden="true"><i class="mini-bottle a"></i><i class="mini-bottle b"></i><i class="mini-bottle c"></i></div></section>
    <div class="layout">${formHtml()}<div class="main-column">
      ${summaryHtml()}${resultHtml()}${swapHtml()}${savedPlansHtml()}
    </div></div><footer class="footer">
      <p class="estimate-note">※「仮推定」の試算方法：同じ品目・同じ単位（mL／g）で、使い切り期間が確認できる商品が2品以上あれば、それぞれの「内容量÷使用回数」で求めた1回量の平均を採用し、対象商品の内容量から使用回数を逆算します。比較できる商品が足りない場合は、試作時の仮の使用回数を使います。いずれも対象商品の実測値ではありません。</p>
      <details class="disclaimer"><summary>データ・試算についての注意事項</summary><div class="disclaimer-body">
      <p>${escape(meta.notice)}</p>
      <ul><li>肌悩みや使用感との相性は試作用の適合評価であり、実際の美容効果や安全性を予測・保証するものではありません。</li>
      <li>敏感肌向けと登録された商品でも、すべての人に合うわけではありません。合わなかった商品の除外は商品単位で、原因成分を特定するものではありません。</li>
      <li>購入価格は、JANが一致するドラッグストア通販の税込掲載価格です。店頭価格や将来の価格とは異なることがあります。</li>
      <li>1本の使用回数は「朝晩で約3か月」などの使い切り期間から逆算し、未確認品は同品目・同容量単位の2商品以上の参考値の平均を仮採用します。平均できない商品は旧来の仮値です。使用期限とは区別します。プッシュ数・泡の直径から容量を決めつけません。</li>
      <li>目元の乾燥を選ぶと目元ケア製品を任意で追加できます。顔全体の保湿とは別枠です。使用回数が未確認の製品は仮推定。クマは現在の登録商品で加点の根拠が確認できていないため、選択時に案内を表示します。</li>
      ${IS_MEN?'<li>男性版ではメンズビオレONEがメイク落としの候補です。BB・UVなどを落として洗顔も兼ねる商品で、耐水性の強いメイクへの対応は製品表示で確認してください。</li>':'<li>メイク落としはチェック時に毎晩使う前提。「手軽に」はW洗顔を省略、ほかの手間設定ではW洗顔も選択可能。花王の登録製品はW洗顔不要で、追加洗顔が必須とは限りません。化粧の濃さにより適合は変わります。</li>'}
      <li>「手軽に」は任意の化粧水・美容液の追加手順を控えめに評価し、「しっかり」は有用な追加手順を許容します。価格は月予算を上限とし、評価が同等の場合のみ安い候補を優先します。</li>
      <li>メーカーが公表した配合量を出典付きで確認できた商品に、小さな情報公開ボーナスを加えます。これは美容効果や成分濃度の高さを表すものではなく、配合量が未確認の商品を0％と評価することもありません。採点内訳は商品DBのデバッグ画面で確認できます。</li>
      <li>保存した組み合わせはブラウザ内にのみ保存します。端末やブラウザを変えると共有されず、ブラウザデータの消去で失われます。</li>
      <li>商品情報が改訂されることがあります。最終確認はメーカー公式ページまたは製品パッケージで行ってください。皮膚疾患の診断・治療を目的とするサービスではありません。</li></ul>
    </div></details><span>SKINCARE LAB — 個人開発プロトタイプ</span></footer></div>`;
}

function renderAfterControl(control, selector, matches, fallback){
  const focused=document.activeElement===control;
  save();render();
  if(!focused)return;
  const next=Array.from(app.querySelectorAll(selector)).find(matches);
  (next??fallback?.())?.focus({preventScroll:true});
}

app.addEventListener('click',e=>{
  const btn=e.target.closest('[data-action]'); if(!btn)return;
  const {action,id}=btn.dataset;
  if(action==='retryRecommendation')recommendationKey=null;
  const matches=next=>next.dataset.action===action && next.dataset.id===id;
  if(action==='budgetStep'){
    setBudget(state.budget+(id==='down'?-budgetRange.step:budgetRange.step));
    renderAfterControl(btn,'[data-action]:enabled',matches,()=>document.getElementById('budget'));
    return;
  }
  if(action==='concern') state.concerns=state.concerns.includes(id)?state.concerns.filter(x=>x!==id):[...state.concerns,id];
  if(action==='clearConcerns'){state.concerns=[];state.concernWeights={};}
  if(action==='priority')state.priority=id;
  if(action==='sensitivity')state.sensitiveSkin=!state.sensitiveSkin;
  if(action==='lock' || action==='unlock'){
    const p=catalog.find(p=>p.jan===id);
    if(p && state.locked[p.category]===id)delete state.locked[p.category];
    else if(p && action==='lock')state.locked[p.category]=id;
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
  if(action==='reset'){
    if(!confirm('選定条件・商品の固定と除外を初期化しますか？ 保存した組み合わせは残ります。'))return;
    state={...structuredClone(DEFAULT),budget:clampBudget(DEFAULT.budget,budgetRange)};
  }
  if(['concern','clearConcerns','priority','lock','unlock','exclude','unexclude'].includes(action))state.manual=null;
  renderAfterControl(btn,'[data-action]:enabled',matches);
});

app.addEventListener('change',e=>{
  const planId=e.target.dataset.planId||e.target.dataset.planName||e.target.dataset.planBudget;
  if(planId){
    editSavedPlan(e.target,planId);
    return;
  }
  if(e.target.dataset.importance){
    state.concernWeights??={};
    state.concernWeights[e.target.dataset.importance]=e.target.value;
    state.manual=null;
  }
  const {field,importance}=e.target.dataset;
  if(field){
    if(field==='budget')setBudget(e.target.value);
    else if(field==='sensitiveSkin'||field==='useMakeupRemover')state[field]=e.target.checked;
    else if(field==='swapExtra')state.swapExtra=Number(e.target.value);
    else state[field]=e.target.value;
    if(!['budget','swapCategory','swapExtra'].includes(field))state.manual=null;
  }
  if(e.target.name==='ingredientMode'){state.ingredientMode=e.target.value;state.manual=null;}
  renderAfterControl(e.target,'[data-field], [data-importance], [name="ingredientMode"]',next=>{
    if(field)return next.dataset.field===field;
    if(importance)return next.dataset.importance===importance;
    return next.name==='ingredientMode' && next.value===e.target.value;
  });
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

loadCatalog(undefined, IS_MEN ? '../catalog-men/' : '../catalog/',progress=>{
  catalogProgress=progress;
  const target=document.getElementById('catalog-progress');
  if(target)target.innerHTML=renderProgress(progress);
}).then(({products, archivedProducts, pricing, usage, meta: catalogMeta})=>{
  catalog=mergeCatalogData(products,pricing,usage);meta=catalogMeta;
  availableIngredients=ingredientChoices(catalog);
  budgetRange=getBudgetRange(catalog);
  const archived=mergeCatalogData(archivedProducts,pricing,usage);
  savedPlanCatalog=[...catalog,...archived.map(product=>({...product,archived:true}))];
  const remembered=load();
  state=reconcileCatalogState(remembered,catalog);
  if(remembered.ingredient!==state.ingredient)save();
  savedPlans=loadSavedPlans();
  catalogLoaded=true;
  render();
}).catch(error=>{app.innerHTML=`<main class="error">商品データを読み込めませんでした。<br>${escape(error.message)}${catalogProgress?renderProgress(catalogProgress,true):''}</main>`;});

window.addEventListener('storage',e=>{
  if(!catalogLoaded)return;
  if(e.key===STORE_KEY){state=reconcileCatalogState(load(),catalog);render();}
  if(e.key===SAVED_KEY){savedPlans=loadSavedPlans();render();}
});
