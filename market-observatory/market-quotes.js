'use strict';
(() => {
 const endpoint='https://jjooni-ct-fast-apgynr7pea-du.a.run.app/observatory/quotes';
 const labels={NASDAQ100:'나스닥100',NASDAQCOMPOSITE:'나스닥종합',SP500:'S&P500',DOW:'다우',RUSSELL2000:'러셀2000',VIX:'VIX',KOSPI:'코스피',KOSDAQ:'코스닥',USDKRW:'원/달러',USDJPY:'달러/엔',DXY:'달러인덱스',WTI:'WTI',BRENT:'브렌트',GOLD:'금',BTCUSD:'비트코인'};
 const b=document.getElementById('quoteLoad'),status=document.getElementById('quoteStatus'),rows=document.getElementById('quoteRows');
 let last=0;
 const fmt=n=>n.toLocaleString('ko-KR',{maximumFractionDigits:2,minimumFractionDigits:2});
 const stamp=n=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(n);
 b.addEventListener('click',async()=>{
  if(Date.now()-last<60000){status.textContent='비용 절감을 위해 60초 후 다시 조회할 수 있습니다.';return;}
  last=Date.now();b.disabled=true;status.textContent='시세 확인 중…';rows.replaceChildren();
  const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),20000);
  try{
   const r=await fetch(endpoint,{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',signal:ctl.signal});
   if(!r.ok)throw Error('HTTP');
   const j=await r.json();
   if(j.schema!=='JJOONI_OBSERVATORY_QUOTES_V1'||j.orders!=='NONE'||!j.quotes||typeof j.quotes!=='object')throw Error('SCHEMA');
   let count=0;
   for(const [k,label] of Object.entries(labels)){
    const v=j.quotes[k];if(!v||v.key!==k||v.source!=='YAHOO_CHART_QUOTE'||!Number.isFinite(v.value)||v.value<=0)continue;
    const t=Date.parse(v.observed_at);if(!Number.isFinite(t)||t>Date.now()+120000)continue;
    const age=Math.max(0,Date.now()-t);const stale=v.quality==='STALE'||v.refresh_status==='RETAINED'||((v.market_state==='REGULAR'||v.market_state==='CONTINUOUS')&&age>1200000);
    const tr=document.createElement('tr');
    const change=Number.isFinite(v.change_pct)?(v.change_pct>0?'+':'')+fmt(v.change_pct)+'%':'—';
    for(const [i,value] of [label,fmt(v.value),change,stamp(t),stale?'지연/이전값':v.market_state==='CLOSED'?'장 종료 참고':'지연 가능'].entries()){
      const td=document.createElement('td');td.textContent=value;if(i===2&&Number.isFinite(v.change_pct))td.className=v.change_pct>0?'up':v.change_pct<0?'down':'muted';tr.append(td);
    }rows.append(tr);count++;
   }
   if(!count)throw Error('EMPTY');
   status.textContent=count+'개 관측값 · Yahoo 참고시세 · 실제 관측 시각 기준 · 실시간 보장 없음';
  }catch(_){rows.replaceChildren();status.textContent='시세 연결 미확인 또는 조회 실패. 상단의 기준일이 표시된 종가 참고값만 사용하세요.';}
  finally{clearTimeout(timeout);b.disabled=false;}
 });
})();
