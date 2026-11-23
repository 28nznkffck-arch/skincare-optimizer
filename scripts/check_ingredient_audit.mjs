import {readFile} from 'node:fs/promises';
import {loadCatalog} from '../dist/catalog-csv.js';
import {checkIngredientAudit} from './ingredient-audit.mjs';
for(const [label,folder] of [['女性版','catalog'],['男性版','catalog-men']]){
  const {products,archivedProducts}=await loadCatalog(url=>readFile(url,'utf8'),`../${folder}/`);
  const records=JSON.parse(await readFile(new URL(`../${folder}/ingredient-sources.json`,import.meta.url),'utf8'));
  const {counts,errors}=checkIngredientAudit([...products,...archivedProducts],records);
  console.log(`${label}の成分原本: 全成分確認${counts.full}品・一部確認${counts.partial}品・未確認${counts.unverified}品`);
  if(errors.length){console.error(errors.slice(0,20).join('\n'));console.error(`不一致 ${errors.length}件`);process.exitCode=1;}
}
