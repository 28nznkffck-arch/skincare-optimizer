const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

const leaf='<svg class="process-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 34C5 23 14 13 25 12c6-.5 10-3 12-6 7 14 6 29-6 33-8 3-15 0-19-5Z"/><path d="M8 43c0-11 7-17 20-23"/></svg>';

export function renderProgress(progress={},stopped=false){
  const known=Number.isFinite(progress.percent);
  const value=known?Math.max(0,Math.min(100,progress.percent)):null;
  const percent=known?`${value.toLocaleString('ja-JP',{maximumFractionDigits:2})}%`:'準備中';
  const title=progress.title||'処理の進捗';
  const current=stopped?progress.current:progress.stage==='loading'?'商品データを読み込んでいます…':
    progress.current?.replace(/の候補を評価・整理中$/,'の候補を評価しています…').replace(/の候補を確認$/,'の候補を確認しています…');
  return `<div class="process-progress${stopped?' process-stopped':''}">
    ${stopped?'<p class="process-phase">停止時の進捗</p>':`${leaf}<h2 class="process-heading">あなたに合うスキンケアを検索中</h2>`}
    <div class="process-meter">
      <progress max="100"${known?` value="${value}"`:''} aria-label="${escape(title)}の進捗">${percent}</progress>
      <strong class="process-percent">${percent}</strong>
    </div>
    <p class="process-current" aria-live="polite">${stopped?'停止時の処理：':''}${escape(current||'候補を整理しています…')}</p>
    ${progress.detail?`<p class="process-detail">${escape(progress.detail)}</p>`:''}
    ${progress.note?`<p class="process-note">${escape(progress.note)}</p>`:''}
  </div>`;
}
