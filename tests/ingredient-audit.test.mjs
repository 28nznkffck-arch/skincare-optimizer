import assert from 'node:assert/strict';
import test from 'node:test';
import {checkIngredientAudit} from '../scripts/ingredient-audit.mjs';
const product={jan:'4900000000001',sourceUrl:'https://example.com/product/',ingredients:['水','未解説の配合成分XYZ','アロエエキス(2)'],ingredientStatus:'full',ingredientLabel:'水、未解説の配合成分XYZ、アロエエキス(2)',ingredientSourceUrl:'https://example.com/label/',ingredientVerifiedAt:'2026-11-23'};
const record={jan:product.jan,productUrl:product.sourceUrl,checkedAt:product.ingredientVerifiedAt,status:'full',sourceUrl:product.ingredientSourceUrl,sourceSha256:'a'.repeat(64),rawText:product.ingredientLabel,ingredients:product.ingredients};
test('complete labels retain ingredients absent from the selection definitions and explanation catalogue',()=>{
  assert.deepEqual(checkIngredientAudit([product],[record]).errors,[]);
  const result=checkIngredientAudit([{...product,ingredients:['水','アロエエキス(2)']}],[record]);
  assert.match(result.errors.join('\n'),/全項目・順序が原本と一致しません/);
});
test('ingredient order and regulatory numbers must agree with the complete source',()=>{
  for(const ingredients of [[...product.ingredients].reverse(),['水','未解説の配合成分XYZ','アロエエキス']])assert(checkIngredientAudit([{...product,ingredients}],[record]).errors.length);
});
test('unverified labels cannot be silently treated as complete',()=>{
  const p={...product,ingredients:[],ingredientStatus:'unverified'};
  const r={...record,ingredients:[],status:'unverified',reason:'原本の確認中'};
  assert.deepEqual(checkIngredientAudit([p],[r]),{counts:{full:0,partial:0,unverified:1},errors:[]});
  assert(checkIngredientAudit([{...p,ingredientStatus:'full'}],[r]).errors.length);
});
test('new products, source changes and loss of original label text are detected',()=>{
  assert.match(checkIngredientAudit([product],[]).errors.join('\n'),/原本がありません/);
  assert(checkIngredientAudit([{...product,sourceUrl:'https://example.com/new/'}],[record]).errors.length);
  assert(checkIngredientAudit([{...product,ingredientLabel:''}],[record]).errors.length);
});
