import {optimize} from './optimizer.js?v=0.9.13';

// 画面から独立して既存の厳密探索を実行する。近似や採点基準の変更はしない。
self.onmessage=({data})=>{
  try{
    const {catalog,options}=data;
    const routine=optimize(catalog,{...options,resultLimit:1})[0]||null;
    let minimumMonthly=null;
    if(!routine && options.concerns?.length){
      const settings={...options,budget:Infinity,resultLimit:1};
      if(optimize(catalog,settings).length)
        minimumMonthly=optimize(catalog,{...settings,objective:'minimumMonthly'})[0]?.monthly??null;
    }
    self.postMessage({routine,minimumMonthly});
  }catch(error){
    self.postMessage({error:error.message||'提案の計算に失敗しました。'});
  }
};
