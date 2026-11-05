(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let tracks = [], current = -1, loaded = false, busy = false;
  const audio = () => $('radioAudio');
  const fmt = n => { n = Math.max(0, Math.floor(Number(n)||0)); return Math.floor(n/60)+':'+String(n%60).padStart(2,'0'); };
  const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url, options={}) {
    const r = await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const d = await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Radio request failed'); return d;
  }
  function status(s){ if($('radioStatus')) $('radioStatus').textContent=s; }
  function drawWave(){ const w=$('radioWave'); if(!w||w.childElementCount)return; w.innerHTML=Array.from({length:48},(_,i)=>`<i style="--h:${18+((i*17+11)%68)}%"></i>`).join(''); }
  function render(){
    const list=$('radioTrackList'); if(!list)return;
    if(!tracks.length){list.innerHTML='<div class="radio-empty"><b>NO BROADCASTS YET</b><span>New FFGC2K26 voice broadcasts will appear here.</span></div>';return;}
    list.innerHTML=tracks.map((t,i)=>`<button class="radio-track ${i===current?'is-active':''}" data-radio-track="${i}" type="button"><span class="radio-track-index">${String(i+1).padStart(2,'0')}</span><span class="radio-track-copy"><b>${esc(t.title)}</b><small>${esc(t.description||'Official FFGC2K26 broadcast')}</small></span><span class="radio-track-duration">${fmt(t.duration)}</span><span class="radio-track-play">${i===current&&audio()?.paused===false?'Ⅱ':'▶'}</span></button>`).join('');
  }
  async function refresh(){
    if(!loaded && $('radioTrackList')) $('radioTrackList').innerHTML='<div class="radio-loading">Tuning into the arena…</div>';
    try{const d=await api('/api/radio/tracks');tracks=d.tracks||[];loaded=true;if(current>=tracks.length)current=-1;render();status(tracks.length?'Broadcast archive connected.':'No published broadcasts yet.');}
    catch(e){if($('radioTrackList'))$('radioTrackList').innerHTML=`<div class="radio-empty"><b>RADIO UNAVAILABLE</b><span>${esc(e.message)}</span></div>`;status(e.message);}
  }
  function setTrack(i,autoplay=true){
    if(!tracks.length)return; i=(i+tracks.length)%tracks.length; current=i; const t=tracks[i];
    $('radioCurrentTitle').textContent=t.title; $('radioCurrentDesc').textContent=t.description||'Official FFGC2K26 broadcast';
    audio().src=t.audioUrl; audio().playbackRate=Number($('radioSpeed')?.value||1); render();
    if(autoplay) audio().play().then(()=>{ $('radioPlay').textContent='Ⅱ';status('Now playing · '+t.title);api('/api/radio/play',{method:'POST',body:JSON.stringify({id:t.id})}).catch(()=>{});}).catch(()=>status('Tap play to start this broadcast.'));
    else {$('radioPlay').textContent='▶';status('Ready · '+t.title);}
  }
  function bind(){
    drawWave();
    $('radioTrackList')?.addEventListener('click',e=>{const b=e.target.closest('[data-radio-track]');if(b)setTrack(Number(b.dataset.radioTrack));});
    $('radioPlay')?.addEventListener('click',()=>{if(!audio().src){if(tracks.length)setTrack(0);return;}if(audio().paused)audio().play().then(()=>{$('radioPlay').textContent='Ⅱ';}).catch(()=>{});else audio().pause();});
    $('radioPrev')?.addEventListener('click',()=>setTrack(current-1)); $('radioNext')?.addEventListener('click',()=>setTrack(current+1));
    $('radioBack')?.addEventListener('click',()=>audio().currentTime=Math.max(0,audio().currentTime-10)); $('radioForward')?.addEventListener('click',()=>audio().currentTime=Math.min(audio().duration||0,audio().currentTime+10));
    $('radioSeek')?.addEventListener('input',e=>{if(audio().duration)audio().currentTime=audio().duration*(Number(e.target.value)/1000);});
    $('radioSpeed')?.addEventListener('change',e=>audio().playbackRate=Number(e.target.value)); $('radioVolume')?.addEventListener('input',e=>audio().volume=Number(e.target.value));
    audio()?.addEventListener('timeupdate',()=>{const a=audio();$('radioElapsed').textContent=fmt(a.currentTime);$('radioDuration').textContent=fmt(a.duration);$('radioSeek').value=a.duration?Math.round(a.currentTime/a.duration*1000):0;});
    audio()?.addEventListener('play',()=>{$('radioPlay').textContent='Ⅱ';render();}); audio()?.addEventListener('pause',()=>{$('radioPlay').textContent='▶';render();});
    audio()?.addEventListener('ended',()=>{if(current<tracks.length-1)setTrack(current+1);else status('Broadcast complete.');});
    $('radioRefresh')?.addEventListener('click',refresh);
    window.addEventListener('ffgc:route',e=>{if(e.detail==='radio')refresh();});
    document.addEventListener('DOMContentLoaded',()=>{if(location.hash==='#radio')refresh();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
