import {CATEGORY_LABELS, monthlyCost} from './optimizer.js';

const STORE_KEY='skincare-lab-v1';
const PAGE_SIZE=25;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=n=>Number.isFinite(n)?Math.round(n).toLocaleString('ja-JP')+'円':'—';
let catalog=[];
let page=0;
const search=document.getElementById('debugSearch');
const category=document.getElementById('debugCategory');
const items=document.getElementById('debugItems');
const count=document.getElementById('debugCount');
const pagination=document.getElementById('debugPagination');

function getState(){
  try {return JSON.parse(localStorage.getItem(STORE_KEY)||'{}')||{};}
  catch{return {};}
}
function updateState(next){localStorage.setItem(STORE_KEY,JSON.stringify(next));}

function renderRows(){
  const q=search.value.trim().toLocaleLowerCase('ja-JP');
  const selected=category.value;
  const matching=catalog.filter(p=>(selected==='all'||p.category===selected) &&
    (!q||[p.brand,p.name,p.jan,...(p.keyIngredients||[])].join(' ').toLocaleLowerCase('ja-JP').includes(q)));
  const pages=Math.max(1,Math.ceil(matching.length/PAGE_SIZE));
  page=Math.min(page,pages-1);
  const visible=matching.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
  const state=getState();
  count.textContent=`${catalog.length}商品中 ${matching.length}件 / ${pages}ページ`;
  items.innerHTML=visible.map(p=>{
    const v=state.overrides?.[p.id]||{};
    const price=v.price??p.demoPrice,uses=v.uses??p.demoUses,frequency=v.frequency??p.dailyUses;
    return `<article class="debug-item"><div class="debug-item-head"><div><small>${escape(p.brand)}・${escape(CATEGORY_LABELS[p.category])} / JAN ${escape(p.jan)}</small><h2>${escape(p.name)}</h2><p>${escape(p.keyIngredients.join('・'))}</p></div><a href="${escape(p.sourceUrl)}" class="source" target="_blank" rel="noopener noreferrer">メーカー公式 ↗</a></div>
      <div class="debug-edit-fields"><label>購入価格（円）<input type="number" min="0" step="10" data-edit="price" data-id="${escape(p.id)}" value="${price}"></label><label>1本の使用回数<input type="number" min="1" step="1" data-edit="uses" data-id="${escape(p.id)}" value="${uses}"></label><label>1日使用回数<input type="number" min="0" step="0.5" data-edit="frequency" data-id="${escape(p.id)}" value="${frequency}"></label><div class="debug-month">${yen(monthlyCost(p,v))}<small> / 月</small></div></div>
      <button type="button" class="link-button" data-reset="${escape(p.id)}" ${state.overrides?.[p.id]?'':'disabled'}>この商品の補正を解除</button>
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
  if(!Number.isFinite(n)||n<(edit==='uses'?1:0)){renderRows();return;}
  const state=getState();state.overrides??={};state.overrides[id]??={};state.overrides[id][edit]=n;
  updateState(state);renderRows();
});
items.addEventListener('click',e=>{
  const btn=e.target.closest('[data-reset]');if(!btn)return;
  const state=getState();if(state.overrides)delete state.overrides[btn.dataset.reset];
  updateState(state);renderRows();
});
window.addEventListener('storage',e=>{if(e.key===STORE_KEY)renderRows();});
fetch('./data/products.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('商品DBを読み込めません');return r.json();}).then(db=>{
  catalog=db.products;renderRows();
}).catch(e=>{count.textContent=e.message;});
