const SYMBOLS = ['NVDA','MSFT','GOOGL','META','AMD','QQQ','SOXX','VIX'];
const SEC_COMPANIES = [
  { ticker:'NVDA', name:'Nvidia', cik:'0001045810' },
  { ticker:'MSFT', name:'Microsoft', cik:'0000789019' },
  { ticker:'GOOGL', name:'Alphabet', cik:'0001652044' },
  { ticker:'META', name:'Meta', cik:'0001326801' },
  { ticker:'AMD', name:'AMD', cik:'0000002488' }
];
const clamp = n => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 50)));
const pct = (a,b) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0) ? (a / b - 1) * 100 : null;
const avg = arr => { const x = arr.filter(Number.isFinite); return x.length ? x.reduce((a,b)=>a+b,0)/x.length : null; };
const source = (label,url,note='') => ({label,url,note});

async function fetchJson(url, headers={}) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function fetchText(url, headers={}) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

async function marketSeries(symbol) {
  try {
    const ticker = symbol === 'VIX' ? '^VIX' : symbol;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=3mo&interval=1d`;
    const j = await fetchJson(url, {'User-Agent':'Mozilla/5.0'});
    const c = j?.chart?.result?.[0];
    const ts = c?.timestamp || [];
    const closes = c?.indicators?.quote?.[0]?.close || [];
    const points = ts.map((t,i)=>({date:new Date(t*1000).toISOString().slice(0,10), close:closes[i]})).filter(p=>Number.isFinite(p.close));
    const last = points.at(-1)?.close ?? null;
    const prev = points.at(-2)?.close ?? null;
    const p5 = points.at(-6)?.close ?? null;
    const p20 = points.at(-21)?.close ?? null;
    const max20 = points.slice(-20).reduce((m,p)=>Math.max(m,p.close),-Infinity);
    return {
      symbol, price:last, changePct:pct(last,prev), change5dPct:pct(last,p5), change20dPct:pct(last,p20),
      drawdown20Pct:Number.isFinite(last)&&Number.isFinite(max20)?(last/max20-1)*100:null,
      points,
      source: source('Yahoo Finance market data', `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/`, 'Daily close data; public feed may be delayed.')
    };
  } catch (e) {
    return {symbol,price:null,changePct:null,change5dPct:null,change20dPct:null,drawdown20Pct:null,points:[],error:String(e),source:source('Yahoo Finance market data','https://finance.yahoo.com/','Feed unavailable')};
  }
}

function stripHtml(s='') { return s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim(); }
async function cboeStats() {
  const url='https://www.cboe.com/markets/us/options/market-statistics/daily/';
  try {
    const raw=await fetchText(url, {'User-Agent':'Mozilla/5.0'});
    const text=stripHtml(raw);
    const read=(label)=>{
      const idx=text.toUpperCase().indexOf(label.toUpperCase());
      if(idx<0) return null;
      const chunk=text.slice(idx+label.length,idx+label.length+100);
      const m=chunk.match(/([0-9]+(?:\.[0-9]+)?)/);
      return m?Number(m[1]):null;
    };
    return { totalPutCall:read('TOTAL PUT/CALL RATIO'), equityPutCall:read('EQUITY PUT/CALL RATIO'), source:source('Cboe Daily Market Statistics',url,'Official Cboe daily put/call ratios.') };
  } catch(e) { return {totalPutCall:null,equityPutCall:null,error:String(e),source:source('Cboe Daily Market Statistics',url,'Feed unavailable')}; }
}

function decodeXml(s='') { return s.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>'); }
async function news() {
  const feed='https://news.google.com/rss/search?q='+encodeURIComponent('(AI bubble OR Nvidia OR AI stocks OR hyperscaler capex) when:3d')+'&hl=en-US&gl=US&ceid=US:en';
  try {
    const xml=await fetchText(feed, {'User-Agent':'Mozilla/5.0'});
    const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,12).map(m=>{
      const b=m[1];
      const get=t=>decodeXml((b.match(new RegExp(`<${t}(?: [^>]*)?>([\\s\\S]*?)<\\/${t}>`,'i'))||[])[1]||'');
      const raw=get('title'); const parts=raw.split(' - ');
      return { title:parts.slice(0,-1).join(' - ')||raw, source:parts.at(-1)||get('source')||'News', link:get('link'), date:get('pubDate') };
    });
    const negativeRx=/bubble|crash|selloff|slump|fear|warning|overvalu|rout|plunge|risk|slowdown|cut capex|overbuild|debt/i;
    const euphoricRx=/surge|record|boom|soar|rally|unstoppable|trillion|massive demand|strong demand/i;
    return { items, negative:items.filter(h=>negativeRx.test(h.title)).length, euphoric:items.filter(h=>euphoricRx.test(h.title)).length, source:source('Google News RSS',feed,'Headline narrative proxy, not a full-media sentiment model.') };
  } catch(e) { return {items:[],negative:0,euphoric:0,error:String(e),source:source('Google News RSS',feed,'Feed unavailable')}; }
}

function factsTag(facts,tags) {
  for (const tag of tags) {
    const f=facts?.facts?.['us-gaap']?.[tag];
    if (f?.units?.USD?.length) return {tag,units:f.units.USD};
  }
  return null;
}
function uniqueByEnd(rows) {
  const map=new Map();
  rows.sort((a,b)=>String(a.filed).localeCompare(String(b.filed))).forEach(r=>map.set(r.end,r));
  return [...map.values()].sort((a,b)=>String(a.end).localeCompare(String(b.end)));
}
function durationDays(r) { if(!r.start||!r.end)return null; return (Date.parse(r.end)-Date.parse(r.start))/86400000; }
function annualRows(tagObj) {
  if(!tagObj) return [];
  return uniqueByEnd(tagObj.units.filter(r=>r.form==='10-K' && r.fp==='FY' && durationDays(r)>=300 && durationDays(r)<=430 && Number.isFinite(r.val)));
}
function quarterRows(tagObj) {
  if(!tagObj) return [];
  return uniqueByEnd(tagObj.units.filter(r=>(r.form==='10-Q'||r.form==='10-K') && durationDays(r)>=65 && durationDays(r)<=120 && Number.isFinite(r.val)));
}
function findYoY(rows) {
  const latest=rows.at(-1); if(!latest) return {latest:null,prior:null,growth:null};
  const end=Date.parse(latest.end);
  const candidates=rows.slice(0,-1).map(r=>({r,dist:Math.abs((end-Date.parse(r.end))/86400000-365)})).filter(x=>x.dist<45).sort((a,b)=>a.dist-b.dist);
  const prior=candidates[0]?.r||null;
  return {latest,prior,growth:prior?pct(latest.val,prior.val):null};
}

async function secCompany(meta) {
  const url=`https://data.sec.gov/api/xbrl/companyfacts/CIK${meta.cik}.json`;
  const filingsUrl=`https://www.sec.gov/edgar/browse/?CIK=${Number(meta.cik)}&owner=exclude`;
  try {
    const facts=await fetchJson(url, {'User-Agent':'AI Bubble Watch dashboard github.com/miqueltor-blip/ai-bubble-watch','Accept-Encoding':'gzip, deflate'});
    const revenue=factsTag(facts,['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet']);
    const cfo=factsTag(facts,['NetCashProvidedByUsedInOperatingActivities']);
    const capex=factsTag(facts,['PaymentsToAcquirePropertyPlantAndEquipment','PaymentsForAdditionsToPropertyPlantAndEquipment']);
    const qRev=findYoY(quarterRows(revenue));
    const aRev=annualRows(revenue), aCfo=annualRows(cfo), aCapex=annualRows(capex);
    const lr=aRev.at(-1), lc=aCfo.at(-1), lx=aCapex.at(-1), px=aCapex.at(-2);
    const fcf=(lc&&lx)?lc.val-lx.val:null;
    const fcfMargin=(Number.isFinite(fcf)&&lr)?fcf/lr.val*100:null;
    const capexToRevenue=(lx&&lr)?lx.val/lr.val*100:null;
    const capexGrowth=(lx&&px)?pct(lx.val,px.val):null;
    const revenueGrowth=qRev.growth;
    const companyRisk=clamp(42 + Math.max(0,(capexGrowth??0)-(revenueGrowth??0))*0.45 + Math.max(0,12-(fcfMargin??12))*1.2 + Math.max(0,(capexToRevenue??15)-20)*0.6);
    return {ticker:meta.ticker,name:meta.name,revenueGrowthPct:revenueGrowth,capexGrowthPct:capexGrowth,fcfMarginPct:fcfMargin,capexToRevenuePct:capexToRevenue,period:qRev.latest?.end||lr?.end||null,filed:qRev.latest?.filed||lr?.filed||null,risk:companyRisk,source:source('SEC EDGAR / Company Facts',filingsUrl,`Automated XBRL proxy. Revenue uses latest comparable quarter; capex and FCF use latest available fiscal-year 10-K facts. Raw company facts: ${url}`)};
  } catch(e) {
    return {ticker:meta.ticker,name:meta.name,revenueGrowthPct:null,capexGrowthPct:null,fcfMarginPct:null,capexToRevenuePct:null,period:null,filed:null,risk:50,error:String(e),source:source('SEC EDGAR / Company Facts',filingsUrl,'SEC feed unavailable; score uses neutral fallback.')};
  }
}

function getQuote(quotes,s){return quotes.find(q=>q.symbol===s)||{};}
function dailyAt(s,i){const a=s?.points||[]; if(i<=0||i>=a.length)return null; return pct(a[i].close,a[i-1].close);}
function historyFrom(quotes,fundamental) {
  const soxx=getQuote(quotes,'SOXX'), qqq=getQuote(quotes,'QQQ'), vix=getQuote(quotes,'VIX');
  const common=soxx.points.slice(-35);
  return common.map((p)=>{
    const globalIdx=soxx.points.findIndex(x=>x.date===p.date);
    if(globalIdx<1)return null;
    const qidx=qqq.points.findIndex(x=>x.date===p.date), vidx=vix.points.findIndex(x=>x.date===p.date);
    const sd=dailyAt(soxx,globalIdx), s5=globalIdx>=5?pct(soxx.points[globalIdx].close,soxx.points[globalIdx-5].close):null;
    const q5=qidx>=5?pct(qqq.points[qidx].close,qqq.points[qidx-5].close):null;
    const vv=vidx>=0?vix.points[vidx].close:null;
    const window=soxx.points.slice(Math.max(0,globalIdx-19),globalIdx+1).map(x=>x.close);
    const dd=window.length?soxx.points[globalIdx].close/Math.max(...window)*100-100:null;
    const marketRisk=clamp(38 + Math.max(0,-(sd??0))*4 + Math.max(0,-(s5??0))*1.4 + Math.max(0,-(dd??0))*1.2 + Math.max(0,(vv??18)-18)*1.8 + Math.max(0,(s5??0)-(q5??0))*0.5);
    return {date:p.date,score:clamp(marketRisk*.65+fundamental*.35)};
  }).filter(Boolean).slice(-30);
}

module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=1800');
  const [quotes,options,narrative,companies]=await Promise.all([
    Promise.all(SYMBOLS.map(marketSeries)), cboeStats(), news(), Promise.all(SEC_COMPANIES.map(secCompany))
  ]);
  const nv=getQuote(quotes,'NVDA'), amd=getQuote(quotes,'AMD'), soxx=getQuote(quotes,'SOXX'), qqq=getQuote(quotes,'QQQ'), vixQ=getQuote(quotes,'VIX');
  const semiDay=avg([nv.changePct,amd.changePct,soxx.changePct])??0;
  const semi5=avg([nv.change5dPct,amd.change5dPct,soxx.change5dPct])??0;
  const qqq5=qqq.change5dPct??0;
  const semiDraw=avg([nv.drawdown20Pct,amd.drawdown20Pct,soxx.drawdown20Pct])??0;
  const vix=vixQ.price??18;
  const vixDay=vixQ.changePct??0;
  const relative5=semi5-qqq5;
  const prevSemiDay=avg([nv.points.length>2?pct(nv.points.at(-2).close,nv.points.at(-3).close):null,amd.points.length>2?pct(amd.points.at(-2).close,amd.points.at(-3).close):null,soxx.points.length>2?pct(soxx.points.at(-2).close,soxx.points.at(-3).close):null])??0;
  const failedDip=prevSemiDay<-2 && semiDay<0;
  const optionFragility=Number.isFinite(options.equityPutCall)?(options.equityPutCall<0.55?10:options.equityPutCall>0.9?12:0):0;
  const sentiment=clamp(38 + Math.max(0,-semiDay)*4.2 + Math.max(0,-semi5)*1.3 + Math.max(0,-semiDraw)*1.1 + Math.max(0,vix-18)*1.8 + narrative.negative*2.4 + narrative.euphoric*0.8 + optionFragility + (failedDip?10:0) + Math.max(0,relative5)*0.45);
  const fundamental=clamp(avg(companies.map(c=>c.risk))??50);
  const combined=clamp(sentiment*.6+fundamental*.4);
  let regime={name:'Normal',class:'green',desc:'No broad reflexive selloff signal is active.'};
  if(combined>=80 || (sentiment>=82&&semiDay<-4)) regime={name:'Panic',class:'red',desc:'Price stress, volatility and narrative deterioration are reinforcing one another.'};
  else if(sentiment>=70&&semiDay<-2) regime={name:'Reflexive selloff',class:'red',desc:'Market weakness itself is becoming a catalyst; watch for forced selling and failed rebounds.'};
  else if(combined>=62||sentiment>=65) regime={name:'Fragile',class:'amber',desc:'Crowded positioning or weakening price action leaves the AI trade vulnerable to a small catalyst.'};
  else if(sentiment>=52 || (Number.isFinite(options.equityPutCall)&&options.equityPutCall<0.6)) regime={name:'Crowded',class:'amber',desc:'Risk appetite remains strong, but positioning may be increasingly one-sided.'};

  const history=historyFrom(quotes,fundamental);
  const histDelta=history.length>1?history.at(-1).score-history.at(-2).score:0;
  const changes=[
    {label:'Market risk score',value:(histDelta>=0?'+':'')+histDelta+' pts',tone:histDelta>3?'red':histDelta>0?'amber':'green',detail:'Market-derived risk versus the prior trading session.'},
    {label:'AI / semis today',value:(semiDay>=0?'+':'')+semiDay.toFixed(2)+'%',tone:semiDay<-2?'red':semiDay<0?'amber':'green',detail:'Average daily move of NVDA, AMD and SOXX.'},
    {label:'VIX today',value:(vixDay>=0?'+':'')+vixDay.toFixed(2)+'%',tone:vix>25?'red':vix>20?'amber':'green',detail:`VIX ${vix.toFixed(1)}; daily percentage change shown.`},
    {label:'SOXX vs QQQ (5d)',value:(relative5>=0?'+':'')+relative5.toFixed(2)+' pts',tone:Math.abs(relative5)>4?'amber':'green',detail:'5-day AI/semiconductor relative momentum versus Nasdaq-100.'}
  ];

  const indicators=[
    {name:'AI / semiconductor price reflexivity',label:semiDay<-3?'Stress':semiDay<-1?'Watch':'Stable',state:semiDay<-3?'red':semiDay<-1?'amber':'green',value:`${semiDay>=0?'+':''}${semiDay.toFixed(2)}% today`,desc:`5-day move ${semi5>=0?'+':''}${semi5.toFixed(2)}%; average 20-day drawdown ${semiDraw.toFixed(2)}%.`,method:'Average NVDA, AMD and SOXX price action. Fast synchronized declines and deeper drawdowns increase reflexive-selling risk.',sources:[nv.source,amd.source,soxx.source]},
    {name:'Volatility regime',label:vix>28?'High':vix>21?'Rising':'Calm',state:vix>28?'red':vix>21?'amber':'green',value:`VIX ${vix.toFixed(1)}`,desc:`VIX daily move ${vixDay>=0?'+':''}${vixDay.toFixed(2)}%.`,method:'VIX is used as a broad risk/hedging stress signal. Sustained readings above the low-20s matter more when AI equities are also falling.',sources:[vixQ.source]},
    {name:'Options positioning',label:Number.isFinite(options.equityPutCall)?(options.equityPutCall<0.55?'Call-heavy':options.equityPutCall>0.9?'Defensive':'Balanced'):'Unavailable',state:Number.isFinite(options.equityPutCall)&&((options.equityPutCall<0.55)||(options.equityPutCall>0.9))?'amber':'green',value:Number.isFinite(options.equityPutCall)?`Equity P/C ${options.equityPutCall.toFixed(2)}`:'—',desc:Number.isFinite(options.totalPutCall)?`Total put/call ${options.totalPutCall.toFixed(2)}.`:'Official Cboe ratio unavailable.',method:'Cboe equity and total put/call ratios are positioning proxies. Very low equity ratios can indicate call-heavy complacency; very high ratios can indicate defensive stress. They are not retail-only measures.',sources:[options.source]},
    {name:'Narrative pressure',label:narrative.negative>=5?'Negative':narrative.negative>=3?'Mixed':'Benign',state:narrative.negative>=5?'red':narrative.negative>=3?'amber':'green',value:`${narrative.negative}/${narrative.items.length} risk headlines`,desc:`${narrative.euphoric} exuberant/boom-style headlines also detected.`,method:'Simple transparent keyword classification over a rolling Google News RSS query. Used as a narrative proxy, not as a sophisticated NLP sentiment model.',sources:[narrative.source]},
    {name:'Buy-the-dip → sell-the-bounce regime',label:failedDip?'Failed dip':'Not triggered',state:failedDip?'red':semiDay<0&&prevSemiDay<0?'amber':'green',value:failedDip?'Two-step weakness':'No failure signal',desc:`Prior AI/semis session ${prevSemiDay>=0?'+':''}${prevSemiDay.toFixed(2)}%; current ${semiDay>=0?'+':''}${semiDay.toFixed(2)}%.`,method:'Flags a simple failed-dip pattern when the AI/semiconductor basket falls more than 2% in the prior session and remains negative the next session.',sources:[soxx.source,nv.source,amd.source]},
    {name:'Fundamental capital-efficiency pressure',label:fundamental>=65?'High':fundamental>=52?'Watch':'Contained',state:fundamental>=65?'red':fundamental>=52?'amber':'green',value:`${fundamental}/100`,desc:'SEC-reported revenue, capex and free-cash-flow proxies across NVDA, MSFT, GOOGL, META and AMD.',method:'Company risk rises when capex growth outruns revenue growth, capex intensity is high, or free-cash-flow margin is weak. This is intentionally separate from market sentiment.',sources:[source('SEC EDGAR XBRL APIs','https://www.sec.gov/search-filings/edgar-application-programming-interfaces','Official company facts data, updated as filings are disseminated.')]} 
  ];

  const scoreDetails={
    sentiment:{title:'Sentiment / positioning crash risk',score:sentiment,method:'A reflexivity score combining synchronized AI-stock weakness, 5-day momentum, 20-day drawdown, VIX, options positioning, headline narrative and a failed-buy-the-dip flag. It can rise even when company fundamentals remain strong.',sources:[nv.source,amd.source,soxx.source,vixQ.source,options.source,narrative.source]},
    fundamental:{title:'Fundamental bubble risk',score:fundamental,method:'Average capital-efficiency risk across five AI-linked leaders using SEC XBRL: latest comparable quarterly revenue growth plus latest available fiscal-year capex growth, capex/revenue and FCF margin. This is a proxy for whether spending is outrunning economic output.',sources:[source('SEC EDGAR XBRL APIs','https://www.sec.gov/search-filings/edgar-application-programming-interfaces','Official SEC documentation for Company Facts API.')]},
    combined:{title:'Combined AI bubble risk',score:combined,method:'60% sentiment/positioning risk + 40% fundamental capital-efficiency risk. The heavier sentiment weight reflects the thesis that a burst can begin through reflexive positioning before fundamentals visibly collapse.',sources:[]}
  };

  res.status(200).json({
    updated:new Date().toISOString(),regime,scores:{sentiment,fundamental,combined},scoreDetails,changes,history,
    quotes:quotes.map(({points,...q})=>q), options, headlines:narrative.items, indicators, fundamentals:companies,
    methodology:{version:'2.0',note:'Transparent heuristic dashboard. It is designed to expose the components and sources rather than pretend to be a statistically calibrated crash model.',sources:[source('SEC EDGAR API documentation','https://www.sec.gov/search-filings/edgar-application-programming-interfaces'),source('Cboe market statistics','https://www.cboe.com/markets/us/options/market-statistics/daily/'),source('Yahoo Finance','https://finance.yahoo.com/'),narrative.source]}
  });
};
