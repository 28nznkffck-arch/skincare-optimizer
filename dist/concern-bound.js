// 上位3品の7・3・1倍を、必ず実点以上になる直線で見積もる。
// 保存するのは今回の検索の単品要約だけ。枝や組み合わせの結果は保存しない。
export function prepareConcernBound(groups, weights, reference, minimum) {
  const features=[];
  for(let i=0;i<weights.length;i++){
    const levels=[...new Set(groups.flatMap(group=>group.map(entry=>entry.points[i])).filter(point=>point>0))].sort((a,b)=>a-b);
    let previous=0;
    for(const level of levels){
      features.push({index:i,level,weight:(level-previous)*weights[i]});
      previous=level;
    }
  }
  const entries=groups.flat();
  const active=new Map(entries.map(entry=>[entry,features.flatMap((feature,i)=>entry.points[feature.index]>=feature.level?[i]:[])]));
  const counts=new Array(features.length).fill(0);
  for(const entry of reference)for(let i=0;i<features.length;i++){
    if(entry.points[features[i].index]>=features[i].level)counts[i]++;
  }
  let slopes=counts.map(count=>count===0?7:count===1?5:count===2?2:count===3?0.5:0);
  let best=Infinity;
  const supports=[];

  // ある点数以上の品数 n に対する加点は 0,7,10,11,11,…。
  // 任意の傾き s∈[0,7] について、s*n+max(0,7-s,10-2s,11-3s)
  // はこの加点以上になる。傾きを調整しても、上限としての安全性は変わらない。
  for(let iteration=0;iteration<80;iteration++){
    const selectedCounts=new Array(features.length).fill(0),tangent=[];
    let upper=0;
    for(let i=0;i<features.length;i++){
      const slope=slopes[i],values=[0,7-slope,10-2*slope,11-3*slope];
      let n=0;
      for(let k=1;k<4;k++)if(values[k]>values[n])n=k;
      tangent[i]=n;
      upper+=features[i].weight*values[n];
    }
    for(const group of groups){
      let highest=-Infinity,selected;
      for(const entry of group){
        const value=active.get(entry).reduce((sum,i)=>sum+features[i].weight*slopes[i],-entry.penalty);
        if(value>highest){highest=value;selected=entry;}
      }
      upper+=highest;
      for(const i of active.get(selected))selectedCounts[i]++;
    }
    if(upper<best-1e-7){
      best=upper;supports.push([...slopes]);
      if(supports.length>4)supports.shift();
    }
    const gradient=selectedCounts.map((count,i)=>(count-tangent[i])*features[i].weight);
    const norm=gradient.reduce((sum,value)=>sum+value*value,0);
    if(!norm)break;
    const step=1.5*Math.max(0.001,upper-minimum)/norm;
    slopes=slopes.map((slope,i)=>Math.max(0,Math.min(7,slope-step*gradient[i])));
  }

  const plans=supports.map(support=>{
    const constant=features.reduce((sum,feature,i)=>sum+feature.weight*Math.max(0,7-support[i],10-2*support[i],11-3*support[i]),0);
    const values=new Map(entries.map(entry=>[entry,active.get(entry).reduce((sum,i)=>sum+features[i].weight*support[i],-entry.penalty)]));
    const remaining=new Array(groups.length+1).fill(0);
    for(let g=groups.length-1;g>=0;g--)
      remaining[g]=remaining[g+1]+Math.max(...groups[g].map(entry=>values.get(entry)));
    return {constant,values,remaining};
  });
  // 実際の採点は悩み別に丸める。小数の点数・倍率でも過小評価しない。
  const roundingAllowance=weights.length*0.005+1e-7;
  return (depth,chosen)=>{
    let upper=Infinity;
    for(const plan of plans){
      let score=plan.constant+plan.remaining[depth];
      for(let g=0;g<depth;g++)score+=plan.values.get(chosen[g]);
      upper=Math.min(upper,Math.ceil((score+roundingAllowance)*100)/100);
    }
    return upper;
  };
}
