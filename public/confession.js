(()=>{
'use strict';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

let state = null;
let busy = false;
let lastError = '';

async function api(path, body) {
  const r = await fetch('/api/confession/' + path, {
    method: body ? 'POST' : 'GET',
    headers: {'Content-Type':'application/json'},
    credentials: 'same-origin',
    cache: 'no-store',
    body: body ? JSON.stringify(body) : undefined
  });

  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok) throw Error(d.error || 'Request failed (' + r.status + ')');
  return d;
}

function say(e) {
  alert(e.message || String(e));
}

function chatMarkup(room) {
  return `<div class="cf-chat" id="cfChat">
    ${(room.messages || []).map(m => `
      <article class="cf-msg ${m.name === 'FFGC' ? 'cf-official' : ''}">
        <b>${esc(m.name)}</b>
        ${m.text ? `<p>${esc(m.text)}</p>` : ''}
        ${m.media ? `<img loading="lazy"
          src="/api/confession/media?id=${encodeURIComponent(m.id)}"
          alt="Shared image">` : ''}
        <small>${new Date(m.at).toLocaleTimeString()}</small>
      </article>
    `).join('') || '<p class="muted">No messages yet. Start the conversation.</p>'}
  </div>`;
}

/* ADMIN PANEL */
function renderAdmin() {
  const box = $('confessionAdmin');
  if (!box) return;

  // IMPORTANT: Never replace the Admin Panel while the admin
  // is interacting with any control inside it.
  if (box.contains(document.activeElement)) return;

  // Preserve checked members and unsent message.
  const selectedIds = [
    ...box.querySelectorAll('.cf-member-pick input[name="memberId"]:checked')
  ].map(x => x.value);

  const oldMessage = $('cfAdminSend')?.elements?.text?.value || '';

  if (!state) {
    box.innerHTML = `
      <div class="cf-card">
        <b>Confession Room Controls</b>
        <p class="cf-muted">${esc(lastError || 'Connecting...')}</p>
        <button type="button" id="cfRetry">Retry</button>
      </div>`;
    $('cfRetry')?.addEventListener('click', refresh);
    return;
  }

  if (!state.admin) {
    box.innerHTML = `
      <div class="cf-card">
        <b>God Admin access required</b>
        <p class="cf-muted">God Admin account se login karke refresh karein.</p>
        <button type="button" id="cfRetry">Refresh Status</button>
      </div>`;
    $('cfRetry')?.addEventListener('click', refresh);
    return;
  }

  const room = state.room;
  const members = state.members || [];
  let html = '';

  if (!room) {
    html = `
      <div class="cf-card cf-create-card">
        <div class="cf-head">
          <b>Create Confession Room</b>
          <span>GOD ADMIN</span>
        </div>

        <p>Select invited members for this private session.</p>

        <div class="cf-member-pick">
          ${members.map(m => `
            <label>
              <input type="checkbox"
                name="memberId"
                value="${esc(m.id)}">
              ${esc(m.name)}
            </label>
          `).join('') || '<p class="cf-muted">No members available.</p>'}
        </div>

        <form id="cfCreate">
          <button type="submit">＋ Create Confession Room</button>
        </form>
      </div>`;
  } else {
    html = `
      <div class="cf-card">
        <div class="cf-head">
          <b>Active Session Controls</b>
          <span class="cf-live">LIVE</span>
        </div>

        <div class="cf-admin-list">
          ${room.participants.map(p => `
            <div class="cf-admin-person">
              <b>${esc(p.name)}</b>
              <small>
                ${p.verified ? 'Verified' : 'Not entered'}
                ${p.removed ? ' · Removed' : ''}
              </small>

              <div class="cf-actions">
                <button type="button"
                  data-cf="mute"
                  data-id="${esc(p.id)}"
                  data-value="${!p.muted}"
                  ${p.removed ? 'disabled' : ''}>
                  ${p.muted ? 'Unmute' : 'Mute'}
                </button>

                <button type="button"
                  data-cf="media"
                  data-id="${esc(p.id)}"
                  data-value="${!p.mediaAllowed}"
                  ${p.removed ? 'disabled' : ''}>
                  ${p.mediaAllowed ? 'Disable Media' : 'Allow Media'}
                </button>

                <button type="button"
                  class="cf-danger"
                  data-cf="remove"
                  data-id="${esc(p.id)}"
                  ${p.removed ? 'disabled' : ''}>
                  Remove
                </button>
              </div>
            </div>
          `).join('')}
        </div>

        <form id="cfAdminSend" class="cf-send">
          <input name="text"
            maxlength="1500"
            placeholder="Send message as FFGC"
            required>
          <button type="submit">Send as FFGC</button>
        </form>

        <form id="cfAdminMedia" class="cf-send">
          <input type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            required>
          <button type="submit">Send Photo as FFGC</button>
        </form>

        <div class="cf-admin-chat">
          ${chatMarkup(room)}
        </div>

        <button type="button"
          class="cf-danger"
          id="cfClose">
          Close Room &amp; Delete Chat
        </button>
      </div>`;
  }

  box.innerHTML = html;

  // Restore selected checkboxes after rendering.
  selectedIds.forEach(id => {
    const cb = [...box.querySelectorAll(
      '.cf-member-pick input[name="memberId"]'
    )].find(x => x.value === id);

    if (cb) cb.checked = true;
  });

  if ($('cfAdminSend')?.elements?.text) {
    $('cfAdminSend').elements.text.value = oldMessage;
  }

  /* CREATE ROOM */
  const create = $('cfCreate');

  if (create) {
    create.onsubmit = async e => {
      e.preventDefault();

      const ids = [
        ...box.querySelectorAll(
          '.cf-member-pick input[name="memberId"]:checked'
        )
      ].map(x => x.value);

      if (!ids.length) {
        alert('At least one member select karo.');
        return;
      }

      // Release focus before refreshing the panel.
      document.activeElement?.blur();

      try {
        await api('admin', {
          action: 'create',
          memberIds: ids
        });
        await refresh();
      } catch (err) {
        say(err);
      }
    };
  }

  /* ADMIN TEXT MESSAGE */
  const af = $('cfAdminSend');

  if (af) {
    af.onsubmit = async e => {
      e.preventDefault();

      const message = af.elements.text.value.trim();
      if (!message) return;

      document.activeElement?.blur();

      try {
        await api('admin-message', {text: message});
        // Clear the sent text before the refresh renderer preserves the draft.
        af.elements.text.value = '';
        await refresh();
      } catch (err) {
        say(err);
      }
    };
  }

  /* ADMIN IMAGE */
  const adminMedia = $('cfAdminMedia');

  if (adminMedia) {
    adminMedia.onsubmit = async e => {
      e.preventDefault();

      const f = adminMedia.elements.file.files[0];
      if (!f) return;

      if (f.size > 7 * 1024 * 1024) {
        alert('Maximum image size is 7 MB');
        return;
      }

      document.activeElement?.blur();

      const reader = new FileReader();

      reader.onload = async () => {
        try {
          await api('media', {
            data: reader.result,
            name: f.name
          });
          await refresh();
        } catch (err) {
          say(err);
        }
      };

      reader.readAsDataURL(f);
    };
  }

  /* CLOSE ROOM */
  const close = $('cfClose');

  if (close) {
    close.onclick = async () => {
      if (!confirm(
        'Close this session and permanently delete its chat and uploaded images?'
      )) return;

      close.blur();

      try {
        await api('admin', {action:'close'});
        await refresh();
      } catch (err) {
        say(err);
      }
    };
  }

  /* MUTE / MEDIA / REMOVE */
  box.querySelectorAll('[data-cf]').forEach(btn => {
    btn.onclick = async () => {
      const action = btn.dataset.cf;
      const memberId = btn.dataset.id;
      const value = btn.dataset.value === 'true';

      btn.blur();

      try {
        await api('admin', {
          action,
          memberId,
          value
        });
        await refresh();
      } catch (err) {
        say(err);
      }
    };
  });

  const chat = box.querySelector('#cfChat');
  if (chat) chat.scrollTop = chat.scrollHeight;
}

/* MEMBER PANEL */
function renderMember() {
  const publicBox = $('confessionPublic');
  const privateBox = $('confessionPrivate');

  if (!publicBox || !privateBox || !state) return;

  const room = state.room;

  if (!room) {
    publicBox.innerHTML =
      '<div class="cf-empty">The Confession Room is currently closed.</div>';
    privateBox.innerHTML = '';
    return;
  }

  publicBox.innerHTML = `
    <div class="cf-banner">
      <span>● LIVE SESSION</span>
      <h3>FFGC CONFESSION ROOM</h3>
      <p>${room.participants.map(p => esc(p.name)).join(' · ')}</p>
    </div>`;

  // Do not interrupt a member while typing or selecting a file.
  const active = document.activeElement;
  const preserveInput = active &&
    ['INPUT','TEXTAREA','SELECT'].includes(active.tagName) &&
    active.closest('#confessionRoom');

  if (preserveInput) return;

  if (room.removed) {
    privateBox.innerHTML =
      '<div class="cf-empty">Your access has been removed by FFGC.</div>';
  } else if (!room.canEnter) {
    privateBox.innerHTML =
      '<div class="cf-empty">This room is invite-only.</div>';
  } else if (!room.verified) {
    privateBox.innerHTML = `
      <form id="cfVerify" class="cf-card">
        <h3>🔐 Verify Your Entry</h3>
        <p>Enter your Private ID to enter this invited session.</p>
        <input name="privateId"
          type="password"
          autocomplete="off"
          placeholder="Your Private ID"
          required>
        <button type="submit">Verify &amp; Enter</button>
      </form>`;
  } else {
    const me = room.participants.find(p => p.isMe);

    privateBox.innerHTML = `
      <div class="cf-card">
        <div class="cf-head">
          <b>Private Live Conversation</b>
          <span>${me?.muted ? 'Muted by FFGC' : 'Connected'}</span>
        </div>

        ${chatMarkup(room)}

        ${me?.muted
          ? '<p class="cf-muted">You are muted. You can still read messages.</p>'
          : `<form id="cfSend" class="cf-send">
               <input name="text"
                 maxlength="1500"
                 placeholder="Write a message..."
                 required>
               <button type="submit">Send</button>
             </form>`}

        ${!me?.muted && me?.mediaAllowed
          ? `<form id="cfMedia" class="cf-send">
               <input type="file"
                 name="file"
                 accept="image/jpeg,image/png,image/webp,image/gif"
                 required>
               <button type="submit">Send Photo</button>
             </form>`
          : '<p class="cf-muted">Photo sharing is currently disabled by FFGC.</p>'}
      </div>`;
  }

  const verify = $('cfVerify');

  if (verify) {
    verify.onsubmit = async e => {
      e.preventDefault();

      const privateId = verify.elements.privateId.value;
      document.activeElement?.blur();

      try {
        await api('enter', {privateId});
        await refresh();
      } catch (err) {
        say(err);
      }
    };
  }

  const send = $('cfSend');

  if (send) {
    send.onsubmit = async e => {
      e.preventDefault();

      const message = send.elements.text.value.trim();
      if (!message) return;

      document.activeElement?.blur();

      try {
        await api('message', {text:message});
        await refresh();
      } catch (err) {
        say(err);
      }
    };
  }

  const media = $('cfMedia');

  if (media) {
    media.onsubmit = async e => {
      e.preventDefault();

      const f = media.elements.file.files[0];
      if (!f) return;

      if (f.size > 7 * 1024 * 1024) {
        alert('Maximum image size is 7 MB');
        return;
      }

      document.activeElement?.blur();

      const reader = new FileReader();

      reader.onload = async () => {
        try {
          await api('media', {
            data: reader.result,
            name: f.name
          });
          await refresh();
        } catch (err) {
          say(err);
        }
      };

      reader.readAsDataURL(f);
    };
  }

  const chat = $('cfChat');
  if (chat) chat.scrollTop = chat.scrollHeight;
}

/* REFRESH */
function render() {
  renderMember();
  renderAdmin();
}

async function refresh() {
  if (busy) return;

  busy = true;

  try {
    state = await api('state');
    lastError = '';
    render();
  } catch (e) {
    lastError = e.message || 'Unable to load Confession Room';
    state = null;
    renderAdmin();
    console.warn('Confession Room:', lastError);
  } finally {
    busy = false;
  }
}

refresh();
setInterval(refresh, 2500);

})();
