// JARVIS Mobile · app logic. Pure vanilla JS, no build step.
// Features:
//   - Tabs (home/control/settings/logs)
//   - Discovery beacon : broadcasts identification via HTTP server (on a local port)
//   - Control commands : receives instructions from Windows Jarvis
//   - Permissions request (notifs, location, mic)
//   - Persistent settings via Capacitor Preferences

const { Capacitor, Plugins } = window.Capacitor || { Capacitor: {}, Plugins: {} };
const { Device, Preferences, LocalNotifications, Geolocation, Network, Share, App } = Plugins;

const state = {
  tab: 'home',
  device: null,
  pairingCode: '',
  jarvisOsUrl: '',
  jarvisOsToken: '',
  connected: false,
  controlLog: [],
  lastPing: null,
};

const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const t = new Date().toLocaleTimeString();
  state.controlLog.unshift(`[${t}] ${msg}`);
  state.controlLog = state.controlLog.slice(0, 100);
  if (state.tab === 'logs') render();
};

async function loadSettings() {
  try {
    const url = await Preferences.get({ key: 'jarvisOsUrl' });
    const tok = await Preferences.get({ key: 'jarvisOsToken' });
    const code = await Preferences.get({ key: 'pairingCode' });
    state.jarvisOsUrl = url?.value || '';
    state.jarvisOsToken = tok?.value || '';
    state.pairingCode = code?.value || Math.random().toString(36).slice(2, 8).toUpperCase();
    if (!code?.value) await Preferences.set({ key: 'pairingCode', value: state.pairingCode });
  } catch {}
}

async function saveSettings() {
  try {
    await Preferences.set({ key: 'jarvisOsUrl', value: state.jarvisOsUrl });
    await Preferences.set({ key: 'jarvisOsToken', value: state.jarvisOsToken });
  } catch {}
}

async function getDeviceInfo() {
  try {
    state.device = await Device.getInfo();
    log(`Device: ${state.device.model} · ${state.device.osVersion}`);
  } catch (e) { log('Device info err: ' + e.message); }
}

// ─── Discovery & registration with the central Jarvis OS (VPS) ──────────────
async function registerWithVps() {
  if (!state.jarvisOsUrl || !state.jarvisOsToken) {
    log('VPS non configuré — skip register');
    return;
  }
  try {
    const r = await fetch(state.jarvisOsUrl.replace(/\/+$/, '') + '/api/phones/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.jarvisOsToken },
      body: JSON.stringify({
        model: state.device?.model || 'unknown',
        platform: state.device?.platform || 'android',
        osVersion: state.device?.osVersion || '',
        pairingCode: state.pairingCode,
        timestamp: Date.now(),
      }),
    });
    state.connected = r.ok;
    state.lastPing = Date.now();
    log(`Register VPS: HTTP ${r.status}`);
    $('status').textContent = state.connected ? 'CONNECTÉ' : 'ERREUR';
    $('status').className = 'status-pill ' + (state.connected ? 'ok' : 'bad');
  } catch (e) {
    state.connected = false;
    log('Register err: ' + e.message);
    $('status').textContent = 'HORS LIGNE';
    $('status').className = 'status-pill bad';
  }
}

// ─── Poll VPS for control commands ──────────────────────────────────────────
async function pollCommands() {
  if (!state.connected || !state.jarvisOsUrl) return;
  try {
    const r = await fetch(state.jarvisOsUrl.replace(/\/+$/, '') + '/api/phones/' + state.pairingCode + '/commands', {
      headers: { 'Authorization': 'Bearer ' + state.jarvisOsToken },
    });
    if (!r.ok) return;
    const cmds = await r.json();
    for (const c of (cmds.commands || [])) {
      await executeCommand(c);
    }
  } catch (e) { log('Poll err: ' + e.message); }
}

async function executeCommand(cmd) {
  log(`CMD: ${cmd.type}`);
  switch (cmd.type) {
    case 'notify': {
      try {
        await LocalNotifications.schedule({
          notifications: [{ id: Date.now() % 100000, title: cmd.title || 'Jarvis', body: cmd.body || '' }]
        });
      } catch (e) { log('Notify err: ' + e.message); }
      return;
    }
    case 'open-url': {
      try { window.open(cmd.url, '_system'); } catch {}
      return;
    }
    case 'location': {
      try {
        const loc = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
        await reportResult(cmd.id, { lat: loc.coords.latitude, lon: loc.coords.longitude, acc: loc.coords.accuracy });
      } catch (e) { await reportResult(cmd.id, { error: e.message }); }
      return;
    }
    case 'speak': {
      // Web Speech Synthesis API
      try {
        const u = new SpeechSynthesisUtterance(cmd.text || '');
        u.lang = cmd.lang || 'fr-FR';
        speechSynthesis.speak(u);
      } catch (e) { log('Speak err: ' + e.message); }
      return;
    }
    case 'vibrate': {
      try { navigator.vibrate && navigator.vibrate(cmd.pattern || [200]); } catch {}
      return;
    }
    case 'info': {
      const info = state.device || {};
      const net = await Network.getStatus().catch(() => ({}));
      await reportResult(cmd.id, { ...info, network: net.connectionType, online: net.connected });
      return;
    }
    default:
      log('Unknown cmd: ' + cmd.type);
  }
}

async function reportResult(cmdId, result) {
  if (!state.connected) return;
  try {
    await fetch(state.jarvisOsUrl.replace(/\/+$/, '') + '/api/phones/' + state.pairingCode + '/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.jarvisOsToken },
      body: JSON.stringify({ cmdId, result, timestamp: Date.now() }),
    });
  } catch {}
}

// ─── Render tabs ────────────────────────────────────────────────────────────
function render() {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  const body = $('body');
  if (state.tab === 'home')      body.innerHTML = renderHome();
  if (state.tab === 'control')   body.innerHTML = renderControl();
  if (state.tab === 'settings')  body.innerHTML = renderSettings();
  if (state.tab === 'logs')      body.innerHTML = renderLogs();
  wireEvents();
}

function renderHome() {
  const d = state.device || {};
  return `
    <div class="orb-wrap"><div class="orb"></div></div>
    <div class="card">
      <div class="card-h">PAIRING CODE</div>
      <div style="font-family: var(--font-display); font-size: 28px; letter-spacing: 8px; text-align: center; color: var(--accent); padding: 8px 0;">${state.pairingCode}</div>
      <div style="text-align: center; font-size: 11px; color: var(--fg-faint);">Saisis ce code dans Jarvis Desktop pour appairer</div>
    </div>
    <div class="card">
      <div class="card-h">APPAREIL</div>
      <div class="meta-row"><span class="k">Modèle</span><span class="v">${d.model || '—'}</span></div>
      <div class="meta-row"><span class="k">OS</span><span class="v">${d.platform || ''} ${d.osVersion || ''}</span></div>
      <div class="meta-row"><span class="k">Mémoire</span><span class="v">${d.memUsed ? Math.round(d.memUsed/1e9) + ' Go' : '—'}</span></div>
    </div>
  `;
}

function renderControl() {
  return `
    <div class="card">
      <div class="card-h">CONTRÔLE À DISTANCE</div>
      <div class="meta-row"><span class="k">Status VPS</span><span class="v" style="color:${state.connected ? 'var(--ok)' : 'var(--danger)'};">${state.connected ? 'CONNECTÉ' : 'HORS LIGNE'}</span></div>
      <div class="meta-row"><span class="k">Dernier ping</span><span class="v">${state.lastPing ? new Date(state.lastPing).toLocaleTimeString() : '—'}</span></div>
      <button class="btn" id="btn-test">PING VPS</button>
      <button class="btn secondary" id="btn-perms">DEMANDER PERMISSIONS</button>
    </div>
    <div class="card">
      <div class="card-h">COMMANDES SUPPORTÉES</div>
      <div style="font-size: 12px; color: var(--fg-faint); line-height: 1.7;">
        <code>notify</code> · notification locale<br/>
        <code>open-url</code> · ouvre une URL<br/>
        <code>location</code> · GPS<br/>
        <code>speak</code> · TTS<br/>
        <code>vibrate</code> · vibration<br/>
        <code>info</code> · infos device + réseau
      </div>
    </div>
  `;
}

function renderSettings() {
  return `
    <div class="card">
      <div class="card-h">JARVIS OS · VPS</div>
      <input class="field" id="set-url" placeholder="https://jarvis.atelier-r.fr" value="${state.jarvisOsUrl}" />
      <input class="field" id="set-token" type="password" placeholder="Bearer token" value="${state.jarvisOsToken}" />
      <button class="btn" id="btn-save">SAUVER & CONNECTER</button>
    </div>
    <div class="card">
      <div class="card-h">PAIRING</div>
      <div style="font-family: var(--font-display); font-size: 24px; letter-spacing: 6px; text-align: center; color: var(--accent); padding: 8px 0;">${state.pairingCode}</div>
      <button class="btn secondary" id="btn-newcode">GÉNÉRER UN NOUVEAU CODE</button>
      <button class="btn secondary" id="btn-share">PARTAGER</button>
    </div>
  `;
}

function renderLogs() {
  return `
    <div class="card">
      <div class="card-h">LOGS · ${state.controlLog.length}</div>
      <div class="log">${state.controlLog.join('\n') || 'Aucun log.'}</div>
    </div>
  `;
}

function wireEvents() {
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.onclick = () => { state.tab = b.dataset.tab; render(); };
  });
  if ($('btn-test')) $('btn-test').onclick = registerWithVps;
  if ($('btn-save')) $('btn-save').onclick = async () => {
    state.jarvisOsUrl = $('set-url').value.trim();
    state.jarvisOsToken = $('set-token').value.trim();
    await saveSettings();
    log('Settings saved');
    await registerWithVps();
  };
  if ($('btn-newcode')) $('btn-newcode').onclick = async () => {
    state.pairingCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    await Preferences.set({ key: 'pairingCode', value: state.pairingCode });
    render();
  };
  if ($('btn-share')) $('btn-share').onclick = async () => {
    try { await Share.share({ title: 'Pairing code Jarvis', text: state.pairingCode }); } catch {}
  };
  if ($('btn-perms')) $('btn-perms').onclick = async () => {
    try {
      await LocalNotifications.requestPermissions();
      await Geolocation.requestPermissions();
      log('Permissions demandées');
    } catch (e) { log('Perm err: ' + e.message); }
  };
}

// ─── Boot ───────────────────────────────────────────────────────────────────
(async () => {
  await loadSettings();
  await getDeviceInfo();
  render();
  await registerWithVps();
  // Poll every 5s
  setInterval(() => {
    pollCommands();
    if (!state.connected) registerWithVps();
  }, 5000);
})();
