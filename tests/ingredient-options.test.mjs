import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {loadCatalog} from '../dist/catalog-csv.js';
import {reconcileCatalogState} from '../dist/catalog-data.js';
import {ingredientChoices,canonicalIngredient,displayIngredients,INGREDIENT_ALIASES,DIPOTASSIUM_GLYCYRRHIZATE} from '../dist/ingredient-options.js';
import {canIncludeRoutineProduct,meetsIngredientRequirement,optimize,scoreRoutine} from '../dist/optimizer.js';

test('choices include each catalog ingredient independently of guide coverage and exclude invalid fragments',()=>{
  const names=['レチノール','加水分解コラーゲン','アラントイン','濃グリセリン','グリセリン','セラミドNG','トラネキサム酸','ナイアシンアミド','ヒアルロン酸Na','ワセリン'];
  const catalog=[{keyIngredients:[...names,'1','酸化チタン ハトムギ発酵エキスは別名です',...names]},
    {archived:true,keyIngredients:['掲載終了成分']}];
  assert.deepEqual(ingredientChoices(catalog),['none','アラントイン','加水分解コラーゲン','グリセリン','セラミドNG','トラネキサム酸','ナイアシンアミド','濃グリセリン','ヒアルロン酸Na','レチノール','ワセリン']);
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
      assert.equal(reconcileCatalogState({ingredient:name},[product]).ingredient,canonical);
    }
    assert.deepEqual(ingredientChoices([{keyIngredients:[canonical,...aliases]}]),['none',canonical]);
    assert.deepEqual(displayIngredients([canonical,...aliases]),[canonical]);
  }
  assert.equal(canonicalIngredient('  ヒアルロン酸Ｎａ（２）  '),'ヒアルロン酸Na');
  assert.equal(canonicalIngredient('ツボクサ葉／茎エキス'),'ツボクサ葉/茎エキス');
  assert.equal(canonicalIngredient('ライスパワーNo.11+'),'ライスパワーNo.11+');
});

test('related compounds and raw-material grades do not match merely by containing the selected name',()=>{
  for(const [selected,other] of [
    ['レチノール','酢酸レチノール'],['ヒアルロン酸Na','アセチルヒアルロン酸Na'],
    ['ヒアルロン酸Na','ヒアルロン酸クロスポリマーNa'],['グリセリン','ジグリセリン'],
    ['グリセリン','濃グリセリン'],['セリン','メチルセリン'],['アミノ酸','アミノ酸系洗浄成分'],
    ['セラミド機能成分','セラミドNP'],['トコフェロール','酢酸トコフェロール'],
    ['アスコルビン酸','アスコルビルグルコシド'],['カモミラET','カモミラエキス(1)'],
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

test('all selectable names have a matching active product in their own catalog',async()=>{
  const lists=[];
  for(const folder of ['../catalog/','../catalog-men/']){
    const {products}=await loadCatalog(url=>readFile(url,'utf8'),folder);
    const choices=ingredientChoices(products);lists.push(choices);
    assert(choices.length>100);
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
