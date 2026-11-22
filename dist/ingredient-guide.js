// ページ本文は静的HTML。検索にJavaScriptを使えなくても解説・出典は読める。
export function normalizeGuideSearch(value){
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g,'')
    .replace(/[ァ-ヶ]/g,char=>String.fromCharCode(char.charCodeAt(0)-0x60));
}

const form=document.getElementById('guide-filter');
const search=document.getElementById('guide-search');
const category=document.getElementById('guide-category');
const status=document.getElementById('guide-results');
const empty=document.getElementById('guide-empty');
const cards=[...document.querySelectorAll('.ingredient-card')];
const sections=[...document.querySelectorAll('.guide-section')];
const texts=new Map(cards.map(card=>[card,normalizeGuideSearch(card.dataset.search)]));
function filter(){
  const query=normalizeGuideSearch(search.value);
  let total=0;
  for(const section of sections){
    let count=0;
    for(const card of section.querySelectorAll('.ingredient-card')){
      const match=(!category.value||section.dataset.section===category.value)&&texts.get(card).includes(query);
      card.hidden=!match;
      if(match)count++;
    }
    section.hidden=count===0;
    total+=count;
  }
  empty.hidden=total!==0;
  status.textContent=`${total} / ${cards.length}項目を表示しています`;
}
form.hidden=false;
form.addEventListener('submit',event=>event.preventDefault());
search.addEventListener('input',filter);
category.addEventListener('change',filter);
document.getElementById('guide-clear').addEventListener('click',()=>{
  search.value='';category.value='';filter();search.focus();
});
// 絞り込みで非表示になった項目にも、目次・戻る操作から到達できるようにする。
window.addEventListener('hashchange',()=>{
  const id=window.location.hash.slice(1);
  const target=document.getElementById(id);
  if(!target)return;
  search.value='';category.value='';filter();target.scrollIntoView();
});
