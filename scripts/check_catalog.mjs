import {readFile} from 'node:fs/promises';
import {loadCatalog} from '../dist/catalog-csv.js';

try {
  for (const [label,folder] of [['女性版','../catalog/'],['男性版','../catalog-men/']]) {
    const {products, archivedProducts} = await loadCatalog(url => readFile(url, 'utf8'),folder);
    console.log(`${label}商品DB: ${products.length}品掲載、${archivedProducts.length}品掲載終了`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
