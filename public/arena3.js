(()=>{
const $=s=>document.querySelector(s);
const routes=['arenaHome','leaderboard','teams','tasks','polls','announcements','spotlightSection','myProfile','supportMember','admin'];
let active='arenaHome';
function showRoute(){
 let hash=decodeURIComponent(location.hash.slice(1));
 if(!routes.includes(hash))hash='arenaHome';
 active=hash;
 document.body.classList.add('arena3-enabled');
 document.body.dataset.arenaRoute=hash;
 routes.forEach(id=>{let el=document.getElementById(id);if(!el)return;el.classList.toggle('arena3-inactive',id!==hash);});
 // Public sections share a wrapper, so keep it visible for their routes.
 const pub=$('#publicContent');if(pub)pub.classList.toggle('arena3-inactive',!['leaderboard','teams','tasks','polls','announcements'].includes(hash));
 // Respect existing app.js hidden access state (e.g. support and admin).
 const target=document.getElementById(hash);
 if(target && target.classList.contains('hidden') && hash==='supportMember')location.hash='myProfile';
 document.querySelectorAll('header nav a,.mobileDock a').forEach(a=>a.classList.toggle('selected',a.getAttribute('href')==='#'+hash));
 if(hash!=='arenaHome')window.scrollTo({top:0,behavior:'instant'});
}
window.addEventListener('hashchange',showRoute);
// Existing adminBtn handler opens #admin but might not change hash: ensure route follows it.
const adminBtn=$('#adminBtn');if(adminBtn)adminBtn.addEventListener('click',()=>{location.hash='admin';}, {capture:false});
const hq=$('#hqRooms');
function setRoom(room){
 document.querySelectorAll('#dashboard [data-hq-room]').forEach(el=>el.classList.toggle('hq-inactive',el.dataset.hqRoom!==room));
 hq?.querySelectorAll('button').forEach(b=>{b.classList.toggle('active',b.dataset.room===room);b.setAttribute('aria-pressed',String(b.dataset.room===room));});
}
hq?.addEventListener('click',e=>{const b=e.target.closest('button[data-room]');if(b)setRoom(b.dataset.room)});
setRoom('overview');showRoute();
})();
