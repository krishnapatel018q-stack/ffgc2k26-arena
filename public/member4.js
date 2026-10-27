(()=>{
'use strict';
const routes=[
 ['home','⌂','Home',[]],
 ['leaderboard','♛','Ranks',['leaderboard','teams']],
 ['events','⚔','Events',['tasks','polls','eliminationArena','decisionChamber']],
 ['empire','◈','Empire',[]],
 ['auction','◆','Auctions',['auctionHouse']],
 ['spotlight','✦','Spotlight',['spotlightSection']],
 ['news','▤','News',['announcements']],
 ['profile','◉','Profile',['myProfile','supportMember']]
];
let active='home';
const byId=id=>document.getElementById(id);
function create(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e}
function navigate(route,{scroll=true}={}){
 if(route==='empire'){byId('openEconomicEmpire')?.click();return}
 if(!routes.some(r=>r[0]===route))route='home';
 active=route;
 const all=new Set(routes.flatMap(r=>r[3]));
 for(const id of all){const el=byId(id);if(el)el.classList.toggle('member-inactive',!(route!=='home'&&routes.find(r=>r[0]===route)?.[3].includes(id)))}
 const hero=document.querySelector('main > .hero');if(hero)hero.classList.toggle('member-inactive',route!=='home');
 const home=byId('memberHome');if(home)home.classList.toggle('member-inactive',route!=='home');
 const spotlight=byId('spotlightSection');
 if(spotlight&&route==='home')spotlight.classList.remove('member-inactive');
 document.querySelectorAll('[data-member-route]').forEach(e=>{const selected=e.dataset.memberRoute===route;e.classList.toggle('selected',selected);if(e.tagName==='BUTTON')e.setAttribute('aria-current',selected?'page':'false')});
 const title=byId('memberPageTitle');if(title)title.textContent=routes.find(r=>r[0]===route)[2];
 const heading=byId('memberSectionIntro');if(heading){heading.hidden=route==='home';heading.querySelector('h1').textContent=({leaderboard:'The Rankings',events:'Competition Arena',auction:'Auction House',spotlight:'Hall of Spotlight',news:'Official Updates',profile:'My Arena Profile'})[route]||'Arena';heading.querySelector('p').textContent=({leaderboard:'Every point matters. Every rank is earned.',events:'Challenges, voting and elimination — all in one place.',auction:'Bid smart. Win exclusive rewards.',spotlight:'Where champions become legends.',news:'Stay updated with the latest arena announcements.',profile:'Your personal identity and support center.'})[route]||''}
 if(scroll)window.scrollTo({top:0,behavior:'smooth'});
 try{history.replaceState(null,'',route==='home'?location.pathname:'#'+route)}catch{}
}
function init(){
 if(byId('memberAppShell'))return;
 const main=document.querySelector('main'),hero=main?.querySelector(':scope > .hero');if(!main||!hero)return;
 document.body.classList.add('member-4');
 const shell=create('div','member-app-shell');shell.id='memberAppShell';
 const side=create('aside','member-side');side.innerHTML='<div class="member-brand">✦ FFGC<span>2K26</span><small>THE OFFICIAL ARENA</small></div><div class="member-side-label">EXPLORE ARENA</div>';
 const links=create('div','member-side-links');
 const top=create('div','member-top');top.innerHTML='<div><small>✦ OBSIDIAN ROYALE 4.0</small><strong id="memberPageTitle">Home</strong></div><div class="member-top-status"><i></i> ARENA LIVE</div>';
 const content=create('div','member-content');
 const intro=create('div','member-intro');intro.id='memberSectionIntro';intro.hidden=true;intro.innerHTML='<small>FFGC2K26 / MEMBER ARENA</small><h1></h1><p></p>';
 const home=create('section','member-home');home.id='memberHome';home.innerHTML='<div class="member-welcome"><span class="member-kicker">✦ WELCOME TO THE NEXT ERA</span><h2>YOUR ARENA.<br><em>YOUR LEGACY.</em></h2><p>Rise through the rankings, compete in events, and build your legacy in FFGC2K26.</p><div class="member-welcome-actions"><button data-member-route="leaderboard">Explore Rankings ↗</button><button data-member-route="events">Enter Events →</button></div></div><div class="member-home-heading"><small>QUICK ACCESS</small><h3>Explore the Arena</h3></div><div class="member-quick-grid"></div>';
 const bottom=create('nav','member-bottom');bottom.setAttribute('aria-label','Member navigation');
 for(const [key,icon,label] of routes){
  const button=create('button','member-nav-item');button.type='button';button.dataset.memberRoute=key;button.innerHTML='<span>'+icon+'</span><span>'+label+'</span>';links.append(button);
  if(key!=='home'){const tile=create('button','member-quick-tile');tile.type='button';tile.dataset.memberRoute=key;tile.innerHTML='<span class="member-tile-icon">'+icon+'</span><strong>'+label+'</strong><small>Explore ↗</small>';home.querySelector('.member-quick-grid').append(tile)}
  if(['home','leaderboard','events','auction','profile'].includes(key)){const b=create('button','member-bottom-item');b.type='button';b.dataset.memberRoute=key;b.innerHTML='<span>'+icon+'</span><small>'+label+'</small>';bottom.append(b)}
 }
 side.append(links);
 main.parentNode.insertBefore(shell,main);
 shell.append(side,content);content.append(top,intro,home);
 content.append(main);document.body.append(bottom);
 // Keep the original elements and IDs: original event handlers, polls, and profiles still target them.
 const mainChildren=[...main.children];
 const admin=byId('admin');if(admin){admin.classList.add('member-admin-area');}
 const spotlight=byId('spotlightSection');
 if(spotlight)home.after(spotlight);
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-member-route]');
  if(b){e.preventDefault();navigate(b.dataset.memberRoute);return}
  const a=e.target.closest('a[href^="#"]');
  if(a){const id=a.getAttribute('href').slice(1);const map={leaderboard:'leaderboard',teams:'leaderboard',tasks:'events',polls:'events',announcements:'news',myProfile:'profile',auctionHouse:'auction',eliminationArena:'events',spotlightSection:'spotlight'};
   if(map[id]){e.preventDefault();navigate(map[id]);const target=byId(id);if(target)target.scrollIntoView({behavior:'smooth',block:'start'})}}
 });
 // Original admin button toggles admin visibility and scrolls to it; do not intercept.
 const current=(location.hash||'').slice(1);const hashMap={tasks:'events',polls:'events',teams:'leaderboard',announcements:'news',myProfile:'profile',auctionHouse:'auction',eliminationArena:'events',spotlightSection:'spotlight'};
 navigate(hashMap[current]||current||'home',{scroll:false});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
