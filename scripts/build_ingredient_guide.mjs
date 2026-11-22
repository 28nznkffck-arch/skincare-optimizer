import {readFile,writeFile} from 'node:fs/promises';
import {loadCatalog} from '../dist/catalog-csv.js';
import {canonicalIngredient,displayIngredients,INGREDIENT_ALIASES,ingredientChoices} from '../dist/ingredient-options.js';
import {checkedOn,guides} from '../data/ingredient-guide.mjs';

const root=new URL('../',import.meta.url);
const check=process.argv.includes('--check');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sections=[...new Set(guides.map(guide=>guide.section))];
const index=new Map();
const ids=new Set();
for(const guide of guides){
  if(ids.has(guide.id)||!/^[a-z][a-z0-9-]*$/.test(guide.id))throw Error(`重複・不正な解説ID: ${guide.id}`);
  ids.add(guide.id);
  for(const name of displayIngredients(guide.names)){
    if(index.has(name))throw Error(`成分の解説が重複: ${name}`);
    index.set(name,guide.id);
  }
  if(!guide.summary||!guide.choice||!guide.refs.length)throw Error(`解説・出典が不足: ${guide.id}`);
}
const counts=[];
const allNames=new Set();
for(const folder of ['../catalog/','../catalog-men/']){
  const {products}=await loadCatalog(url=>readFile(url,'utf8'),folder);
  const names=ingredientChoices(products).slice(1);counts.push(names.length);
  for(const name of names){
    if(!index.has(name))throw Error(`解説が未登録: ${name}`);
    allNames.add(name);
  }
}
const link=(label,url)=>`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)} <span aria-hidden="true">↗</span></a>`;
const references=refs=>refs.map(source=>`<li><strong>${escape(source.label)}</strong>${source.title?`<cite lang="en">${escape(source.title)}</cite>`:''}<div class="reference-links">${source.url?link('出典を開く',source.url):''}${source.pmid?link(`PMID: ${source.pmid}`,`https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/`):''}${source.doi?link(`DOI: ${source.doi}`,`https://doi.org/${source.doi}`):''}</div></li>`).join('\n');
function renderCard(guide){
  const names=displayIngredients(guide.names);
  const aliases=INGREDIENT_ALIASES.filter(([name])=>names.includes(name)).flatMap(([,values])=>values);
  const search=[guide.title,guide.section,guide.purpose,...names,...aliases].join(' ');
  return `<article class="panel ingredient-card" id="${guide.id}" aria-labelledby="${guide.id}-title" tabindex="-1" data-search="${escape(search)}">
  <div class="ingredient-card-top"><span class="ingredient-purpose">${escape(guide.purpose)}</span><a class="guide-top-link" href="#guide-top">目次へ ↑</a></div>
  <h3 id="${guide.id}-title">${escape(guide.title)}</h3>
  <p class="ingredient-summary">${escape(guide.summary)}</p>
  <p class="ingredient-choice"><strong>選ぶ目安</strong>${escape(guide.choice)}</p>
  <details class="ingredient-names"><summary>この解説で扱う登録名（${names.length}）</summary><p>${names.map(escape).join(' / ')}</p>${aliases.length?`<p class="ingredient-aliases">同じ成分として照合する別表記：${aliases.map(escape).join(' / ')}</p>`:''}</details>
  <details class="ingredient-evidence"><summary>研究と出典を見る <span class="evidence-kind">${escape(guide.evidence?.kind||'メーカーの用途・原料資料')}</span></summary>
  ${guide.evidence?`<p class="evidence-scope">${escape(guide.evidence.scope)}</p><p class="evidence-limit">${escape(guide.evidence.limit)}</p>`:'<p class="evidence-scope">配合目的や成分名を確認するための資料です。完成品の効果を比較した臨床試験とは区別しています。</p>'}
  <ol class="guide-references">${references(guide.refs)}</ol></details>
</article>`;
}
const sectionId=index=>`guide-section-${index+1}`;
const html=`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#f5f6f0">
  <meta name="description" content="スキンケア成分の簡単解説。${guides.length}項目で主な役割と選ぶ目安、研究の対象・限界、論文のPMID・DOI、メーカーの一次資料を紹介します。">
  <title>使ってみたい成分の解説｜スキンケア最適化ラボ</title>
  <link rel="stylesheet" href="./styles.css?v=0.9.22">
  <link rel="stylesheet" href="./ingredients.css?v=0.9.22">
</head>
<body>
  <div class="shell ingredient-guide" id="guide-top">
    <header class="topbar"><div class="logo"><span class="logo-mark" aria-hidden="true">✿</span><span>SKINCARE LAB</span></div><nav class="topnav" aria-label="アプリへ"><a href="./">女性向け版</a><a href="../men/">男性向け版</a></nav></header>
    <main>
      <div class="guide-intro">
        <div class="eyebrow">INGREDIENT GUIDE</div>
        <h1>使ってみたい成分、<br>どんな違い？</h1>
        <p>${guides.length}項目で、成分の役割と選ぶ目安を紹介します。<br>女性・男性それぞれのアプリで選べる成分をすべて掲載。関連する成分は同じ項目で説明し、違いも添えています。</p>
        <div class="guide-context">薬用の効能は商品ごとの有効成分と表示で確認します。論文がある項目は、研究の対象・条件・限界とPMID／DOIを掲載。メーカーの用途説明は、臨床試験の結果と分けて読めます。</div>
        <form class="guide-filter" id="guide-filter" role="search" hidden>
          <label for="guide-search">成分名で検索</label>
          <div class="guide-search-row"><input id="guide-search" type="search" placeholder="例：レチノール、ヒアルロン酸、DPG" autocomplete="off"><button type="button" id="guide-clear">クリア</button></div>
          <label for="guide-category">役割で絞り込む</label><select id="guide-category"><option value="">すべての役割</option>${sections.map(section=>`<option value="${escape(section)}">${escape(section)}</option>`).join('')}</select>
        </form>
        <p id="guide-results" class="guide-results" role="status" aria-live="polite">${guides.length}項目を掲載しています</p>
        <nav class="guide-nav" aria-label="役割別の目次">${sections.map((section,i)=>`<a href="#${sectionId(i)}">${escape(section)}</a>`).join('')}</nav>
      </div>
      <p class="guide-empty" id="guide-empty" hidden>一致する成分が見つかりませんでした。名前を短くするか、絞り込みを解除してください。</p>
      ${sections.map((section,i)=>`<section class="guide-section" id="${sectionId(i)}" data-section="${escape(section)}" aria-labelledby="${sectionId(i)}-title"><h2 id="${sectionId(i)}-title">${escape(section)}</h2><div class="guide-cards">${guides.filter(guide=>guide.section===section).map(renderCard).join('\n')}</div></section>`).join('\n')}
    </main>
    <footer class="guide-footer">出典確認：${checkedOn.replace(/-/g,'/')}。PMIDはPubMedの論文番号、DOIは論文を特定する識別子です。論文は主に英語です。表記の統一は成分名の照合のためで、原料規格・分子量・配合濃度・製品の効能が同一であることを意味しません。</footer>
  </div>
  <script type="module" src="./ingredient-guide.js?v=0.9.22"></script>
</body>
</html>
`;
const indexJs=`// Generated by scripts/build_ingredient_guide.mjs. Edit data/ingredient-guide.mjs instead.
import {canonicalIngredient} from './ingredient-options.js?v=0.9.22';
export const INGREDIENT_GUIDE_GROUPS=${JSON.stringify(guides.map(guide=>[guide.id,displayIngredients(guide.names)]))};
const index=new Map(INGREDIENT_GUIDE_GROUPS.flatMap(([id,names])=>names.map(name=>[name,id])));
export function ingredientGuideId(name){return index.get(canonicalIngredient(name))||null;}
`;
for(const [path,content] of [['dist/ingredients.html',html],['dist/ingredient-guide-index.js',indexJs]]){
  const url=new URL(path,root);
  if(check){if(await readFile(url,'utf8')!==content)throw Error(`${path} を再生成してください: npm run guide:build`);}
  else await writeFile(url,content);
}
console.log(`成分解説 ${guides.length}項目 / 選択名 女性${counts[0]}・男性${counts[1]} / 共通を除く合計${allNames.size}成分 / ${check?'生成物一致':'生成完了'}`);
