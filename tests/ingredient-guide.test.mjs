import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {guides} from '../data/ingredient-guide.mjs';
import {dictionaryEntries,dictionaryForCatalog,dictionaryKanaRow} from '../data/ingredient-dictionary.mjs';
import {INGREDIENT_GUIDE_GROUPS,ingredientGuideId} from '../dist/ingredient-guide-index.js';
import {INGREDIENT_ALIASES,ingredientChoices,compareIngredients} from '../dist/ingredient-options.js';
import {loadCatalog} from '../dist/catalog-csv.js';

test('all selectable ingredients and their aliases lead to an existing, sourced guide card',async()=>{
  const catalog=[];
  for(const folder of ['../catalog/','../catalog-men/'])catalog.push(...(await loadCatalog(url=>readFile(url,'utf8'),folder)).products);
  const dictionaryEntries=dictionaryForCatalog(catalog);
  const html=await readFile(new URL('../dist/ingredients.html',import.meta.url),'utf8');
  const ids=[...html.matchAll(/<article class="panel ingredient-card" id="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,dictionaryEntries.length);
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
  const names=[...html.matchAll(/<article[^>]*data-name="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(names,[...names].sort(compareIngredients),'the page must follow ingredient names, not roles or concerns');
  assert.doesNotMatch(html,/guide-category|役割で絞り込む|役割別の目次/);
  assert.match(html,/aria-label="五十音の目次"/);
  for(const entry of dictionaryEntries){assert(entry.use&&entry.summary);assert.match(html,new RegExp(`主な用途：`));}
  assert.equal(dictionaryKanaRow('ヒアルロン酸'),'ha');assert.equal(dictionaryKanaRow('グリセリン'),'ka');
});

test('new complete-label ingredients stay selectable even before their purpose is explained',()=>{
  const entries=dictionaryForCatalog([{ingredients:['未解説成分XYZ'],sourceUrl:'https://example.com/product/'}]);
  const entry=entries.find(item=>item.name==='未解説成分XYZ');
  assert(entry);assert.equal(entry.use,'用途の確認中');
  assert.deepEqual(entry.refs,[{label:'配合成分の表示を確認する',url:'https://example.com/product/'}]);
});

test('merged salts retain previous guide bookmarks, source labels and differences in formulation',async()=>{
  const html=await readFile(new URL('../dist/ingredients.html',import.meta.url),'utf8');
  const bookmarks=[
    ['ココイルグリシンNa','ingredient-f13f899fcf49','ココイルグリシン'],
    ['ココイルグルタミン酸2Na','ingredient-604fdba1a815','ココイルグルタミン酸'],
    ['ラウロイルグルタミン酸K','ingredient-ee5ee4087a2e','ラウロイルグルタミン酸'],
    ['ミリスチン酸Na','ingredient-a632aa109c09','ミリスチン酸'],
    ['含水シリカ','ingredient-ae32e928bc7d','シリカ'],
    ['結晶セルロース','ingredient-a0907addc672','セルロース'],
    ['マカデミアナッツ油','ingredient-bad250c2afdf','マカデミア種子油'],
  ];
  for(const [name,oldId,family] of bookmarks){
    const entry=dictionaryEntries.find(entry=>entry.name===family);
    assert(entry.legacyIds.includes(oldId),name);
    assert.equal(ingredientGuideId(name),entry.id,name);
    const card=html.slice(html.indexOf(`<article class="panel ingredient-card" id="${entry.id}"`)).split('</article>')[0];
    assert(card.includes(`id="${oldId}"`),name);
    assert(card.includes(name),'retain manufacturer names for search and reading');
    assert(entry.note,'explain the differences within the merged group');
  }
  assert(dictionaryEntries.find(entry=>entry.name==='ココイルグルタミン酸').refs.some(ref=>ref.url==='https://www.ahs.ajinomoto.com/products/cosme/cosme_list.html'));
});

test('ingredient dictionary search handles kana, source names, empty results and alphabetical navigation',async()=>{
  const oldDocument=globalThis.document,oldWindow=globalThis.window;
  const element=(extra={})=>({hidden:false,value:'',events:{},addEventListener(name,fn){this.events[name]=fn;},focus(){this.focused=true;},scrollIntoView(){this.scrolled=true;},...extra});
  const a=element({dataset:{search:'ヒアルロン酸Na ヒアルロン酸ナトリウム(2)'}});
  const b=element({dataset:{search:'レチノール 酢酸レチノール'}});
  const section=(name,cards)=>element({dataset:{section:name},querySelectorAll(){return cards;}});
  const first=section('は行',[a]),second=section('ら行',[b]);
  const elements=Object.fromEntries(['guide-filter','guide-search','guide-results','guide-empty','guide-clear'].map(id=>[id,element()]));
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
    elements['guide-search'].value='見つからない成分';elements['guide-search'].events.input();
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

test('old standalone guide links point to grouped cards',async()=>{const html=await readFile(new URL('../dist/ingredients.html',import.meta.url),'utf8');for(const name of ['EDTA-2Na','PEG-4','ステアリン酸Na','シャクヤク根エキス'])assert(html.includes('id="'+ingredientGuideId(name)+'"'));});

test('new glyceryl and glycerin groups have distinct guide links',()=>{for(const [oldName,newName] of [['グリセリンモノ2-エチルヘキシルエーテル','エチルヘキシルグリセリン'],['POE(26)グリセリン','グリセレス-26'],['トリメチルグリシン','ベタイン'],['エデト酸二ナトリウム','EDTA']])assert.equal(ingredientGuideId(oldName),ingredientGuideId(newName));assert.notEqual(ingredientGuideId('グリセリン'),ingredientGuideId('ステアリン酸グリセリル'));});
