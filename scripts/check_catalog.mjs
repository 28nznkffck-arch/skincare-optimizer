import {readFile} from 'node:fs/promises';
import {loadCatalog} from '../dist/catalog-csv.js';

try {
  const {products, archivedProducts} = await loadCatalog(url => readFile(url, 'utf8'));
  console.log(`商品DB: ${products.length}品掲載、${archivedProducts.length}品掲載終了`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
