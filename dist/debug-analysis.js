import {CATEGORY_LABELS, CONCERNS, explainRoutineScore, diagnoseProduct, optimize, transparencyDetails, unscoredConcerns} from './optimizer.js?v=0.8.3';

const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=n=>Number.isFinite(n)?Math.round(n).toLocaleString('ja-JP')+'円':'—';
const signed=n=>`${n>0?'+':n<0?'−':''}${Math.abs(n).toFixed(2)}`;
const nameOf=p=>`${p.brand} ${p.name}`;
const names=r=>r.products.map(p=>`${CATEGORY_LABELS[p.category]}：${nameOf(p)}`).join(' / ');

export function renderEvidence(product){
  const e=transparencyDetails(product);
  const levelText=['公式情報の登録なし','メーカー公式の製品情報を登録','公式の有効成分を確認済み','公式の配合量を確認済み'][e.level];
  return `<div class="debug-evidence"><strong>情報公開レベル ${e.level}/3</strong><span>${levelText}</span>
    <small>確認済み有効成分：${e.actives.length?e.actives.map(escape).join('・'):'未調査・未登録'}
    <span class="debug-evidence-sep">｜</span>配合濃度：${e.concentrations.length?e.concentrations.map(x=>`${escape(x.name)} ${escape(x.value)}${escape(x.unit)}`).join('・'):'数値未登録（非公表・無配合を意味しません）'}
    ${e.verifiedAt?`<span class="debug-evidence-sep">｜</span>公式製品情報の確認日 ${escape(e.verifiedAt)}`:''}</small>
  </div>`;
}

export function renderRawScores(product,options={}){
  const keys=[...new Set([...(options.concerns||[]),...Object.keys(product.scores||{})])];
  return `<details class="debug-raw-scores"><summary>肌悩み別の登録スコアを表示</summary><div class="debug-raw-score-list">
    ${keys.map(id=>`<span class="debug-raw-score">${escape(CONCERNS[id]||id)}：${Object.hasOwn(product.scores||{},id)?`${escape(product.scores[id])}点`:'未登録（計算上0点）'}</span>`).join('')}
  </div><small>この値は検証用の仮評価で、成分の実測値・効果の大きさではありません。</small></details>`;
}

function renderScoreTable(first,second,options,firstLabel='自動選定'){
  const a=explainRoutineScore(first.products,options);
  const b=second?explainRoutineScore(second.products,options):null;
  return `<div class="debug-breakdown-table-wrap"><table class="debug-breakdown-table"><thead><tr><th>評価項目</th><th>${escape(firstLabel)}</th>${b?'<th>対象商品を入れる</th><th>差</th>':''}</tr></thead><tbody>
    ${a.parts.map((part,i)=>{
      const compared=b?.parts[i];
      return `<tr><th title="${escape(part.detail)}">${escape(part.label)}<small>${escape(part.detail)}</small></th><td>${signed(part.value)}</td>${compared?`<td>${signed(compared.value)}</td><td>${signed(compared.value-part.value)}</td>`:''}</tr>`;
    }).join('')}
    <tr class="debug-breakdown-total"><th>合計</th><td>${a.total.toFixed(2)}</td>${b?`<td>${b.total.toFixed(2)}</td><td>${signed(b.total-a.total)}</td>`:''}</tr>
  </tbody></table></div>`;
}

export function renderContext(catalog,options,best){
  const concerns=options.concerns||[];
  const header=`<div class="debug-context-top"><div><span class="eyebrow">CURRENT OPTIMIZATION</span><h2>現在の自動選定</h2></div><span class="tag">月予算 ${yen(options.budget)}</span></div>`;
  if(!concerns.length)return `${header}<p>まだ肌悩みが選択されていません。<a href="./" class="source">メイン画面</a>で肌悩みを選ぶと、ここに採点内訳と商品の採否理由が出ます。</p>`;
  const missing=unscoredConcerns(catalog,concerns);
  const condition=`<p class="micro muted">選択中：${concerns.map(x=>escape(CONCERNS[x]||x)).join('・')} / お手入れ ${escape(({simple:'手軽に',any:'こだわらない',thorough:'しっかり'})[options.priority]||'こだわらない')} / 除外 ${options.excluded.length}品 / 固定 ${Object.keys(options.locked).length}品</p>`;
  if(!best){
    const cheapest=optimize(catalog,{...options,budget:Number.MAX_SAFE_INTEGER,resultLimit:1,objective:'minimumMonthly'})[0]||null;
    if(!cheapest)return `${header}${condition}<div class="unscored-warning">予算を外しても、固定・除外・必須成分をすべて満たす組み合わせがありません。</div>`;
    return `${header}${condition}<div class="unscored-warning">現予算で成立する組み合わせはありません。ただし採点は可能です。下は予算を無視して費用を最小化した参考例で、最高得点の例ではありません。</div>
      <div class="debug-context-result"><div><span class="micro muted">予算外の最低必要月額</span><strong>${yen(cheapest.monthly)}</strong></div><div><span class="micro muted">参考評価</span><strong>${cheapest.score.toFixed(2)} 点</strong></div></div>
      <p class="micro">${escape(names(cheapest))}</p><details class="debug-score-details"><summary>参考組み合わせの採点内訳を見る</summary>${renderScoreTable(cheapest,null,options,'予算外の参考例')}</details>`;
  }
  return `${header}${condition}<div class="debug-context-result"><div><span class="micro muted">最良候補の月額</span><strong>${yen(best.monthly)}</strong></div><div><span class="micro muted">全体評価</span><strong>${best.score.toFixed(2)} 点</strong></div></div>
    <p class="micro">${escape(names(best))}</p>
    ${missing.length?`<div class="unscored-warning">未採点の悩み：${missing.map(id=>escape(CONCERNS[id]||id)).join('・')}</div>`:''}
    <details class="debug-score-details"><summary>最良候補の採点内訳を見る</summary>${renderScoreTable(best,null,options)}</details>`;
}

export function renderProductAnalysis(catalog,options,product,best){
  const d=diagnoseProduct(catalog,options,product.id,best);
  const statusLabel={selected:'採用中',not_selected:'不採用',excluded:'除外設定',locked:'他商品を固定中',budget:'予算超過',unavailable:'条件不成立',no_concern:'悩み未指定',no_base:'候補なし',missing:'商品不明'}[d.status]||d.status;
  const showCompared=Boolean(d.best&&d.forced);
  const isPreview=d.comparisonMode==='singleChange'||d.comparisonMode==='unbudgetedExample';
  const baselineLabel=d.comparisonMode==='unbudgetedExample'?'予算外・費用最小の参考例':'現在の予算内最良候補';
  return `<section class="debug-diagnosis" aria-label="${escape(product.name)}の採点検証"><div class="debug-diagnosis-head"><strong>選定理由の検証</strong><span class="tag ${d.status==='selected'?'':'orange'}">${statusLabel}</span></div>
    <p>${escape(d.reason)}</p>
    ${showCompared?`<div class="debug-diagnosis-cost"><span>${baselineLabel}：<strong>${d.best.score.toFixed(2)}点 / ${yen(d.best.monthly)}</strong></span><span>この商品を採用：<strong>${d.forced.score.toFixed(2)}点 / ${yen(d.forced.monthly)}${d.forced.monthly>options.budget?'（予算外）':''}</strong></span></div>
      <div class="micro muted">${isPreview?'他の商品を固定したまま当該品目だけ交換（該当品目がなければ追加）した参考採点です。予算を理由に得点を省略していません。':'固定した商品を含む予算内の組み合わせを再探索した結果です。'}差は商品単体の効能差ではなく、組み合わせ全体の評価差です。</div>
      <div class="micro">採用時の組み合わせ：${escape(names(d.forced))}</div>
      ${renderScoreTable(d.best,d.forced,options,baselineLabel)}`:''}
    ${d.best&&d.overbudgetPreview?`<div class="unscored-warning"><strong>予算を増やして1品だけ交換する場合の参考採点</strong><p>予算内に組み直した上の候補とは別です。他の商品は元の最良候補のまま維持し、この品目だけ交換します。</p></div>
      <div class="debug-diagnosis-cost"><span>元の組み合わせ：<strong>${d.best.score.toFixed(2)}点 / ${yen(d.best.monthly)}</strong></span><span>1品交換（現予算を超過）：<strong>${d.overbudgetPreview.score.toFixed(2)}点 / ${yen(d.overbudgetPreview.monthly)}</strong></span></div>
      <p class="micro muted">全体評価差 ${signed(d.overbudgetPreview.score-d.best.score)}点 ／ 通常予算からの超過額 ${yen(d.overbudgetPreview.monthly-options.budget)}。評価が上がる場合に限り、追加予算を認める「1品だけ入れ替える」の候補になり得ます。</p>
      ${renderScoreTable(d.best,d.overbudgetPreview,options,'元の最良候補')}`:''}
    ${d.status==='budget'&&d.minimum!=null?`<p class="micro muted">固定・除外・必須成分の条件を維持した最小月額：${yen(d.minimum)}</p>`:''}
  </section>`;
}
