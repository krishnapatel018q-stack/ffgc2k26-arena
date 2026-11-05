(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let tracks = [], current = -1, loaded = false, busy = false, radioAuthorized = false;
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
  function radioContentVisible(visible){
    ['radioPlayerCard','radioLibraryHead','radioTrackList','radioFootnote'].forEach(id=>{const el=$(id);if(el)el.hidden=!visible;});
  }
  function showGate(message='Enter your FFGC2K26 Private ID to unlock the Radio.') {
    const station=$('radioStation'); if(!station)return;
    radioContentVisible(false);
    let gate=$('radioAccessGate');
    if(!gate){
      gate=document.createElement('section');gate.id='radioAccessGate';gate.className='radio-access-gate';
      gate.innerHTML=`<div class="radio-gate-mark">◉</div><p class="radio-gate-kicker">RESTRICTED MEMBER CHANNEL</p><h3>PRIVATE ACCESS REQUIRED</h3><p class="radio-gate-copy">FFGC2K26 Radio is exclusively available to the 16 members issued an official Private ID.</p><form id="radioAccessForm"><label for="radioPrivateId">YOUR PRIVATE ID</label><input id="radioPrivateId" name="privateId" type="password" autocomplete="current-password" placeholder="Enter your Private ID" required maxlength=100><button type="submit">VERIFY &amp; ENTER RADIO</button><p id="radioGateMessage" role="status"></p></form><small>UNAUTHORIZED ACCESS IS NOT PERMITTED.</small>`;
      station.insertBefore(gate,station.children[1]||null);
      $('radioAccessForm').addEventListener('submit',async e=>{
        e.preventDefault();const input=$('radioPrivateId'),btn=e.currentTarget.querySelector('button'),msg=$('radioGateMessage');
        const code=input.value.trim();if(!code)return;btn.disabled=true;btn.textContent='VERIFYING…';msg.textContent='Checking member credentials…';
        try{await api('/api/radio/access',{method:'POST',body:JSON.stringify({code})});radioAuthorized=true;gate.remove();radioContentVisible(true);await refresh();}
        catch(err){msg.textContent=err.message==='Invalid private member ID'?'Access denied. This Private ID is not authorized for FFGC2K26 Radio.':err.message;input.select();}
        finally{if(btn.isConnected){btn.disabled=false;btn.textContent='VERIFY & ENTER RADIO';}}
      });
    }
    const msg=$('radioGateMessage');if(msg)msg.textContent=message;
  }
  async function refresh(){
    if(!loaded && $('radioTrackList')) $('radioTrackList').innerHTML='<div class="radio-loading">Tuning into the arena…</div>';
    try{
      if(!radioAuthorized){const access=await api('/api/radio/access');if(!access.authorized){showGate();return;}radioAuthorized=true;}
      const gate=$('radioAccessGate');if(gate)gate.remove();radioContentVisible(true);
      const d=await api('/api/radio/tracks');tracks=d.tracks||[];loaded=true;if(current>=tracks.length)current=-1;render();status(tracks.length?'Broadcast archive connected.':'No published broadcasts yet.');
    } catch(e){
      if(e.message==='Radio Private ID required'){radioAuthorized=false;showGate();return;}
      if($('radioTrackList'))$('radioTrackList').innerHTML=`<div class="radio-empty"><b>RADIO UNAVAILABLE</b><span>${esc(e.message)}</span></div>`;status(e.message);
    }
  }
  function setTrack(i,autoplay=true){
    if(!tracks.length)return; i=(i+tracks.length)%tracks.length; current=i; const t=tracks[i];
    $('radioCurrentTitle').textContent=t.title; $('radioCurrentDesc').textContent=t.description||'Official FFGC2K26 broadcast';
    audio().pause(); audio().removeAttribute('src'); audio().load(); audio().src=t.audioUrl; audio().preload='metadata'; audio().playbackRate=Number($('radioSpeed')?.value||1); audio().load(); render();
    if(autoplay) audio().play().then(()=>{ $('radioPlay').textContent='Ⅱ';status('Now playing · '+t.title);api('/api/radio/play',{method:'POST',body:JSON.stringify({id:t.id})}).catch(()=>{});}).catch(err=>status('Playback failed: '+(err.message||'check audio format or storage access')));
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
    audio()?.addEventListener('loadedmetadata',()=>{const a=audio(),t=tracks[current];if(t&&Number.isFinite(a.duration)&&a.duration>0){t.duration=a.duration;render();api('/api/radio/duration',{method:'POST',body:JSON.stringify({id:t.id,duration:a.duration})}).catch(()=>{});} $('radioDuration').textContent=fmt(a.duration);});
    audio()?.addEventListener('timeupdate',()=>{const a=audio();$('radioElapsed').textContent=fmt(a.currentTime);$('radioDuration').textContent=fmt(a.duration);$('radioSeek').value=a.duration?Math.round(a.currentTime/a.duration*1000):0;});
    audio()?.addEventListener('error',()=>{const a=audio(),code=a.error?.code;status('Audio could not load (media error '+(code||'unknown')+'). Refresh the broadcast or re-upload as MP3/M4A.');});
    audio()?.addEventListener('canplay',()=>{if(current>=0)status('Audio ready · '+tracks[current].title);});
    audio()?.addEventListener('play',()=>{$('radioPlay').textContent='Ⅱ';render();}); audio()?.addEventListener('pause',()=>{$('radioPlay').textContent='▶';render();});
    audio()?.addEventListener('ended',()=>{if(current<tracks.length-1)setTrack(current+1);else status('Broadcast complete.');});
    $('radioRefresh')?.addEventListener('click',refresh);
    window.addEventListener('ffgc:route',e=>{if(e.detail==='radio')refresh();});
    document.addEventListener('DOMContentLoaded',()=>{if(location.hash==='#radio')refresh();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
