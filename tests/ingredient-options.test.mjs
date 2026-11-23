import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {loadCatalog} from '../dist/catalog-csv.js';
import {reconcileCatalogState} from '../dist/catalog-data.js';
import {ingredientChoices,canonicalIngredient,ingredientSelection,displayIngredients,INGREDIENT_ALIASES,INGREDIENT_FAMILIES,DIPOTASSIUM_GLYCYRRHIZATE} from '../dist/ingredient-options.js';
import {canIncludeRoutineProduct,meetsIngredientRequirement,optimize,scoreRoutine} from '../dist/optimizer.js';

test('choices include each catalog ingredient independently of guide coverage and exclude invalid fragments',()=>{
  const names=['レチノール','加水分解コラーゲン','アラントイン','濃グリセリン','グリセリン','セラミドNG','トラネキサム酸','ナイアシンアミド','ヒアルロン酸Na','ワセリン'];
  const catalog=[{keyIngredients:[...names,'1','酸化チタン ハトムギ発酵エキスは別名です',...names]},
    {archived:true,keyIngredients:['掲載終了成分']}];
  assert.deepEqual(ingredientChoices(catalog),['none','アラントイン','グリセリン','コラーゲン','セラミド','トラネキサム酸','ナイアシンアミド','ヒアルロン酸','レチノール','ワセリン']);
  const options=ingredientChoices([{keyIngredients:['3-O-エチルアスコルビン酸','BG','α-オレフィンオリゴマー']}]);
  assert.equal(options.length,4);
});

test('verified aliases deduplicate choices, match both directions and migrate saved selections',()=>{
  for(const [canonical,aliases] of INGREDIENT_ALIASES){
    for(const name of [canonical,...aliases]){
      assert.equal(canonicalIngredient(name),canonical);
      const product={jan:'alias-product',category:'serum',keyIngredients:[name],scores:{}};
      const options={ingredient:canonical,ingredientMode:'required',concerns:['dryness']};
      assert(meetsIngredientRequirement([product],options),name);
      assert(canIncludeRoutineProduct(product,options),name);
      assert.equal(scoreRoutine([product],options)-scoreRoutine([product],{...options,ingredient:'none'}),10);
      assert(meetsIngredientRequirement([{...product,keyIngredients:[canonical]}],{...options,ingredient:name}),name);
      assert.equal(reconcileCatalogState({ingredient:name},[product]).ingredient,ingredientSelection(canonical));
    }
    assert.deepEqual(ingredientChoices([{keyIngredients:[canonical,...aliases]}]),['none',ingredientSelection(canonical)]);
    assert.deepEqual(displayIngredients([canonical,...aliases]),[canonical]);
  }
  assert.equal(canonicalIngredient('  ヒアルロン酸Ｎａ（２）  '),'ヒアルロン酸Na');
  assert.equal(canonicalIngredient('ツボクサ葉／茎エキス'),'ツボクサ葉/茎エキス');
  assert.equal(canonicalIngredient('ライスパワーNo.11+'),'ライスパワーNo.11+');
});

test('different selection families do not match merely by containing part of the selected name',()=>{
  for(const [selected,other] of [
    ['レチノール','酢酸レチノール'],['グリセリン','ジグリセリン'],
    ['セリン','メチルセリン'],['アミノ酸','アミノ酸系洗浄成分'],
    ['ヒアルロン酸','水溶性コラーゲン'],['ビタミンC','酢酸トコフェロール'],
    ['カモミラET','カモミラエキス(1)'],['ユーカリエキス','ユーカリ葉油'],
    ['ライスパワーNo.11(米エキスNo.11)','ライスパワーNo.11+'],
  ]){
    assert.notEqual(canonicalIngredient(selected),canonicalIngredient(other));
    const product={jan:'other-product',category:'serum',keyIngredients:[other],scores:{}};
    const options={ingredient:selected,ingredientMode:'required',concerns:['dryness']};
    assert(!meetsIngredientRequirement([product],options),`${selected} / ${other}`);
    assert(!canIncludeRoutineProduct(product,options),`${selected} / ${other}`);
    assert.equal(scoreRoutine([product],options),scoreRoutine([product],{...options,ingredient:'none'}));
  }
});

test('ingredient families group selection and matching while keeping all manufacturer names intact',()=>{
  for(const [family,members] of INGREDIENT_FAMILIES){
    const products=members.map((name,i)=>({jan:`family-${i}`,category:'serum',keyIngredients:[name],scores:{}}));
    const original=structuredClone(products),settings={ingredient:family,ingredientMode:'required',concerns:['dryness']};
    assert.deepEqual(ingredientChoices(products),['none',family]);
    for(const product of products){
      assert(meetsIngredientRequirement([product],settings),product.keyIngredients[0]);
      assert(canIncludeRoutineProduct(product,settings));
      assert.equal(scoreRoutine([product],settings)-scoreRoutine([product],{...settings,ingredient:'none'}),10);
      assert.equal(reconcileCatalogState({ingredient:product.keyIngredients[0]},[product]).ingredient,family);
    }
    assert.deepEqual(products,original,'selection grouping must not rewrite source names');
  }
  const sodium={jan:'ha-na',category:'serum',keyIngredients:['ヒアルロン酸Na-2'],scores:{}};
  const hydrolyzed={...sodium,jan:'hydrolyzed',keyIngredients:['加水分解ヒアルロン酸']};
  assert(meetsIngredientRequirement([hydrolyzed],{ingredient:'ヒアルロン酸Na',ingredientMode:'required'}),'old saved choices migrate to the broad family');
  assert.deepEqual(ingredientChoices([sodium,hydrolyzed]),['none','ヒアルロン酸']);
  assert.notEqual(canonicalIngredient('ヒアルロン酸Na'),canonicalIngredient('加水分解ヒアルロン酸'),'chemical identity is distinct from a selection family');
});

test('grouped ingredient preferences and requirements preserve the exact best combination',()=>{
  const item=(category,jan,cost,points,name)=>({category,jan,brand:'検証',name:jan,referencePrice:cost,referenceUses:30,dailyUses:1,keyIngredients:[name],scores:{dryness:points}});
  const catalog=[
    item('cleanser','wash-1',80,1,'ヒアルロン酸Na-2'),item('cleanser','wash-2',120,2,'水溶性コラーゲン'),
    item('moisturizer','cream-1',180,2,'セラミド機能成分'),item('moisturizer','cream-2',250,3,'セラミドNP'),
    item('toner','toner-1',120,1,'加水分解ヒアルロン酸'),item('toner','toner-2',200,2,'ビタミンCリン酸Mg'),
    item('serum','serum-1',230,3,'アセチル化ヒアルロン酸ナトリウム'),item('serum','serum-2',300,3,'アスコルビルグルコシド'),
  ];
  for(const ingredient of ['ヒアルロン酸','ビタミンC','セラミド','コラーゲン'])for(const ingredientMode of ['prefer','required'])for(const budget of [300,500,1000]){
    const options={ingredient,ingredientMode,budget,concerns:['dryness'],priority:'any'};
    assert.deepEqual(optimize(catalog,{...options,resultLimit:1}),optimize(catalog,options).slice(0,1));
  }
});

test('all selectable names have a matching active product in their own catalog',async()=>{
  const lists=[];
  for(const folder of ['../catalog/','../catalog-men/']){
    const {products}=await loadCatalog(url=>readFile(url,'utf8'),folder);
    const choices=ingredientChoices(products);lists.push(choices);
    assert(choices.length>70);
    for(const name of choices.slice(1))assert(products.some(p=>meetsIngredientRequirement([p],{ingredient:name,ingredientMode:'required'})),name);
    assert.equal(choices.filter(name=>name===DIPOTASSIUM_GLYCYRRHIZATE).length,1);
    assert(!choices.includes('グリチルリチン酸2K'));assert(!choices.includes('1'));
  }
  assert(lists[0].includes('レチノール'));assert(!lists[1].includes('レチノール'));
  assert(lists[1].includes('グリシルグリシン'));assert(!lists[0].includes('グリシルグリシン'));
});

test('identical glycyrrhizate names match preferences and requirements without merging other compounds',()=>{
  const item=(jan,category,keyIngredients)=>({jan,category,keyIngredients,brand:'検証',name:jan,referencePrice:100,referenceUses:30,dailyUses:1,scores:{dryness:1}});
  const wash=item('wash','cleanser',[]),cream=item('cream','moisturizer',[]);
  for(const spelling of ['グリチルリチン酸2K','グリチルリチン酸二カリウム',DIPOTASSIUM_GLYCYRRHIZATE]){
    const serum=item('serum','serum',[spelling]);serum.scores={};
    const settings={budget:5000,concerns:['dryness'],ingredient:DIPOTASSIUM_GLYCYRRHIZATE,ingredientMode:'required',priority:'any'};
    assert.equal(canonicalIngredient(spelling),DIPOTASSIUM_GLYCYRRHIZATE);
    assert(canIncludeRoutineProduct(serum,settings));assert(meetsIngredientRequirement([serum],settings));
    assert.equal(scoreRoutine([serum],settings)-scoreRoutine([serum],{...settings,ingredient:'none'}),10);
    assert(optimize([wash,cream,serum],{...settings,resultLimit:1})[0].products.some(p=>p.jan==='serum'));
    assert.equal(reconcileCatalogState({ingredient:spelling},[serum]).ingredient,DIPOTASSIUM_GLYCYRRHIZATE);
  }
  assert(!meetsIngredientRequirement([item('other','serum',['グリチルレチン酸ステアリル'])],{ingredient:DIPOTASSIUM_GLYCYRRHIZATE,ingredientMode:'required'}));
  assert.equal(reconcileCatalogState({ingredient:'掲載終了成分'},[cream]).ingredient,'none');
});
