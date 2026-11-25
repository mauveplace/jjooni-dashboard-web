'use strict';
(() => {
 const labels={NASDAQ100:'나스닥100',SP500:'S&P 500',DOW30:'다우30',VIX:'VIX',USDKRW:'원/달러',DXY:'달러인덱스',WTI:'WTI',BRENT:'브렌트유'};
 const stamp=document.getElementById('dailyStamp'),tbody=document.getElementById('dailyMarketRows');
 const floor=Date.parse('2026-11-25T07:32:13+09:00');
 const fmt=n=>n.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2});
 async function load(){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),10000);
  try{
   const res=await fetch('./data/market-daily.json',{cache:'no-store',credentials:'omit',redirect:'error',signal:ctl.signal});
   if(!res.ok)throw Error('MISSING');
   const data=await res.json(),time=Date.parse(data.generated_kst);
   if(data.schema!=='JJOONI_PUBLIC_MARKET_PROJECTION_V1'||data.basis!=='COMPLETED_DAILY_REFERENCE_NOT_LIVE'||!Number.isFinite(time)||time<floor||time>Date.now()+120000||!data.items)throw Error('INVALID');
   const frag=document.createDocumentFragment();let count=0;
   for(const [key,label] of Object.entries(labels)){
    const item=data.items[key];if(!item||!Number.isFinite(item.value)||item.value<=0||typeof item.date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(item.date))continue;
    const tr=document.createElement('tr'),pct=Number.isFinite(item.change_pct)?(item.change_pct>0?'+':'')+fmt(item.change_pct)+'%':'—';
    for(const [i,value] of [label,fmt(item.value),pct,item.date].entries()){
     const td=document.createElement('td');td.textContent=value;if(i===2&&Number.isFinite(item.change_pct))td.className=item.change_pct>0?'up':item.change_pct<0?'down':'muted';tr.append(td);
    }
    frag.append(tr);count++;
   }
   if(!count)throw Error('EMPTY');
   tbody.replaceChildren(frag);
   const kst=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(time);
   stamp.textContent='수집 시각: '+kst+' KST · 완료 일봉 참고값 · '+(Date.now()-time>72*3600000?'갱신 지연':'실시간 아님')+' · '+count+'개';
  }catch(_){stamp.textContent='수집 시각: 2026-11-25 07:32 KST · 자동 갱신 미연결 또는 조회 실패 · 저장된 참고값';}
  finally{clearTimeout(timer);}
 }
 load();
})();
