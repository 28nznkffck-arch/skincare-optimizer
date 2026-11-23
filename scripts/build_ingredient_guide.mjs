import {readFile,writeFile} from 'node:fs/promises';
import {loadCatalog} from '../dist/catalog-csv.js';
import {ingredientSelection,INGREDIENT_ALIASES,ingredientChoices} from '../dist/ingredient-options.js';
import {checkedOn} from '../data/ingredient-guide.mjs';
import {dictionaryForCatalog,kanaRows,dictionaryKanaRow} from '../data/ingredient-dictionary.mjs';

const root=new URL('../',import.meta.url),check=process.argv.includes('--check');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const counts=[],allNames=new Set(),catalog=[];
for(const folder of ['../catalog/','../catalog-men/']){
  const {products}=await loadCatalog(url=>readFile(url,'utf8'),folder);catalog.push(...products);
  const names=ingredientChoices(products).slice(1);counts.push(names.length);
  for(const name of names)allNames.add(name);
}
const dictionaryEntries=dictionaryForCatalog(catalog);
const productIngredients=new Map();
for(const product of catalog)for(const name of new Set(product.ingredients.map(ingredientSelection))){
  if(!productIngredients.has(name))productIngredients.set(name,[]);
  productIngredients.get(name).push(product);
}
const index=new Map(dictionaryEntries.map(entry=>[entry.name,entry.id])),ids=new Set();
for(const entry of dictionaryEntries){
  for(const id of [entry.id,...entry.legacyIds]){
    if(ids.has(id)||!/^[a-z][a-z0-9-]*$/.test(id))throw Error(`重複・不正な解説ID: ${id}`);
    ids.add(id);
  }
  if(!entry.use||!entry.summary||!entry.refs.length)throw Error(`配合目的・出典が不足: ${entry.name}`);
}
for(const name of allNames)if(!index.has(name))throw Error(`成分表示の出典が未登録: ${name}`);
const link=(label,url)=>`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)} <span aria-hidden="true">↗</span></a>`;
const references=refs=>refs.map(source=>`<li><strong>${escape(source.label)}</strong>${source.title?`<cite lang="en">${escape(source.title)}</cite>`:''}<div class="reference-links">${source.url?link('出典を開く',source.url):''}${source.pmid?link(`PMID: ${source.pmid}`,`https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/`):''}${source.doi?link(`DOI: ${source.doi}`,`https://doi.org/${source.doi}`):''}</div></li>`).join('\n');
function renderCard(entry){
  const products=productIngredients.get(entry.name)||[];
  // 表示名の例もメーカー記録の文字列をそのまま掲載する。
  const names=[...new Set(products.flatMap(product=>product.ingredients.filter(name=>ingredientSelection(name)===entry.name)))];
  const aliases=INGREDIENT_ALIASES.filter(([name])=>entry.members.includes(name)).flatMap(([,values])=>values);
  const search=[entry.name,entry.use,...names,...entry.members,...aliases,entry.name==='ツボクサエキス'?'CICA シカ':''].join(' ');
  const exampleUrls=new Set(),examples=[];
  for(const product of products){
    if(product.sourceUrl&&!exampleUrls.has(product.sourceUrl)){
      exampleUrls.add(product.sourceUrl);examples.push({label:`配合例：${product.brand} ${product.name}`,url:product.sourceUrl});
      if(examples.length===2)break;
    }
  }
  const showNames=names.length>1||names[0]!==entry.name;
  return `<article class="panel ingredient-card" id="${entry.id}" aria-labelledby="${entry.id}-title" tabindex="-1" data-name="${escape(entry.name)}" data-search="${escape(search)}">
  ${entry.legacyIds.map(id=>`<span class="legacy-guide-anchor" id="${id}" aria-hidden="true"></span>`).join('')}
  <div class="ingredient-card-top"><span class="ingredient-purpose">主な用途：${escape(entry.use)}</span><a class="guide-top-link" href="#guide-top">目次へ ↑</a></div>
  <h3 id="${entry.id}-title">${escape(entry.title)}</h3>
  <p class="ingredient-summary">${escape(entry.summary)}</p>
  ${entry.note?`<p class="ingredient-note">${escape(entry.note)}</p>`:''}
  ${showNames?`<details class="ingredient-names"><summary>種類・表示名の例（${names.length}）</summary><p>${names.map(escape).join(' / ')}</p></details>`:''}
  <details class="ingredient-evidence"><summary>出典・研究を見る</summary>
  ${entry.research.map(source=>`<p class="evidence-kind">${escape(source.evidence.kind)}</p><p class="evidence-scope">${escape(source.evidence.scope)}</p><p class="evidence-limit">${escape(source.evidence.limit)}</p>`).join('')}
  <ol class="guide-references">${references([...entry.refs,...examples])}</ol></details>
</article>`;
}
const rows=kanaRows.map(([key,label])=>({key,label,entries:dictionaryEntries.filter(entry=>dictionaryKanaRow(entry.name)===key)})).filter(row=>row.entries.length);
const html=`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#f5f6f0">
  <meta name="description" content="スキンケア成分を名前の五十音順で紹介。主な配合目的、種類・表示名、メーカー資料と参考論文のPMID・DOIを掲載しています。">
  <title>使ってみたい成分の解説｜スキンケア最適化ラボ</title>
  <link rel="stylesheet" href="./styles.css?v=0.9.29">
  <link rel="stylesheet" href="./ingredients.css?v=0.9.29">
</head>
<body>
  <div class="shell ingredient-guide" id="guide-top">
    <header class="topbar"><div class="logo"><span class="logo-mark" aria-hidden="true">✿</span><span>SKINCARE LAB</span></div><nav class="topnav" aria-label="アプリへ"><a href="./">女性向け版</a><a href="../men/">男性向け版</a></nav></header>
    <main>
      <div class="guide-intro">
        <div class="eyebrow">INGREDIENT GUIDE</div>
        <h1>使ってみたい成分、<br>どんな違い？</h1>
        <p>成分名をあいうえお順に並べ、何のために配合されているかを紹介します。<br>同じ成分のNa塩・K塩などや、ヒアルロン酸などの仲間はひとつの見出しで説明しています。</p>
        <div class="guide-context">薬用の効能は商品ごとの有効成分と表示で確認します。論文がある成分は「出典・研究を見る」から、研究の条件や論文番号（PMID・DOI）も確認できます。</div>
        <form class="guide-filter" id="guide-filter" role="search" hidden>
          <label for="guide-search">成分名で検索</label>
          <div class="guide-search-row"><input id="guide-search" type="search" placeholder="例：ヒアルロン酸、レチノール、DPG" autocomplete="off"><button type="button" id="guide-clear">クリア</button></div>
        </form>
        <p id="guide-results" class="guide-results" role="status" aria-live="polite">${dictionaryEntries.length}項目を五十音順で掲載しています</p>
        <nav class="guide-nav" aria-label="五十音の目次">${rows.map(row=>`<a href="#kana-${row.key}">${escape(row.label)}</a>`).join('')}</nav>
      </div>
      <p class="guide-empty" id="guide-empty" hidden>一致する成分が見つかりませんでした。名前を短くするか、検索をクリアしてください。</p>
      ${rows.map(row=>`<section class="guide-section" id="kana-${row.key}" aria-labelledby="kana-${row.key}-title"><h2 id="kana-${row.key}-title">${escape(row.label)}</h2><div class="guide-cards">${row.entries.map(renderCard).join('\n')}</div></section>`).join('\n')}
    </main>
    <footer class="guide-footer">出典確認：${checkedOn.replace(/-/g,'/')}。PMIDはPubMedの論文番号、DOIは論文を特定する識別子です。ひとつの見出しにまとめた成分でも、種類・濃度・処方によって性質や用途は異なります。メーカーの用途説明と、ヒト・動物・細胞での研究結果は区別して掲載しています。</footer>
  </div>
  <script type="module" src="./ingredient-guide.js?v=0.9.29"></script>
</body>
</html>
`.replace(/[ \t]+$/gm,'');
const indexJs=`// Generated by scripts/build_ingredient_guide.mjs. Edit data/ingredient-dictionary.mjs instead.
import {ingredientSelection} from './ingredient-options.js?v=0.9.29';
export const INGREDIENT_GUIDE_GROUPS=${JSON.stringify(dictionaryEntries.map(entry=>[entry.id,[entry.name]]))};
const index=new Map(INGREDIENT_GUIDE_GROUPS.flatMap(([id,names])=>names.map(name=>[name,id])));
export function ingredientGuideId(name){return index.get(ingredientSelection(name))||null;}
`;
for(const [path,content] of [['dist/ingredients.html',html],['dist/ingredient-guide-index.js',indexJs]]){
  const url=new URL(path,root);
  if(check){if(await readFile(url,'utf8')!==content)throw Error(`${path} を再生成してください: npm run guide:build`);}
  else await writeFile(url,content);
}
console.log(`成分解説 ${dictionaryEntries.length}項目（五十音順） / 選択名 女性${counts[0]}・男性${counts[1]} / 共通を除く合計${allNames.size} / ${check?'生成物一致':'生成完了'}`);
