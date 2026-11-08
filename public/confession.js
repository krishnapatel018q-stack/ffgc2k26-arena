(() => {
  const $ = id => document.getElementById(id);
  const page = location.pathname.endsWith('confession-room.html');
  const api = async (path, data) => {
    const r = await fetch('/api/confession/' + path, {
      method: data ? 'POST' : 'GET', headers: data ? {'Content-Type':'application/json'} : {},
      body: data ? JSON.stringify(data) : undefined, cache:'no-store'
    });
    const type = r.headers.get('content-type') || '';
    if (!r.ok) { let msg='Request failed'; if(type.includes('json')) msg=(await r.json()).error||msg; throw Error(msg); }
    return type.includes('json') ? r.json() : r.blob();
  };
  const status = msg => { if ($('status')) $('status').textContent=msg; };
  let current=null, lastPlayed=new Set(), firstMemberMessageLoad=true, lastSignal=0, pc=null, localStream=null, remoteQueue=[], pollTimer=null, mediaRecorder=null, voiceChunks=[], voiceBlob=null;
  let rtcConfig={iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]};

  function renderMessages(target, messages, isMember) {
    if (!target) return;
    target.innerHTML='';
    const list=messages||[];
    if(isMember && firstMemberMessageLoad){list.slice(0,-1).forEach(m=>lastPlayed.add(m.id));firstMemberMessageLoad=false;}
    list.forEach(m=>{
      const d=document.createElement('div'); d.className='bubble '+(m.from==='admin'?'admin':'member');
      const label=document.createElement('small'); label.textContent=m.from==='admin'?'GOD ADMIN · VIRAJ':'MEMBER REPLY';
      const text=document.createElement('div'); text.textContent=m.text;
      d.append(label,text); target.append(d);
      if(isMember && m.from==='admin' && m.audioId && !lastPlayed.has(m.id)) {
        lastPlayed.add(m.id); playAudio(m.audioId,'memberTtsAudio').catch(()=>{lastPlayed.delete(m.id);status('Tap “Enable Viraj Voice” to hear the message.');});
      }
    });
    target.scrollTop=target.scrollHeight;
  }
  async function playAudio(id, elementId) {
    const blob=await api('audio?id='+encodeURIComponent(id));
    const url=URL.createObjectURL(blob), audio=$(elementId);
    if(audio){audio.src=url; await audio.play();}
  }
  function cleanupPeer(){ if(pollTimer)clearInterval(pollTimer);pollTimer=null;if(pc){pc.close();pc=null;}if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}const a=$('memberRemoteAudio');if(a)a.srcObject=null;const b=$('adminRemoteAudio');if(b)b.srcObject=null; }
  async function sendSignal(type,data){await api('signal',{type,data});}
  async function handleSignals(isAdmin){
    try {
      const result=await api('signal?after='+lastSignal);
      for(const sig of result.signals||[]){lastSignal=Math.max(lastSignal,sig.seq);
        if(sig.type==='offer'&&!isAdmin){
          if(!pc) await makeMemberPeer();
          await pc.setRemoteDescription(sig.data);
          for(const c of remoteQueue) await pc.addIceCandidate(c).catch(()=>{}); remoteQueue=[];
          const answer=await pc.createAnswer(); await pc.setLocalDescription(answer); await sendSignal('answer',pc.localDescription);
        } else if(sig.type==='answer'&&isAdmin&&pc){
          await pc.setRemoteDescription(sig.data);
          for(const c of remoteQueue) await pc.addIceCandidate(c).catch(()=>{}); remoteQueue=[];
        } else if(sig.type==='candidate'&&pc){
          const candidate=new RTCIceCandidate(sig.data);
          if(pc.remoteDescription) await pc.addIceCandidate(candidate).catch(()=>{}); else remoteQueue.push(candidate);
        }
      }
    } catch(e) { /* short polling tolerates temporary network failures */ }
  }
  async function makeAdminPeer(){
    cleanupPeer();lastSignal=0;pc=new RTCPeerConnection(rtcConfig);
    pc.addTransceiver('audio',{direction:'recvonly'});
    pc.ontrack=e=>{const a=$('adminRemoteAudio');if(a)a.srcObject=e.streams[0];};
    pc.onicecandidate=e=>{if(e.candidate)sendSignal('candidate',e.candidate.toJSON()).catch(()=>{});};
    const offer=await pc.createOffer();await pc.setLocalDescription(offer);await sendSignal('offer',pc.localDescription);
    pollTimer=setInterval(()=>handleSignals(true),1200);
    $('liveAdminState').textContent='Offer sent. Waiting for the member to allow microphone access…';
  }
  async function makeMemberPeer(){
    localStream=await navigator.mediaDevices.getUserMedia({audio:true});
    pc=new RTCPeerConnection(rtcConfig);localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
    pc.ontrack=e=>{const a=$('memberRemoteAudio');if(a)a.srcObject=e.streams[0];};
    pc.onicecandidate=e=>{if(e.candidate)sendSignal('candidate',e.candidate.toJSON()).catch(()=>{});};
    $('memberLiveState').textContent='Microphone connected. Waiting for GOD ADMIN audio…';
  }

  async function loadAdmin(data){
    $('adminView').classList.remove('hidden');$('memberView').classList.add('hidden');$('noInvite').classList.add('hidden');
    const sel=$('memberSelect'), old=sel.value;sel.innerHTML='<option value="">Select a member…</option>';
    data.members.forEach(m=>{const o=document.createElement('option');o.value=m.id;o.textContent=m.name;sel.append(o);});if(old)sel.value=old;
    const recent=$('recentSessions');recent.innerHTML='';
    (data.recent||[]).forEach(x=>{const d=document.createElement('div');d.className='recentitem';const a=document.createElement('span');a.textContent=x.memberName+' · '+x.mode.toUpperCase();const b=document.createElement('small');b.textContent=x.status+' · '+new Date(x.createdAt).toLocaleString();d.append(a,b);recent.append(d);});
    current=data.session;
    $('adminSession').classList.toggle('hidden',!current);
    if(!current){cleanupPeer();return;}
    $('sessionTitle').textContent='Session with '+current.memberName;
    $('sessionTag').textContent=current.status.toUpperCase();$('sessionTag').classList.toggle('live',current.status==='active');
    $('sessionMeta').textContent='Mode: '+current.mode.toUpperCase()+' · '+(current.status==='scheduled'?'Scheduled: ':'Started: ')+new Date(current.scheduledAt).toLocaleString();
    renderMessages($('adminMessages'),current.messages,false);
    $('sendArea').classList.toggle('hidden',current.status!=='active');$('sendSpeak').disabled=current.status!=='active';
    $('liveAdmin').classList.toggle('hidden',current.mode!=='live'||current.status!=='active');
    $('voiceClips').innerHTML='';
    (current.voiceClips||[]).forEach((v,i)=>{const box=document.createElement('div');box.className='clip';const small=document.createElement('small');small.textContent='MEMBER VOICE NOTE '+(i+1)+' · '+new Date(v.at).toLocaleString();const audio=document.createElement('audio');audio.controls=true;audio.src='/api/confession/audio?id='+encodeURIComponent(v.id);box.append(small,audio);$('voiceClips').append(box);});
  }
  async function loadMember(data){
    $('adminView').classList.add('hidden');
    if(!data.invited||!data.session){cleanupPeer();current=null;$('memberView').classList.add('hidden');$('noInvite').classList.remove('hidden');return;}
    $('noInvite').classList.add('hidden');$('memberView').classList.remove('hidden');current=data.session;
    $('memberTitle').textContent='Your Confession Room';$('memberTag').textContent=current.status.toUpperCase();
    $('memberMeta').textContent='Session mode: '+current.mode.toUpperCase()+' · '+(current.status==='scheduled'?'Reporting time: ':'Session opened: ')+new Date(current.scheduledAt).toLocaleString();
    const waiting=current.status==='scheduled';$('memberWaiting').classList.toggle('hidden',!waiting);
    $('memberTextArea').classList.toggle('hidden',waiting||current.mode!=='text');$('memberVoiceArea').classList.toggle('hidden',waiting||current.mode!=='voice');$('memberLive').classList.toggle('hidden',waiting||current.mode!=='live');
    $('memberTag').textContent=waiting?'SCHEDULED':'INVITED';
    renderMessages($('memberMessages'),current.messages,true);
  }
  async function refresh(){
    try{const data=await api('state');status(data.admin?'GOD ADMIN authenticated.':'Private access verified.');
      if(page){if(data.admin)await loadAdmin(data);else await loadMember(data);}
      else if(data.invited){let btn=$('confessionInvite');if(!btn){btn=document.createElement('a');btn.id='confessionInvite';btn.href='/confession-room.html';btn.textContent='🎙️ Enter Confession Room';btn.style.cssText='position:fixed;right:14px;bottom:18px;z-index:99999;background:#e8c777;color:#101421;padding:13px 16px;border-radius:12px;text-decoration:none;font-weight:900;box-shadow:0 8px 30px #0008';document.body.append(btn);}}
      else $('confessionInvite')?.remove();
    }catch(e){if(page){status(e.message);$('adminView')?.classList.add('hidden');$('memberView')?.classList.add('hidden');$('noInvite')?.classList.remove('hidden');}}
  }

  if(page){
    $('summonNow').onclick=async()=>{try{await api('admin',{action:'summon',memberId:$('memberSelect').value,mode:$('modeSelect').value});status('Member summoned.');await refresh();}catch(e){status(e.message);}};
    $('scheduleBtn').onclick=async()=>{try{await api('admin',{action:'schedule',memberId:$('memberSelect').value,mode:$('modeSelect').value,scheduledAt:$('scheduleAt').value?new Date($('scheduleAt').value).toISOString():''});status('Summon scheduled.');await refresh();}catch(e){status(e.message);}};
    $('closeSession').onclick=async()=>{if(!confirm('End this private session now?'))return;try{cleanupPeer();await api('admin',{action:'close'});status('Session ended.');await refresh();}catch(e){status(e.message);}};
    $('refreshAdmin').onclick=refresh;
    $('sendSpeak').onclick=async()=>{const text=$('adminText').value.trim();if(!text)return;try{$('sendSpeak').disabled=true;await api('admin',{action:'send',text});$('adminText').value='';status('Message sent. Viraj voice delivered to the invited member.');await refresh();}catch(e){status(e.message);}finally{$('sendSpeak').disabled=false;}};
    $('connectLive').onclick=async()=>{try{await makeAdminPeer();}catch(e){$('liveAdminState').textContent=e.message;}};
    refresh();setInterval(refresh,3500);
  }else{
    refresh();setInterval(refresh,4000);
  }

  window.addEventListener('pagehide',cleanupPeer);
  if($('enableTts'))$('enableTts').onclick=async()=>{try{const a=new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==');await a.play();a.pause();$('enableTts').textContent='✓ Viraj Voice Enabled';status('Viraj voice audio is enabled on this device.');}catch(e){status('Could not enable audio playback: '+e.message);}};
  if($('sendReply'))$('sendReply').onclick=async()=>{try{await api('reply',{text:$('memberText').value});$('memberText').value='';await refresh();}catch(e){status(e.message);}};
  if($('joinLive'))$('joinLive').onclick=async()=>{try{$('joinLive').disabled=true;await makeMemberPeer();$('joinLive').textContent='Microphone enabled';pollTimer=setInterval(()=>handleSignals(false),1200);}catch(e){$('memberLiveState').textContent='Microphone permission or connection failed: '+e.message;$('joinLive').disabled=false;}};
  if($('recordVoice'))$('recordVoice').onclick=async()=>{
    try{
      if(mediaRecorder&&mediaRecorder.state==='recording'){mediaRecorder.stop();$('recordVoice').textContent='● Start recording';return;}
      if(!$('voiceConsent').checked){$('recordState').textContent='Please confirm consent before recording.';return;}
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});voiceChunks=[];mediaRecorder=new MediaRecorder(stream);
      mediaRecorder.ondataavailable=e=>{if(e.data.size)voiceChunks.push(e.data);};
      mediaRecorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());voiceBlob=new Blob(voiceChunks,{type:mediaRecorder.mimeType||'audio/webm'});$('voicePreview').src=URL.createObjectURL(voiceBlob);$('voicePreview').classList.remove('hidden');$('sendVoice').disabled=false;$('recordState').textContent='Recording ready. Preview it, then send.';};
      mediaRecorder.start();$('recordVoice').textContent='■ Stop recording';$('recordState').textContent='Recording…';
    }catch(e){$('recordState').textContent='Microphone unavailable: '+e.message;}
  };
  if($('sendVoice'))$('sendVoice').onclick=async()=>{if(!voiceBlob||!$('voiceConsent').checked)return;try{$('sendVoice').disabled=true;const reader=new FileReader();reader.onload=async()=>{try{const dataUrl=String(reader.result).replace(/^data:audio\/[^;,]+(?:;codecs=[^;,]+)?;base64,/, 'data:'+voiceBlob.type.split(';')[0]+';base64,');await api('voice',{consent:true,audio:dataUrl});$('recordState').textContent='Voice note sent securely to GOD ADMIN.';voiceBlob=null;$('voiceConsent').checked=false;$('voicePreview').classList.add('hidden');}catch(e){$('recordState').textContent=e.message;$('sendVoice').disabled=false;}};reader.readAsDataURL(voiceBlob);}catch(e){$('recordState').textContent=e.message;$('sendVoice').disabled=false;}};
})();
