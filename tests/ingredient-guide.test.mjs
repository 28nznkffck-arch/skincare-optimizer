import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {guides} from '../data/ingredient-guide.mjs';
import {INGREDIENT_GUIDE_GROUPS,ingredientGuideId} from '../dist/ingredient-guide-index.js';
import {INGREDIENT_ALIASES,ingredientChoices} from '../dist/ingredient-options.js';
import {loadCatalog} from '../dist/catalog-csv.js';

test('all selectable ingredients and their aliases lead to an existing, sourced guide card',async()=>{
  const html=await readFile(new URL('../dist/ingredients.html',import.meta.url),'utf8');
  const ids=[...html.matchAll(/<article class="panel ingredient-card" id="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,guides.length);
  assert.equal(ids.length,INGREDIENT_GUIDE_GROUPS.length);
  for(const folder of ['../catalog/','../catalog-men/']){
    const {products}=await loadCatalog(url=>readFile(url,'utf8'),folder);
    for(const name of ingredientChoices(products).slice(1))assert(ids.includes(ingredientGuideId(name)),name);
  }
  for(const [name,aliases] of INGREDIENT_ALIASES){
    for(const alias of aliases)assert.equal(ingredientGuideId(alias),ingredientGuideId(name));
  }
  assert.equal(ingredientGuideId('none'),null);assert.equal(ingredientGuideId('未登録の成分'),null);
  for(const guide of guides){
    assert(guide.summary&&guide.choice&&guide.refs.length,guide.id);
    for(const source of guide.refs){
      if(source.url)assert.equal(new URL(source.url).protocol,'https:');
      if(source.pmid){
        assert.match(source.pmid,/^\d+$/);assert(source.title&&guide.evidence?.kind);
        assert(html.includes(`https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/`));
      }
      if(source.doi)assert(html.includes(`https://doi.org/${source.doi}`));
    }
  }
  for(const id of ['allantoin','glycyrrhizate','ceramide','niacinamide','hyaluronate'])assert(ids.includes(id),'preserve existing deep links');
});

test('guide search handles kana, full-width aliases, empty results, categories and navigation',async()=>{
  const oldDocument=globalThis.document,oldWindow=globalThis.window;
  const element=(extra={})=>({hidden:false,value:'',events:{},addEventListener(name,fn){this.events[name]=fn;},focus(){this.focused=true;},scrollIntoView(){this.scrolled=true;},...extra});
  const a=element({dataset:{search:'ヒアルロン酸Na ヒアルロン酸ナトリウム(2)'}});
  const b=element({dataset:{search:'レチノール 酢酸レチノール'}});
  const section=(name,cards)=>element({dataset:{section:name},querySelectorAll(){return cards;}});
  const first=section('保湿・バリア',[a]),second=section('シワ・シミ予防',[b]);
  const elements=Object.fromEntries(['guide-filter','guide-search','guide-category','guide-results','guide-empty','guide-clear'].map(id=>[id,element()]));
  elements.retinol=b;
  const windowEvents={};
  globalThis.document={getElementById(id){return elements[id]||null;},querySelectorAll(selector){return selector==='.ingredient-card'?[a,b]:[first,second];}};
  globalThis.window={location:{hash:''},addEventListener(name,fn){windowEvents[name]=fn;}};
  try{
    const {normalizeGuideSearch}=await import('../dist/ingredient-guide.js?test=filter');
    assert.equal(normalizeGuideSearch(' ＤＰＧ '),'dpg');
    assert.equal(normalizeGuideSearch('ひあるろん酸'),normalizeGuideSearch('ヒアルロン酸'));
    elements['guide-search'].value='ヒアルロン酸ナトリウム（２）';elements['guide-search'].events.input();
    assert(!a.hidden&&b.hidden&&!first.hidden&&second.hidden);
    elements['guide-category'].value='シワ・シミ予防';elements['guide-category'].events.change();
    assert(a.hidden&&b.hidden&&!elements['guide-empty'].hidden);
    assert.equal(elements['guide-results'].textContent,'0 / 2項目を表示しています');
    elements['guide-clear'].events.click();assert(!a.hidden&&!b.hidden&&elements['guide-empty'].hidden);
    elements['guide-search'].value='一致しない';elements['guide-search'].events.input();
    window.location.hash='#retinol';windowEvents.hashchange();
    assert(!b.hidden&&b.scrolled);assert.equal(elements['guide-search'].value,'');
  }finally{
    if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;
    if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;
  }
});
