(()=>{'use strict';
const admin=location.pathname.includes('economy-admin'),$=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let state=null,tab='overview',selectedStock=null,stockInterval='5m',stockChart=null;
async function api(path,data){const r=await fetch('/api/economy/'+path,{method:data?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const x=await r.json();if(!r.ok)throw Error(x.error||x.message||'Request failed');return x}
const fmt=n=>Number(n||0).toLocaleString('en-IN')+' FC';const name=id=>state.members?.find(x=>x.id===id)?.name||'Member';const co=id=>state.companies.find(x=>x.id===id);const btn=(text,act,id,extra='')=>`<button data-action="${act}" data-id="${esc(id)}" ${extra}>${text}</button>`;
function chart(data){if(!data?.length)return '<p class="muted">Chart will appear after price updates.</p>';const pts=data.slice(-70),min=Math.min(...pts.map(x=>x.price)),max=Math.max(...pts.map(x=>x.price)),range=Math.max(1,max-min);return `<svg class="chart" viewBox="0 0 340 150" preserveAspectRatio="none" role="img" aria-label="Executed share price history"><polyline fill="none" stroke="#56e79c" stroke-width="2.8" points="${pts.map((p,i)=>`${(i/Math.max(1,pts.length-1)*330+5).toFixed(1)},${(140-(p.price-min)/range*125).toFixed(1)}`).join(' ')}"/></svg>`}
function memberPage(){const m=state.member;if(!m)return '';const a=m.account,shares=Object.entries(a.shares||{}).filter(x=>x[1]>0);switch(tab){
case 'overview':return `<p class="notice">📅 Stock Market: 8:00 AM–10:00 PM IST daily. Virtual FC only.</p><div class="grid"><div class="card"><h3>💵 Available Cash</h3><div class="price">${fmt(a.cash)}</div></div><div class="card"><h3>💎 Net Worth</h3><div class="price">${fmt(m.netWorth)}</div></div><div class="card"><h3>📈 Portfolio</h3>${shares.map(([id,n])=>`<p>${esc(co(id)?.name||'Archived company')}: ${n} shares</p>`).join('')||'No shares yet'}</div><div class="card"><h3>🏢 Businesses</h3>${m.businesses.length} owned</div><div class="card"><h3>🔔 Notifications</h3>${(m.notifications||[]).slice(0,5).map(n=>`<p>${esc(n.message)}</p>`).join('')||'No alerts'}</div><div class="card"><h3>🎯 Daily Missions</h3>${[['invest','First investment'],['portfolio','Hold shares'],['business','Own a business']].map(([id,title])=>`<p>${esc(title)} ${m.missions.includes(id)?'✓':btn('Claim FC','claim-mission',id)}</p>`).join('')}</div><div class="card"><h3>🏅 Achievements & Badges</h3>${m.achievements.map(x=>`<p>${esc(x)}</p>`).join('')||'Start investing to earn achievements'}${m.items.filter(x=>x.effect==='vip_badge'&&x.expiresAt>Date.now()||x.effect==='prestige').map(x=>`<p>✨ ${esc(x.title)}</p>`).join('')}</div></div>`;
case 'market':{
 const companies=state.companies;
 if(!companies.length)return '<div class="card">No companies available.</div>';
 if(!companies.some(c=>c.id===selectedStock))selectedStock=companies[0].id;
 const c=companies.find(c=>c.id===selectedStock);
 const previous=c.history?.length>1?c.history[c.history.length-2].price:c.price;
 const delta=c.price-previous, pct=previous?100*delta/previous:0;
 const owned=a.shares[c.id]||0;
 return `<div class="terminal">
 <div class="terminal-top"><div><span class="terminal-kicker">FFGC EXCHANGE · SIMULATED FC MARKET</span><h2>Professional Trading Terminal</h2><span class="market-badge ${state.marketOpen?'open':'closed'}">${state.marketOpen?'● MARKET OPEN':'● MARKET CLOSED'}</span><span class="terminal-kicker"> 08:00–22:00 IST</span></div><div class="terminal-balance">AVAILABLE BALANCE<strong>${fmt(a.cash)}</strong></div></div>
 <div class="ticker-strip">${companies.map(x=>`<button class="ticker ${x.id===c.id?'selected':''}" data-stock="${esc(x.id)}"><span>${esc(x.name)}</span><b>${Number(x.price).toLocaleString('en-IN')} FC</b></button>`).join('')}</div>
 <div class="terminal-layout"><section class="terminal-main">
 <div class="stock-heading"><div><span class="terminal-kicker">VIRTUAL EQUITY / FC</span><h2>${esc(c.name)}</h2><span class="terminal-kicker">Historical prices reflect saved simulation data</span></div><div><div class="stock-price">${fmt(c.price)}</div><div class="${delta>=0?'gain':'loss'}">${delta>=0?'+':''}${delta.toFixed(0)} FC (${pct>=0?'+':''}${pct.toFixed(2)}%) · latest tick</div></div></div>
 <div class="chart-toolbar"><span>CHART</span>${[['1m','1m'],['5m','5m'],['15m','15m'],['1h','1H'],['4h','4H'],['1d','1D'],['1w','1W']].map(([v,label])=>`<button data-interval="${v}" class="${stockInterval===v?'active':''}">${label}</button>`).join('')}<button data-action="chart-fullscreen" data-id="${esc(c.id)}">⛶ Fullscreen</button></div>
 <div id="proChart" class="pro-chart" role="img" aria-label="Historical candlestick chart for ${esc(c.name)}"></div>
 <div class="chart-footnote">OHLC from stored price ticks · Volume shows executed member shares only · No fabricated trade volume</div>
 <div class="market-stats"><div>Available supply<strong>${Number(c.supply).toLocaleString('en-IN')}</strong></div><div>Your shares<strong>${owned.toLocaleString('en-IN')}</strong></div><div>Market status<strong>${c.frozen?'Frozen':state.marketOpen?'Trading':'Closed'}</strong></div></div>
 </section><aside class="terminal-order"><div class="terminal-kicker">ORDER ENTRY</div><h2>Trade ${esc(c.name)}</h2><p>Current price <b>${fmt(c.price)}</b></p><label>Shares<input type="number" id="qty_${c.id}" value="1" min="1" step="1"></label><p>Estimated total: <b id="orderEstimate">${fmt(c.price)}</b></p><div class="order-buttons">${btn('BUY SHARES','buy',c.id,(!state.marketOpen||c.frozen)?'disabled':'')}${btn('SELL SHARES','sell',c.id,(!state.marketOpen||c.frozen)?'disabled':'')}</div><p class="muted">Market orders only in this version. ${state.approvalMode?'Admin approval required.':'Instant execution when market is open.'}</p><div class="order-history"><h3>Recent Orders</h3>${(m.orders||[]).filter(o=>o.companyId===c.id).slice(-7).reverse().map(o=>`<div class="row"><span>${esc(o.side.toUpperCase())} ${o.quantity} shares</span><small>${esc(o.status)} · ${fmt(o.price)}</small></div>`).join('')||'<p class="muted">No orders yet.</p>'}</div></aside></div></div>`;
}

case 'business':return `<h2>My Businesses</h2><div class="card">${m.businesses.map(b=>`<p>${esc(state.businessTypes.find(t=>t.id===b.typeId)?.name||'Business')} · Level ${b.level||1} · ${b.locked?'🔒 Income locked (maintenance FC needed)':'🟢 Active'} · Next weekly payout: ${new Date(b.paidAt+7*86400000).toLocaleString()} ${btn('Upgrade','business-upgrade',b.id)} ${btn('Sell','business-sell',b.id)}</p>`).join('')||'No businesses yet'}</div><h2>Business Store</h2><div class="grid">${state.businessTypes.map(t=>`<div class="card"><h3>${esc(t.name)}</h3><p>Price: ${fmt(t.price)} · Weekly income: ${fmt(t.income)} · Maintenance: ${fmt(t.maintenance)}</p>${btn('Buy Business','business-buy',t.id)}</div>`).join('')||'Coming soon'}</div>`;
case 'shop':return `<div class="grid">${state.products.map(t=>`<div class="card"><h3>${esc(t.name)}</h3><p>${fmt(t.price)} · Stock: ${t.stock}</p>${btn('Purchase','product-buy',t.id,t.stock===0?'disabled':'')}</div>`).join('')||'Items coming soon'}</div><h2>My Items</h2><div class="card">${m.items.map(x=>`<p>${esc(x.title)} · ${esc(x.status)} ${x.expiresAt?'· Expires '+new Date(x.expiresAt).toLocaleDateString('en-IN'):''} ${x.effect==='business_boost'&&x.status==='owned'?`<select id="boost_${esc(x.id)}">${m.businesses.map(b=>`<option value="${esc(b.id)}">${esc(state.businessTypes.find(t=>t.id===b.typeId)?.name||'Business')}</option>`).join('')}</select>${btn('Activate','activate-boost',x.id)}`:''}</p>`).join('')||'No purchases'}</div>`;
case 'trading':return `<div class="card"><h2>Send FC Trade Offer</h2><p>Select a public member name. Private login IDs are never displayed. Receiver accepts; God Admin approves.</p><form id="tradeForm"><label>Receiver<select name="toId" required><option value="">Choose a member</option>${(state.tradeMembers||[]).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label><label>Amount (FC)<input type="number" name="amount" min="1" required></label><button>Send Offer</button></form></div><div class="card"><h2>Offers</h2>${m.trades.map(t=>`<div class="row">${t.fromId===m.id?'Sent':'Received'} ${fmt(t.amount)} · ${esc(t.status)} ${t.toId===m.id&&t.status==='offered'?btn('Accept','accept-trade',t.id)+' '+btn('Reject','reject-trade',t.id):''}</div>`).join('')||'No offers'}</div>`;
case 'rankings':return `<div class="card">${state.rankings.map((r,i)=>`<div class="row"><b>#${i+1} ${esc(r.name)} ${esc(r.badges||'')}</b><strong>${fmt(r.netWorth)}</strong></div>`).join('')}</div>`;
case 'history':return `<h2>🌍 Automatic Market Events</h2><div class="card">${(state.marketEvents||[]).map(x=>`<p>${esc(x.title)} · ${new Date(x.at).toLocaleString()}</p>`).join('')||'No events yet'}</div><h2>📢 Recent Market Activity</h2><div class="card">${(state.activity||[]).map(x=>`<p>${esc(x.side)} ${x.quantity} shares · ${esc(x.company)} · ${new Date(x.at).toLocaleString()}</p>`).join('')||'No trades yet'}</div><h2>My Transactions</h2><div class="card">${m.history.map(x=>`<div class="row"><span>${esc(x.action)} — ${esc(x.detail)}</span><small>${new Date(x.at).toLocaleString()}</small></div>`).join('')||'No transactions yet'}</div><h2>Stock Orders</h2><div class="card">${m.orders.map(o=>`<p>${esc(o.side)} ${o.quantity} shares @ ${fmt(o.price)} — ${esc(o.status)}</p>`).join('')||'No orders'}</div>`;
}}
function adminPage(){const e=state.admin;switch(tab){
case 'overview': {
  const historyTimes = state.companies
    .flatMap(c => (c.history || []).slice(-1).map(p => Date.parse(p.at)))
    .filter(Number.isFinite);

  const latestTick = historyTimes.length
    ? new Date(Math.max(...historyTimes)).toLocaleString('en-IN')
    : 'No saved ticks yet';

  const historyPoints = state.companies.reduce(
    (total, c) => total + (c.history || []).length,
    0
  );

  const frozenCompanies = state.companies.filter(c => c.frozen).length;

  const activeSchedules = e.schedules.filter(
    s => s.status === 'pending' || s.status === 'running'
  ).length;

  return `
    <p class="notice">
      Trading hours: 8:00 AM–10:00 PM IST.
      Virtual FC market only.
    </p>

    <div class="grid">
      <div class="card">
        <h3>Economy Status</h3>
        ${state.enabled ? '🟢 ONLINE' : '🔴 DISABLED'}
      </div>

      <div class="card">
        <h3>Market Status</h3>
        ${state.marketOpen ? '🟢 OPEN' : '🔴 CLOSED'}
      </div>

      <div class="card">
        <h3>Companies</h3>
        ${state.companies.length}
      </div>

      <div class="card">
        <h3>Pending Orders</h3>
        ${e.orders.filter(x => x.status === 'pending').length}
      </div>

      <div class="card">
        <h3>FC Circulation</h3>
        ${fmt(e.settings.fcCirculation)}
      </div>

      <div class="card">
        <h3>Maintenance Locks</h3>
        ${e.settings.lockedBusinesses}
      </div>

      <div class="card">
        <h3>Auto Market Engine</h3>
        ${state.autoMarket ? '🟢 ENABLED' : '🔴 DISABLED'}
      </div>

      <div class="card">
        <h3>Saved Chart Points</h3>
        ${historyPoints.toLocaleString('en-IN')}
      </div>

      <div class="card">
        <h3>Frozen Companies</h3>
        ${frozenCompanies}
      </div>

      <div class="card">
        <h3>Active Schedules</h3>
        ${activeSchedules}
      </div>

      <div class="card">
        <h3>Latest Saved Market Tick</h3>
        <small>${esc(latestTick)}</small>
      </div>
    </div>
  `;
}

function candleData(history,interval){
 const spans={'1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400,'1w':604800};
 const span=spans[interval]||300, buckets=new Map();
 for(const tick of history||[]){
  const sec=Math.floor(new Date(tick.at).getTime()/1000),price=Number(tick.price);
  if(!Number.isFinite(sec)||!Number.isFinite(price)||price<=0)continue;
  const time=Math.floor(sec/span)*span;
  const row=buckets.get(time);
  if(!row)buckets.set(time,{time,open:price,high:price,low:price,close:price});
  else{row.high=Math.max(row.high,price);row.low=Math.min(row.low,price);row.close=price;}
 }
 return [...buckets.values()].sort((a,b)=>a.time-b.time);
}
function mountProChart(){
 const el=$('proChart'),c=co(selectedStock);
 if(!el||!c)return;
 if(stockChart){try{stockChart.remove()}catch{}stockChart=null}
 const candles=candleData(c.history,stockInterval);
 if(!candles.length){el.textContent='Price history will appear after market updates.';return}
 if(!window.LightweightCharts){
  el.innerHTML=chart(c.history)+'<p class="muted">Advanced chart requires the chart library to load. Check internet access.</p>';return;
 }
 try{
  const L=window.LightweightCharts;
  stockChart=L.createChart(el,{width:el.clientWidth||650,height:Math.max(320,Math.min(490,window.innerHeight*.55)),layout:{background:{type:'solid',color:'#0b111c'},textColor:'#a8b6c8'},grid:{vertLines:{color:'#192335'},horzLines:{color:'#192335'}},rightPriceScale:{borderColor:'#27364b'},timeScale:{borderColor:'#27364b',timeVisible:true,secondsVisible:false},crosshair:{mode:0}});
  const options={upColor:'#14c99b',downColor:'#f05a70',borderUpColor:'#14c99b',borderDownColor:'#f05a70',wickUpColor:'#14c99b',wickDownColor:'#f05a70'};
  const series=L.CandlestickSeries?stockChart.addSeries(L.CandlestickSeries,options):stockChart.addCandlestickSeries(options);
  series.setData(candles);
  stockChart.timeScale().fitContent();
  const observer=new ResizeObserver(()=>{if(stockChart&&el.isConnected)stockChart.applyOptions({width:el.clientWidth})});observer.observe(el);
  const oldRemove=stockChart.remove.bind(stockChart);
  stockChart.remove=()=>{observer.disconnect();oldRemove()};
 }catch(err){el.innerHTML=chart(c.history);console.warn('Chart fallback',err)}
}

async function refresh(){try{state=await api('state');const authorized=admin?!!state.admin:!!state.member;$(admin?'adminLock':'loginNotice').classList.toggle('hidden',authorized);$(admin?'adminApp':'memberApp').classList.toggle('hidden',!authorized);if(authorized)render();$('status').textContent='';}catch(e){$('status').textContent=e.message;}}
function render(){document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));$('content').innerHTML=admin?adminPage():memberPage();if(!admin&&tab==='market')requestAnimationFrame(mountProChart)}
async function post(action,payload){try{await api(admin?'admin':action,admin?{action,...payload}:payload);await refresh();}catch(e){alert(e.message)}}
document.addEventListener('click',async ev=>{const t=ev.target.closest('[data-tab],[data-action],[data-stock],[data-interval]');if(!t)return;if(t.dataset.tab){tab=t.dataset.tab;render();return}if(t.dataset.stock){selectedStock=t.dataset.stock;render();return}if(t.dataset.interval){stockInterval=t.dataset.interval;render();return}const id=t.dataset.id,act=t.dataset.action;
if(act==='chart-fullscreen'){const el=$('proChart');if(el?.requestFullscreen)await el.requestFullscreen();return;}if(['buy','sell'].includes(act)){const quantity=Number($('qty_'+id)?.value);await post('order',{companyId:id,quantity,side:act});}
else if(act==='activate-boost'){const businessId=$('boost_'+id)?.value;if(businessId)await post('item-activate',{id,businessId});}
else if(act==='claim-mission')await post('mission',{kind:id});
else if(['business-upgrade','business-sell'].includes(act)){if(confirm('Confirm business action?'))await post(act,{id});}
else if(['business-buy','product-buy'].includes(act)){if(confirm('Confirm purchase?'))await post(act,{id});}
else if(['accept-trade','reject-trade'].includes(act))await post('trade-respond',{id,action:act==='accept-trade'?'accept':'reject'});
else if(act==='cancel-schedule')await post('admin',{action:'cancel-schedule',id});
else if(['freeze','unfreeze','archive-company'].includes(act)){if(confirm('Apply company control?'))await post('admin',{action:'company-control',id,mode:act==='archive-company'?'archive':act});}
else if(act==='edit-business'||act==='edit-product'){const list=act==='edit-business'?state.businessTypes:state.products;const x=list.find(y=>y.id===id);if(!x)return;const name=prompt('Name',x.name),price=prompt('Price',x.price);if(name===null||price===null)return;const payload={id,name,price:Number(price)};if(act==='edit-business'){payload.income=Number(prompt('Weekly income',x.income));payload.maintenance=Number(prompt('Weekly maintenance',x.maintenance));}else payload.stock=Number(prompt('Stock (-1 for unlimited)',x.stock));await post('admin',{action:act==='edit-business'?'business-type':'product',...payload});}
else if(act==='edit-company'){const c=co(id);const price=prompt('New price (FC)',c.price),supply=prompt('Available shares',c.supply);if(price!==null&&supply!==null)await post('admin',{action:'company',id,name:c.name,price:Number(price),supply:Number(supply)});}
else if(['approve-order','reject-order'].includes(act))await post('admin',{action:'review-order',id,decision:act.startsWith('approve')?'approve':'reject'});
else if(['approve-trade','reject-trade-admin'].includes(act))await post('admin',{action:'review-trade',id,decision:act.startsWith('approve')?'approve':'reject'});
else if(['archive-business','archive-product'].includes(act))await post('admin',{action:'archive-listing',id,kind:act==='archive-business'?'business':'product'});
});
document.addEventListener('input',ev=>{if(ev.target.id?.startsWith('qty_')){const c=co(selectedStock);if(c&&$('orderEstimate'))$('orderEstimate').textContent=fmt(Math.max(0,Number(ev.target.value)||0)*c.price)}});
document.addEventListener('submit',async ev=>{const f=ev.target;if(!f.id)return;const forms={companyForm:'company',scheduleForm:'schedule',cashForm:'cash',businessForm:'business-type',productForm:'product',settingsForm:'settings',tradeForm:'trade-offer'};if(!forms[f.id])return;ev.preventDefault();const b=Object.fromEntries(new FormData(f).entries());for(const k of ['price','supply','target','minutes','amount','income','maintenance','stock'])if(k in b)b[k]=Number(b[k]);if(f.id==='settingsForm')for(const k of ['enabled','marketOpen','approvalMode','autoMarket'])b[k]=!!f.elements[k].checked;if(f.id==='scheduleForm')b.startAt=new Date(b.startAt).toISOString();await post(forms[f.id],b)});
refresh();setInterval(refresh,12000);
})();
