const PERIODS = {
  '1d': { days: 1, label: '1 trading day', news: '1d' },
  '5d': { days: 5, label: '5 trading days', news: '5d' },
  '1m': { days: 21, label: '1 month (~21 trading days)', news: '30d' },
  '3m': { days: 63, label: '3 months (~63 trading days)', news: '90d' }
};

const MARKET_SYMBOLS = [
  'NVDA','AMD','AVGO','MSFT','GOOGL','META','AMZN','ORCL',
  'QQQ','QQQE','SOXX','SMH','VIX','VIX3M'
];

const SEC_COMPANIES = [
  { ticker:'MSFT', name:'Microsoft', role:'Hyperscaler', cik:'0000789019', ir:'https://www.microsoft.com/en-us/Investor', weight:1.15 },
  { ticker:'GOOGL', name:'Alphabet', role:'Hyperscaler', cik:'0001652044', ir:'https://abc.xyz/investor/', weight:1.15 },
  { ticker:'META', name:'Meta', role:'Hyperscaler', cik:'0001326801', ir:'https://investor.atmeta.com/', weight:1.05 },
  { ticker:'AMZN', name:'Amazon', role:'Hyperscaler', cik:'0001018724', ir:'https://ir.aboutamazon.com/', weight:1.15 },
  { ticker:'ORCL', name:'Oracle', role:'Hyperscaler', cik:'0001341439', ir:'https://investor.oracle.com/', weight:0.85 },
  { ticker:'NVDA', name:'Nvidia', role:'AI supplier', cik:'0001045810', ir:'https://investor.nvidia.com/', weight:1.10 },
  { ticker:'AMD', name:'AMD', role:'AI supplier', cik:'0000002488', ir:'https://ir.amd.com/', weight:0.75 },
  { ticker:'AVGO', name:'Broadcom', role:'AI supplier', cik:'0001730168', ir:'https://investors.broadcom.com/', weight:0.90 }
];

const clamp = n => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 50)));
const pct = (a,b) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0) ? (a / b - 1) * 100 : null;
const avg = arr => { const x = arr.filter(Number.isFinite); return x.length ? x.reduce((a,b)=>a+b,0)/x.length : null; };
const weightedAvg = rows => {
  const ok = rows.filter(x=>Number.isFinite(x.value) && Number.isFinite(x.weight));
  const den = ok.reduce((s,x)=>s+x.weight,0);
  return den ? ok.reduce((s,x)=>s+x.value*x.weight,0)/den : null;
};
const source = (label,url,note='') => ({label,url,note});
const safeNum = v => Number.isFinite(v) ? v : null;

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
function stripHtml(s='') {
  return s.replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/g,' ')
    .replace(/&amp;/g,'&')
    .replace(/&#39;/g,"'")
    .replace(/&quot;/g,'"')
    .replace(/\s+/g,' ')
    .trim();
}
function decodeXml(s='') {
  return s.replace(/<!\[CDATA\[|\]\]>/g,'')
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
function lookbackPoint(points, days, endIndex=points.length-1) {
  if (!points?.length || endIndex < 0) return null;
  return points[Math.max(0,endIndex-days)] || null;
}
function changeAt(points, days, endIndex=points.length-1) {
  const cur=points?.[endIndex], prev=lookbackPoint(points,days,endIndex);
  return cur&&prev?pct(cur.close,prev.close):null;
}
function drawdownAt(points, days, endIndex=points.length-1) {
  if (!points?.length || endIndex<0) return null;
  const start=Math.max(0,endIndex-days+1);
  const window=points.slice(start,endIndex+1).map(p=>p.close).filter(Number.isFinite);
  const cur=points[endIndex]?.close;
  return window.length&&Number.isFinite(cur)?(cur/Math.max(...window)-1)*100:null;
}
function changeInValue(points, days) {
  if (!points?.length) return null;
  const prev=lookbackPoint(points,days);
  return prev?points.at(-1).close-prev.close:null;
}

async function marketSeries(symbol, periodDays) {
  try {
    const map = {VIX:'^VIX',VIX3M:'^VIX3M'};
    const ticker = map[symbol] || symbol;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
    const j = await fetchJson(url, {'User-Agent':'Mozilla/5.0'});
    const c = j?.chart?.result?.[0];
    const ts = c?.timestamp || [];
    const closes = c?.indicators?.quote?.[0]?.close || [];
    const points = ts.map((t,i)=>({date:new Date(t*1000).toISOString().slice(0,10),close:closes[i]}))
      .filter(p=>Number.isFinite(p.close));
    const last=points.at(-1)?.close??null;
    return {
      symbol, price:last,
      change1dPct:changeAt(points,1),
      changePeriodPct:changeAt(points,periodDays),
      change1mPct:changeAt(points,21),
      change3mPct:changeAt(points,63),
      drawdownPeriodPct:drawdownAt(points,Math.max(20,periodDays)),
      drawdown3mPct:drawdownAt(points,63),
      points,
      source:source('Yahoo Finance market data',`https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/`,'Daily close feed used for price/volatility proxies; may be delayed.')
    };
  } catch(e) {
    return {symbol,price:null,change1dPct:null,changePeriodPct:null,change1mPct:null,change3mPct:null,drawdownPeriodPct:null,drawdown3mPct:null,points:[],error:String(e),source:source('Yahoo Finance market data','https://finance.yahoo.com/','Feed unavailable')};
  }
}

async function cboeStats() {
  const url='https://www.cboe.com/markets/us/options/market-statistics/daily/';
  try {
    const raw=await fetchText(url,{'User-Agent':'Mozilla/5.0'});
    const text=stripHtml(raw);
    const read=label=>{
      const idx=text.toUpperCase().indexOf(label.toUpperCase());
      if(idx<0)return null;
      const m=text.slice(idx+label.length,idx+label.length+120).match(/([0-9]+(?:\.[0-9]+)?)/);
      return m?Number(m[1]):null;
    };
    return {
      totalPutCall:read('TOTAL PUT/CALL RATIO'),
      equityPutCall:read('EQUITY PUT/CALL RATIO'),
      source:source('Cboe Daily Market Statistics',url,'Official daily options-market put/call statistics.')
    };
  } catch(e) {
    return {totalPutCall:null,equityPutCall:null,error:String(e),source:source('Cboe Daily Market Statistics',url,'Feed unavailable')};
  }
}

async function aaiiSentiment(periodDays) {
  const url='https://www.aaii.com/sentimentsurvey/sent_results?reload=true';
  try {
    const raw=await fetchText(url,{'User-Agent':'Mozilla/5.0'});
    const text=stripHtml(raw);
    const rows=[];
    const rx=/([A-Z][a-z]{2}\s+\d{1,2})\s+([0-9]+(?:\.[0-9]+)?)%\s+([0-9]+(?:\.[0-9]+)?)%\s+([0-9]+(?:\.[0-9]+)?)%/g;
    let m;
    while((m=rx.exec(text)) && rows.length<30) {
      rows.push({date:m[1],bullish:Number(m[2]),neutral:Number(m[3]),bearish:Number(m[4]),spread:Number(m[2])-Number(m[4])});
    }
    const latest=rows[0]||null;
    const weeks=Math.max(1,Math.round(periodDays/5));
    const prior=rows[Math.min(weeks,rows.length-1)]||null;
    return {
      latest, prior,
      spreadChange:latest&&prior?latest.spread-prior.spread:null,
      rows,
      source:source('AAII Sentiment Survey',url,'Official weekly survey of individual-investor bullish, neutral and bearish expectations.')
    };
  } catch(e) {
    return {latest:null,prior:null,spreadChange:null,rows:[],error:String(e),source:source('AAII Sentiment Survey',url,'Feed unavailable')};
  }
}

async function finraMargin() {
  const url='https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-statistics';
  try {
    const raw=await fetchText(url,{'User-Agent':'Mozilla/5.0'});
    const text=stripHtml(raw);
    const rows=[];
    const rx=/([A-Z][a-z]{2}-\d{2})\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/g;
    let m;
    while((m=rx.exec(text)) && rows.length<30) {
      rows.push({period:m[1],debit:Number(m[2].replace(/,/g,'')),cashCredit:Number(m[3].replace(/,/g,'')),marginCredit:Number(m[4].replace(/,/g,''))});
    }
    const latest=rows[0]||null, prev=rows[1]||null, yoy=rows[12]||null;
    return {
      latest,
      momPct:latest&&prev?pct(latest.debit,prev.debit):null,
      yoyPct:latest&&yoy?pct(latest.debit,yoy.debit):null,
      source:source('FINRA Margin Statistics',url,'Official monthly aggregate customer margin-debit balances across FINRA member firms.')
    };
  } catch(e) {
    return {latest:null,momPct:null,yoyPct:null,error:String(e),source:source('FINRA Margin Statistics',url,'Feed unavailable')};
  }
}

async function cftcNasdaq() {
  const url='https://www.cftc.gov/dea/futures/deacmesf.htm';
  try {
    const raw=await fetchText(url,{'User-Agent':'Mozilla/5.0'});
    const text=stripHtml(raw);
    const idx=text.indexOf('NASDAQ-100 Consolidated');
    if(idx<0) throw new Error('NASDAQ-100 section not found');
    const chunk=text.slice(idx,idx+2600);
    const oi=(chunk.match(/OPEN INTEREST:\s*([\d,]+)/i)||[])[1];
    const commitments=chunk.match(/COMMITMENTS\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/i);
    const changes=chunk.match(/CHANGES FROM[^(]*\([^)]*\)\s+([+-]?[\d,]+)\s+([+-]?[\d,]+)\s+([+-]?[\d,]+)/i);
    const long=commitments?Number(commitments[1].replace(/,/g,'')):null;
    const short=commitments?Number(commitments[2].replace(/,/g,'')):null;
    const openInterest=oi?Number(oi.replace(/,/g,'')):null;
    const dLong=changes?Number(changes[1].replace(/,/g,'')):null;
    const dShort=changes?Number(changes[2].replace(/,/g,'')):null;
    const net=Number.isFinite(long)&&Number.isFinite(short)?long-short:null;
    const priorNet=Number.isFinite(net)&&Number.isFinite(dLong)&&Number.isFinite(dShort)?net-(dLong-dShort):null;
    return {
      openInterest,long,short,net,
      netPct:Number.isFinite(net)&&openInterest?net/openInterest*100:null,
      weeklyNetChange:Number.isFinite(net)&&Number.isFinite(priorNet)?net-priorNet:null,
      source:source('CFTC Commitments of Traders — Nasdaq-100',url,'Official weekly CME futures positioning; non-commercial long/short positions.')
    };
  } catch(e) {
    return {openInterest:null,long:null,short:null,net:null,netPct:null,weeklyNetChange:null,error:String(e),source:source('CFTC Commitments of Traders — Nasdaq-100',url,'Feed unavailable')};
  }
}

async function fredSeries(id,label,note) {
  const url=`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;
  const display=`https://fred.stlouisfed.org/series/${encodeURIComponent(id)}`;
  try {
    const csv=await fetchText(url,{'User-Agent':'Mozilla/5.0'});
    const rows=csv.trim().split(/\r?\n/).slice(1).map(line=>{
      const [date,val]=line.split(',');
      return {date,close:Number(val)};
    }).filter(x=>x.date&&Number.isFinite(x.close));
    return {id,label,points:rows,value:rows.at(-1)?.close??null,source:source(label,display,note)};
  } catch(e) {
    return {id,label,points:[],value:null,error:String(e),source:source(label,display,'Feed unavailable')};
  }
}

async function newsResearch(periodKey) {
  const when=PERIODS[periodKey]?.news||'5d';
  const themes=[
    {id:'bubble',label:'AI valuation / bubble narrative',q:'AI stocks valuation bubble market'},
    {id:'capex',label:'AI capex / data-center financing',q:'AI data center capex debt financing hyperscaler'},
    {id:'chips',label:'AI chip / GPU demand',q:'Nvidia GPU AI chip demand cloud'},
    {id:'hyperscalers',label:'Hyperscaler AI spending',q:'Microsoft Google Meta Amazon Oracle AI spending capex'}
  ];
  const results=await Promise.all(themes.map(async theme=>{
    const feed='https://news.google.com/rss/search?q='+encodeURIComponent(`${theme.q} when:${when}`)+'&hl=en-US&gl=US&ceid=US:en';
    try {
      const xml=await fetchText(feed,{'User-Agent':'Mozilla/5.0'});
      const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,18).map(m=>{
        const b=m[1];
        const get=t=>decodeXml((b.match(new RegExp(`<${t}(?: [^>]*)?>([\\s\\S]*?)<\\/${t}>`,'i'))||[])[1]||'');
        const raw=get('title'), parts=raw.split(' - ');
        return {theme:theme.id,themeLabel:theme.label,title:parts.slice(0,-1).join(' - ')||raw,source:parts.at(-1)||get('source')||'News',link:get('link'),date:get('pubDate')};
      });
      return {...theme,feed,items};
    } catch(e) { return {...theme,feed,items:[],error:String(e)}; }
  }));
  const seen=new Set(), items=[];
  for(const r of results) for(const item of r.items) {
    const key=item.title.toLowerCase().replace(/\W+/g,' ').trim();
    if(!seen.has(key)){seen.add(key);items.push(item);}
  }
  items.sort((a,b)=>Date.parse(b.date||0)-Date.parse(a.date||0));
  const negativeRx=/bubble|crash|selloff|slump|fear|warning|overvalu|rout|plunge|risk|slowdown|cut|cancel|overbuild|debt|loss|worry|concern/i;
  const euphoricRx=/surge|record|boom|soar|rally|unstoppable|trillion|massive demand|strong demand|accelerat|beat|explod/i;
  const bubbleRx=/bubble|overvalu|valuation|froth|crowd|mania/i;
  const capexStressRx=/debt|financ|cut capex|cancel|delay|overbuild|free cash flow|cash burn/i;
  const strongDemandRx=/strong demand|record demand|backlog|sold out|capacity constrained|accelerat/i;
  return {
    items:items.slice(0,50),
    total:items.length,
    negative:items.filter(x=>negativeRx.test(x.title)).length,
    euphoric:items.filter(x=>euphoricRx.test(x.title)).length,
    bubbleMentions:items.filter(x=>bubbleRx.test(x.title)).length,
    capexStress:items.filter(x=>capexStressRx.test(x.title)).length,
    strongDemand:items.filter(x=>strongDemandRx.test(x.title)).length,
    feeds:results.map(r=>({id:r.id,label:r.label,url:r.feed,count:r.items.length,error:r.error||null})),
    source:source('Google News RSS research basket','https://news.google.com/','Four targeted query families; narrative proxy only, not a substitute for filings or market data.')
  };
}

function factsTag(facts,tags) {
  for(const tag of tags) {
    const f=facts?.facts?.['us-gaap']?.[tag];
    if(f?.units?.USD?.length) return {tag,units:f.units.USD};
  }
  return null;
}
function uniqueByEnd(rows) {
  const map=new Map();
  rows.sort((a,b)=>String(a.filed).localeCompare(String(b.filed))).forEach(r=>map.set(r.end,r));
  return [...map.values()].sort((a,b)=>String(a.end).localeCompare(String(b.end)));
}
function durationDays(r){if(!r.start||!r.end)return null;return(Date.parse(r.end)-Date.parse(r.start))/86400000;}
function annualRows(tagObj){
  if(!tagObj)return[];
  return uniqueByEnd(tagObj.units.filter(r=>r.form==='10-K'&&r.fp==='FY'&&durationDays(r)>=300&&durationDays(r)<=430&&Number.isFinite(r.val)));
}
function quarterRows(tagObj){
  if(!tagObj)return[];
  return uniqueByEnd(tagObj.units.filter(r=>(r.form==='10-Q'||r.form==='10-K')&&durationDays(r)>=65&&durationDays(r)<=120&&Number.isFinite(r.val)));
}
function findYoY(rows){
  const latest=rows.at(-1); if(!latest)return{latest:null,prior:null,growth:null};
  const end=Date.parse(latest.end);
  const prior=rows.slice(0,-1).map(r=>({r,dist:Math.abs((end-Date.parse(r.end))/86400000-365)})).filter(x=>x.dist<50).sort((a,b)=>a.dist-b.dist)[0]?.r||null;
  return {latest,prior,growth:prior?pct(latest.val,prior.val):null};
}

async function secCompany(meta) {
  const api=`https://data.sec.gov/api/xbrl/companyfacts/CIK${meta.cik}.json`;
  const filings=`https://www.sec.gov/edgar/browse/?CIK=${Number(meta.cik)}&owner=exclude`;
  try {
    const facts=await fetchJson(api,{'User-Agent':'AI Bubble Watch research dashboard contact github.com/miqueltor-blip/ai-bubble-watch','Accept-Encoding':'gzip, deflate'});
    const revenue=factsTag(facts,['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet']);
    const cfo=factsTag(facts,['NetCashProvidedByUsedInOperatingActivities']);
    const capex=factsTag(facts,['PaymentsToAcquirePropertyPlantAndEquipment','PaymentsForAdditionsToPropertyPlantAndEquipment']);
    const qRev=findYoY(quarterRows(revenue));
    const aRev=annualRows(revenue),aCfo=annualRows(cfo),aCapex=annualRows(capex);
    const lr=aRev.at(-1),pr=aRev.at(-2),lc=aCfo.at(-1),lx=aCapex.at(-1),px=aCapex.at(-2);
    const annualRevenueGrowth=lr&&pr?pct(lr.val,pr.val):null;
    const revenueGrowth=qRev.growth??annualRevenueGrowth;
    const fcf=lc&&lx?lc.val-lx.val:null;
    const fcfMargin=Number.isFinite(fcf)&&lr?fcf/lr.val*100:null;
    const capexToRevenue=lx&&lr?lx.val/lr.val*100:null;
    const capexGrowth=lx&&px?pct(lx.val,px.val):null;
    let risk;
    if(meta.role==='Hyperscaler'){
      const capexPressure=(capexGrowth??0)-Math.max(revenueGrowth??0,0);
      risk=clamp(34+Math.max(0,capexPressure)*0.34+Math.max(0,18-(fcfMargin??18))*1.1+Math.max(0,(capexToRevenue??15)-20)*0.75+Math.max(0,-(revenueGrowth??0))*1.1);
    } else {
      risk=clamp(42+Math.max(0,18-(revenueGrowth??18))*1.05+Math.max(0,10-(fcfMargin??10))*0.9);
    }
    return {
      ticker:meta.ticker,name:meta.name,role:meta.role,weight:meta.weight,
      revenueGrowthPct:safeNum(revenueGrowth),capexGrowthPct:safeNum(capexGrowth),
      fcfMarginPct:safeNum(fcfMargin),capexToRevenuePct:safeNum(capexToRevenue),
      period:qRev.latest?.end||lr?.end||null,filed:qRev.latest?.filed||lr?.filed||null,
      risk,
      source:source('SEC EDGAR / Company Facts',filings,'Official standardized XBRL facts. Quarterly revenue where comparable; capex and FCF use latest available fiscal-year facts.'),
      irSource:source(`${meta.name} Investor Relations`,meta.ir,'Official company earnings, guidance and investor materials.')
    };
  } catch(e) {
    return {ticker:meta.ticker,name:meta.name,role:meta.role,weight:meta.weight,revenueGrowthPct:null,capexGrowthPct:null,fcfMarginPct:null,capexToRevenuePct:null,period:null,filed:null,risk:50,error:String(e),source:source('SEC EDGAR / Company Facts',filings,'SEC feed unavailable; neutral fallback used.'),irSource:source(`${meta.name} Investor Relations`,meta.ir,'Official company investor materials.')};
  }
}

function q(quotes,s){return quotes.find(x=>x.symbol===s)||{};}
function scoreState(v){return v>=75?'red':v>=55?'amber':'green';}
function stateLabel(v){return v>=75?'High':v>=55?'Watch':'Contained';}

function marketSnapshot(quotes, fred, periodDays, endOffset=0) {
  const endIndex=symbol=>{
    const p=q(quotes,symbol).points||[];
    return Math.max(0,p.length-1-endOffset);
  };
  const ch=(symbol,days)=>{
    const p=q(quotes,symbol).points||[];
    return changeAt(p,days,endIndex(symbol));
  };
  const dd=(symbol,days)=>{
    const p=q(quotes,symbol).points||[];
    return drawdownAt(p,days,endIndex(symbol));
  };
  const val=symbol=>{
    const p=q(quotes,symbol).points||[];
    return p[endIndex(symbol)]?.close??null;
  };
  const aiPeriod=avg(['NVDA','AMD','AVGO','SOXX','SMH'].map(s=>ch(s,periodDays)))??0;
  const aiDay=avg(['NVDA','AMD','AVGO','SOXX','SMH'].map(s=>ch(s,1)))??0;
  const aiDraw=avg(['NVDA','AMD','AVGO','SOXX','SMH'].map(s=>dd(s,Math.max(20,periodDays))))??0;
  const qqqPeriod=ch('QQQ',periodDays)??0;
  const qqqePeriod=ch('QQQE',periodDays)??qqqPeriod;
  const relativeAI=aiPeriod-qqqPeriod;
  const megaConcentration=qqqPeriod-qqqePeriod;
  const vix=val('VIX')??18;
  const vix3m=val('VIX3M');
  const vixCurve=Number.isFinite(vix3m)&&vix3m? vix/vix3m : null;
  const hy=fred.hy.points||[];
  const nfci=fred.nfci.points||[];
  const hyIndex=Math.max(0,hy.length-1-endOffset);
  const nfciIndex=Math.max(0,nfci.length-1-Math.round(endOffset/5));
  const hyValue=hy[hyIndex]?.close??fred.hy.value;
  const hyPrev=hy[Math.max(0,hyIndex-periodDays)]?.close;
  const hyChange=Number.isFinite(hyValue)&&Number.isFinite(hyPrev)?hyValue-hyPrev:null;
  const nfciValue=nfci[nfciIndex]?.close??fred.nfci.value;
  return {aiPeriod,aiDay,aiDraw,qqqPeriod,qqqePeriod,relativeAI,megaConcentration,vix,vix3m,vixCurve,hyValue,hyChange,nfciValue};
}

function detectDipEpisodes(points) {
  const p=(points||[]).slice(-150);
  if(p.length<10)return[];
  let peak=p[0],active=null,episodes=[];
  for(let i=1;i<p.length;i++){
    const x=p[i];
    if(!active){
      if(x.close>peak.close) peak=x;
      const dd=(x.close/peak.close-1)*100;
      if(dd<=-5) active={peakDate:peak.date,peak:peak.close,troughDate:x.date,trough:x.close,troughPct:dd,startIndex:i};
    } else {
      if(x.close<active.trough){active.trough=x.close;active.troughDate=x.date;active.troughPct=(x.close/active.peak-1)*100;}
      if(x.close>=active.peak*0.98){
        episodes.push({...active,recoveryDate:x.date,recovered:true,recoveryDays:i-active.startIndex});
        peak=x; active=null;
      }
    }
  }
  if(active){
    const last=p.at(-1);
    const fromTrough=(last.close/active.trough-1)*100;
    episodes.push({...active,recoveryDate:null,recovered:false,currentPct:(last.close/active.peak-1)*100,reboundFromTroughPct:fromTrough});
  }
  return episodes.slice(-4);
}

function confidence(available,total,max=4) {
  const ratio=total?available/total:0;
  const stars=Math.max(1,Math.min(max,Math.round(ratio*max)));
  return {stars,outOf:5,label:stars>=4?'Strong':stars===3?'Moderate':'Limited'};
}

module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=1800');
  const periodKey=PERIODS[req.query?.period]?req.query.period:'5d';
  const period=PERIODS[periodKey];

  const marketPromise=Promise.all(MARKET_SYMBOLS.map(s=>marketSeries(s,period.days)));
  const fredPromise=Promise.all([
    fredSeries('BAMLH0A0HYM2','FRED: US High Yield Credit Spread','Daily option-adjusted spread; widening indicates tighter/riskier corporate credit.'),
    fredSeries('NFCI','FRED: Chicago Fed Financial Conditions','Weekly broad financial-conditions index; positive is tighter than average, negative looser.')
  ]);
  const [quotes,options,aaii,margin,cftc,narrative,companies,fredRows]=await Promise.all([
    marketPromise,
    cboeStats(),
    aaiiSentiment(period.days),
    finraMargin(),
    cftcNasdaq(),
    newsResearch(periodKey),
    Promise.all(SEC_COMPANIES.map(secCompany)),
    fredPromise
  ]);

  const fred={hy:fredRows[0],nfci:fredRows[1]};
  const snap=marketSnapshot(quotes,fred,period.days,0);
  const priorSnap=marketSnapshot(quotes,fred,period.days,period.days);

  const hypers=companies.filter(c=>c.role==='Hyperscaler');
  const suppliers=companies.filter(c=>c.role==='AI supplier');
  const overbuildRisk=clamp(weightedAvg(hypers.map(c=>({value:c.risk,weight:c.weight})))??50);
  const supplierDemandRisk=clamp(weightedAvg(suppliers.map(c=>({value:c.risk,weight:c.weight})))??50);

  const marginLeverage=Number.isFinite(margin.yoyPct)?clamp(45+margin.yoyPct*1.5):50;
  const aaiiCrowding=aaii.latest?clamp(50+(aaii.latest.bullish-aaii.latest.bearish-6.5)*1.4):50;
  const cftcCrowding=Number.isFinite(cftc.netPct)?clamp(50+cftc.netPct*2.2):50;
  const optionsComplacency=Number.isFinite(options.equityPutCall)?clamp(50+(0.72-options.equityPutCall)*80):50;
  const marketEuphoria=clamp(
    44 + Math.max(0,snap.aiPeriod)*1.15 + Math.max(0,snap.relativeAI)*0.8 +
    Math.max(0,snap.megaConcentration)*1.1 + Math.max(0,18-snap.vix)*1.2 +
    narrative.euphoric*0.8 + narrative.bubbleMentions*0.45
  );
  const leverageCrowding=clamp(avg([marginLeverage,aaiiCrowding,cftcCrowding,optionsComplacency])??50);
  const bubble=clamp(overbuildRisk*0.52+marketEuphoria*0.28+leverageCrowding*0.20);

  const prevDayAI=avg(['NVDA','AMD','AVGO','SOXX','SMH'].map(s=>{
    const pts=q(quotes,s).points||[]; const i=pts.length-2;
    return i>0?changeAt(pts,1,i):null;
  }))??0;
  const failedDip=prevDayAI<-2 && snap.aiDay<0;
  const priceStress=clamp(38+Math.max(0,-snap.aiPeriod)*2.2+Math.max(0,-snap.aiDraw)*1.5+Math.max(0,-snap.relativeAI)*1.15+(failedDip?12:0));
  const fearStress=clamp(38+Math.max(0,snap.vix-18)*2.4+(Number.isFinite(snap.vixCurve)?Math.max(0,snap.vixCurve-0.9)*120:0)+(Number.isFinite(options.equityPutCall)?Math.max(0,options.equityPutCall-0.72)*65:0)+(aaii.latest?Math.max(0,aaii.latest.bearish-31.5)*0.9:0));
  const creditStress=clamp(35+(Number.isFinite(snap.hyValue)?Math.max(0,snap.hyValue-3.2)*18:0)+(Number.isFinite(snap.hyChange)?Math.max(0,snap.hyChange)*45:0)+(Number.isFinite(snap.nfciValue)?Math.max(0,snap.nfciValue+0.1)*38:0));
  const narrativeStress=clamp(38+(narrative.total? narrative.negative/narrative.total*55:0)+narrative.capexStress*1.5+supplierDemandRisk*0.18);
  const unwindStress=clamp(42+(Number.isFinite(cftc.weeklyNetChange)?Math.max(0,-cftc.weeklyNetChange/5000)*3:0)+Math.max(0,-snap.megaConcentration)*1.3+Math.max(0,-snap.relativeAI)*1.2);
  const burst=clamp(priceStress*0.38+fearStress*0.20+creditStress*0.16+narrativeStress*0.11+unwindStress*0.15);
  const fragility=clamp(bubble*0.40+burst*0.35+leverageCrowding*0.15+creditStress*0.10);

  const histPrice=clamp(38+Math.max(0,-priorSnap.aiPeriod)*2.2+Math.max(0,-priorSnap.aiDraw)*1.5+Math.max(0,-priorSnap.relativeAI)*1.15);
  const histFear=clamp(38+Math.max(0,priorSnap.vix-18)*2.4+(Number.isFinite(priorSnap.vixCurve)?Math.max(0,priorSnap.vixCurve-0.9)*120:0));
  const histCredit=clamp(35+(Number.isFinite(priorSnap.hyValue)?Math.max(0,priorSnap.hyValue-3.2)*18:0)+(Number.isFinite(priorSnap.nfciValue)?Math.max(0,priorSnap.nfciValue+0.1)*38:0));
  const currentComparable=clamp(priceStress*0.50+fearStress*0.28+creditStress*0.22);
  const priorComparable=clamp(histPrice*0.50+histFear*0.28+histCredit*0.22);
  const burstDelta=currentComparable-priorComparable;
  const fragilityDelta=Math.round(burstDelta*0.55);

  let regime={name:'Normal',class:'green',desc:'The AI trade is not showing a broad self-reinforcing selloff.'};
  if(fragility>=80||burst>=82) regime={name:'Panic',class:'red',desc:'Selling, volatility and funding stress are reinforcing one another.'};
  else if(burst>=68&&snap.aiPeriod<0) regime={name:'Reflexive selloff',class:'red',desc:'Price weakness itself is becoming a catalyst; failed rebounds matter more than normal valuation debate.'};
  else if(fragility>=62||burst>=60) regime={name:'Fragile',class:'amber',desc:'The setup is vulnerable: a modest catalyst could trigger a larger positioning unwind.'};
  else if(bubble>=60||leverageCrowding>=62) regime={name:'Crowded',class:'amber',desc:'Optimism, leverage or capital intensity are elevated, but the exit rush has not started.'};

  const stageIndex=regime.name==='Panic'?4:regime.name==='Reflexive selloff'?3:regime.name==='Fragile'?2:regime.name==='Crowded'?1:0;
  const stages=['Calm','Crowded','Nervous','Exits forming','Rush for exits'];

  const dips=detectDipEpisodes(q(quotes,'SOXX').points);
  const activeDip=dips.at(-1)?.recovered===false?dips.at(-1):null;
  let dipState={label:'Dip buying intact',state:'green',explain:'Recent semiconductor drawdowns have not yet developed into a clear failed-rebound pattern.'};
  if(activeDip&&activeDip.currentPct<=-10) dipState={label:'Dip buying under pressure',state:'amber',explain:`SOXX remains ${activeDip.currentPct.toFixed(1)}% below the prior peak. The rebound has not fully repaired the drawdown.`};
  if(failedDip||(activeDip&&activeDip.currentPct<=-15&&activeDip.reboundFromTroughPct<3)) dipState={label:'Sell-the-bounce warning',state:'red',explain:'A meaningful drawdown is being followed by weak or failed rebound behavior — the regime change we care about most.'};

  const musicalIngredients=[
    {name:'Crowding',technical:'Leverage & positioning composite',score:leverageCrowding,state:scoreState(leverageCrowding),label:stateLabel(leverageCrowding),plain:'How many investors appear to already be leaning the same way.',why:'Crowded trades can fall faster because there are fewer fresh buyers and more holders trying to exit together.',method:'FINRA margin debt, AAII individual-investor sentiment, CFTC Nasdaq futures positioning and Cboe equity put/call.'},
    {name:'Bubble narrative',technical:'Media / expectation proxy',score:clamp(42+narrative.bubbleMentions*3+narrative.euphoric*1.2),state:scoreState(clamp(42+narrative.bubbleMentions*3+narrative.euphoric*1.2)),label:narrative.bubbleMentions>=6?'Loud':'Present',plain:'How strongly the public conversation is framing AI as either a mania or an unstoppable boom.',why:'If everyone is already thinking about the exit, a small negative catalyst can become a coordination point.',method:'Four separate Google News research baskets, deduplicated and classified by headline language.'},
    {name:'Dip buying',technical:'SOXX drawdown/recovery behavior',score:dipState.state==='red'?82:dipState.state==='amber'?62:38,state:dipState.state,label:dipState.label,plain:'Are investors still reliably stepping in after AI-related selloffs?',why:'The transition from “buy the dip” to “sell the bounce” is a potential regime-change signal.',method:'Detected SOXX drawdown episodes, recovery speed and a failed-dip flag based on consecutive weak AI-complex sessions.'},
    {name:'Forced-selling pressure',technical:'Price + CFTC unwind + credit stress',score:clamp(unwindStress*0.55+creditStress*0.45),state:scoreState(clamp(unwindStress*0.55+creditStress*0.45)),label:stateLabel(clamp(unwindStress*0.55+creditStress*0.45)),plain:'Are there signs that investors may be reducing risk because they have to, not because they changed their long-term AI view?',why:'Forced deleveraging is how an ordinary correction can become a rout.',method:'CFTC weekly Nasdaq positioning changes, AI relative performance, high-yield spreads and financial conditions.'},
    {name:'Market fear',technical:'VIX / VIX3M / options composite',score:fearStress,state:scoreState(fearStress),label:stateLabel(fearStress),plain:'How expensive and urgent market protection has become.',why:'Rising volatility can force systematic strategies to reduce exposure, which can create additional selling.',method:'VIX level, VIX-versus-3-month volatility curve, Cboe put/call ratio and AAII bearish sentiment.'}
  ];

  const sourceFamilies=[
    {name:'SEC company filings',status:companies.filter(c=>!c.error).length===companies.length?'Live':'Partial',count:`${companies.filter(c=>!c.error).length}/${companies.length} companies`,cadence:'Quarterly / annual',usedFor:'Capital efficiency, revenue growth, capex, free cash flow',confidence:'High',source:source('SEC EDGAR API','https://www.sec.gov/search-filings/edgar-application-programming-interfaces','Official XBRL Company Facts API.')},
    {name:'Market breadth & volatility',status:quotes.filter(x=>!x.error).length>=11?'Live':'Partial',count:`${quotes.filter(x=>!x.error).length}/${quotes.length} series`,cadence:'Daily',usedFor:'AI complex, relative momentum, drawdowns, concentration, VIX curve',confidence:'High for prices',source:source('Yahoo Finance market data','https://finance.yahoo.com/','Price feed; public data can be delayed.')},
    {name:'Options positioning',status:options.error?'Unavailable':'Live',count:'Cboe daily statistics',cadence:'Daily',usedFor:'Fear vs complacency',confidence:'High',source:options.source},
    {name:'Individual-investor sentiment',status:aaii.error?'Unavailable':'Live',count:aaii.rows?.length?`${aaii.rows.length} weekly observations loaded`:'Current survey',cadence:'Weekly',usedFor:'Retail sentiment / crowding proxy',confidence:'Medium-high',source:aaii.source},
    {name:'Customer leverage',status:margin.error?'Unavailable':'Live',count:margin.latest?`Latest: ${margin.latest.period}`:'Monthly series',cadence:'Monthly',usedFor:'Margin leverage / crowdedness',confidence:'High but broad-market',source:margin.source},
    {name:'Leveraged futures positioning',status:cftc.error?'Unavailable':'Live',count:'Nasdaq-100 COT',cadence:'Weekly',usedFor:'Speculative positioning and unwind',confidence:'High but futures-only',source:cftc.source},
    {name:'Credit & financial conditions',status:fredRows.filter(x=>!x.error).length===2?'Live':'Partial',count:`${fredRows.filter(x=>!x.error).length}/2 macro series`,cadence:'Daily + weekly',usedFor:'Funding stress / forced-selling risk',confidence:'High',source:fred.hy.source},
    {name:'News / narrative research',status:narrative.items.length?'Live':'Unavailable',count:`${narrative.items.length} deduplicated headlines · ${narrative.feeds.length} themes`,cadence:`Selected ${period.label}`,usedFor:'Bubble narrative, capex stress, demand language',confidence:'Medium — narrative proxy',source:narrative.source},
    {name:'Official company IR',status:'Reference',count:`${SEC_COMPANIES.length} investor-relations sites`,cadence:'Earnings cycle',usedFor:'Human drill-down into guidance and management commentary',confidence:'High',source:source('Company IR reference layer','https://www.sec.gov/edgar/search/','Each company card links to its official investor-relations page.')}
  ];

  const availableFamilies=sourceFamilies.filter(x=>x.status==='Live').length;
  const scoreConfidence={
    bubble:{...confidence(availableFamilies,8,4),note:'Good structured coverage, but direct broker-level retail order flow and a clean real-time valuation database are still missing.'},
    burst:{...confidence([quotes,options,aaii,cftc,fred.hy,fred.nfci,narrative].filter(x=>!x.error).length,7,4),note:'Strong reflexivity coverage; direct dealer gamma/retail order-flow data would improve it further.'},
    fragility:{...confidence(availableFamilies,8,4),note:'Broad cross-asset coverage; private-market AI financing and real-time data-center utilization remain gaps.'}
  };

  const scoreDetails={
    bubble:{
      title:'Bubble conditions',score:bubble,delta:null,deltaLabel:'Reported-data score — changes mainly when filings, leverage or positioning data update',
      plain:'How much the AI boom currently resembles an overheated setup: heavy spending, crowded positioning and euphoric expectations.',
      why:'A high bubble score does not mean a crash is imminent. It means the market may have less room for disappointment.',
      method:`52% hyperscaler capital-efficiency risk + 28% market euphoria/concentration + 20% leverage/positioning crowding. Fundamentals cover ${hypers.length} hyperscalers; positioning adds FINRA, AAII, CFTC and Cboe.`,
      confidence:scoreConfidence.bubble,
      components:[['Capital overbuild / efficiency',overbuildRisk],['Market euphoria & concentration',marketEuphoria],['Leverage & positioning crowding',leverageCrowding]],
      sources:sourceFamilies.filter(x=>['SEC company filings','Market breadth & volatility','Options positioning','Individual-investor sentiment','Customer leverage','Leveraged futures positioning','News / narrative research'].includes(x.name)).map(x=>x.source)
    },
    burst:{
      title:'Burst risk',score:burst,delta:burstDelta,deltaLabel:`market-sensitive change vs ${period.label} ago`,
      plain:'How close the market looks to turning ordinary AI skepticism into a self-reinforcing selloff.',
      why:'This is the “musical chairs” score: it can rise rapidly even if long-term AI fundamentals remain excellent.',
      method:'38% AI price stress + 20% fear/options + 16% credit conditions + 11% narrative stress + 15% positioning unwind. The displayed delta only compares components that can honestly be backfilled.',
      confidence:scoreConfidence.burst,
      components:[['AI price stress',priceStress],['Market fear',fearStress],['Credit / funding stress',creditStress],['Narrative stress',narrativeStress],['Position unwind',unwindStress]],
      sources:sourceFamilies.filter(x=>['Market breadth & volatility','Options positioning','Individual-investor sentiment','Leveraged futures positioning','Credit & financial conditions','News / narrative research'].includes(x.name)).map(x=>x.source)
    },
    fragility:{
      title:'Market fragility',score:fragility,delta:fragilityDelta,deltaLabel:`market-sensitive change vs ${period.label} ago`,
      plain:'How vulnerable the AI trade is to a small shock becoming a much larger move.',
      why:'Fragility is highest when a crowded/bubbly market meets rising fear, leverage and tighter funding.',
      method:'40% bubble conditions + 35% burst risk + 15% leverage/crowding + 10% credit stress. This measures susceptibility, not expected return.',
      confidence:scoreConfidence.fragility,
      components:[['Bubble conditions',bubble],['Burst risk',burst],['Leverage & crowding',leverageCrowding],['Credit stress',creditStress]],
      sources:sourceFamilies.map(x=>x.source)
    }
  };

  const changeCards=[
    {label:'AI chip complex',value:`${snap.aiPeriod>=0?'+':''}${snap.aiPeriod.toFixed(1)}%`,detail:`over ${period.label}`,tone:snap.aiPeriod<-5?'red':snap.aiPeriod<0?'amber':'green'},
    {label:'AI vs Nasdaq',value:`${snap.relativeAI>=0?'+':''}${snap.relativeAI.toFixed(1)} pts`,detail:`relative performance over ${period.label}`,tone:snap.relativeAI<-3?'red':snap.relativeAI<0?'amber':'green'},
    {label:'Market fear (VIX)',value:Number.isFinite(snap.vix)?snap.vix.toFixed(1):'—',detail:`${Number.isFinite(changeInValue(q(quotes,'VIX').points,period.days))?(changeInValue(q(quotes,'VIX').points,period.days)>=0?'+':'')+changeInValue(q(quotes,'VIX').points,period.days).toFixed(1)+' pts vs '+period.label+' ago':'period change unavailable'}`,tone:snap.vix>28?'red':snap.vix>21?'amber':'green'},
    {label:'Credit risk',value:Number.isFinite(snap.hyValue)?snap.hyValue.toFixed(2)+'%':'—',detail:Number.isFinite(snap.hyChange)?`${snap.hyChange>=0?'+':''}${(snap.hyChange*100).toFixed(0)} bps vs ${period.label} ago`:'high-yield spread change unavailable',tone:snap.hyValue>5?'red':snap.hyValue>4?'amber':'green'},
    {label:'Retail sentiment',value:aaii.latest?`${aaii.latest.spread>=0?'+':''}${aaii.latest.spread.toFixed(1)} pts`:'—',detail:aaii.latest?`AAII bull-minus-bear; ${Number.isFinite(aaii.spreadChange)?(aaii.spreadChange>=0?'+':'')+aaii.spreadChange.toFixed(1)+' pts vs nearest prior survey':''}`:'AAII unavailable',tone:aaii.latest&&aaii.latest.spread>15?'amber':'green'},
    {label:'Margin leverage',value:margin.latest?`$${(margin.latest.debit/1000).toFixed(0)}B`:'—',detail:margin.latest?`${Number.isFinite(margin.momPct)?(margin.momPct>=0?'+':'')+margin.momPct.toFixed(1)+'% MoM':''} · ${Number.isFinite(margin.yoyPct)?(margin.yoyPct>=0?'+':'')+margin.yoyPct.toFixed(1)+'% YoY':''}`:'FINRA unavailable',tone:Number.isFinite(margin.yoyPct)&&margin.yoyPct>25?'red':Number.isFinite(margin.yoyPct)&&margin.yoyPct>12?'amber':'green'}
  ];

  const indicatorSources={
    crowding:[margin.source,aaii.source,cftc.source,options.source],
    narrative:[narrative.source,...narrative.feeds.map(f=>source(f.label,f.url,`${f.count} headlines in selected window`))],
    dips:[q(quotes,'SOXX').source,q(quotes,'NVDA').source],
    forced:[cftc.source,fred.hy.source,fred.nfci.source,q(quotes,'SOXX').source],
    fear:[options.source,q(quotes,'VIX').source,source('Cboe VIX Term Structure','https://www.cboe.com/tradable-products/vix/term-structure/','Official explanation/reference for volatility term structure.'),aaii.source]
  };
  musicalIngredients[0].sources=indicatorSources.crowding;
  musicalIngredients[1].sources=indicatorSources.narrative;
  musicalIngredients[2].sources=indicatorSources.dips;
  musicalIngredients[3].sources=indicatorSources.forced;
  musicalIngredients[4].sources=indicatorSources.fear;

  const driverPool=[
    {name:'AI price stress',score:priceStress,text:`AI-linked chips are ${snap.aiPeriod>=0?'up':'down'} ${Math.abs(snap.aiPeriod).toFixed(1)}% over ${period.label}.`},
    {name:'Market fear',score:fearStress,text:`VIX is ${snap.vix.toFixed(1)}${Number.isFinite(snap.vixCurve)?` and VIX/VIX3M is ${snap.vixCurve.toFixed(2)}`:''}.`},
    {name:'Leverage/crowding',score:leverageCrowding,text:`Positioning/leverage composite is ${leverageCrowding}/100.`},
    {name:'Capital overbuild risk',score:overbuildRisk,text:`Hyperscaler capital-efficiency risk is ${overbuildRisk}/100 across ${hypers.length} companies.`},
    {name:'Credit stress',score:creditStress,text:`Credit/funding stress is ${creditStress}/100.`}
  ].sort((a,b)=>b.score-a.score);
  const topDriver=driverPool[0];
  const summary={
    headline:regime.name==='Normal'?'AI risk remains contained.':regime.name==='Crowded'?'The AI trade is crowded, but the exit rush has not started.':regime.name==='Fragile'?'AI markets look fragile enough that a modest catalyst matters.':regime.name==='Reflexive selloff'?'A reflexive selloff signal is active.':'Panic conditions are active.',
    body:`Bubble conditions are ${bubble}/100, burst risk ${burst}/100 and fragility ${fragility}/100. The strongest current driver is ${topDriver.name.toLowerCase()}: ${topDriver.text}`,
    keySignal:`Most important signal: ${dipState.label}. ${dipState.explain}`,
    watchFor:burst<65?'What would make us more worried: a failed rebound in semiconductors accompanied by a VIX jump, worsening relative performance and widening credit spreads.':'What matters now: whether rebounds fail, credit spreads widen and positioning data confirm an unwind rather than a normal correction.'
  };

  const basePoints=q(quotes,'SOXX').points||[];
  const histCount=Math.min(basePoints.length,Math.max(period.days+5,periodKey==='3m'?70:periodKey==='1m'?30:15));
  const history=[];
  for(let off=histCount-1;off>=0;off--){
    const s=marketSnapshot(quotes,fred,Math.min(period.days,21),off);
    const pStress=clamp(38+Math.max(0,-s.aiPeriod)*2.2+Math.max(0,-s.aiDraw)*1.5+Math.max(0,-s.relativeAI)*1.15);
    const fStress=clamp(38+Math.max(0,s.vix-18)*2.4+(Number.isFinite(s.vixCurve)?Math.max(0,s.vixCurve-0.9)*120:0));
    const cStress=clamp(35+(Number.isFinite(s.hyValue)?Math.max(0,s.hyValue-3.2)*18:0)+(Number.isFinite(s.nfciValue)?Math.max(0,s.nfciValue+0.1)*38:0));
    const proxy=clamp(pStress*0.50+fStress*0.28+cStress*0.22);
    const date=basePoints[Math.max(0,basePoints.length-1-off)]?.date;
    if(date)history.push({date,score:proxy});
  }

  const glossary=[
    {term:'VIX',plain:'A market-implied “fear gauge” built from S&P 500 options.',why:'A fast VIX rise often means investors are paying up for protection and can trigger risk reduction by systematic strategies.'},
    {term:'VIX term structure',plain:'The difference between near-term and longer-term expected volatility.',why:'When near-term fear becomes more expensive than future fear, markets can be entering a stressed regime.'},
    {term:'Put/call ratio',plain:'How much put-option activity there is relative to call-option activity.',why:'Very low readings can signal complacency; high readings can signal defensive hedging or fear.'},
    {term:'Capex',plain:'Capital expenditure: money spent building long-lived infrastructure such as data centers, servers and equipment.',why:'The AI bubble question is partly whether enormous capex eventually earns adequate returns.'},
    {term:'Free cash flow (FCF)',plain:'Cash left after operating the business and paying for capital investment.',why:'If AI spending rises much faster than cash generation, capital efficiency can deteriorate even while revenue grows.'},
    {term:'Drawdown',plain:'How far an asset has fallen from a recent peak.',why:'A drawdown tells you the damage already done, not just today’s move.'},
    {term:'Relative momentum',plain:'Whether AI/chip stocks are doing better or worse than the broader tech market.',why:'AI-specific weakness can appear before the overall Nasdaq looks stressed.'},
    {term:'CFTC COT',plain:'A weekly report showing how different groups are positioned in futures markets.',why:'A large speculative position that starts unwinding can amplify price moves.'},
    {term:'High-yield spread',plain:'The extra yield risky corporate borrowers pay over safer Treasury bonds.',why:'Widening spreads mean financing is getting more expensive or investors are demanding more compensation for risk.'},
    {term:'FINRA margin debt',plain:'Money customers have borrowed against securities in brokerage margin accounts.',why:'Rapid growth can be a broad sign of leverage and risk appetite; leverage can accelerate selloffs.'},
    {term:'AAII sentiment',plain:'A weekly survey of individual investors asking whether they are bullish, neutral or bearish.',why:'It is one useful retail-sentiment proxy, though it is not direct broker order-flow data.'}
  ];

  const gaps=[
    'No direct real-time broker-level retail buy/sell flow. AAII and FINRA are proxies, not the same thing.',
    'No direct dealer gamma/options-position map; Cboe put/call and volatility structure are broader proxies.',
    'Private AI infrastructure financing and private-company economics are only indirectly visible.',
    'Real-time data-center utilization / GPU rental economics are not yet sourced from a robust public API.',
    'The dashboard intentionally avoids pretending news sentiment is a precise scientific measurement.'
  ];

  res.status(200).json({
    updated:new Date().toISOString(),
    period:{key:periodKey,...period},
    regime,
    summary,
    scores:{bubble,burst,fragility},
    scoreDetails,
    stages:{labels:stages,current:stageIndex},
    musicalIngredients,
    dipMonitor:{state:dipState,episodes:dips},
    changes:changeCards,
    history,
    quotes:quotes.map(({points,...rest})=>rest),
    options,aaii:{...aaii,rows:(aaii.rows||[]).slice(0,14)},margin,cftc,
    credit:{highYield:{value:fred.hy.value,change:snap.hyChange,source:fred.hy.source},nfci:{value:fred.nfci.value,source:fred.nfci.source}},
    headlines:narrative.items.slice(0,12),
    narrativeStats:{total:narrative.total,negative:narrative.negative,euphoric:narrative.euphoric,bubbleMentions:narrative.bubbleMentions,capexStress:narrative.capexStress,strongDemand:narrative.strongDemand},
    fundamentals:companies,
    researchCoverage:sourceFamilies,
    glossary,
    methodology:{
      version:'3.0',
      note:'Simple first layer, deep auditable research underneath. Scores are transparent heuristics, not statistically calibrated crash probabilities.',
      selectedPeriod:period.label,
      gaps,
      sourceCount:sourceFamilies.length,
      companyCount:companies.length,
      marketSeriesCount:quotes.length,
      headlineCount:narrative.items.length
    }
  });
};
