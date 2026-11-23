// Compare the complete registered label against its source record. No selection
// vocabulary or explanation catalogue participates in this check.
export function checkIngredientAudit(products,records){
  const byJan=new Map(),errors=[],counts={full:0,partial:0,unverified:0};
  for(const record of records){
    if(byJan.has(record.jan))errors.push(`成分原本のJANが重複: ${record.jan}`);
    byJan.set(record.jan,record);
  }
  for(const product of products){
    const record=byJan.get(product.jan);
    if(!record){errors.push(`${product.jan}: 成分原本がありません`);continue;}
    byJan.delete(product.jan);
    if(record.productUrl!==product.sourceUrl)errors.push(`${product.jan}: 公式URL変更に伴う原本の再確認が必要です`);
    if(!Object.hasOwn(counts,record.status)){errors.push(`${product.jan}: 成分確認状況が不正です`);continue;}
    counts[record.status]++;
    if(product.ingredientStatus!==record.status)errors.push(`${product.jan}: 成分確認状況が原本と一致しません`);
    if(JSON.stringify(product.ingredients||[])!==JSON.stringify(record.ingredients||[]))
      errors.push(`${product.jan}: 配合成分の全項目・順序が原本と一致しません`);
    if(record.status==='full'){
      if(!record.ingredients?.length||!record.rawText||!record.sourceUrl?.startsWith('https://')||!/^[a-f0-9]{64}$/.test(record.sourceSha256||''))
        errors.push(`${product.jan}: 全成分原本の内容・出典が不足しています`);
      if(product.ingredientLabel!==record.rawText||product.ingredientSourceUrl!==record.sourceUrl||product.ingredientVerifiedAt!==record.checkedAt)
        errors.push(`${product.jan}: 成分表示原文・出典・確認日が原本と一致しません`);
    }else if(!record.reason)errors.push(`${product.jan}: 全成分未確認の理由がありません`);
  }
  for(const jan of byJan.keys())errors.push(`${jan}: 商品DBにない成分原本です`);
  return {counts,errors};
}
