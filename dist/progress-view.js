const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const count=value=>/^\d+$/.test(String(value))?String(value).replace(/\B(?=(\d{3})+(?!\d))/g,','):'—';

export function renderProgress(progress={},stopped=false){
  const known=Number.isFinite(progress.percent);
  const value=known?Math.max(0,Math.min(100,progress.percent)):null;
  const percent=known?`${value.toLocaleString('ja-JP',{maximumFractionDigits:2})}%`:'集計中';
  const title=progress.title||'処理の進捗';
  const counts=progress.stage==='search'?
    `<p class="process-counts">評価 ${count(progress.evaluated)} 通り・省略 ${count(progress.skipped)} 通り ／ 全 ${count(progress.total)} 通り</p><p class="process-note">評価した分と、枝刈りなどで省略できた分を進捗に含めています。</p>`:
    progress.total!==undefined?`<p class="process-counts">${count(progress.completed)} / ${count(progress.total)} ${escape(progress.unit||'工程')}</p>`:'';
  return `<div class="process-progress${stopped?' process-stopped':''}">
    <div class="process-metrics"><span>${escape(title)} <small>この工程の進捗</small></span><strong>${percent}</strong></div>
    <progress max="100"${known?` value="${value}"`:''} aria-label="${escape(title)}の進捗">${percent}</progress>
    <p class="process-current" aria-live="polite">${stopped?'停止時の処理：':''}${escape(progress.current||'候補を整理しています')}</p>
    ${counts}
  </div>`;
}
