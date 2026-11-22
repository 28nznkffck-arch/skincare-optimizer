import {optimize} from './optimizer.js?v=0.9.19';

// 画面から独立して既存の厳密探索を実行する。近似や採点基準の変更はしない。
self.onmessage=({data})=>{
  try{
    const {catalog,options}=data;
    const run=(settings,phase)=>optimize(catalog,settings,progress=>self.postMessage({progress:{...progress,phase,
      title:(phase==='minimum'?'最低予算の探索':'提案の探索')+(progress.stage==='preparing'?'：候補の整理':'')}}));
    const routine=run({...options,resultLimit:1},'recommendation')[0]||null;
    let minimumMonthly=null;
    if(!routine && options.concerns?.length){
      minimumMonthly=run({...options,budget:Infinity,resultLimit:1,objective:'minimumMonthly'},'minimum')[0]?.monthly??null;
    }
    self.postMessage({routine,minimumMonthly});
  }catch(error){
    self.postMessage({error:error.message||'提案の計算に失敗しました。'});
  }
};
