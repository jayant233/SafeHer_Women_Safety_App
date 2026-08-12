/* ═══════════════════════════════════════════════════════════════
   SafeHer — Smart Women Safety App  |  script.js
   ───────────────────────────────────────────────────────────────
   Sections:
   [SOUND] [TOAST] [TABS] [LOCATION] [WHATSAPP] [SMS] [SOS]
   [CONTACTS] [CALL] [TIMER] [FAKECALL] [TRACKER] [EVIDENCE]
   [AUDIOREC] (NEW) [INCIDENTS] [TRANSLATOR] (NEW) [INIT]
═══════════════════════════════════════════════════════════════ */


// ── Global State ──────────────────────────────────────────────
let currentLocation     = null;
let safetyTimerInterval = null;
let audioCtx            = null;

// Tracker
let liveWatchId         = null;
let locationHistory     = [];
let lastTrackerUpdate   = null;
let trackerDisplayTimer = null;
let stationaryAlerted   = false;

// Quick evidence (photo + 10-sec audio)
let autoEvidenceEnabled = false;

// Long-form audio recorder
let longRec = {
  recorder: null, stream: null, audioCtx: null, analyser: null,
  meterRAF: null, startedAt: 0, durationSec: 60,
  endTimer: null, tickTimer: null, chunks: [],
};
let savedRecordings = [];

// Translator
let translator = {
  // --- mode ---
  mode: 'online',                 // 'online' | 'offline'

  // --- shared state ---
  finalText: '', interimText: '',
  lastTranslated: '',
  translateTimer: null,

  // --- online (Web Speech API) ---
  recognition: null,
  isListening: false,
  wantToListen: false,
  restartTimer: null,
  consecutiveNetErrors: 0,        // for exponential backoff + diagnostic trigger
  nextRetryMs: 280,               // grows on repeated failures

  // --- offline (Vosk + Translator API) ---
  offline: {
    voskReady: false,
    voskLoading: false,
    voskModel: null,
    voskRecognizer: null,
    voskAudioCtx: null,
    voskStream: null,
    voskNode: null,
    voskListening: false,
    voskLoadedLang: null,         // track which language's model is loaded
    aiTranslator: null,           // window.Translator instance if available
    aiTranslatorPair: null,       // e.g. "hi->en"
  },
};


/* ═══════════════════════════════════════════════════════════════
   [SOUND] Web-Audio Sound System
═══════════════════════════════════════════════════════════════ */
function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playBeep(freq=440, dur=0.3, vol=0.6, type='sine', delay=0) {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    g.gain.setValueAtTime(vol, ctx.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + dur);
  } catch (e) { console.warn('Sound err:', e); }
}

let sosAlarmPlaying = false;
function playSOSAlarm() {
  if (sosAlarmPlaying) return;
  sosAlarmPlaying = true;
  setTimeout(() => { sosAlarmPlaying = false; }, 2200);
  try {
    const ctx = getAudioContext();
    const sirenNotes = [
      {f:600,t:0.00},{f:1400,t:0.18},{f:600,t:0.36},{f:1400,t:0.54},
      {f:600,t:0.72},{f:1400,t:0.90},{f:600,t:1.08},{f:1400,t:1.26},
      {f:600,t:1.44},{f:1400,t:1.62},{f:600,t:1.80},{f:1400,t:1.98},
    ];
    sirenNotes.forEach(({f, t}) => {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, ctx.currentTime + t);
      osc.frequency.linearRampToValueAtTime(f === 600 ? 1400 : 600, ctx.currentTime + t + 0.18);
      g.gain.setValueAtTime(0.7, ctx.currentTime + t);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + t + 0.18);
      osc.start(ctx.currentTime + t); osc.stop(ctx.currentTime + t + 0.20);
    });
    for (let i = 0; i < 12; i++) {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(180, ctx.currentTime + i * 0.17);
      g.gain.setValueAtTime(0.45, ctx.currentTime + i * 0.17);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.17 + 0.12);
      osc.start(ctx.currentTime + i * 0.17); osc.stop(ctx.currentTime + i * 0.17 + 0.14);
    }
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(2800, ctx.currentTime + i * 0.5);
      g.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.5);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.5 + 0.08);
      osc.start(ctx.currentTime + i * 0.5); osc.stop(ctx.currentTime + i * 0.5 + 0.10);
    }
  } catch(e) { console.warn('SOS alarm err:', e); }
}

function playSuccessSound()   { playBeep(523,0.15,0.4,'sine',0); playBeep(659,0.15,0.4,'sine',0.15); playBeep(784,0.25,0.4,'sine',0.30); }
function playWarningBeep()    { playBeep(600,0.2,0.6,'triangle',0); playBeep(600,0.2,0.6,'triangle',0.3); }
function playAlertChime()     { playBeep(880,0.2,0.35,'sine',0); playBeep(660,0.3,0.3,'sine',0.2); }
function playTimerTick()      { playBeep(300,0.05,0.15,'sine',0); }
function playCountdownUrgent(){ playBeep(700,0.1,0.5,'square',0); }


/* ═══════════════════════════════════════════════════════════════
   [TOAST] Status Toast
═══════════════════════════════════════════════════════════════ */
function showStatus(message, type = '', duration = 4000) {
  const toast = document.getElementById('status-toast');
  toast.textContent = message;
  toast.className   = `status-toast ${type}`.trim();
  toast.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toast.classList.add('hidden'), duration);
}


/* ═══════════════════════════════════════════════════════════════
   [TABS] Tab Navigation
═══════════════════════════════════════════════════════════════ */
function switchTab(tabName) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tabName}`).classList.remove('hidden');
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  if (tabName === 'safety')     renderIncidents();
  if (tabName === 'translator') initTranslatorIfNeeded();
}


/* ═══════════════════════════════════════════════════════════════
   [LOCATION] GPS fetch + share helpers
═══════════════════════════════════════════════════════════════ */
function fetchLocation() {
  getAudioContext();
  showStatus('📡 Fetching your location... please wait', 'info', 15000);
  if (!navigator.geolocation) { showStatus('❌ Your browser does not support location.', ''); return; }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude.toFixed(6);
      const lng = position.coords.longitude.toFixed(6);
      currentLocation = { lat, lng };
      const mapsLink = buildMapsLink(lat, lng);
      displayLocationOnScreen(lat, lng, mapsLink);
      setupWhatsAppShare(mapsLink);
      playSuccessSound();
      showStatus('✅ Location fetched! Tap "Share via WhatsApp" to send it.', 'success');
    },
    (error) => {
      let msg = '';
      switch (error.code) {
        case error.PERMISSION_DENIED:    msg = '❌ Location blocked. Click 🔒 in browser address bar → Allow Location.'; break;
        case error.POSITION_UNAVAILABLE: msg = '❌ Location unavailable. Check internet.'; break;
        case error.TIMEOUT:              msg = '❌ Location timed out. Try again.'; break;
        default:                         msg = '❌ Could not get location.';
      }
      showStatus(msg, '', 8000);
    },
    { timeout: 15000, maximumAge: 0, enableHighAccuracy: true }
  );
}

function buildMapsLink(lat, lng) { return `https://www.google.com/maps?q=${lat},${lng}`; }

function displayLocationOnScreen(lat, lng, mapsLink) {
  document.getElementById('location-display').innerHTML = `
    <div class="location-result">
      <span class="location-coords">📌 Lat: ${lat}  |  Long: ${lng}</span>
      <a href="${mapsLink}" target="_blank" class="location-link">🗺️ Open in Google Maps ↗</a>
    </div>`;
}

function buildSOSMessage(mapsLink) {
  return `🚨 EMERGENCY! I need help immediately.\n📍 My live location: ${mapsLink}\nPlease call me or come to my location NOW.`;
}

function formatForWhatsApp(phone) {
  let num = phone.replace(/\D/g, '');
  if (num.length === 10) num = '91' + num;
  return num;
}


/* ═══════════════════════════════════════════════════════════════
   [WHATSAPP] Step-by-step Queue
═══════════════════════════════════════════════════════════════ */
let waQueue = [], waQueueIndex = 0, waQueueMessage = '';

function startWhatsAppQueue() {
  const contacts = getContacts();
  const mapsLink = window._currentMapsLink || (currentLocation
    ? buildMapsLink(currentLocation.lat, currentLocation.lng) : null);
  if (contacts.length === 0) { showStatus('⚠️ No contacts saved. Go to People tab first.', '', 5000); return; }
  if (!mapsLink)             { showStatus('⚠️ Tap "Get Location" first, then share.', '', 5000); return; }

  waQueue = contacts; waQueueIndex = 0;
  waQueueMessage = buildSOSMessage(mapsLink);

  document.getElementById('wa-start-btn').classList.add('hidden');
  document.getElementById('wa-queue-area').classList.remove('hidden');
  showCurrentQueueContact();
  playAlertChime();
}

function showCurrentQueueContact() {
  const contact = waQueue[waQueueIndex];
  const total = waQueue.length, current = waQueueIndex + 1, remaining = total - current;
  document.getElementById('wa-queue-contact-name').textContent = contact.name + (contact.isPrimary ? ' ⭐' : '');
  document.getElementById('wa-queue-contact-num').textContent  = '+' + contact.phone;
  document.getElementById('wa-queue-progress').textContent =
    `Contact ${current} of ${total}${remaining > 0 ? ` · ${remaining} more after this` : ' · Last one!'}`;
  const btn = document.getElementById('wa-open-btn');
  btn.textContent = `📲 Open WhatsApp for ${contact.name}`;
  btn.disabled = false;
}

function openNextWhatsApp() {
  const contact = waQueue[waQueueIndex];
  const waNum = formatForWhatsApp(contact.phone);
  window.open(`https://wa.me/${waNum}?text=${encodeURIComponent(waQueueMessage)}`, '_blank');
  playAlertChime();
  waQueueIndex++;
  if (waQueueIndex < waQueue.length) {
    showCurrentQueueContact();
    showStatus(`✅ Opened for ${contact.name}. Tap Send, then come back for next.`, 'success', 4000);
  } else {
    document.getElementById('wa-queue-area').classList.add('hidden');
    const startBtn = document.getElementById('wa-start-btn');
    startBtn.classList.remove('hidden');
    startBtn.textContent = '✅ All Done! Share Again?';
    playSuccessSound();
    showStatus(`✅ WhatsApp opened for all ${waQueue.length} contacts!`, 'success', 6000);
  }
}

function setupWhatsAppShare(mapsLink) {
  const contacts  = getContacts();
  const shareCard = document.getElementById('share-card');
  shareCard.classList.remove('hidden');
  window._currentMapsLink = mapsLink;

  const queueArea = document.getElementById('wa-queue-area');
  const startBtn  = document.getElementById('wa-start-btn');
  if (queueArea) queueArea.classList.add('hidden');
  if (startBtn)  { startBtn.classList.remove('hidden'); startBtn.textContent = '📢 Share to ALL via WhatsApp'; }

  loadF2SKey();

  const msgText      = buildSOSMessage(mapsLink);
  const contactsArea = document.getElementById('whatsapp-contacts-area');
  if (!contactsArea) return;

  if (contacts.length === 0) {
    const encoded = encodeURIComponent(msgText);
    contactsArea.innerHTML = `
      <a href="https://wa.me/?text=${encoded}" target="_blank" class="btn-whatsapp"
         onclick="playAlertChime()">📲 Share via WhatsApp</a>
      <p class="muted-text small">No contacts saved — WhatsApp will open and you pick a person.</p>`;
    return;
  }

  contactsArea.innerHTML = `
    <p class="muted-text small" style="margin-top:2px; margin-bottom:4px;">Or send to one person:</p>
    ${contacts.map(c => {
      const waNum = formatForWhatsApp(c.phone);
      const waURL = `https://wa.me/${waNum}?text=${encodeURIComponent(msgText)}`;
      return `
        <button class="btn-whatsapp-contact"
          onclick="window.open('${waURL}','_blank'); playAlertChime(); showStatus('📲 WhatsApp opened for ${c.name}!','info',3000)">
          <div class="contact-wa-avatar">${c.name.charAt(0).toUpperCase()}</div>
          <div class="contact-wa-info">
            <div class="contact-wa-name">${c.name} ${c.isPrimary ? '⭐' : ''}</div>
            <div class="contact-wa-num">+${c.phone}</div>
          </div>
          <span style="font-size:18px; margin-left:auto;">📲</span>
        </button>`;
    }).join('')}`;
}


/* ═══════════════════════════════════════════════════════════════
   [SMS] Fast2SMS Bulk
═══════════════════════════════════════════════════════════════ */
function saveF2SKey() {
  const key = document.getElementById('f2s-key-input')?.value.trim() || '';
  if (!key || key.length < 10) { showStatus('⚠️ Please paste a valid Fast2SMS API key.', ''); return; }
  localStorage.setItem('safeher_f2s_key', key);
  const inp = document.getElementById('f2s-key-input');
  if (inp) inp.value = '••••••••••••••••••••';
  updateF2SKeyStatus();
  playSuccessSound();
  showStatus('✅ Fast2SMS key saved!', 'success', 4000);
}

function loadF2SKey() {
  const saved = localStorage.getItem('safeher_f2s_key');
  const inp = document.getElementById('f2s-key-input');
  if (saved && inp) inp.value = '••••••••••••••••••••';
  updateF2SKeyStatus();
}

function updateF2SKeyStatus() {
  const el = document.getElementById('f2s-status');
  if (!el) return;
  const key = localStorage.getItem('safeher_f2s_key');
  if (key) { el.textContent = '✅ API key saved — SMS ready to fire on SOS.'; el.style.color = '#18c96e'; }
  else     { el.textContent = '⚠️ No key saved. Add your Fast2SMS API key above.'; el.style.color = '#f59e0b'; }
}

async function sendSMSToAll() {
  const apiKey = localStorage.getItem('safeher_f2s_key');
  const contacts = getContacts();
  const resultEl = document.getElementById('sms-result');
  const sendBtn = document.getElementById('sms-send-btn');

  if (!apiKey) {
    if (resultEl) { resultEl.className='sms-result error'; resultEl.textContent='❌ No API key. Save your Fast2SMS key first.'; resultEl.classList.remove('hidden'); }
    showStatus('❌ Fast2SMS key not saved.', '', 5000); return;
  }
  if (contacts.length === 0) {
    if (resultEl) { resultEl.className='sms-result error'; resultEl.textContent='❌ No contacts saved.'; resultEl.classList.remove('hidden'); }
    return;
  }

  const mapsLink = window._currentMapsLink || (currentLocation
    ? buildMapsLink(currentLocation.lat, currentLocation.lng) : 'Location unavailable');
  const message = `EMERGENCY! I need help. Location: ${mapsLink} Please call me NOW. -SafeHer`;

  const numbers = contacts
    .map(c => c.phone.replace(/\D/g, '').slice(-10))
    .filter(n => n.length === 10).join(',');

  if (!numbers) {
    if (resultEl) { resultEl.className='sms-result error'; resultEl.textContent='❌ No valid 10-digit phone numbers.'; resultEl.classList.remove('hidden'); }
    return;
  }

  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳ Sending SMS...'; }
  if (resultEl) { resultEl.className='sms-result sending'; resultEl.textContent=`📱 Sending SMS to ${contacts.length} contact(s)...`; resultEl.classList.remove('hidden'); }
  playAlertChime();

  try {
    const params = new URLSearchParams({ authorization: apiKey, route: 'q', message, language: 'english', flash: '0', numbers });
    const f2sURL   = `https://www.fast2sms.com/dev/bulkV2?${params.toString()}`;
    const proxyURL = `https://corsproxy.io/?${encodeURIComponent(f2sURL)}`;
    const response = await fetch(proxyURL, { method: 'GET', headers: { 'cache-control': 'no-cache' } });
    const data = await response.json();

    if (data.return === true) {
      if (resultEl) { resultEl.className='sms-result success'; resultEl.textContent=`✅ SMS sent to ${contacts.length} contact(s): ${contacts.map(c=>c.name).join(', ')}`; }
      if (sendBtn) sendBtn.textContent = '✅ SMS Sent!';
      playSuccessSound();
      showStatus(`✅ SMS sent to all ${contacts.length} contacts!`, 'success', 5000);
    } else {
      let reason = Array.isArray(data.message) ? data.message.join(', ') : (data.message || 'Unknown error');
      if (reason.includes('complete one transaction')) reason = 'Recharge Fast2SMS wallet with ₹100+ before API works.';
      if (reason.includes('authorization')) reason = 'API key wrong. Copy again from fast2sms.com → Dev API.';
      if (reason.includes('number')) reason = 'One or more phone numbers are invalid.';
      throw new Error(reason);
    }
  } catch (error) {
    if (resultEl) { resultEl.className='sms-result error'; resultEl.textContent=`❌ SMS failed: ${error.message}`; }
    if (sendBtn) sendBtn.textContent = '📱 Send SMS to All Contacts';
    showStatus('❌ SMS failed.', '', 6000);
    console.error('Fast2SMS error:', error);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

async function autoSendSOSSMS() {
  if (!localStorage.getItem('safeher_f2s_key')) return;
  await sendSMSToAll();
}

function shareLocationToAll() { startWhatsAppQueue(); }


/* ═══════════════════════════════════════════════════════════════
   [SOS] Master SOS Trigger
═══════════════════════════════════════════════════════════════ */
function triggerSOS() {
  playSOSAlarm();
  showStatus('🚨 SOS ACTIVATED! Getting your location...', '', 20000);

  const sosBtn = document.getElementById('sos-btn');
  if (sosBtn) {
    sosBtn.style.transform = 'scale(1.1)';
    setTimeout(() => sosBtn.style.transform = '', 300);
  }

  if (autoEvidenceEnabled) captureEvidenceAuto();
  autoSendSOSSMS();

  if (!navigator.geolocation) {
    logIncident(null, null, 'SOS triggered — location unavailable');
    callPrimaryContact();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude.toFixed(6);
      const lng = position.coords.longitude.toFixed(6);
      currentLocation = { lat, lng };
      const mapsLink = buildMapsLink(lat, lng);
      displayLocationOnScreen(lat, lng, mapsLink);
      setupWhatsAppShare(mapsLink);
      logIncident(lat, lng, 'SOS triggered by user');
      showStatus('📍 Location found! Calling emergency contact...', '', 8000);
      callPrimaryContact();
    },
    () => {
      logIncident(null, null, 'SOS triggered — location unavailable');
      showStatus('⚠️ Location unavailable. Calling contact anyway...', '', 6000);
      callPrimaryContact();
    },
    { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 }
  );
}


/* ═══════════════════════════════════════════════════════════════
   [CONTACTS]
═══════════════════════════════════════════════════════════════ */
function getContacts()       { return JSON.parse(localStorage.getItem('safeher_contacts') || '[]'); }
function saveContacts(list)  { localStorage.setItem('safeher_contacts', JSON.stringify(list)); }
function getPrimaryContact() { const c = getContacts(); return c.find(x => x.isPrimary) || c[0] || null; }

function addContact() {
  getAudioContext();
  const name  = document.getElementById('contact-name').value.trim();
  const phone = document.getElementById('contact-phone').value.trim().replace(/\D/g, '');
  if (!name || !phone)  { showStatus('⚠️ Please enter both name and phone.', ''); return; }
  if (phone.length < 7) { showStatus('⚠️ Phone number too short.', ''); return; }

  const contacts = getContacts();
  contacts.push({ id: Date.now(), name, phone, isPrimary: contacts.length === 0 });
  saveContacts(contacts);
  document.getElementById('contact-name').value  = '';
  document.getElementById('contact-phone').value = '';
  playSuccessSound();
  renderContacts();
  showStatus(`✅ ${name} added as emergency contact!`, 'success');
}

function deleteContact(id) {
  let contacts  = getContacts();
  const deleted = contacts.find(c => c.id === id);
  contacts      = contacts.filter(c => c.id !== id);
  if (deleted?.isPrimary && contacts.length > 0) contacts[0].isPrimary = true;
  saveContacts(contacts);
  renderContacts();
  showStatus('🗑️ Contact removed.', 'info');
}

function setPrimaryContact(id) {
  const contacts = getContacts().map(c => ({ ...c, isPrimary: c.id === id }));
  saveContacts(contacts);
  renderContacts();
  const primary = contacts.find(c => c.isPrimary);
  playSuccessSound();
  showStatus(`⭐ ${primary.name} is now your primary contact.`, 'success');
}

function renderContacts() {
  const contacts = getContacts();
  const listEl   = document.getElementById('contacts-list');
  if (contacts.length === 0) { listEl.innerHTML = '<p class="muted-text">No contacts saved yet.</p>'; return; }
  listEl.innerHTML = contacts.map(c => `
    <div class="contact-item ${c.isPrimary ? 'primary-contact' : ''}">
      <div class="contact-avatar">${c.name.charAt(0).toUpperCase()}</div>
      <div class="contact-info">
        <div class="contact-name">${c.name} ${c.isPrimary ? '<span class="primary-badge">PRIMARY</span>' : ''}</div>
        <div class="contact-phone">+${c.phone}</div>
      </div>
      <div class="contact-actions">
        ${!c.isPrimary ? `<button class="contact-action-btn" onclick="setPrimaryContact(${c.id})" title="Set as primary">⭐</button>` : ''}
        <button class="contact-action-btn" onclick="deleteContact(${c.id})" title="Delete">🗑️</button>
      </div>
    </div>`).join('');
}


/* ═══════════════════════════════════════════════════════════════
   [CALL] Tel + WhatsApp call popup
═══════════════════════════════════════════════════════════════ */
function callPrimaryContact() {
  const contact = getPrimaryContact();
  if (!contact) { showStatus('⚠️ No emergency contact saved! Go to People tab first.', '', 8000); return; }
  showStatus(`📞 Calling ${contact.name} (${contact.phone})... Stay safe!`, '', 10000);
  showCallOptions(contact);
}

function showCallOptions(contact) {
  const existing = document.getElementById('call-options-popup');
  if (existing) existing.remove();
  let waNumber = contact.phone.replace(/\D/g, '');
  if (waNumber.length === 10) waNumber = '91' + waNumber;

  const popup = document.createElement('div');
  popup.id = 'call-options-popup';
  popup.style.cssText = `position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:99998;
    display:flex; align-items:center; justify-content:center; padding:20px; animation:fadeIn 0.2s ease;`;
  popup.innerHTML = `
    <div style="background:#14141d; border:1px solid #2a2a3a; border-radius:18px;
                padding:28px 24px; max-width:340px; width:100%;
                display:flex; flex-direction:column; gap:14px; text-align:center;
                box-shadow:0 20px 60px rgba(0,0,0,0.6);">
      <div style="font-size:48px;">📞</div>
      <div style="font-family:'Bebas Neue',sans-serif; font-size:30px; letter-spacing:2px; color:#f5f5fa;">
        CALLING ${contact.name.toUpperCase()}
      </div>
      <div style="font-size:14px; color:#7a7a99; font-family:'IBM Plex Mono',monospace;">+${contact.phone}</div>
      <a href="tel:${contact.phone}"
         style="display:block; background:linear-gradient(135deg,#ef2d4f,#b00f2d); color:#fff;
                border-radius:10px; padding:14px; font-size:15px; font-weight:700;
                text-decoration:none; font-family:'Manrope',sans-serif;
                box-shadow:0 4px 14px rgba(239,45,79,0.3);"
         onclick="document.getElementById('call-options-popup').remove()">📱 Normal Phone Call</a>
      <a href="https://wa.me/${waNumber}" target="_blank"
         style="display:block; background:linear-gradient(135deg,#25d366,#1ba84a); color:#fff;
                border-radius:10px; padding:14px; font-size:15px; font-weight:700;
                text-decoration:none; font-family:'Manrope',sans-serif;
                box-shadow:0 4px 14px rgba(37,211,102,0.3);"
         onclick="document.getElementById('call-options-popup').remove()">💬 WhatsApp Call</a>
      <button onclick="sendWhatsAppSOS('${waNumber}'); document.getElementById('call-options-popup').remove();"
        style="background:#1c1c28; color:#f5f5fa; border:1px solid #2a2a3a; border-radius:10px;
               padding:14px; font-size:15px; font-weight:600; cursor:pointer;
               font-family:'Manrope',sans-serif; width:100%;">📍 WhatsApp Message + Location</button>
      <button onclick="document.getElementById('call-options-popup').remove();"
        style="background:none; color:#7a7a99; border:none; font-size:13px; cursor:pointer;
               font-family:'Manrope',sans-serif; padding:4px;">Dismiss</button>
    </div>`;
  document.body.appendChild(popup);
}

function sendWhatsAppSOS(waNumber) {
  let msg = '🚨 EMERGENCY! I need help immediately.\n';
  if (currentLocation) {
    msg += `📍 My live location: ${buildMapsLink(currentLocation.lat, currentLocation.lng)}\n`;
  } else {
    msg += '📍 (Location unavailable — please call me)\n';
  }
  msg += 'Please call me or come to my location NOW!';
  window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(msg)}`, '_blank');
  showStatus(`💬 Opening WhatsApp for ${waNumber}...`, 'success', 4000);
}


/* ═══════════════════════════════════════════════════════════════
   [TIMER] Safety Timer
═══════════════════════════════════════════════════════════════ */
let timerSecondsLeft = 0;

function startSafetyTimer() {
  getAudioContext();
  timerSecondsLeft = parseInt(document.getElementById('timer-duration').value);
  document.getElementById('timer-start-btn').classList.add('hidden');
  document.getElementById('timer-cancel-btn').classList.remove('hidden');
  document.getElementById('timer-display').classList.remove('hidden');
  updateTimerDisplay();
  playAlertChime();
  showStatus(`⏱️ Safety timer started for ${formatTime(timerSecondsLeft)}.`, 'info', 5000);

  safetyTimerInterval = setInterval(() => {
    timerSecondsLeft--;
    updateTimerDisplay();
    playTimerTick();
    if (timerSecondsLeft <= 10 && timerSecondsLeft > 0) playCountdownUrgent();
    if (timerSecondsLeft <= 0) {
      clearInterval(safetyTimerInterval);
      safetyTimerInterval = null;
      document.getElementById('timer-start-btn').classList.remove('hidden');
      document.getElementById('timer-cancel-btn').classList.add('hidden');
      document.getElementById('timer-display').classList.add('hidden');
      showStatus('⏰ Timer expired! SOS triggered automatically!', '', 10000);
      triggerSOS();
    }
  }, 1000);
}

function cancelSafetyTimer() {
  clearInterval(safetyTimerInterval);
  safetyTimerInterval = null;
  document.getElementById('timer-start-btn').classList.remove('hidden');
  document.getElementById('timer-cancel-btn').classList.add('hidden');
  document.getElementById('timer-display').classList.add('hidden');
  playSuccessSound();
  showStatus('✅ Safety timer cancelled. You are safe!', 'success');
}

function updateTimerDisplay() {
  document.getElementById('timer-countdown').textContent = formatTime(timerSecondsLeft);
}

function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}


/* ═══════════════════════════════════════════════════════════════
   [FAKECALL] Looping Ringtone
═══════════════════════════════════════════════════════════════ */
let ringActive = false;
const ANDROID_MELODY = [
  [659,0.12,0.5],[784,0.12,0.5],[988,0.12,0.55],[1047,0.18,0.6],
  [988,0.10,0.45],[1047,0.28,0.65],
  [784,0.12,0.45],[880,0.12,0.50],[988,0.20,0.55],[1047,0.35,0.65],
  [988,0.10,0.40],[880,0.10,0.40],[784,0.10,0.40],[659,0.30,0.50],
  [0,0.70,0.0],
];

function scheduleRingCycle(startTime) {
  if (!ringActive) return;
  const ctx = getAudioContext();
  let offset = 0, cycleDuration = 0;
  ANDROID_MELODY.forEach(([freq, dur, vol]) => {
    cycleDuration += dur;
    if (freq === 0) { offset += dur; return; }
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    const vibrato     = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    vibrato.frequency.value = 5.5; vibratoGain.gain.value = 6;
    vibrato.connect(vibratoGain); vibratoGain.connect(osc.frequency);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime + offset);
    const t = startTime + offset;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.015);
    gain.gain.setValueAtTime(vol * 0.85, t + dur * 0.4);
    gain.gain.linearRampToValueAtTime(0.001, t + dur - 0.01);
    vibrato.start(t); vibrato.stop(t + dur + 0.02);
    osc.start(t);     osc.stop(t + dur + 0.02);
    offset += dur;
  });
  setTimeout(() => { if (ringActive) scheduleRingCycle(getAudioContext().currentTime + 0.05); }, (cycleDuration - 0.08) * 1000);
}

function startRingtone() { ringActive = true; scheduleRingCycle(getAudioContext().currentTime + 0.1); }
function stopRingtone()  { ringActive = false; }

function startFakeCall() {
  getAudioContext();
  const callerName = document.getElementById('fake-caller-input').value.trim() || 'Mom';
  const delaySecs  = parseInt(document.getElementById('fake-call-delay').value);
  if (delaySecs === 0) showFakeCall(callerName);
  else {
    showStatus(`📞 Fake call from "${callerName}" coming in ${delaySecs} seconds...`, 'info', (delaySecs + 1) * 1000);
    setTimeout(() => showFakeCall(callerName), delaySecs * 1000);
  }
}
function showFakeCall(name) {
  document.getElementById('fake-caller-name').textContent = name;
  document.getElementById('fake-call-overlay').classList.remove('hidden');
  startRingtone();
}
function endFakeCall() {
  stopRingtone();
  document.getElementById('fake-call-overlay').classList.add('hidden');
  showStatus('📵 Call ended.', 'info');
}


/* ═══════════════════════════════════════════════════════════════
   [TRACKER] Live GPS + ML stationary detection
═══════════════════════════════════════════════════════════════ */
function startLiveTracker() {
  getAudioContext();
  if (!navigator.geolocation) { showStatus('❌ Geolocation not supported.', ''); return; }
  document.getElementById('tracker-start-btn').classList.add('hidden');
  document.getElementById('tracker-stop-btn').classList.remove('hidden');
  document.getElementById('tracker-location-box').classList.remove('hidden');
  document.getElementById('tracker-status-pill').className = 'tracker-pill on';
  document.getElementById('tracker-status-text').textContent = 'Tracker is ACTIVE — updating live';
  showStatus('📡 Live tracker started!', 'success', 4000);
  playSuccessSound();
  stationaryAlerted = false;
  locationHistory   = [];
  liveWatchId = navigator.geolocation.watchPosition(
    onTrackerLocationUpdate,
    (err) => showStatus('⚠️ Location update failed: ' + err.message, '', 4000),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
  );
  trackerDisplayTimer = setInterval(updateTrackerTimeAgo, 1000);
}

function stopLiveTracker() {
  if (liveWatchId !== null) { navigator.geolocation.clearWatch(liveWatchId); liveWatchId = null; }
  clearInterval(trackerDisplayTimer);
  document.getElementById('tracker-start-btn').classList.remove('hidden');
  document.getElementById('tracker-stop-btn').classList.add('hidden');
  document.getElementById('tracker-status-pill').className = 'tracker-pill off';
  document.getElementById('tracker-status-text').textContent = 'Tracker is OFF';
  document.getElementById('tracker-location-box').classList.add('hidden');
  document.getElementById('tracker-share-btn').style.display = 'none';
  document.getElementById('stationary-alert').classList.add('hidden');
  showStatus('⏹ Live tracker stopped.', 'info');
}

function onTrackerLocationUpdate(position) {
  const lat  = position.coords.latitude.toFixed(6);
  const lng  = position.coords.longitude.toFixed(6);
  const time = Date.now();
  currentLocation = { lat, lng };
  lastTrackerUpdate = time;
  const mapsLink = buildMapsLink(lat, lng);
  document.getElementById('tracker-coords').textContent     = `Lat: ${lat}  |  Long: ${lng}`;
  document.getElementById('tracker-maps-link').href          = mapsLink;
  document.getElementById('tracker-last-updated').textContent = 'Just updated';
  const shareBtn = document.getElementById('tracker-share-btn');
  shareBtn.style.display = 'block';
  shareBtn.classList.remove('hidden');
  locationHistory.push({ lat: parseFloat(lat), lng: parseFloat(lng), time });
  if (locationHistory.length > 10) locationHistory.shift();
  checkStationaryML();
}

function updateTrackerTimeAgo() {
  if (!lastTrackerUpdate) return;
  const seconds = Math.floor((Date.now() - lastTrackerUpdate) / 1000);
  const text = seconds < 5 ? 'Just updated'
             : seconds < 60 ? `Updated ${seconds} sec ago`
             : `Updated ${Math.floor(seconds / 60)} min ago`;
  const el = document.getElementById('tracker-last-updated');
  if (el) el.textContent = text;
}

function shareTrackerLocation() {
  if (!currentLocation) { showStatus('⚠️ No location yet.', ''); return; }
  const mapsLink = buildMapsLink(currentLocation.lat, currentLocation.lng);
  const msg = encodeURIComponent(`📍 Live Location Update\nI am currently here: ${mapsLink}\nThis is my real-time GPS location from SafeHer app.`);
  window.open(`https://wa.me/?text=${msg}`, '_blank');
  playAlertChime();
  showStatus('📲 Opening WhatsApp...', 'success', 3000);
}

function checkStationaryML() {
  if (stationaryAlerted || locationHistory.length < 3) return;
  const fiveMinAgo   = Date.now() - 5 * 60 * 1000;
  const recentPoints = locationHistory.filter(p => p.time > fiveMinAgo);
  if (recentPoints.length < 3) return;
  let maxDistMeters = 0;
  for (let i = 0; i < recentPoints.length; i++)
    for (let j = i + 1; j < recentPoints.length; j++) {
      const d = gpsDistanceMeters(recentPoints[i], recentPoints[j]);
      if (d > maxDistMeters) maxDistMeters = d;
    }
  const spanMinutes = Math.round((recentPoints[recentPoints.length-1].time - recentPoints[0].time) / 60000);
  if (maxDistMeters < 50 && spanMinutes >= 5) {
    stationaryAlerted = true;
    showStationaryAlert(spanMinutes);
  }
}

function gpsDistanceMeters(p1, p2) {
  const R = 6371000;
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2)
          + Math.cos(p1.lat*Math.PI/180)*Math.cos(p2.lat*Math.PI/180)
          * Math.sin(dLng/2)*Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function showStationaryAlert(minutes) {
  document.getElementById('stationary-alert-text').textContent = `You've been at the same location for ${minutes} minutes. Are you safe?`;
  document.getElementById('stationary-alert').classList.remove('hidden');
  playWarningBeep();
  showStatus(`🤖 ML: Stationary for ${minutes} min detected.`, '', 8000);
}

function dismissStationaryAlert() {
  document.getElementById('stationary-alert').classList.add('hidden');
  stationaryAlerted = false;
  playSuccessSound();
  showStatus('✅ Glad you are safe!', 'success');
}


/* ═══════════════════════════════════════════════════════════════
   [EVIDENCE] Photo + 10-sec quick audio
═══════════════════════════════════════════════════════════════ */
function toggleAutoEvidence(enabled) {
  autoEvidenceEnabled = enabled;
  document.getElementById('evidence-auto-label').textContent = `Auto-capture on SOS: ${enabled ? 'ON ✅' : 'OFF'}`;
  showStatus(enabled
    ? '📸 Auto-evidence ON — photo + audio captured on SOS.'
    : '📸 Auto-evidence OFF.', enabled ? 'success' : 'info', 3000);
}

async function captureEvidenceManual() {
  getAudioContext();
  showStatus('📸 Capturing evidence...', 'info', 6000);
  await captureEvidenceAuto();
}

async function captureEvidenceAuto() {
  await Promise.allSettled([capturePhoto(), recordAudio(10)]);
}

async function capturePhoto() {
  const videoEl = document.getElementById('evidence-video');
  const photoEl = document.getElementById('evidence-photo');
  const photoDiv = document.getElementById('photo-result');
  const downloadEl = document.getElementById('photo-download');
  const tsEl = document.getElementById('photo-timestamp');
  const resultsDiv = document.getElementById('evidence-results');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: 640, height: 480 }
    });
    videoEl.srcObject = stream;
    videoEl.classList.remove('hidden');
    await new Promise(r => { videoEl.onloadedmetadata = r; });
    videoEl.play();
    await new Promise(r => setTimeout(r, 1500));
    const canvas = document.createElement('canvas');
    canvas.width  = videoEl.videoWidth  || 640;
    canvas.height = videoEl.videoHeight || 480;
    canvas.getContext('2d').drawImage(videoEl, 0, 0);
    stream.getTracks().forEach(t => t.stop());
    videoEl.classList.add('hidden');
    videoEl.srcObject = null;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    photoEl.src = dataUrl;
    downloadEl.href = dataUrl;
    tsEl.textContent = '📅 ' + new Date().toLocaleString('en-IN');
    photoDiv.classList.remove('hidden');
    resultsDiv.classList.remove('hidden');
    playSuccessSound();
    showStatus('📸 Photo captured!', 'success', 4000);
  } catch (err) {
    videoEl.classList.add('hidden');
    console.warn('Photo capture failed:', err);
    showStatus('⚠️ Camera access denied.', '', 5000);
  }
}

async function recordAudio(seconds = 10) {
  const audioEl = document.getElementById('evidence-audio');
  const audioDiv = document.getElementById('audio-result');
  const downloadEl = document.getElementById('audio-download');
  const tsEl = document.getElementById('audio-timestamp');
  const resultsDiv = document.getElementById('evidence-results');
  try {
    const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks   = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const url  = URL.createObjectURL(blob);
      audioEl.src = url;
      downloadEl.href = url;
      tsEl.textContent = '📅 ' + new Date().toLocaleString('en-IN');
      audioDiv.classList.remove('hidden');
      resultsDiv.classList.remove('hidden');
      showStatus('🎙️ Audio recorded!', 'success', 4000);
    };
    recorder.start();
    showStatus(`🎙️ Recording for ${seconds} seconds...`, 'info', seconds * 1000);
    setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, seconds * 1000);
  } catch (err) {
    console.warn('Audio recording failed:', err);
    showStatus('⚠️ Microphone access denied.', '', 5000);
  }
}


/* ═══════════════════════════════════════════════════════════════
   [AUDIOREC] NEW — Long-form Audio Evidence Recorder
   ─────────────────────────────────────────────────────────────
   Records continuously for the chosen duration (30s/1m/5m/10m).
   Live volume meter, MM:SS countdown, list of saved recordings
   with playback + download + delete. Recordings live in memory
   only (cleared on refresh) — saves them to disk via download
   instead, since blobs don't fit in localStorage.
═══════════════════════════════════════════════════════════════ */

function wireAudioDurationChips() {
  document.querySelectorAll('#audio-duration-chips .duration-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (longRec.recorder) return; // ignore changes mid-recording
      document.querySelectorAll('#audio-duration-chips .duration-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      longRec.durationSec = parseInt(chip.dataset.secs, 10);
    });
  });
}

async function startAudioRecording() {
  getAudioContext();
  if (longRec.recorder) { showStatus('⚠️ A recording is already in progress.', '', 3000); return; }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    });
    longRec.stream = stream;
    longRec.chunks = [];

    let mime = '';
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (const m of candidates) { if (MediaRecorder.isTypeSupported(m)) { mime = m; break; } }

    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    longRec.recorder = recorder;

    recorder.ondataavailable = e => { if (e.data && e.data.size > 0) longRec.chunks.push(e.data); };
    recorder.onstop = handleLongRecStop;

    recorder.start(1000); // request data every 1s
    longRec.startedAt = Date.now();

    setupVolumeMeter(stream);

    document.getElementById('audio-rec-status').classList.remove('hidden');
    document.getElementById('audio-rec-start-btn').classList.add('hidden');
    document.getElementById('audio-rec-stop-btn').classList.remove('hidden');
    updateRecTimer();
    longRec.tickTimer = setInterval(updateRecTimer, 250);

    longRec.endTimer = setTimeout(() => {
      if (longRec.recorder && longRec.recorder.state === 'recording') stopAudioRecording();
    }, longRec.durationSec * 1000);

    playAlertChime();
    showStatus(`🔴 Recording started — ${formatTime(longRec.durationSec)} total.`, 'info', 4000);

  } catch (err) {
    console.warn('Audio rec failed:', err);
    showStatus('❌ Mic permission denied. Allow microphone access in browser.', '', 6000);
    cleanupRecResources();
  }
}

function stopAudioRecording() {
  if (!longRec.recorder) return;
  try { longRec.recorder.stop(); } catch (e) { console.warn(e); }
}

function handleLongRecStop() {
  const mime = longRec.recorder.mimeType || 'audio/webm';
  const blob = new Blob(longRec.chunks, { type: mime });
  const url  = URL.createObjectURL(blob);
  const actualSec = Math.round((Date.now() - longRec.startedAt) / 1000);
  const ext = mime.includes('mp4') ? 'm4a'
            : mime.includes('ogg') ? 'ogg' : 'webm';
  const dt = new Date();
  const fileName = `safeher-audio-${dt.toISOString().replace(/[:.]/g, '-').slice(0,19)}.${ext}`;

  const rec = {
    id: Date.now(), name: fileName, url, blob,
    durationSec: actualSec, createdAt: dt.toLocaleString('en-IN'),
  };
  savedRecordings.unshift(rec);
  if (savedRecordings.length > 20) {
    const old = savedRecordings.pop();
    URL.revokeObjectURL(old.url);
  }
  renderRecordings();
  playSuccessSound();
  showStatus(`✅ Saved ${formatTime(actualSec)} of audio. Tap ⬇ to download.`, 'success', 5000);
  cleanupRecResources();
}

function cleanupRecResources() {
  if (longRec.stream)    longRec.stream.getTracks().forEach(t => t.stop());
  if (longRec.endTimer)  clearTimeout(longRec.endTimer);
  if (longRec.tickTimer) clearInterval(longRec.tickTimer);
  if (longRec.meterRAF)  cancelAnimationFrame(longRec.meterRAF);
  if (longRec.audioCtx)  { try { longRec.audioCtx.close(); } catch(e){} }
  longRec.recorder = null; longRec.stream = null;
  longRec.audioCtx = null; longRec.analyser = null;
  longRec.endTimer = null; longRec.tickTimer = null; longRec.meterRAF = null;

  document.getElementById('audio-rec-status').classList.add('hidden');
  document.getElementById('audio-rec-start-btn').classList.remove('hidden');
  document.getElementById('audio-rec-stop-btn').classList.add('hidden');

  document.querySelectorAll('#audio-vol-meter span').forEach(s => {
    s.style.height = '4px';
    s.classList.remove('active', 'warn', 'peak');
  });
}

function setupVolumeMeter(stream) {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const source = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    longRec.audioCtx = ac;
    longRec.analyser = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const bars = document.querySelectorAll('#audio-vol-meter span');

    function tick() {
      if (!longRec.analyser) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length;
      const level = Math.min(1, avg / 100);
      const litCount = Math.round(level * bars.length);
      bars.forEach((bar, i) => {
        if (i < litCount) {
          const h = 4 + Math.round((i / bars.length) * 24);
          bar.style.height = h + 'px';
          bar.classList.add('active');
          bar.classList.toggle('warn', i >= bars.length * 0.6 && i < bars.length * 0.85);
          bar.classList.toggle('peak', i >= bars.length * 0.85);
        } else {
          bar.style.height = '4px';
          bar.classList.remove('active', 'warn', 'peak');
        }
      });
      longRec.meterRAF = requestAnimationFrame(tick);
    }
    tick();
  } catch (e) { console.warn('Vol meter setup failed:', e); }
}

function updateRecTimer() {
  const elapsed = Math.floor((Date.now() - longRec.startedAt) / 1000);
  document.getElementById('audio-rec-timer').textContent =
    `${formatTime(elapsed)} / ${formatTime(longRec.durationSec)}`;
}

function renderRecordings() {
  const listEl = document.getElementById('audio-rec-list');
  if (!listEl) return;
  if (savedRecordings.length === 0) {
    listEl.innerHTML = '<p class="muted-text small empty-list-msg">No recordings yet.</p>';
    return;
  }
  listEl.innerHTML = savedRecordings.map(r => `
    <div class="recording-item">
      <div class="recording-meta">
        <div class="recording-name">🎙️ ${formatTime(r.durationSec)} clip</div>
        <div class="recording-time">${r.createdAt}</div>
      </div>
      <audio controls src="${r.url}"></audio>
      <div class="recording-actions">
        <a class="rec-action-btn" href="${r.url}" download="${r.name}">⬇ Download</a>
        <button class="rec-action-btn" onclick="shareRecordingViaWhatsApp(${r.id})">📲 Share Note</button>
        <button class="rec-action-btn del" onclick="deleteRecording(${r.id})">🗑️ Delete</button>
      </div>
    </div>
  `).join('');
}

function shareRecordingViaWhatsApp(id) {
  const r = savedRecordings.find(x => x.id === id);
  if (!r) return;
  const msg = encodeURIComponent(
    `🎙️ I have a SafeHer audio recording from ${r.createdAt} (${formatTime(r.durationSec)} long).\nI'll share the file with you separately.`
  );
  window.open(`https://wa.me/?text=${msg}`, '_blank');
  showStatus('💬 Tip: download the recording and attach it manually in WhatsApp.', 'info', 6000);
}

function deleteRecording(id) {
  const idx = savedRecordings.findIndex(x => x.id === id);
  if (idx === -1) return;
  if (!confirm('Delete this recording? This cannot be undone.')) return;
  URL.revokeObjectURL(savedRecordings[idx].url);
  savedRecordings.splice(idx, 1);
  renderRecordings();
  showStatus('🗑️ Recording deleted.', 'info');
}


/* ═══════════════════════════════════════════════════════════════
   [INCIDENTS] Log + Printable Report
═══════════════════════════════════════════════════════════════ */
function getIncidents()    { return JSON.parse(localStorage.getItem('safeher_incidents') || '[]'); }
function saveIncidents(l)  { localStorage.setItem('safeher_incidents', JSON.stringify(l)); }

function logIncident(lat, lng, notes = '') {
  const incidents = getIncidents();
  const now = new Date();
  const incident = {
    id: Date.now(),
    date: now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }),
    time: now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' }),
    lat: lat || 'Unavailable',
    lng: lng || 'Unavailable',
    mapsLink: lat ? buildMapsLink(lat, lng) : null,
    notes,
  };
  incidents.unshift(incident);
  if (incidents.length > 30) incidents.pop();
  saveIncidents(incidents);
  renderIncidents();
}

function renderIncidents() {
  const incidents = getIncidents();
  const listEl = document.getElementById('incident-list');
  if (!listEl) return;
  if (incidents.length === 0) {
    listEl.innerHTML = '<p class="muted-text">No incidents recorded yet. SOS triggers are saved here automatically.</p>';
    return;
  }
  listEl.innerHTML = incidents.map((inc, index) => `
    <div class="incident-item">
      <div class="incident-header">
        <span class="incident-number">INCIDENT #${incidents.length - index}</span>
        <span class="incident-datetime">${inc.date} · ${inc.time}</span>
      </div>
      ${inc.mapsLink
        ? `<a href="${inc.mapsLink}" target="_blank" class="incident-location">📍 ${inc.lat}, ${inc.lng} ↗</a>`
        : `<span class="incident-notes">📍 Location unavailable</span>`}
      <span class="incident-notes">📝 ${inc.notes}</span>
    </div>`).join('');
}

function clearIncidents() {
  if (!confirm('Are you sure you want to delete all incident records? This cannot be undone.')) return;
  localStorage.removeItem('safeher_incidents');
  renderIncidents();
  showStatus('🗑️ All incident records cleared.', 'info');
}

function generateReport() {
  const incidents = getIncidents();
  if (incidents.length === 0) { showStatus('⚠️ No incidents to report yet.', '', 4000); return; }
  const userName  = getPrimaryContact()?.name  || 'User';
  const userPhone = getPrimaryContact()?.phone || 'Not set';
  const reportDate = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' });
  const reportTime = new Date().toLocaleTimeString('en-IN');

  const reportHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SafeHer — Incident Report</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;color:#111;background:#fff;padding:40px}
    .report-header{border-bottom:3px solid #c00;padding-bottom:20px;margin-bottom:28px}
    .report-title{font-size:28px;font-weight:900;color:#c00;letter-spacing:2px}
    .report-sub{font-size:13px;color:#555;margin-top:4px}
    .report-meta{display:flex;gap:40px;margin-bottom:28px;flex-wrap:wrap}
    .meta-item label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;display:block}
    .meta-item span{font-size:14px;font-weight:600}
    .section-title{font-size:16px;font-weight:700;color:#c00;border-bottom:1px solid #eee;padding-bottom:6px;margin-bottom:14px;text-transform:uppercase;letter-spacing:1px}
    .incident-block{border:1px solid #ddd;border-radius:8px;padding:16px 20px;margin-bottom:14px;page-break-inside:avoid}
    .inc-number{font-size:18px;font-weight:800;color:#c00}
    .inc-detail{font-size:13px;color:#333;margin-top:5px;line-height:1.7}
    .inc-detail strong{color:#000}
    .maps-link{color:#1a73e8;font-size:12px}
    .disclaimer{margin-top:40px;padding:16px;background:#fff8f8;border:1px solid #fcc;border-radius:6px;font-size:12px;color:#666;line-height:1.6}
    .footer{margin-top:30px;text-align:center;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:14px}
    @media print{body{padding:20px}}
  </style></head><body>
    <div class="report-header">
      <div class="report-title">🛡️ SAFEHER — INCIDENT REPORT</div>
      <div class="report-sub">Women Safety Application — Auto-generated Report</div>
    </div>
    <div class="report-meta">
      <div class="meta-item"><label>Report Date</label><span>${reportDate}</span></div>
      <div class="meta-item"><label>Report Time</label><span>${reportTime}</span></div>
      <div class="meta-item"><label>Contact Name</label><span>${userName}</span></div>
      <div class="meta-item"><label>Contact Phone</label><span>+${userPhone}</span></div>
      <div class="meta-item"><label>Total Incidents</label><span>${incidents.length}</span></div>
    </div>
    <div class="section-title">Incident Records</div>
    ${incidents.map((inc, i) => `
      <div class="incident-block">
        <div class="inc-number">INCIDENT #${incidents.length - i}</div>
        <div class="inc-detail">
          <strong>Date:</strong> ${inc.date} &nbsp;&nbsp; <strong>Time:</strong> ${inc.time}<br/>
          <strong>Location:</strong> ${inc.lat !== 'Unavailable' ? `Lat ${inc.lat}, Long ${inc.lng}` : 'Location was unavailable at time of incident'}<br/>
          ${inc.mapsLink ? `<strong>Maps Link:</strong> <a href="${inc.mapsLink}" class="maps-link">${inc.mapsLink}</a><br/>` : ''}
          <strong>Notes:</strong> ${inc.notes || 'SOS triggered'}
        </div>
      </div>`).join('')}
    <div class="disclaimer">
      <strong>Disclaimer:</strong> This report was automatically generated by the SafeHer Women Safety Application.
      All incident data was recorded at the time of the SOS trigger using GPS coordinates from the device.
      This report can be used as supporting evidence. Please contact your local police station for formal complaint registration.
      Emergency helpline: <strong>112</strong> (Police) | <strong>181</strong> (Women Helpline)
    </div>
    <div class="footer">Generated by SafeHer App · ${reportDate} ${reportTime} · For official use as supporting evidence</div>
  </body></html>`;

  const win = window.open('', '_blank');
  win.document.write(reportHTML);
  win.document.close();
  setTimeout(() => win.print(), 800);
  showStatus('🖨️ Report opened! Use Ctrl+P or the print dialog to save as PDF.', 'success', 6000);
}


/* ═══════════════════════════════════════════════════════════════
   [TRANSLATOR] Listen → Transcribe → Translate
   ─────────────────────────────────────────────────────────────
   FIXES vs the old voice-activation code that didn't work:
   • continuous = false   → restart manually on every onend
   • setTimeout(restart, 250) avoids race-condition InvalidStateError
   • Handles ALL onerror types (no-speech, aborted, network, …)
   • State machine: wantToListen vs isListening — never start twice
   • Visible state pill so you ALWAYS know what the mic is doing
   • onspeechstart fires the "speaking" pill — proves mic is alive
   • Translation via MyMemory (free, no API key, online only)
═══════════════════════════════════════════════════════════════ */

const LANGUAGES = [
  { code: 'en-IN', name: 'English (India)', short: 'en' },
  { code: 'en-US', name: 'English (US)',    short: 'en' },
  { code: 'hi-IN', name: 'Hindi',           short: 'hi' },
  { code: 'bn-IN', name: 'Bengali',         short: 'bn' },
  { code: 'ta-IN', name: 'Tamil',           short: 'ta' },
  { code: 'te-IN', name: 'Telugu',          short: 'te' },
  { code: 'mr-IN', name: 'Marathi',         short: 'mr' },
  { code: 'gu-IN', name: 'Gujarati',        short: 'gu' },
  { code: 'kn-IN', name: 'Kannada',         short: 'kn' },
  { code: 'ml-IN', name: 'Malayalam',       short: 'ml' },
  { code: 'pa-IN', name: 'Punjabi',         short: 'pa' },
  { code: 'ur-IN', name: 'Urdu',            short: 'ur' },
  { code: 'es-ES', name: 'Spanish',         short: 'es' },
  { code: 'fr-FR', name: 'French',          short: 'fr' },
  { code: 'de-DE', name: 'German',          short: 'de' },
  { code: 'it-IT', name: 'Italian',         short: 'it' },
  { code: 'pt-PT', name: 'Portuguese',      short: 'pt' },
  { code: 'ru-RU', name: 'Russian',         short: 'ru' },
  { code: 'zh-CN', name: 'Chinese',         short: 'zh' },
  { code: 'ja-JP', name: 'Japanese',        short: 'ja' },
  { code: 'ko-KR', name: 'Korean',          short: 'ko' },
  { code: 'ar-SA', name: 'Arabic',          short: 'ar' },
];

let translatorInited = false;
function initTranslatorIfNeeded() {
  if (translatorInited) return;
  translatorInited = true;

  const srcSel = document.getElementById('src-lang');
  const tgtSel = document.getElementById('tgt-lang');
  // Build deduped target list (so we don't list "English" twice)
  const seenTgt = new Set();
  LANGUAGES.forEach(L => {
    srcSel.innerHTML += `<option value="${L.code}">${L.name}</option>`;
    if (!seenTgt.has(L.short)) {
      seenTgt.add(L.short);
      tgtSel.innerHTML += `<option value="${L.short}">${L.name}</option>`;
    }
  });
  srcSel.value = 'hi-IN'; // default: they speak Hindi
  tgtSel.value = 'en';    // default: I read English

  // If mid-session the user changes the source language, restart the engine
  srcSel.addEventListener('change', () => {
    if (translator.wantToListen) {
      stopTranslatorListening(/*temporarily=*/true);
      setTimeout(() => startTranslatorListening(), 350);
    }
    // Offline mode: re-detect engines + refresh quick phrases for the new language
    if (translator.mode === 'offline') {
      detectOfflineEngines();
      renderQuickPhrases();
    }
  });

  // Target language change also matters for the Chrome Translator API pair
  tgtSel.addEventListener('change', () => {
    if (translator.mode === 'offline') {
      detectOfflineEngines();
    }
  });
}

function setTranslatorState(state, msg) {
  const pill = document.getElementById('translator-state-pill');
  const txt  = document.getElementById('translator-state-text');
  pill.className = `translator-state-pill ${state}`;
  txt.textContent = msg;
}

function setListenButton(listening) {
  const btn   = document.getElementById('translator-listen-btn');
  const label = btn.querySelector('.listen-label');
  const icon  = btn.querySelector('.listen-icon');
  if (listening) {
    btn.classList.add('listening');
    label.textContent = 'Tap to Stop Listening';
    icon.textContent  = '⏹';
  } else {
    btn.classList.remove('listening');
    label.textContent = 'Tap to Start Listening';
    icon.textContent  = '🎤';
  }
}

function toggleTranslatorListening() {
  getAudioContext();
  if (translator.wantToListen) {
    stopTranslatorListening();
  } else {
    startTranslatorListening();
  }
}

function startTranslatorListening() {
  // Pre-flight environment checks — catches issues that cause spurious "network" errors
  if (!window.isSecureContext && location.protocol !== 'http:') {
    setTranslatorState('error', '❌ This page must be served over HTTPS.');
    showStatus('❌ Speech recognition requires HTTPS or localhost.', '', 6000);
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setTranslatorState('error', '❌ Speech recognition not supported. Use Chrome or Edge.');
    showStatus('❌ Speech recognition not supported in this browser. Please use Chrome, or switch to Offline Mode.', '', 6000);
    return;
  }

  // Fresh session → reset retry tracking
  translator.consecutiveNetErrors = 0;
  translator.nextRetryMs = 280;
  hideOnlineDiagnostic();

  // Build a fresh recognition instance each session (avoids stale state)
  const rec = new SpeechRecognition();

  // KEY FIX #1: continuous = false. The auto-restart loop in onend is more reliable
  // than continuous mode on mobile Chrome.
  rec.continuous     = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.lang = document.getElementById('src-lang').value || 'hi-IN';

  rec.onstart = () => {
    translator.isListening = true;
    setTranslatorState('listening', `🎙️ Listening (${rec.lang})… speak now`);
  };

  // KEY FIX #2: onspeechstart proves the mic actually heard sound
  rec.onspeechstart = () => {
    setTranslatorState('speaking', `🗣️ Hearing speech… transcribing`);
  };

  rec.onspeechend = () => {
    setTranslatorState('listening', `🎙️ Listening (${rec.lang})…`);
  };

  rec.onresult = (event) => {
    // A real result arriving means the speech service IS reachable.
    // Reset the exponential-backoff counter and hide any error diagnostic.
    translator.consecutiveNetErrors = 0;
    translator.nextRetryMs = 280;
    hideOnlineDiagnostic();

    let interim = '';
    let newFinal = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) newFinal += transcript + ' ';
      else                          interim  += transcript;
    }
    if (newFinal) {
      translator.finalText = (translator.finalText + ' ' + newFinal).trim();
      // Translate when we get a finalized chunk
      scheduleTranslation();
    }
    translator.interimText = interim;
    renderTranslatorTranscript();
  };

  // KEY FIX #3: handle ALL error types with proper diagnostics
  // The "network" error from Web Speech API does NOT mean the user is offline —
  // it means Chrome couldn't reach speech.googleapis.com. We handle that distinctly.
  rec.onerror = (e) => {
    console.warn('Speech recognition error:', e.error, e);
    switch (e.error) {
      case 'not-allowed':
      case 'service-not-allowed':
        setTranslatorState('error', '❌ Microphone permission denied. Allow in browser settings.');
        showStatus('❌ Microphone permission denied. Click 🔒 in address bar → Allow microphone.', '', 7000);
        translator.wantToListen = false;
        setListenButton(false);
        break;
      case 'no-speech':
        // Common — engine timed out waiting for sound. Just restart (handled in onend).
        setTranslatorState('idle', '⚠️ Didn\'t hear anything — listening again…');
        break;
      case 'aborted':
        // We aborted intentionally. onend will follow.
        break;
      case 'audio-capture':
        setTranslatorState('error', '❌ No microphone found. Connect a mic and try again.');
        showStatus('❌ No microphone detected. Plug one in and reload.', '', 6000);
        translator.wantToListen = false;
        setListenButton(false);
        break;
      case 'network':
        // IMPORTANT: "network" from Web Speech = Chrome couldn't reach Google's
        // speech backend. It does NOT mean the user's internet is down.
        // Apply exponential backoff and show diagnostics if it keeps failing.
        translator.consecutiveNetErrors++;
        translator.nextRetryMs = Math.min(280 * (2 ** translator.consecutiveNetErrors), 6000);
        if (translator.consecutiveNetErrors >= 3) {
          // Stop the retry loop and show the diagnostic panel
          translator.wantToListen = false;
          setListenButton(false);
          setTranslatorState('error', '❌ Speech service unreachable');
          showOnlineDiagnostic();
        } else {
          setTranslatorState('error',
            `⚠️ Speech service unreachable — retrying in ${Math.round(translator.nextRetryMs/1000)}s (${translator.consecutiveNetErrors}/3)…`);
        }
        break;
      case 'language-not-supported':
        setTranslatorState('error', `❌ Language ${rec.lang} not supported on this browser.`);
        showStatus(`❌ Language ${rec.lang} not supported by your browser. Try a different one.`, '', 6000);
        translator.wantToListen = false;
        setListenButton(false);
        break;
      default:
        setTranslatorState('error', `⚠️ Error: ${e.error}. Will retry…`);
    }
  };

  // KEY FIX #4: restart on onend with exponential backoff, gated by wantToListen
  rec.onend = () => {
    translator.isListening = false;
    if (translator.wantToListen) {
      clearTimeout(translator.restartTimer);
      translator.restartTimer = setTimeout(() => {
        if (translator.wantToListen && !translator.isListening) {
          try { rec.start(); }
          catch (err) {
            console.warn('Restart failed, building fresh recognition:', err);
            translator.recognition = null;
            startTranslatorListening();
          }
        }
      }, translator.nextRetryMs);
    } else {
      setTranslatorState('idle', 'Idle — tap mic to begin');
    }
  };

  translator.recognition  = rec;
  translator.wantToListen = true;
  setListenButton(true);

  try {
    rec.start();
  } catch (err) {
    console.warn('Initial start failed:', err);
    setTranslatorState('error', '❌ Could not start mic. Refresh the page and try again.');
    translator.wantToListen = false;
    setListenButton(false);
  }
}



function stopTranslatorListening(temporarily = false) {
  // If a temporary stop (e.g. user changed source language), keep wantToListen
  // so the engine restarts in onend. Otherwise clear it for good.
  if (!temporarily) translator.wantToListen = false;

  if (translator.recognition) {
    try { translator.recognition.stop(); } catch (e) { /* ignore */ }
  }
  if (!temporarily) {
    setListenButton(false);
    setTranslatorState('idle', 'Idle — tap mic to begin');
  }
}

function renderTranslatorTranscript() {
  const el = document.getElementById('translator-transcript');
  const finalPart = translator.finalText
    ? `<span class="final">${escapeHtml(translator.finalText)}</span>`
    : '';
  const interimPart = translator.interimText
    ? `<span class="interim"> ${escapeHtml(translator.interimText)}</span>`
    : '';
  if (!finalPart && !interimPart) {
    el.innerHTML = `<span class="placeholder">Live transcription will appear here as they speak…</span>`;
  } else {
    el.innerHTML = finalPart + interimPart;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Debounce: only translate after 600ms of no new final text
function scheduleTranslation() {
  clearTimeout(translator.translateTimer);
  translator.translateTimer = setTimeout(runTranslation, 600);
}

async function runTranslation() {
  const sourceCode = document.getElementById('src-lang').value.split('-')[0]; // 'hi-IN' → 'hi'
  const targetCode = document.getElementById('tgt-lang').value;
  const text       = translator.finalText.trim();
  if (!text) return;
  if (text === translator.lastTranslated) return; // dedupe
  if (sourceCode === targetCode) {
    document.getElementById('translator-translation').innerHTML =
      `<span>${escapeHtml(text)}</span>`;
    showSOSPopup();
    return;
  }

  setTranslatorState('translating', `🌐 Translating to ${targetCode.toUpperCase()}…`);
  const transEl = document.getElementById('translator-translation');

  try {
    // MyMemory translation — free, no API key, ~5000 chars/day per IP
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceCode}|${targetCode}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data && data.responseData && data.responseData.translatedText) {
      const translated = data.responseData.translatedText;
      transEl.innerHTML = `<span>${escapeHtml(translated)}</span>`;
      translator.lastTranslated = text;
      showSOSPopup();
      playAlertChime();

      if (translator.wantToListen) {
        setTranslatorState('listening', `🎙️ Listening (${document.getElementById('src-lang').value})…`);
      } else {
        setTranslatorState('idle', '✅ Translation done');
      }
    } else {
      throw new Error(data?.responseDetails || 'Empty translation result');
    }
  } catch (err) {
    console.warn('Translation failed:', err);
    transEl.innerHTML = `<span class="placeholder">⚠️ Translation failed: ${escapeHtml(err.message || String(err))}. Check internet.</span>`;
    setTranslatorState('error', '⚠️ Translation failed — check internet');
  }
}

function showSOSPopup() {
  document.getElementById('translator-sos-area').classList.remove('hidden');
}

function clearTranslator() {
  translator.finalText = '';
  translator.interimText = '';
  translator.lastTranslated = '';
  document.getElementById('translator-transcript').innerHTML =
    `<span class="placeholder">Live transcription will appear here as they speak…</span>`;
  document.getElementById('translator-translation').innerHTML =
    `<span class="placeholder">Translation will appear here once we hear something.</span>`;
  document.getElementById('translator-sos-area').classList.add('hidden');
  showStatus('🧹 Transcript cleared.', 'info', 2500);
}


/* ═══════════════════════════════════════════════════════════════
   [TRANSLATOR · MODE SWITCH + ONLINE DIAGNOSTICS]
═══════════════════════════════════════════════════════════════ */

function switchTranslatorMode(mode) {
  if (mode !== 'online' && mode !== 'offline') return;
  translator.mode = mode;

  // Stop any active sessions when switching away
  if (mode === 'offline') {
    if (translator.wantToListen) stopTranslatorListening();
  } else {
    if (translator.offline.voskListening) stopOfflineVoice();
  }

  // Toggle buttons
  document.getElementById('mode-btn-online').classList.toggle('active',  mode === 'online');
  document.getElementById('mode-btn-offline').classList.toggle('active', mode === 'offline');
  document.getElementById('mode-btn-online').setAttribute('aria-selected',  mode === 'online');
  document.getElementById('mode-btn-offline').setAttribute('aria-selected', mode === 'offline');

  // Toggle panels
  document.getElementById('panel-online').classList.toggle('hidden',  mode !== 'online');
  document.getElementById('panel-offline').classList.toggle('hidden', mode !== 'offline');

  // Toggle info note
  document.getElementById('mode-info-online').classList.toggle('hidden',  mode !== 'online');
  document.getElementById('mode-info-offline').classList.toggle('hidden', mode !== 'offline');

  // First-time offline mode → detect available engines and build phrasebook chips
  if (mode === 'offline') {
    detectOfflineEngines();
    renderQuickPhrases();
  }

  hideOnlineDiagnostic();
}

function showOnlineDiagnostic() {
  const panel = document.getElementById('translator-diag-panel');
  const list  = document.getElementById('diag-list');
  if (!panel || !list) return;
  const items = [];

  const online  = navigator.onLine;
  const secure  = window.isSecureContext || location.hostname === 'localhost' || location.protocol === 'http:';
  const ua      = navigator.userAgent.toLowerCase();
  const isSafari  = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isFirefox = ua.includes('firefox');
  const isBrave   = !!(navigator.brave && navigator.brave.isBrave);

  items.push(
    online
      ? '✅ Your internet IS working (device reports online)'
      : '❌ Your device reports it is offline — reconnect to Wi-Fi/data'
  );
  items.push(
    secure
      ? '✅ Page is on HTTPS (speech recognition is allowed here)'
      : '❌ Page is on HTTP — serve this over HTTPS'
  );

  if (isSafari)       items.push('⚠️ Safari does not support the Web Speech API — use Chrome or switch to Offline mode');
  else if (isFirefox) items.push('⚠️ Firefox does not support the Web Speech API — use Chrome or switch to Offline mode');
  else if (isBrave)   items.push('⚠️ Brave blocks Google speech servers by default — switch to Offline mode');
  else if (online)    items.push('⚠️ Chrome cannot reach Google\'s speech service (<code>speech.googleapis.com</code>). Common causes: college/office firewall, VPN, ISP filtering, or Google services restricted in your region.');

  items.push('💡 <strong>Offline mode works with none of these issues</strong> — nothing leaves your device.');

  list.innerHTML = items.map(t => `<li>${t}</li>`).join('');
  panel.classList.remove('hidden');
}

function hideOnlineDiagnostic() {
  const panel = document.getElementById('translator-diag-panel');
  if (panel) panel.classList.add('hidden');
}

function retryOnlineSpeech() {
  translator.consecutiveNetErrors = 0;
  translator.nextRetryMs = 280;
  hideOnlineDiagnostic();
  startTranslatorListening();
}


/* ═══════════════════════════════════════════════════════════════
   [TRANSLATOR · OFFLINE — EMERGENCY PHRASEBOOK]
   Hand-curated safety phrases. Work instantly without any download
   and without any network. Covers Hindi ↔ English — the two most
   common pairs for users in India — and can be extended.
═══════════════════════════════════════════════════════════════ */

const PHRASEBOOK = {
  // key = source language short code; value = [{ text, translations: {tgt: str}}]
  hi: [
    { text: 'मुझे मदद चाहिए',           translations: { en: 'I need help',                   es: 'Necesito ayuda',      fr: 'J\'ai besoin d\'aide',    de: 'Ich brauche Hilfe' }},
    { text: 'पुलिस को बुलाओ',          translations: { en: 'Call the police',                es: 'Llama a la policía',  fr: 'Appelez la police',        de: 'Ruf die Polizei' }},
    { text: 'कोई मेरा पीछा कर रहा है', translations: { en: 'Someone is following me',        es: 'Alguien me sigue',    fr: 'Quelqu\'un me suit',       de: 'Jemand folgt mir' }},
    { text: 'मुझे डर लग रहा है',       translations: { en: 'I am scared',                    es: 'Tengo miedo',         fr: 'J\'ai peur',               de: 'Ich habe Angst' }},
    { text: 'मुझे अकेला छोड़ दो',       translations: { en: 'Leave me alone',                 es: 'Déjame en paz',       fr: 'Laisse-moi tranquille',    de: 'Lass mich in Ruhe' }},
    { text: 'यहाँ से बाहर निकालो',     translations: { en: 'Get me out of here',             es: 'Sácame de aquí',      fr: 'Sors-moi d\'ici',          de: 'Hol mich hier raus' }},
    { text: 'मुझे डॉक्टर चाहिए',       translations: { en: 'I need a doctor',                es: 'Necesito un médico',  fr: 'J\'ai besoin d\'un médecin', de: 'Ich brauche einen Arzt' }},
    { text: 'क्या आप मुझे बता सकते हैं कहाँ हूँ?', translations: { en: 'Can you tell me where I am?', es: '¿Puede decirme dónde estoy?', fr: 'Pouvez-vous me dire où je suis?', de: 'Können Sie mir sagen, wo ich bin?' }},
  ],
  en: [
    { text: 'I need help',            translations: { hi: 'मुझे मदद चाहिए',            es: 'Necesito ayuda',       fr: 'J\'ai besoin d\'aide',  de: 'Ich brauche Hilfe' }},
    { text: 'Call the police',        translations: { hi: 'पुलिस को बुलाओ',             es: 'Llama a la policía',   fr: 'Appelez la police',      de: 'Ruf die Polizei' }},
    { text: 'Someone is following me',translations: { hi: 'कोई मेरा पीछा कर रहा है',   es: 'Alguien me sigue',     fr: 'Quelqu\'un me suit',     de: 'Jemand folgt mir' }},
    { text: 'I am scared',            translations: { hi: 'मुझे डर लग रहा है',          es: 'Tengo miedo',          fr: 'J\'ai peur',             de: 'Ich habe Angst' }},
    { text: 'Leave me alone',         translations: { hi: 'मुझे अकेला छोड़ दो',          es: 'Déjame en paz',        fr: 'Laisse-moi tranquille',  de: 'Lass mich in Ruhe' }},
    { text: 'Where am I?',            translations: { hi: 'मैं कहाँ हूँ?',               es: '¿Dónde estoy?',        fr: 'Où suis-je?',            de: 'Wo bin ich?' }},
    { text: 'I need a doctor',        translations: { hi: 'मुझे डॉक्टर चाहिए',          es: 'Necesito un médico',   fr: 'J\'ai besoin d\'un médecin', de: 'Ich brauche einen Arzt' }},
    { text: 'Stop the car',           translations: { hi: 'गाड़ी रोको',                  es: 'Para el coche',        fr: 'Arrêtez la voiture',     de: 'Halt das Auto an' }},
  ],
};

function phrasebookLookup(text, srcShort, tgtShort) {
  const bucket = PHRASEBOOK[srcShort];
  if (!bucket) return null;
  const norm = text.trim().toLowerCase();
  for (const entry of bucket) {
    if (entry.text.trim().toLowerCase() === norm && entry.translations[tgtShort]) {
      return entry.translations[tgtShort];
    }
  }
  return null;
}

function renderQuickPhrases() {
  const wrap = document.getElementById('quick-phrases-list');
  if (!wrap) return;
  const srcCode = getSourceShort();
  const bucket = PHRASEBOOK[srcCode] || PHRASEBOOK['hi'];
  wrap.innerHTML = bucket.slice(0, 6).map(entry =>
    `<button class="quick-phrase-chip" onclick="applyQuickPhrase(${JSON.stringify(entry.text).replace(/"/g, '&quot;')})">${escapeHtml(entry.text)}</button>`
  ).join('');
}

function applyQuickPhrase(text) {
  document.getElementById('offline-input-text').value = text;
  runOfflineTranslation();
}


/* ═══════════════════════════════════════════════════════════════
   [TRANSLATOR · OFFLINE — ENGINE DETECTION]
   Three tiers, in order of preference:
     1. Chrome's built-in `Translator` API (Chrome 138+) — offline, unlimited
     2. Emergency phrasebook — built-in, instant, limited
     3. Vosk (speech-to-text only) — optional 40MB download
═══════════════════════════════════════════════════════════════ */

function getSourceShort() {
  const full = (document.getElementById('src-lang')?.value || 'hi-IN');
  return full.split('-')[0];
}
function getTargetShort() {
  return document.getElementById('tgt-lang')?.value || 'en';
}

function setEngineChip(id, status) {
  // status: 'on' | 'off' | 'pending'
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('on', 'off', 'pending');
  el.classList.add(status);
}

async function detectOfflineEngines() {
  // Phrasebook is always available
  setEngineChip('engine-chip-dict', 'on');

  // Chrome AI Translator: check for window.Translator (Chrome 138+)
  try {
    if ('Translator' in self && typeof self.Translator.availability === 'function') {
      const srcShort = getSourceShort();
      const tgtShort = getTargetShort();
      const avail = await self.Translator.availability({ sourceLanguage: srcShort, targetLanguage: tgtShort });
      if (avail === 'available' || avail === 'downloadable' || avail === 'downloading') {
        setEngineChip('engine-chip-ai', 'on');
      } else {
        setEngineChip('engine-chip-ai', 'off');
      }
    } else {
      setEngineChip('engine-chip-ai', 'off');
    }
  } catch (e) {
    console.warn('Translator API check failed:', e);
    setEngineChip('engine-chip-ai', 'off');
  }

  // Vosk: check if already loaded
  setEngineChip('engine-chip-voice', translator.offline.voskReady ? 'on' : 'off');
}


/* ═══════════════════════════════════════════════════════════════
   [TRANSLATOR · OFFLINE — TRANSLATION]
   Tries in order:
     1. Exact phrasebook match (instant, free)
     2. Chrome window.Translator (offline, unlimited, Chrome 138+)
     3. Fallback: MyMemory if device is actually online
     4. Else: graceful error
═══════════════════════════════════════════════════════════════ */

async function runOfflineTranslation() {
  const input = document.getElementById('offline-input-text').value.trim();
  if (!input) {
    showStatus('✍️ Type or speak something first.', 'info', 2500);
    return;
  }

  const srcShort = getSourceShort();
  const tgtShort = getTargetShort();

  // Update the "original" display
  document.getElementById('offline-transcript').innerHTML =
    `<span class="final">${escapeHtml(input)}</span>`;

  const transEl    = document.getElementById('offline-translation');
  const engineBadge = document.getElementById('offline-engine-used');
  transEl.innerHTML = `<span class="placeholder">⏳ Translating offline…</span>`;
  engineBadge.textContent = '';

  // Same language → just echo
  if (srcShort === tgtShort) {
    transEl.innerHTML = `<span>${escapeHtml(input)}</span>`;
    engineBadge.textContent = '(same language)';
    showOfflineSOSPopup();
    return;
  }

  // Tier 1: phrasebook
  const pb = phrasebookLookup(input, srcShort, tgtShort);
  if (pb) {
    transEl.innerHTML = `<span>${escapeHtml(pb)}</span>`;
    engineBadge.textContent = '· phrasebook';
    showOfflineSOSPopup();
    playAlertChime();
    return;
  }

  // Tier 2: Chrome built-in Translator API
  try {
    if ('Translator' in self) {
      const pairKey = `${srcShort}->${tgtShort}`;
      if (!translator.offline.aiTranslator || translator.offline.aiTranslatorPair !== pairKey) {
        // (re)build for this language pair
        const avail = await self.Translator.availability({ sourceLanguage: srcShort, targetLanguage: tgtShort });
        if (avail === 'unavailable') throw new Error('pair-unavailable');

        const inst = await self.Translator.create({
          sourceLanguage: srcShort,
          targetLanguage: tgtShort,
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
              const pct = Math.round((e.loaded || 0) * 100);
              transEl.innerHTML = `<span class="placeholder">⬇ Downloading language pack… ${pct}%</span>`;
            });
          },
        });
        translator.offline.aiTranslator = inst;
        translator.offline.aiTranslatorPair = pairKey;
      }
      const translated = await translator.offline.aiTranslator.translate(input);
      transEl.innerHTML = `<span>${escapeHtml(translated)}</span>`;
      engineBadge.textContent = '· Chrome AI (offline)';
      showOfflineSOSPopup();
      playAlertChime();
      return;
    }
  } catch (err) {
    console.warn('Chrome Translator failed:', err);
    // fall through
  }

  // Tier 3: MyMemory fallback if actually online
  if (navigator.onLine) {
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(input)}&langpair=${srcShort}|${tgtShort}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data?.responseData?.translatedText) {
        transEl.innerHTML = `<span>${escapeHtml(data.responseData.translatedText)}</span>`;
        engineBadge.textContent = '· MyMemory (network)';
        showOfflineSOSPopup();
        playAlertChime();
        return;
      }
    } catch (e) {
      console.warn('MyMemory fallback failed:', e);
    }
  }

  // Tier 4: nothing worked
  transEl.innerHTML =
    `<span class="placeholder">⚠️ No offline engine available for ${srcShort}→${tgtShort}. ` +
    `Use Chrome 138+ for built-in offline translation, or connect to the internet.</span>`;
}

function showOfflineSOSPopup() {
  document.getElementById('offline-sos-area').classList.remove('hidden');
}

function clearOfflineTranslator() {
  document.getElementById('offline-input-text').value = '';
  document.getElementById('offline-transcript').innerHTML =
    `<span class="placeholder">Text you type or speak appears here…</span>`;
  document.getElementById('offline-translation').innerHTML =
    `<span class="placeholder">Translation will appear here.</span>`;
  document.getElementById('offline-engine-used').textContent = '';
  document.getElementById('offline-sos-area').classList.add('hidden');
  showStatus('🧹 Cleared.', 'info', 2000);
}


/* ═══════════════════════════════════════════════════════════════
   [TRANSLATOR · OFFLINE — VOSK VOICE INPUT]
   Vosk is a free on-device speech engine (WebAssembly). First use
   downloads ~40 MB for the selected source language; afterwards it
   works with zero network.

   If loading fails (CDN blocked, slow network, etc.) the user can
   still type — graceful degradation.
═══════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════
   PATCH for SafeHer · script.js
   Replace EVERYTHING between line 1934 and line 2062 (inclusive)
   of your existing script.js with the block below.
   That is: from `const VOSK_MODELS = {` through the closing `}`
   of `loadScript()`. Keep startOfflineVoice/stopOfflineVoice as-is.
═══════════════════════════════════════════════════════════════ */

// CORS-safe mirrors only. (alphacephei.com sends no CORS headers
// → silent failure in browsers.) Sizes in MB are approximate.
const VOSK_MODELS = {
  en: { url: 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz', size: 40 },
  fr: { url: 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-fr-pguyot-0.3.tar.gz', size: 41 },
  es: { url: 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-es-0.3.tar.gz',     size: 39 },
  de: { url: 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-de-0.15.tar.gz',    size: 45 },
  ru: { url: 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-ru-0.4.tar.gz',     size: 45 },
  zh: { url: 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-cn-0.3.tar.gz',     size: 42 },
  it: { url: 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-it-0.4.tar.gz',     size: 48 },
  pt: { url: 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-pt-0.3.tar.gz',     size: 31 },
  ml: { url: 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-malayalam-bigram.tar.gz', size: 80 },
  // Languages without a CORS-safe public mirror. User must use the
  // "📂 Load from file" button (downloaded once from alphacephei.com, picked manually).
  // Includes most Indian languages — the alphacephei CDN blocks browser fetches.
  hi: { url: null, size: 42 },
  bn: { url: null, size: 35 },
  ta: { url: null, size: 50 },
  te: { url: null, size: 35 },
  mr: { url: null, size: 35 },
  gu: { url: null, size: 35 },
  kn: { url: null, size: 35 },
  pa: { url: null, size: 35 },
  ur: { url: null, size: 35 },
  ja: { url: null, size: 50 },
  ko: { url: null, size: 80 },
};

const VOSK_CACHE = 'safeher-vosk-v1';

function toggleOfflineVoice() {
  if (translator.offline.voskListening) { stopOfflineVoice(); return; }
  if (!translator.offline.voskReady) {
    document.getElementById('offline-voice-setup').classList.remove('hidden');
    return;
  }
  startOfflineVoice();
}

function hideVoiceSetup() {
  document.getElementById('offline-voice-setup').classList.add('hidden');
}

// Public entry point — bound to the "Download voice model" button.
async function downloadOfflineVoiceModel() {
  const srcShort = getSourceShort();
  const meta = VOSK_MODELS[srcShort];

  // No CORS-safe URL for this language → auto-open the file picker.
  // This covers Hindi and most Indian languages (alphacephei.com blocks
  // browser fetches; ccoreilly's mirror doesn't host them). Showing a
  // toast and returning leaves the user thinking the button is broken,
  // so we trigger the picker instead and explain inline.
  if (!meta || !meta.url) {
    showStatus(
      `ℹ️ No online model for "${srcShort}". Pick the .tar.gz file you downloaded from alphacephei.com.`,
      '', 6000
    );
    const picker = document.getElementById('vosk-file-input');
    if (picker) picker.click();
    return;
  }
  await _loadVoskModel(srcShort, meta.url, meta.size * 1024 * 1024, /*fromFile*/ false);
}

// Public entry point — bound to the file-picker.
async function loadModelFromFile(file) {
  if (!file) return;
  const srcShort = getSourceShort();
  const blobUrl  = URL.createObjectURL(file);
  await _loadVoskModel(srcShort, blobUrl, file.size, /*fromFile*/ true);
}

// Core loader: streams, shows real progress, caches, hands a blob: URL to Vosk.
async function _loadVoskModel(srcShort, sourceUrl, sizeHint, fromFile) {
  const btn    = document.getElementById('voice-download-btn');
  const wrap   = document.getElementById('voice-progress-wrap');
  const fill   = document.getElementById('voice-progress-fill');
  const pctEl  = document.getElementById('voice-progress-pct');
  const textEl = document.getElementById('voice-progress-text');

  btn.disabled = true;
  btn.textContent = 'Working…';
  wrap.classList.remove('hidden');
  fill.style.width = '2%';
  pctEl.textContent = '2%';

  // 1) Load the vosk-browser library (≈100 KB, separate from the model)
  try {
    if (typeof Vosk === 'undefined') {
      textEl.textContent = 'Loading speech engine…';
      await loadScript('https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js');
    }
  } catch (err) {
    return _voskFail(textEl, btn, fill, '❌ Engine library blocked. Check your connection and retry.');
  }

  // 2) Get the model archive
  let blobUrl = sourceUrl;
  try {
    if (fromFile) {
      // User-picked file → already a blob: URL, nothing to fetch.
      textEl.textContent = 'Reading file…';
      fill.style.width = '60%';
      pctEl.textContent = '60%';
    } else {
      // Try Cache API first (instant on revisit).
      const cache = ('caches' in window) ? await caches.open(VOSK_CACHE) : null;
      let resp   = cache ? await cache.match(sourceUrl) : null;

      if (resp) {
        textEl.textContent = '⚡ Loading from cache…';
        fill.style.width = '70%';
        pctEl.textContent = '70%';
        const blob = await resp.blob();
        blobUrl    = URL.createObjectURL(blob);
      } else {
        textEl.textContent = 'Downloading model…';
        resp = await fetch(sourceUrl, { mode: 'cors' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const total  = Number(resp.headers.get('content-length')) || sizeHint || 0;
        const reader = resp.body.getReader();
        const chunks = [];
        let received = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (total) {
            const pct = Math.min(95, Math.round((received / total) * 95));
            fill.style.width = `${pct}%`;
            pctEl.textContent = `${pct}% · ${(received / 1048576).toFixed(1)} MB`;
          } else {
            // No content-length header → show MB only.
            pctEl.textContent = `${(received / 1048576).toFixed(1)} MB`;
          }
        }

        const blob = new Blob(chunks, { type: 'application/octet-stream' });
        if (cache) {
          // Re-wrap so Cache API stores it cleanly.
          await cache.put(sourceUrl, new Response(blob.slice(), {
            headers: { 'Content-Type': 'application/octet-stream' }
          }));
        }
        blobUrl = URL.createObjectURL(blob);
      }
    }
  } catch (err) {
    console.error('[Vosk] model fetch failed:', err);
    return _voskFail(
      textEl, btn, fill,
      `❌ Download blocked (${err.message}). Tap "📂 Load model from file" and pick the .tar.gz manually.`
    );
  }

  // 3) Hand the blob: URL to Vosk. Same-origin → no CORS, always works.
  try {
    textEl.textContent = 'Unpacking model…';
    fill.style.width = '97%';
    pctEl.textContent = '97%';

    const model = await Vosk.createModel(blobUrl);

    translator.offline.voskModel      = model;
    translator.offline.voskLoadedLang = srcShort;
    translator.offline.voskReady      = true;

    fill.style.width = '100%';
    pctEl.textContent = '100%';
    textEl.textContent = '✅ Voice model ready!';
    setEngineChip('engine-chip-voice', 'on');
    showStatus('✅ Offline voice ready. Tap 🎤 Voice to start.', 'success', 5000);
    setTimeout(() => document.getElementById('offline-voice-setup').classList.add('hidden'), 1200);
  } catch (err) {
    console.error('[Vosk] model unpack failed:', err);
    _voskFail(textEl, btn, fill, `❌ Could not unpack model: ${err.message || err}`);
  }
}

function _voskFail(textEl, btn, fill, msg) {
  textEl.textContent = msg;
  fill.style.width = '0%';
  btn.disabled = false;
  btn.textContent = '⬇ Retry download (~40 MB)';
  showStatus(msg, '', 7000);
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${url}`));
    document.head.appendChild(s);
  });
}
async function startOfflineVoice() {
  if (!translator.offline.voskReady) {
    showStatus('⚠️ Offline voice model not loaded yet.', '', 4000);
    return;
  }

  // If the user changed source language since the model was loaded, rebuild
  if (translator.offline.voskLoadedLang !== getSourceShort()) {
    showStatus('⚠️ Language changed — redownload the offline voice model for the new language.', '', 6000);
    translator.offline.voskReady = false;
    setEngineChip('engine-chip-voice', 'off');
    document.getElementById('offline-voice-setup').classList.remove('hidden');
    const btn = document.getElementById('voice-download-btn');
    btn.disabled = false;
    btn.textContent = '⬇ Download voice model (~40 MB)';
    return;
  }

  const pill = document.getElementById('offline-voice-pill');
  const pillTxt = document.getElementById('offline-voice-text');
  pill.classList.remove('hidden');
  pill.className = 'translator-state-pill listening';
  pillTxt.textContent = '🎙️ Listening offline — speak now';

  try {
    // Create a KaldiRecognizer at 16 kHz (Vosk small-model standard)
    const model = translator.offline.voskModel;
    const recognizer = new model.KaldiRecognizer(16000);
    recognizer.setWords(true);

    recognizer.on('result', (msg) => {
      const text = msg?.result?.text;
      if (text && text.trim()) {
        const inputEl = document.getElementById('offline-input-text');
        inputEl.value = (inputEl.value + ' ' + text).trim();
        // Auto-translate on each finalized chunk
        runOfflineTranslation();
      }
    });

    recognizer.on('partialresult', (msg) => {
      const partial = msg?.result?.partial;
      if (partial) {
        pillTxt.textContent = `🗣️ …${partial}`;
      }
    });

    // Mic access — request mono 16 kHz where possible
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
        sampleRate: 16000,
      },
      video: false,
    });

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source   = audioCtx.createMediaStreamSource(stream);

    // vosk-browser ships its own AudioWorklet processor: registerPort + AudioWorkletNode
    // But we can use the simpler ScriptProcessorNode for broad compat — it's deprecated
    // but still works, and we're in a short-running foreground session.
    const bufferSize = 4096;
    const processor  = audioCtx.createScriptProcessor(bufferSize, 1, 1);

    processor.onaudioprocess = (e) => {
      try {
        recognizer.acceptWaveform(e.inputBuffer);
      } catch (err) {
        // vosk-browser may occasionally throw on edge buffers — ignore and keep going
        console.debug('acceptWaveform skip:', err?.message);
      }
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);

    translator.offline.voskRecognizer = recognizer;
    translator.offline.voskAudioCtx   = audioCtx;
    translator.offline.voskStream     = stream;
    translator.offline.voskNode       = processor;
    translator.offline.voskListening  = true;

    // Flip the Voice button to "Stop"
    const voiceBtn = document.getElementById('offline-voice-btn');
    voiceBtn.classList.add('listening');
    voiceBtn.innerHTML = '⏹ Stop';
  } catch (err) {
    console.error('Offline voice start failed:', err);
    pill.className = 'translator-state-pill error';
    pillTxt.textContent = `❌ ${err.message || 'Could not start microphone'}`;
    showStatus(`❌ Offline voice failed: ${err.message || err}`, '', 5000);
  }
}

function stopOfflineVoice() {
  const o = translator.offline;
  try { if (o.voskNode)      o.voskNode.disconnect(); } catch (e) {}
  try { if (o.voskAudioCtx)  o.voskAudioCtx.close();   } catch (e) {}
  try { if (o.voskStream)    o.voskStream.getTracks().forEach(t => t.stop()); } catch (e) {}
  try { if (o.voskRecognizer) o.voskRecognizer.remove(); } catch (e) {}

  o.voskNode = null;
  o.voskAudioCtx = null;
  o.voskStream = null;
  o.voskRecognizer = null;
  o.voskListening = false;

  const pill = document.getElementById('offline-voice-pill');
  pill.classList.add('hidden');
  pill.className = 'translator-state-pill idle hidden';

  const voiceBtn = document.getElementById('offline-voice-btn');
  voiceBtn.classList.remove('listening');
  voiceBtn.innerHTML = '🎤 Voice';
}


/* ═══════════════════════════════════════════════════════════════
   [INIT] DOMContentLoaded
═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  renderContacts();
  renderIncidents();
  renderRecordings();
  loadF2SKey();
  wireAudioDurationChips();

  // Secret keyboard shortcut: press S three times = SOS
  let keyCount = 0;
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 's' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      keyCount++;
      clearTimeout(window._keyTimer);
      window._keyTimer = setTimeout(() => { keyCount = 0; }, 1500);
      if (keyCount >= 3) { keyCount = 0; triggerSOS(); }
    }
  });

  setTimeout(() => {
    showStatus('👋 Welcome to SafeHer! Add emergency contacts first to enable SOS calling.', 'info', 6000);
  }, 600);
});
