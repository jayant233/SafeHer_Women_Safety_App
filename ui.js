/* SafeHer UI v2 — behaviour layer. Loads AFTER script.js; wraps/overrides functions, never edits script.js.
   Overrides: renderContacts, addContact, deleteContact, displayLocationOnScreen, updateTimerDisplay, endFakeCall, renderIncidents, showStatus (strips emoji), setTranslatorState, setListenButton. Adds: openSettings, setPref, openOnboarding, swapLanguages, requestSOS, cancelSOS, undoDelete, closeSOSActive, shareFromSOS, answerFakeCall. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const I = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const P = {
    call: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.9L12 3.5z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.4c1.9.8 3 2.6 3 5.6"/>'
  };
  const fmt = p => p.length === 10 ? p.slice(0, 5) + ' ' + p.slice(5) : '+' + p;
  const hue = n => [...n].reduce((a, c) => a + c.charCodeAt(0), 0) * 47 % 360;
  const buzz = ms => { try { LS.get('safeher_vibrate', '1') !== '0' && navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

  /* Home status chips */
  function updateStatus() {
    let n = 0, loc = false;
    try { n = getContacts().length; } catch (e) {}
    try { loc = !!currentLocation; } catch (e) {}
    const a = $('chip-contacts'), b = $('chip-loc');
    if (!a || !b) return;
    a.className = 'chip ' + (n ? 'ok' : 'warn');
    a.lastElementChild.textContent = n ? n + (n > 1 ? ' contacts ready' : ' contact ready') : 'Add an emergency contact';
    b.className = 'chip ' + (loc ? 'ok' : '');
    b.lastElementChild.textContent = loc ? 'Location ready' : 'Check my location';
  }

  /* SOS with a 3-second cancel window (accidental taps no longer call/alert instantly) */
  let timer = null, left = 0, practiceMode = false;
  const hideCountdown = () => { clearInterval(timer); timer = null; $('sos-countdown').classList.add('hidden'); };
  window.requestSOS = function (practice) {
    if (timer) return;
    practiceMode = practice === true;
    if (!practiceMode && LS.get('safeher_sos_delay', '3') === '0') { try { getAudioContext(); } catch (e) {} triggerSOS(); openSOSActive(); return; }
    try { getAudioContext(); } catch (e) {}          // unlock audio while we still have the user's tap
    left = practiceMode ? 3 : (parseInt(LS.get('safeher_sos_delay', '3')) || 3); $('sos-count').textContent = left;
    $('sos-cd-title').textContent = practiceMode ? 'Practice run. SOS in' : 'Sending SOS in';
    $('sos-countdown').classList.remove('hidden'); $('sos-cancel-btn').focus(); buzz(60);
    timer = setInterval(() => {
      left--;
      if (left > 0) { $('sos-count').textContent = left; buzz(40); }
      else { hideCountdown(); if (practiceMode) { practiceMode = false; showStatus('Practice complete. Nothing was sent.', 'success'); } else { triggerSOS(); openSOSActive(); } }
    }, 1000);
  };
  window.cancelSOS = function () { practiceMode = false; hideCountdown(); showStatus('SOS cancelled. Nothing was sent.', 'success'); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && timer) cancelSOS(); });

  /* Contacts list: safe rendering, avatars, call button, friendly empty state */
  window.renderContacts = function () {
    const list = getContacts(), el = $('contacts-list');
    el.innerHTML = list.length ? list.map(c => `
      <div class="contact-item${c.isPrimary ? ' primary-contact' : ''}">
        <div class="contact-avatar" style="--h:${hue(c.name)}">${esc(c.name.charAt(0).toUpperCase())}</div>
        <div class="contact-info">
          <div class="contact-name"><span>${esc(c.name)}</span>${c.isPrimary ? '<span class="primary-badge">Primary</span>' : ''}</div>
          <div class="contact-phone">${fmt(c.phone)}</div>
        </div>
        <div class="contact-actions">
          <a class="contact-action-btn" href="tel:${esc(c.phone)}" aria-label="Call ${esc(c.name)}">${I(P.call)}</a>
          ${c.isPrimary ? '' : `<button class="contact-action-btn" onclick="setPrimaryContact(${c.id})" aria-label="Make ${esc(c.name)} primary">${I(P.star)}</button>`}
          <button class="contact-action-btn danger" onclick="deleteContact(${c.id})" aria-label="Remove ${esc(c.name)}">${I(P.trash)}</button>
        </div>
      </div>`).join('')
      : `<div class="empty">${I(P.users)}<h4>No emergency contacts yet</h4><p>Add someone you trust. They get your location when you press SOS.</p></div>`;
    updateStatus();
  };

  /* Add contact: inline validation instead of a distant toast */
  const origAdd = window.addContact;
  window.addContact = function () {
    const name = $('contact-name'), ph = $('contact-phone'), digits = ph.value.replace(/\D/g, '');
    let msg = '';
    name.classList.remove('invalid'); ph.classList.remove('invalid');
    if (!name.value.trim()) { msg = 'Enter a name, like "Mom".'; name.classList.add('invalid'); name.focus(); }
    else if (digits.length < 7 || digits.length > 15) { msg = 'Enter a valid phone number (7–15 digits).'; ph.classList.add('invalid'); ph.focus(); }
    $('contact-error').textContent = msg;
    if (!msg) origAdd();
  };

  /* Delete with undo */
  let snapshot = null, undoTimer = null;
  window.deleteContact = function (id) {
    const prev = getContacts(), gone = prev.find(c => c.id === id);
    if (!gone) return;
    const next = prev.filter(c => c.id !== id);
    if (gone.isPrimary && next.length) next[0].isPrimary = true;
    snapshot = prev; saveContacts(next); renderContacts();
    $('undo-text').textContent = gone.name + ' removed';
    $('undo-bar').classList.remove('hidden');
    clearTimeout(undoTimer); undoTimer = setTimeout(() => $('undo-bar').classList.add('hidden'), 6000);
  };
  window.undoDelete = function () {
    if (!snapshot) return;
    saveContacts(snapshot); snapshot = null; renderContacts();
    $('undo-bar').classList.add('hidden'); clearTimeout(undoTimer);
  };

  /* Keep the location chip in sync whenever script.js finds a location */
  const origShow = window.displayLocationOnScreen;
  if (origShow) window.displayLocationOnScreen = function () { const r = origShow.apply(this, arguments); updateStatus(); sosLocFound(); return r; };


  /* ── Phase 3 ── */
  P.clip = '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>';

  /* Full-screen "SOS active" state shown after the countdown */
  let sosLocTimer = null;
  function openSOSActive() {
    const c = (typeof getPrimaryContact === 'function') && getPrimaryContact(), l = $('sos-act-loc');
    $('sos-act-call').textContent = c ? 'Calling ' + c.name : 'No contact to call. Add one in Contacts.';
    l.className = ''; l.textContent = 'Finding your location…';
    $('sos-active').classList.remove('hidden'); buzz([200, 100, 200]);
    clearTimeout(sosLocTimer);
    sosLocTimer = setTimeout(() => { if (!l.classList.contains('done')) l.textContent = 'Location not found. Call 112 or share it manually.'; }, 12000);
  }
  function sosLocFound() {
    const l = $('sos-act-loc');
    if (l && !$('sos-active').classList.contains('hidden')) { l.className = 'done'; l.textContent = 'Location found'; }
  }
  window.closeSOSActive = () => { $('sos-active').classList.add('hidden'); clearTimeout(sosLocTimer); };
  window.shareFromSOS = () => {
    closeSOSActive(); switchTab('home');
    const c = $('share-card');
    if (c && !c.classList.contains('hidden')) c.scrollIntoView({ behavior: 'smooth' }); else fetchLocation();
  };

  /* Safety timer: circular progress ring driven by the existing countdown */
  function ring() {
    const a = $('timer-ring-arc'); if (!a) return;
    let t = 0; try { t = timerSecondsLeft; } catch (e) {}
    const total = parseInt($('timer-duration').value) || 1, C = 2 * Math.PI * 54;
    a.style.strokeDasharray = C; a.style.strokeDashoffset = C * (1 - Math.max(0, Math.min(1, t / total)));
    a.classList.toggle('urgent', t <= 10);
  }
  const origTimer = window.updateTimerDisplay;
  if (origTimer) window.updateTimerDisplay = function () { const r = origTimer.apply(this, arguments); ring(); return r; };

  /* Fake call: Answer now opens a realistic in-call screen with a running timer */
  let callTimer = null;
  window.answerFakeCall = function () {
    try { stopRingtone(); } catch (e) {}
    const o = $('fake-call-overlay'), net = o.querySelector('.call-network'); let s = 0;
    o.classList.add('in-call'); o.querySelector('.call-label').textContent = 'In call'; net.textContent = '00:00';
    clearInterval(callTimer);
    callTimer = setInterval(() => { s++; net.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }, 1000);
  };
  const origEnd = window.endFakeCall;
  window.endFakeCall = function () {
    clearInterval(callTimer); callTimer = null;
    const o = $('fake-call-overlay');
    o.classList.remove('in-call'); o.querySelector('.call-label').textContent = 'Incoming call'; o.querySelector('.call-network').textContent = 'Mobile · India';
    origEnd();
  };

  /* Incident log as a timeline (escaped text, no emoji) */
  window.renderIncidents = function () {
    const list = getIncidents(), el = $('incident-list'); if (!el) return;
    if (!list.length) { el.innerHTML = `<div class="empty">${I(P.clip)}<h4>No incidents yet</h4><p>Every SOS is saved here with the time and place, ready for a police report.</p></div>`; return; }
    el.innerHTML = '<ol class="timeline">' + list.map((inc, i) => `
      <li class="tl-item">
        <div class="tl-head"><strong>Incident ${list.length - i}</strong><span>${esc(inc.date)} · ${esc(inc.time)}</span></div>
        ${inc.mapsLink ? `<a class="tl-loc" href="${esc(inc.mapsLink)}" target="_blank" rel="noopener">${esc(inc.lat)}, ${esc(inc.lng)}</a>` : '<span class="tl-note">Location unavailable</span>'}
        <span class="tl-note">${esc(inc.notes)}</span>
      </li>`).join('') + '</ol>';
  };


  /* ── Phase 4 ── */
  /* No emoji in popups or translator messages (script.js still sends them; we clean them here) */
  const EMOJI = /[\u2300-\u23FF\u25A0-\u25FF\u2600-\u27BF\u2B00-\u2BFF\u{1F000}-\u{1FAFF}\uFE0F\u200D]/gu;
  const clean = m => typeof m === 'string' ? m.replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim() : m;
  const origStatus = window.showStatus;
  window.showStatus = function (m) { const a = Array.from(arguments); a[0] = clean(m); return origStatus.apply(this, a); };
  const origState = window.setTranslatorState;
  if (origState) window.setTranslatorState = function (st, m) { return origState.call(this, st, clean(m)); };

  /* Mic button keeps its SVG icon (script.js used to swap in emoji) */
  const MIC = I('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>');
  const STOP = I('<rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/>');
  window.setListenButton = function (on) {
    const b = $('translator-listen-btn'); if (!b) return;
    b.classList.toggle('listening', !!on);
    b.querySelector('.listen-label').textContent = on ? 'Tap to stop' : 'Tap to start listening';
    b.querySelector('.listen-icon').innerHTML = on ? STOP : MIC;
  };

  /* Swap "They speak" and "I read in" (the two lists use different code formats, so map through LANGUAGES) */
  window.swapLanguages = function () {
    const s = $('src-lang'), t = $('tgt-lang');
    if (!s || !t || !s.options.length) return;
    const from = LANGUAGES.find(L => L.code === s.value), to = LANGUAGES.find(L => L.short === t.value);
    if (!from || !to) return;
    t.value = from.short; s.value = to.code;
    s.dispatchEvent(new Event('change'));
  };


  /* ── Phase 5: settings, themes, first-run setup, installable app ── */
  const LS = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
  function applyTheme() {
    const p = LS.get('safeher_theme', 'dark'), r = p === 'auto' ? (mq && mq.matches ? 'light' : 'dark') : p;
    document.documentElement.setAttribute('data-theme', r);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = r === 'light' ? '#F6F4FF' : '#120E24';
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', applyTheme);

  /* Settings sheet */
  let sh = null;
  const SEG = (k, cur, o) => '<div class="mode-switch seg">' + o.map(([v, l]) =>
    `<button class="mode-switch-btn${String(cur) === v ? ' active' : ''}" onclick="setPref('${k}','${v}')"><span class="mode-label">${l}</span></button>`).join('') + '</div>';
  function drawSettings() {
    sh.innerHTML = `<div class="sheet-backdrop" onclick="closeSettings()"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Settings">
        <div class="sheet-head"><h2>Settings</h2><button class="contact-action-btn" onclick="closeSettings()" aria-label="Close settings">${I('<path d="M6 6l12 12M18 6 6 18"/>')}</button></div>
        <h3 class="sheet-h">Appearance</h3>${SEG('safeher_theme', LS.get('safeher_theme', 'dark'), [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']])}
        <h3 class="sheet-h">Language</h3>${SEG('safeher_lang', LS.get('safeher_lang', 'en'), [['en', 'English'], ['hi', 'हिन्दी']])}
        <h3 class="sheet-h">Countdown before SOS</h3>${SEG('safeher_sos_delay', LS.get('safeher_sos_delay', '3'), [['3', '3 sec'], ['5', '5 sec'], ['0', 'Off']])}
        <div class="sheet-row"><span>Vibration</span><label class="toggle-switch"><input type="checkbox" ${LS.get('safeher_vibrate', '1') !== '0' ? 'checked' : ''} onchange="setPref('safeher_vibrate',this.checked?'1':'0')"><span class="toggle-slider"></span></label></div>
        <button class="btn-secondary" onclick="closeSettings();requestSOS(true)">Practice SOS</button>
        <button class="btn-secondary" onclick="closeSettings();openOnboarding()">Run setup again</button>
        <p class="muted-text small">Contacts, incidents and settings are stored on this phone only.</p>
        <button class="btn-danger" onclick="wipeData()">Delete all my data</button>
      </div>`;
  }
  window.openSettings = function () { if (sh) return; sh = document.createElement('div'); document.body.appendChild(sh); drawSettings(); };
  window.closeSettings = function () { if (sh) { sh.remove(); sh = null; } };
  window.setPref = function (k, v) { LS.set(k, v); if (k === 'safeher_theme') applyTheme(); if (k === 'safeher_lang' && window.applyLang) window.applyLang(); if (sh) drawSettings(); };
  window.wipeData = function () {
    if (!confirm(window.i18n('Delete all contacts, incidents and settings from this phone? This cannot be undone.'))) return;
    try { Object.keys(localStorage).filter(k => k.indexOf('safeher_') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    location.reload();
  };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

  /* First-run setup: contact -> permissions -> practice */
  let ob = null, obStep = 0;
  const OB = [
    { t: 'Add someone you trust', p: 'They are the first person SafeHer calls when you press SOS.',
      body: '<input id="ob-name" class="input-field" placeholder="Name, like Mom" autocomplete="name" aria-label="Contact name"><input id="ob-phone" class="input-field" type="tel" inputmode="tel" placeholder="Phone number" autocomplete="tel" aria-label="Phone number"><p class="field-error" id="ob-error" role="alert"></p>' },
    { t: 'Allow what SOS needs', p: 'Your phone will ask for permission. SafeHer only uses these when you ask it to.',
      body: '<button class="btn-secondary" id="ob-loc" onclick="obAllow(\'loc\')">Allow location</button><p class="muted-text small">Lets your contacts see where you are.</p><button class="btn-secondary" id="ob-mic" onclick="obAllow(\'mic\')">Allow microphone</button><p class="muted-text small">For audio evidence and the translator.</p>' },
    { t: 'Practice once', p: 'See what happens when you press SOS. Nothing is sent during practice.',
      body: '<button class="btn-primary" onclick="requestSOS(true)">Practice SOS</button><p class="muted-text small">You can always cancel during the countdown.</p>' }
  ];
  const obLg = () => /hi/.test(LS.get('safeher_lang', '')) ? 'hi' : 'en';
  window.obLang = function (v) { setPref('safeher_lang', v); document.querySelectorAll('.ob-lang button').forEach(b => { const on = b.dataset.l === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); };
  function drawOB() {
    const s = OB[obStep], last = obStep === OB.length - 1;
    ob.innerHTML = `<div class="ob-card">
      <div class="ob-dots" aria-hidden="true">${OB.map((_, i) => `<i class="${i <= obStep ? 'on' : ''}"></i>`).join('')}</div>
      <div class="ob-top"><p class="muted-text small">Step ${obStep + 1} of ${OB.length}</p>
        <div class="ob-lang" role="group" aria-label="Language">${[['en', 'English'], ['hi', 'हिन्दी']].map(([v, l]) => `<button type="button" lang="${v}" data-l="${v}" class="${obLg() === v ? 'on' : ''}" aria-pressed="${obLg() === v}" onclick="obLang('${v}')">${l}</button>`).join('')}</div></div>
      <h2 class="ob-title">${s.t}</h2><p class="ob-sub">${s.p}</p>
      <div class="ob-body">${s.body}</div>
      <div class="ob-actions"><button class="btn-primary" onclick="obNext()">${last ? 'Finish' : 'Continue'}</button>
      <button class="btn-secondary" onclick="closeOB()">${last ? 'Close' : 'Skip for now'}</button></div></div>`;
    const f1 = ob.querySelector('.ob-body input, .ob-body button'); if (f1) f1.focus(); /* first field, not the language switch */
  }
  window.openOnboarding = function () {
    if (ob) return; obStep = 0; ob = document.createElement('div'); ob.className = 'ob';
    ob.setAttribute('role', 'dialog'); ob.setAttribute('aria-modal', 'true'); document.body.appendChild(ob); drawOB();
  };
  window.closeOB = function () { LS.set('safeher_onboarded', '1'); if (ob) { ob.remove(); ob = null; } };
  window.obNext = function () {
    if (obStep === 0) {
      const n = $('ob-name').value.trim(), digits = $('ob-phone').value.replace(/\D/g, ''), err = $('ob-error');
      if (n || digits) {
        if (!n) { err.textContent = 'Enter a name, like "Mom".'; return; }
        if (digits.length < 7 || digits.length > 15) { err.textContent = 'Enter a valid phone number (7–15 digits).'; return; }
        const list = getContacts(); list.push({ id: Date.now(), name: n, phone: digits, isPrimary: list.length === 0 });
        saveContacts(list); renderContacts();
      }
    }
    if (obStep < OB.length - 1) { obStep++; drawOB(); } else closeOB();
  };
  window.obAllow = function (kind) {
    const b = $(kind === 'loc' ? 'ob-loc' : 'ob-mic'), name = kind === 'loc' ? 'Location' : 'Microphone';
    const ok = () => { b.textContent = name + ' allowed'; b.classList.add('done'); };
    const no = () => { b.textContent = name + ' blocked. Allow it in your browser settings.'; };
    if (kind === 'loc') { navigator.geolocation ? navigator.geolocation.getCurrentPosition(ok, no) : no(); }
    else { navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? navigator.mediaDevices.getUserMedia({ audio: true }).then(st => { st.getTracks().forEach(t => t.stop()); ok(); }).catch(no) : no(); }
  };

  applyTheme();
  if (!LS.get('safeher_onboarded', '')) { if (getContacts().length) LS.set('safeher_onboarded', '1'); else { if (LS.get('safeher_lang', '') === '' && /^hi(-|$)/i.test(navigator.language || '')) LS.set('safeher_lang', 'hi'); openOnboarding(); } }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

  updateStatus();
})();

/* Phase 6: modal focus trap + focus return */
(function () {
  const F = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const fc = document.getElementById('fake-call-overlay');
  if (fc) { fc.setAttribute('role', 'dialog'); fc.setAttribute('aria-modal', 'true'); fc.setAttribute('aria-label', 'Incoming call'); }
  const top = () => { const m = [...document.querySelectorAll('[aria-modal="true"]')].filter(e => !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none'); return m[m.length - 1] || null; };
  const items = t => [...t.querySelectorAll(F)].filter(e => e.offsetParent !== null);
  let cur = null, opener = null;
  new MutationObserver(() => {
    const t = top(); if (t === cur) return;
    if (t && !cur) opener = document.activeElement;
    if (t) { const f = items(t); if (f[0] && !t.contains(document.activeElement)) f[0].focus(); }
    else if (opener && document.contains(opener)) { try { opener.focus(); } catch (e) {} opener = null; }
    cur = t;
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return; const t = top(); if (!t) return;
    const f = items(t); if (!f.length) { e.preventDefault(); return; }
    const a = f[0], z = f[f.length - 1], d = document.activeElement;
    if (!t.contains(d)) { e.preventDefault(); a.focus(); }
    else if (e.shiftKey && d === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && d === z) { e.preventDefault(); a.focus(); }
  });
})();


/* Phase 6: Hindi / English interface language.
   Swaps text, placeholder, aria-label and title at runtime from the HI dictionary, so no markup tagging is needed.
   A string that is not in HI stays English. Add new strings to HI (exact text) or to PAT (strings with names or numbers). Setting key: safeher_lang (en / hi). */
(function () {
  const HI = {
    'Home': 'होम', 'Contacts': 'संपर्क', 'Tools': 'टूल्स', 'Track': 'ट्रैक', 'Translate': 'अनुवाद', 'Settings': 'सेटिंग्स', 'Main': 'मुख्य मेन्यू',
    'Add an emergency contact': 'आपातकालीन संपर्क जोड़ें', 'Check my location': 'मेरी लोकेशन जांचें',
    'Help is one tap away': 'मदद बस एक टैप दूर है', 'Alerts your contacts with your live location': 'आपके संपर्कों को आपकी लाइव लोकेशन के साथ अलर्ट भेजता है',
    'Fake call': 'नकली कॉल', 'My location': 'मेरी लोकेशन', 'Safety timer': 'सेफ्टी टाइमर', 'Your Location': 'आपकी लोकेशन',
    'Tap SOS or "Get Location" to fetch your coordinates.': 'अपनी लोकेशन पाने के लिए SOS या "लोकेशन पाएं" दबाएं।',
    'Get Location': 'लोकेशन पाएं', 'Share Location': 'लोकेशन शेयर करें', 'Location unavailable': 'लोकेशन उपलब्ध नहीं',
    'Automatic SMS (needs a Fast2SMS key)': 'ऑटोमैटिक SMS (Fast2SMS key चाहिए)', 'Auto SMS to All': 'सभी को ऑटो SMS', 'Automatic': 'ऑटोमैटिक',
    'Paste Fast2SMS API key here': 'Fast2SMS API key यहां पेस्ट करें', 'Save': 'सेव करें', 'Send SMS to All Contacts Now': 'सभी संपर्कों को अभी SMS भेजें',
    'OR': 'या', 'One tap per person': 'हर व्यक्ति के लिए एक टैप', 'Sending to:': 'इन्हें भेज रहे हैं:',
    'Open WhatsApp for this person': 'इस व्यक्ति के लिए WhatsApp खोलें', 'Share to ALL via WhatsApp': 'सभी को WhatsApp से भेजें',
    'Add Emergency Contact': 'आपातकालीन संपर्क जोड़ें', 'Contact name': 'संपर्क का नाम', 'Contact Name (e.g. Mom)': 'संपर्क का नाम (जैसे मम्मी)',
    'Phone number': 'फ़ोन नंबर', 'Phone Number (e.g. 9876543210)': 'फ़ोन नंबर (जैसे 9876543210)', 'Add Contact': 'संपर्क जोड़ें',
    'Saved Contacts': 'सेव किए गए संपर्क', 'No contacts saved yet.': 'अभी कोई संपर्क सेव नहीं है।', 'No emergency contacts yet': 'अभी कोई आपातकालीन संपर्क नहीं',
    'Add someone you trust. They get your location when you press SOS.': 'किसी भरोसेमंद को जोड़ें। SOS दबाने पर उन्हें आपकी लोकेशन मिलेगी।', 'Primary': 'मुख्य',
    'Safety Timer': 'सेफ्टी टाइमर', "Set a timer. If you don't cancel it, SOS fires automatically.": 'टाइमर लगाएं। रद्द न करने पर SOS अपने आप चल जाएगा।',
    '1 Minute': '1 मिनट', '2 Minutes': '2 मिनट', '5 Minutes': '5 मिनट', '10 Minutes': '10 मिनट', 'Start Timer': 'टाइमर शुरू करें', 'Cancel': 'रद्द करें',
    'SOS will trigger when this reaches 0!': '0 होते ही SOS चालू हो जाएगा!', 'Fake Incoming Call': 'नकली इनकमिंग कॉल',
    'Simulate a call to escape uncomfortable situations.': 'असहज स्थिति से निकलने के लिए कॉल का दिखावा करें।', 'Caller Name (e.g. Mom)': 'कॉल करने वाले का नाम (जैसे मम्मी)',
    'Immediately': 'तुरंत', 'After 5 sec': '5 सेकंड बाद', 'After 10 sec': '10 सेकंड बाद', 'After 30 sec': '30 सेकंड बाद', 'Simulate Call': 'कॉल शुरू करें',
    'Incoming Call': 'इनकमिंग कॉल', 'Decline': 'काटें', 'Answer': 'उठाएं', 'End call': 'कॉल खत्म करें',
    'Live Location Tracker': 'लाइव लोकेशन ट्रैकर', 'Tracker is OFF': 'ट्रैकर बंद है', 'Waiting for GPS...': 'GPS का इंतज़ार...', 'Open in Google Maps ↗': 'Google Maps में खोलें ↗',
    'ML Alert:': 'स्मार्ट अलर्ट:', 'You appear stationary. Are you safe?': 'आप रुके हुए लगते हैं। क्या आप सुरक्षित हैं?', "I'm Safe": 'मैं सुरक्षित हूं',
    'Start Tracking': 'ट्रैकिंग शुरू करें', 'Stop': 'रोकें', 'Share Live Location via WhatsApp': 'लाइव लोकेशन WhatsApp से भेजें',
    'Audio Evidence Recorder': 'ऑडियो सबूत रिकॉर्डर', 'New': 'नया', 'Duration': 'अवधि', '30 sec': '30 सेकंड', '1 min': '1 मिनट', '5 min': '5 मिनट', '10 min': '10 मिनट',
    'Recording': 'रिकॉर्डिंग', 'Start Recording': 'रिकॉर्डिंग शुरू करें', 'Stop Now': 'अभी रोकें', 'No recordings yet.': 'अभी कोई रिकॉर्डिंग नहीं।',
    'Photo & Quick Audio Evidence': 'फ़ोटो और तुरंत ऑडियो सबूत', 'Capture Now (Manual)': 'अभी कैप्चर करें', 'Captured Evidence:': 'कैप्चर किया गया सबूत:',
    'Save Photo': 'फ़ोटो सेव करें', 'Audio Recording (10 sec)': 'ऑडियो रिकॉर्डिंग (10 सेकंड)', 'Save Audio': 'ऑडियो सेव करें',
    'Incident Log & Report': 'घटना लॉग और रिपोर्ट', 'No incidents recorded yet. SOS triggers are saved here automatically.': 'अभी कोई घटना दर्ज नहीं। SOS चलने पर यहां अपने आप सेव होगी।',
    'No incidents yet': 'अभी कोई घटना नहीं', 'Generate Report': 'रिपोर्ट बनाएं', 'Clear Log': 'लॉग साफ़ करें',
    'Translator mode': 'अनुवाद मोड', 'Online': 'ऑनलाइन', 'Best accuracy': 'सबसे सटीक', 'Offline': 'ऑफ़लाइन', 'No internet needed': 'इंटरनेट की ज़रूरत नहीं',
    'They speak': 'वे बोलते हैं', 'Swap languages': 'भाषाएं बदलें', 'I read in': 'मैं पढ़ती हूं',
    "Uses your browser's speech engine + MyMemory translation. Needs internet.": 'आपके ब्राउज़र के स्पीच इंजन और MyMemory अनुवाद का उपयोग करता है। इंटरनेट चाहिए।',
    'Listen & Translate': 'सुनें और अनुवाद करें', 'Tap to start listening': 'सुनना शुरू करने के लिए टैप करें', 'Idle — tap mic to begin': 'तैयार — शुरू करने के लिए माइक दबाएं',
    'Try Again': 'फिर कोशिश करें', 'Switch to Offline': 'ऑफ़लाइन पर जाएं', 'They said': 'उन्होंने कहा', 'You read': 'आप पढ़ें',
    'Live transcription will appear here as they speak…': 'वे जैसे बोलेंगे, लाइव टेक्स्ट यहां दिखेगा…', 'Translation will appear here once we hear something.': 'कुछ सुनते ही अनुवाद यहां दिखेगा।',
    'Feel unsafe? Trigger SOS based on what you just heard.': 'असुरक्षित लग रहा है? अभी जो सुना उसके आधार पर SOS चलाएं।', 'Trigger SOS Now': 'अभी SOS चलाएं',
    'Clear Transcript': 'टेक्स्ट साफ़ करें', 'Offline Translate': 'ऑफ़लाइन अनुवाद', 'Emergency phrasebook': 'आपातकालीन वाक्य', 'Quick safety phrases': 'ज़रूरी सुरक्षा वाक्य',
    'Type what you heard': 'जो सुना वह टाइप करें', 'Voice': 'आवाज़', 'Preparing…': 'तैयार हो रहा है…', 'Later': 'बाद में', 'Idle': 'तैयार', 'Clear': 'साफ़ करें',
    'Text you type or speak appears here…': 'आप जो टाइप या बोलेंगे वह यहां दिखेगा…', 'Translation will appear here.': 'अनुवाद यहां दिखेगा।',
    'Sending SOS in': 'SOS भेजा जा रहा है', 'Your contacts will get your live location.': 'आपके संपर्कों को आपकी लाइव लोकेशन मिलेगी।', "Cancel, I'm safe": 'रद्द करें, मैं सुरक्षित हूं',
    'SOS is active': 'SOS चालू है', 'Alarm sounded': 'अलार्म बज रहा है', 'Finding your location…': 'आपकी लोकेशन खोज रहे हैं…', 'Location found': 'लोकेशन मिल गई',
    'Calling your primary contact': 'आपके मुख्य संपर्क को कॉल हो रही है', 'Call 112': '112 पर कॉल करें', 'Share my location': 'मेरी लोकेशन भेजें', "I'm safe, end SOS": 'मैं सुरक्षित हूं, SOS बंद करें',
    'Contact removed': 'संपर्क हटाया गया', 'Undo': 'वापस लाएं',
    'Appearance': 'दिखावट', 'Language': 'भाषा', 'Auto': 'ऑटो', 'Dark': 'डार्क', 'Light': 'लाइट', 'Countdown before SOS': 'SOS से पहले उलटी गिनती', '3 sec': '3 सेकंड', '5 sec': '5 सेकंड', 'Off': 'बंद',
    'Vibration': 'कंपन', 'Practice SOS': 'SOS का अभ्यास', 'Run setup again': 'सेटअप फिर से चलाएं',
    'Contacts, incidents and settings are stored on this phone only.': 'संपर्क, घटनाएं और सेटिंग्स सिर्फ़ इसी फ़ोन में सेव हैं।', 'Delete all my data': 'मेरा सारा डेटा मिटाएं',
    'Allow location': 'लोकेशन की अनुमति दें', 'Lets your contacts see where you are.': 'आपके संपर्क देख सकेंगे कि आप कहां हैं।',
    'Allow microphone': 'माइक्रोफ़ोन की अनुमति दें', 'For audio evidence and the translator.': 'ऑडियो सबूत और अनुवाद के लिए।', 'You can always cancel during the countdown.': 'उलटी गिनती के दौरान आप कभी भी रद्द कर सकती हैं।',
    'Fetching your location... please wait': 'आपकी लोकेशन खोज रहे हैं... कृपया प्रतीक्षा करें', 'Your browser does not support location.': 'आपका ब्राउज़र लोकेशन सपोर्ट नहीं करता।',
    'Geolocation not supported.': 'लोकेशन सपोर्ट नहीं है।', 'Location fetched! Tap "Share via WhatsApp" to send it.': 'लोकेशन मिल गई! भेजने के लिए "WhatsApp से शेयर करें" दबाएं।',
    'No contacts saved. Go to People tab first.': 'कोई संपर्क सेव नहीं है। पहले संपर्क टैब में जाएं।', 'No emergency contact saved! Go to People tab first.': 'कोई आपातकालीन संपर्क सेव नहीं है! पहले संपर्क टैब में जाएं।',
    'Tap "Get Location" first, then share.': 'पहले "लोकेशन पाएं" दबाएं, फिर शेयर करें।', 'All Done! Share Again?': 'सब हो गया! फिर शेयर करें?',
    'Please paste a valid Fast2SMS API key.': 'कृपया सही Fast2SMS API key पेस्ट करें।', 'Fast2SMS key saved!': 'Fast2SMS key सेव हो गई!', 'API key saved — SMS ready to fire on SOS.': 'API key सेव है — SOS पर SMS जाने को तैयार।',
    'No key saved. Add your Fast2SMS API key above.': 'कोई key सेव नहीं है। ऊपर अपनी Fast2SMS API key जोड़ें।', 'No API key. Save your Fast2SMS key first.': 'API key नहीं है। पहले अपनी Fast2SMS key सेव करें।',
    'Fast2SMS key not saved.': 'Fast2SMS key सेव नहीं है।', 'No contacts saved.': 'कोई संपर्क सेव नहीं है।', 'No valid 10-digit phone numbers.': 'कोई सही 10 अंकों का फ़ोन नंबर नहीं है।',
    'Sending SMS...': 'SMS भेजा जा रहा है...', 'SMS Sent!': 'SMS भेज दिया!', 'SMS failed.': 'SMS नहीं गया।', 'Send SMS to All Contacts': 'सभी संपर्कों को SMS भेजें',
    'SOS ACTIVATED! Getting your location...': 'SOS चालू हो गया! आपकी लोकेशन ली जा रही है...', 'Location found! Calling emergency contact...': 'लोकेशन मिल गई! आपातकालीन संपर्क को कॉल हो रही है...',
    'Location unavailable. Calling contact anyway...': 'लोकेशन नहीं मिली। फिर भी संपर्क को कॉल हो रही है...', 'Please enter both name and phone.': 'कृपया नाम और फ़ोन नंबर दोनों भरें।',
    'Phone number too short.': 'फ़ोन नंबर बहुत छोटा है।', 'Contact removed.': 'संपर्क हटाया गया।', 'Timer expired! SOS triggered automatically!': 'टाइमर खत्म! SOS अपने आप चालू हो गया!',
    'Safety timer cancelled. You are safe!': 'सेफ्टी टाइमर रद्द हुआ। आप सुरक्षित हैं!', 'Call ended.': 'कॉल खत्म हुई।', 'Tracker is ACTIVE — updating live': 'ट्रैकर चालू है — लाइव अपडेट हो रहा है',
    'Live tracker started!': 'लाइव ट्रैकर शुरू हो गया!', 'Live tracker stopped.': 'लाइव ट्रैकर बंद हुआ।', 'Just updated': 'अभी अपडेट हुआ', 'No location yet.': 'अभी लोकेशन नहीं मिली।',
    'Opening WhatsApp...': 'WhatsApp खुल रहा है...', 'Glad you are safe!': 'अच्छा है कि आप सुरक्षित हैं!', 'Capturing evidence...': 'सबूत कैप्चर हो रहा है...', 'Photo captured!': 'फ़ोटो कैप्चर हो गई!',
    'Camera access denied.': 'कैमरे की अनुमति नहीं मिली।', 'Audio recorded!': 'ऑडियो रिकॉर्ड हो गया!', 'Microphone access denied.': 'माइक्रोफ़ोन की अनुमति नहीं मिली।',
    'A recording is already in progress.': 'रिकॉर्डिंग पहले से चल रही है।', 'Mic permission denied. Allow microphone access in browser.': 'माइक की अनुमति नहीं मिली। ब्राउज़र में माइक्रोफ़ोन की अनुमति दें।',
    'Tip: download the recording and attach it manually in WhatsApp.': 'सुझाव: रिकॉर्डिंग डाउनलोड करें और WhatsApp में खुद अटैच करें।', 'Recording deleted.': 'रिकॉर्डिंग हटाई गई।',
    'All incident records cleared.': 'सभी घटना रिकॉर्ड साफ़ हो गए।', 'No incidents to report yet.': 'रिपोर्ट के लिए अभी कोई घटना नहीं।',
    'Report opened! Use Ctrl+P or the print dialog to save as PDF.': 'रिपोर्ट खुल गई! PDF सेव करने के लिए Ctrl+P या प्रिंट डायलॉग इस्तेमाल करें।',
    'Practice complete. Nothing was sent.': 'अभ्यास पूरा हुआ। कुछ भेजा नहीं गया।', 'SOS cancelled. Nothing was sent.': 'SOS रद्द हुआ। कुछ भेजा नहीं गया।',
    'Location not found. Call 112 or share it manually.': 'लोकेशन नहीं मिली। 112 पर कॉल करें या खुद शेयर करें।', 'In call': 'कॉल में', 'Incoming call': 'इनकमिंग कॉल', 'Mobile · India': 'मोबाइल · भारत',
    'Enter a name, like "Mom".': 'नाम लिखें, जैसे "मम्मी"।', 'Enter a valid phone number (7–15 digits).': 'सही फ़ोन नंबर लिखें (7–15 अंक)।',
    'Welcome to SafeHer! Add emergency contacts first to enable SOS calling.': 'SafeHer में स्वागत है! SOS कॉल चालू करने के लिए पहले आपातकालीन संपर्क जोड़ें।',
    'This page must be served over HTTPS.': 'यह पेज HTTPS पर चलना चाहिए।', 'Speech recognition requires HTTPS or localhost.': 'स्पीच रिकग्निशन के लिए HTTPS या localhost चाहिए।',
    'Speech recognition not supported. Use Chrome or Edge.': 'स्पीच रिकग्निशन सपोर्ट नहीं है। Chrome या Edge इस्तेमाल करें।',
    'Speech recognition not supported in this browser. Please use Chrome, or switch to Offline Mode.': 'इस ब्राउज़र में स्पीच रिकग्निशन सपोर्ट नहीं है। Chrome इस्तेमाल करें या ऑफ़लाइन मोड चुनें।',
    'Hearing speech… transcribing': 'आवाज़ सुनाई दी… टेक्स्ट बन रहा है', 'Microphone permission denied. Allow in browser settings.': 'माइक्रोफ़ोन की अनुमति नहीं मिली। ब्राउज़र सेटिंग्स में अनुमति दें।',
    'Microphone permission denied. Click in address bar → Allow microphone.': 'माइक्रोफ़ोन की अनुमति नहीं मिली। एड्रेस बार में क्लिक करके माइक्रोफ़ोन की अनुमति दें।',
    "Didn't hear anything — listening again…": 'कुछ सुनाई नहीं दिया — फिर से सुन रहे हैं…', 'No microphone found. Connect a mic and try again.': 'माइक नहीं मिला। माइक जोड़कर फिर कोशिश करें।',
    'No microphone detected. Plug one in and reload.': 'माइक नहीं मिला। माइक लगाकर पेज रीलोड करें।', 'Speech service unreachable': 'स्पीच सेवा तक नहीं पहुंच पाए',
    'Could not start mic. Refresh the page and try again.': 'माइक शुरू नहीं हो सका। पेज रिफ़्रेश करके फिर कोशिश करें।', 'Translation done': 'अनुवाद हो गया',
    'Translation failed — check internet': 'अनुवाद नहीं हो सका — इंटरनेट जांचें', 'Transcript cleared.': 'टेक्स्ट साफ़ हो गया।', 'Type or speak something first.': 'पहले कुछ टाइप करें या बोलें।', 'Cleared.': 'साफ़ हो गया।',
    'Tap to Stop Listening': 'सुनना रोकने के लिए टैप करें', 'Tap to Start Listening': 'सुनना शुरू करने के लिए टैप करें', '(same language)': '(वही भाषा)', '· phrasebook': '· वाक्य-सूची',
    '· Chrome AI (offline)': '· Chrome AI (ऑफ़लाइन)', '· MyMemory (network)': '· MyMemory (नेटवर्क)', 'Working…': 'काम चल रहा है…', 'Loading speech engine…': 'स्पीच इंजन लोड हो रहा है…',
    'Reading file…': 'फ़ाइल पढ़ी जा रही है…', 'Loading from cache…': 'कैश से लोड हो रहा है…', 'Downloading model…': 'मॉडल डाउनलोड हो रहा है…', 'Unpacking model…': 'मॉडल खुल रहा है…',
    'Voice model ready!': 'वॉइस मॉडल तैयार!', 'Offline voice ready. Tap Voice to start.': 'ऑफ़लाइन वॉइस तैयार। शुरू करने के लिए "आवाज़" दबाएं।',
    'Retry download (~40 MB)': 'दोबारा डाउनलोड करें (~40 MB)', 'Download voice model (~40 MB)': 'वॉइस मॉडल डाउनलोड करें (~40 MB)', 'Offline voice model not loaded yet.': 'ऑफ़लाइन वॉइस मॉडल अभी लोड नहीं हुआ।',
    'Language changed — redownload the offline voice model for the new language.': 'भाषा बदल गई — नई भाषा के लिए ऑफ़लाइन वॉइस मॉडल फिर डाउनलोड करें।',
    'Listening offline — speak now': 'ऑफ़लाइन सुन रहे हैं — अब बोलें', 'Could not start microphone': 'माइक्रोफ़ोन शुरू नहीं हो सका',
    'Call options': 'कॉल के विकल्प', 'Normal phone call': 'सामान्य फ़ोन कॉल', 'WhatsApp call': 'WhatsApp कॉल', 'WhatsApp message + location': 'WhatsApp मैसेज + लोकेशन', 'Dismiss': 'बंद करें',
    'Download': 'डाउनलोड', 'Share Note': 'नोट शेयर करें', 'Delete': 'हटाएं', 'Pick a duration, then tap Start Recording.': 'अवधि चुनें, फिर रिकॉर्डिंग शुरू करें दबाएं।',
  };
  const lang = () => { try { return /hi/.test(localStorage.getItem('safeher_lang') || '') ? 'hi' : 'en'; } catch (e) { return 'en'; } };
  /* Strings with numbers or names: [regex, Hindi with $1 $2]. Specific patterns first. */
  const PAT = [
    [/^Opened for (.+)\. Tap Send, then come back for next\.$/, '$1 के लिए खुल गया। Send दबाएं, फिर अगले के लिए वापस आएं।'],
    [/^WhatsApp opened for all (\d+) contacts!$/, 'सभी $1 संपर्कों के लिए WhatsApp खुल गया!'], [/^WhatsApp opened for (.+)!$/, '$1 के लिए WhatsApp खुल गया!'],
    [/^Open WhatsApp for (.+)$/, '$1 के लिए WhatsApp खोलें'], [/^Opening WhatsApp for (.+)\.\.\.$/, '$1 के लिए WhatsApp खुल रहा है...'],
    [/^Sending SMS to (\d+) contact\(s\)\.\.\.$/, '$1 संपर्कों को SMS भेजा जा रहा है...'], [/^SMS sent to (\d+) contact\(s\): (.+)$/, '$1 संपर्कों को SMS भेज दिया गया: $2'],
    [/^SMS sent to all (\d+) contacts!$/, 'सभी $1 संपर्कों को SMS भेज दिया गया!'], [/^SMS failed: (.+)$/, 'SMS नहीं गया: $1'],
    [/^(.+) added as emergency contact!$/, '$1 आपातकालीन संपर्क के रूप में जोड़ा गया!'], [/^(.+) is now your primary contact\.$/, '$1 अब आपका मुख्य संपर्क है।'],
    [/^Calling (.+?) \((.+)\)\.\.\. Stay safe!$/, '$1 ($2) को कॉल हो रही है... सुरक्षित रहें!'], [/^Calling (.+)$/, '$1 को कॉल'],
    [/^Safety timer started for (.+)\.$/, 'सेफ्टी टाइमर $1 के लिए शुरू हुआ।'], [/^Fake call from "(.*)" coming in (\d+) seconds\.\.\.$/, '"$1" की नकली कॉल $2 सेकंड में आएगी...'],
    [/^Location update failed: (.+)$/, 'लोकेशन अपडेट नहीं हुई: $1'], [/^Lat: (.+?) \| Long: (.+)$/, 'अक्षांश: $1 | देशांतर: $2'],
    [/^You've been at the same location for (\d+) minutes\. Are you safe\?$/, 'आप $1 मिनट से एक ही जगह पर हैं। क्या आप सुरक्षित हैं?'],
    [/^ML: Stationary for (\d+) min detected\.$/, 'स्मार्ट अलर्ट: आप $1 मिनट से रुके हुए हैं।'],
    [/^Auto-capture on SOS: ON$/, 'SOS पर ऑटो-कैप्चर: चालू'], [/^Auto-capture on SOS: OFF$/, 'SOS पर ऑटो-कैप्चर: बंद'],
    [/^Recording for (\d+) seconds\.\.\.$/, '$1 सेकंड रिकॉर्ड हो रहा है...'], [/^Recording started — (.+) total\.$/, 'रिकॉर्डिंग शुरू हुई — कुल $1।'],
    [/^Saved (.+) of audio\. Tap to download\.$/, '$1 का ऑडियो सेव हुआ। डाउनलोड करने के लिए टैप करें।'], [/^([\d:]+) clip$/, '$1 की क्लिप'],
    [/^Listening \((.+)\)… speak now$/, 'सुन रहे हैं ($1)… अब बोलें'], [/^Listening \((.+)\)…$/, 'सुन रहे हैं ($1)…'], [/^Translating to (.+)…$/, '$1 में अनुवाद हो रहा है…'],
    [/^Language (.+) not supported on this browser\.$/, 'भाषा $1 इस ब्राउज़र में सपोर्ट नहीं है।'],
    [/^Language (.+) not supported by your browser\. Try a different one\.$/, 'भाषा $1 आपके ब्राउज़र में सपोर्ट नहीं है। कोई दूसरी चुनें।'],
    [/^Error: (.+)\. Will retry…$/, 'गड़बड़ी: $1। फिर कोशिश होगी…'], [/^Offline voice failed: (.+)$/, 'ऑफ़लाइन वॉइस नहीं चली: $1']
  ];
  Object.entries({"Capturing a photo and 10 seconds of audio…": "फ़ोटो और 10 सेकंड का ऑडियो लिया जा रहा है…", "Getting your location…": "आपकी लोकेशन ली जा रही है…", "Nothing was captured. Allow camera and microphone in your browser settings, then try again.": "कुछ भी कैप्चर नहीं हुआ। ब्राउज़र सेटिंग में कैमरा और माइक्रोफ़ोन की अनुमति दें, फिर दोबारा कोशिश करें।", "Try again": "फिर कोशिश करें", "Location blocked. Click in browser address bar → Allow Location.": "लोकेशन ब्लॉक है। ब्राउज़र के एड्रेस बार में लोकेशन की अनुमति दें।", "Location unavailable. Check internet.": "लोकेशन नहीं मिली। इंटरनेट जांचें।", "Location timed out. Try again.": "लोकेशन मिलने में बहुत देर लगी। फिर कोशिश करें।", "Could not get location.": "लोकेशन नहीं मिल सकी।", "Your browser does not support location.": "आपका ब्राउज़र लोकेशन सपोर्ट नहीं करता।", "Delete this recording? This cannot be undone.": "यह रिकॉर्डिंग हटाएं? इसे वापस नहीं लाया जा सकता।", "Are you sure you want to delete all incident records? This cannot be undone.": "क्या आप सभी घटना रिकॉर्ड हटाना चाहते हैं? इन्हें वापस नहीं लाया जा सकता।", "Delete all contacts, incidents and settings from this phone? This cannot be undone.": "इस फ़ोन से सभी संपर्क, घटनाएं और सेटिंग हटाएं? इन्हें वापस नहीं लाया जा सकता।", "SafeHer — Incident Report": "SafeHer — घटना रिपोर्ट", "SAFEHER — INCIDENT REPORT": "SAFEHER — घटना रिपोर्ट", "Women Safety Application — Auto-generated Report": "महिला सुरक्षा ऐप — अपने आप बनी रिपोर्ट", "Report Date": "रिपोर्ट की तारीख", "Report Time": "रिपोर्ट का समय", "Contact Name": "संपर्क का नाम", "Contact Phone": "संपर्क का फ़ोन", "Total Incidents": "कुल घटनाएं", "User": "उपयोगकर्ता", "Not set": "सेट नहीं है", "Incident Records": "घटना रिकॉर्ड", "Date:": "तारीख:", "Time:": "समय:", "Location:": "लोकेशन:", "Maps Link:": "मैप लिंक:", "Notes:": "टिप्पणी:", "SOS triggered": "SOS चालू किया गया", "SOS triggered — location unavailable": "SOS चालू किया गया — लोकेशन उपलब्ध नहीं", "Location was unavailable at time of incident": "घटना के समय लोकेशन उपलब्ध नहीं थी", "Disclaimer:": "अस्वीकरण:", "This report was automatically generated by the SafeHer Women Safety Application. All incident data was recorded at the time of the SOS trigger using GPS coordinates from the device. This report can be used as supporting evidence. Please contact your local police station for formal complaint registration.": "यह रिपोर्ट SafeHer महिला सुरक्षा ऐप ने अपने आप बनाई है। घटना का सारा डेटा SOS चालू करते समय फ़ोन के GPS निर्देशांकों से दर्ज किया गया था। इस रिपोर्ट को सहायक सबूत के रूप में इस्तेमाल किया जा सकता है। औपचारिक शिकायत दर्ज कराने के लिए कृपया अपने स्थानीय पुलिस थाने से संपर्क करें।", "Emergency helpline:": "आपातकालीन हेल्पलाइन:", "(Police)": "(पुलिस)", "(Women Helpline)": "(महिला हेल्पलाइन)", "Generated by SafeHer App": "SafeHer ऐप से बनी रिपोर्ट", "For official use as supporting evidence": "सहायक सबूत के रूप में आधिकारिक उपयोग के लिए", "Diagnosis": "जांच", "Chrome AI translator": "Chrome AI अनुवादक", "Voice input (Vosk)": "वॉइस इनपुट (Vosk)", "Load from file": "फ़ाइल से लोड करें", "Every SOS is saved here with the time and place, ready for a police report.": "हर SOS समय और जगह के साथ यहां सेव होता है, पुलिस रिपोर्ट के लिए तैयार।"}).forEach(([k, v]) => { if (!Object.prototype.hasOwnProperty.call(HI, k)) HI[k] = v; }); /* P6 s4: confirm(), report window, states; never overwrites an existing entry */
  Object.entries({"Sends SMS to ALL contacts at once — no tapping needed. Requires Fast2SMS account with ₹100+ wallet balance.": "सभी संपर्कों को एक साथ SMS भेजता है — टैप करने की ज़रूरत नहीं। इसके लिए Fast2SMS अकाउंट में ₹100+ वॉलेट बैलेंस चाहिए।", "Your API key is saved in this browser only, as plain text. Use a key with a small balance, and avoid this on a shared phone.": "आपकी API key सिर्फ़ इसी ब्राउज़र में सादे टेक्स्ट के रूप में सेव होती है। कम बैलेंस वाली key इस्तेमाल करें और साझा फ़ोन पर इसका उपयोग न करें।", "Tracks your GPS location every 30 seconds automatically. Share a live link with your family so they can watch you move in real time.": "आपकी GPS लोकेशन हर 30 सेकंड में अपने आप ट्रैक होती है। परिवार को लाइव लिंक भेजें, ताकि वे आपको रियल टाइम में चलते हुए देख सकें।", "Records audio continuously for the time you choose. Useful as evidence — keep it running while walking alone, in a cab, or in a tense situation. You can play it back and download afterwards.": "आपके चुने हुए समय तक लगातार ऑडियो रिकॉर्ड करता है। सबूत के तौर पर काम आता है — अकेले चलते समय, कैब में या तनाव की स्थिति में इसे चालू रखें। बाद में आप इसे सुन सकते हैं और डाउनलोड कर सकते हैं।", "Captures a photo + 10 seconds of audio automatically when SOS is triggered. Save and share as evidence with police.": "SOS चालू होने पर अपने आप एक फ़ोटो और 10 सेकंड का ऑडियो कैप्चर करता है। इसे सेव करें और सबूत के तौर पर पुलिस के साथ शेयर करें।", "Every SOS trigger is automatically recorded here with date, time and location. Generate a printable report for police complaint.": "हर SOS की तारीख, समय और लोकेशन यहां अपने आप दर्ज हो जाती है। पुलिस में शिकायत के लिए प्रिंट करने लायक रिपोर्ट बनाएं।", "Understand what someone is saying to you. Use Online for the best accuracy, or Offline when your signal is weak.": "समझें कि कोई आपसे क्या कह रहा है। सबसे सटीक नतीजे के लिए ऑनलाइन चुनें, और सिग्नल कमज़ोर हो तो ऑफ़लाइन।", "Works without any network. Type what you heard (or enable voice — needs a one-time ~40MB download).": "बिना नेटवर्क के काम करता है। जो आपने सुना उसे टाइप करें (या वॉइस चालू करें — इसके लिए एक बार लगभग 40MB डाउनलोड करना होगा)।", "Offline voice uses": "ऑफ़लाइन वॉइस में यह इंजन इस्तेमाल होता है:", "— a free on-device speech engine. First-time setup downloads a ~40 MB model for the language selected above. After that, it works entirely offline, forever.": "— फ़ोन पर ही चलने वाला मुफ़्त स्पीच इंजन। पहली बार सेटअप में ऊपर चुनी गई भाषा का लगभग 40 MB का मॉडल डाउनलोड होता है। उसके बाद यह हमेशा पूरी तरह ऑफ़लाइन चलता है।", "No model online for your language? Download the": "आपकी भाषा का मॉडल ऑनलाइन उपलब्ध नहीं है? यह फ़ाइल", "once from": "एक बार यहां से", "and use": "डाउनलोड करें, फिर यह बटन दबाएं:"}).forEach(([k, v]) => { if (!Object.prototype.hasOwnProperty.call(HI, k)) HI[k] = v; }); /* P6 s5: long help paragraphs; never overwrites an existing entry */
  Object.entries({"E.g. मुझे मदद चाहिए (type in their language)…": "जैसे: मुझे मदद चाहिए (उनकी भाषा में टाइप करें)…"}).forEach(([k, v]) => { if (!Object.prototype.hasOwnProperty.call(HI, k)) HI[k] = v; }); /* P6 s5: offline translator placeholder */
  Object.entries({"English (India)": "अंग्रेज़ी (भारत)", "English (US)": "अंग्रेज़ी (अमेरिका)", "Hindi": "हिन्दी", "Bengali": "बंगाली", "Tamil": "तमिल", "Telugu": "तेलुगु", "Marathi": "मराठी", "Gujarati": "गुजराती", "Kannada": "कन्नड़", "Malayalam": "मलयालम", "Punjabi": "पंजाबी", "Urdu": "उर्दू", "Spanish": "स्पेनिश", "French": "फ़्रेंच", "German": "जर्मन", "Italian": "इतालवी", "Portuguese": "पुर्तगाली", "Russian": "रूसी", "Chinese": "चीनी", "Japanese": "जापानी", "Korean": "कोरियाई", "Arabic": "अरबी", "Close settings": "सेटिंग बंद करें"}).forEach(([k, v]) => { if (!Object.prototype.hasOwnProperty.call(HI, k)) HI[k] = v; }); /* P6 s5: translator language names (display only; script.js reads .code) + Settings close label */
  PAT.push([/^INCIDENT #(\d+)$/, 'घटना #$1'], [/^Lat (.+), Long (.+)$/, 'अक्षांश $1, देशांतर $2'], [/^Downloading language pack… (\d+)%$/, 'भाषा पैक डाउनलोड हो रहा है… $1%']);
  const MON = { Jan: 'जनवरी', Feb: 'फ़रवरी', Mar: 'मार्च', Apr: 'अप्रैल', May: 'मई', Jun: 'जून', Jul: 'जुलाई', Aug: 'अगस्त', Sep: 'सितंबर', Sept: 'सितंबर', Oct: 'अक्टूबर', Nov: 'नवंबर', Dec: 'दिसंबर' };
  PAT.push([/^Step (\d+) of (\d+)$/, 'चरण $1 / $2'], [/^(\d+) contacts? ready$/, '$1 संपर्क तैयार'], [/^Call (.+)$/, '$1 को कॉल करें'], [/^Remove (.+)$/, '$1 को हटाएं'], [/^Incident (\d+)$/, 'घटना $1'],
    [/^(\d{1,2}) ([A-Z][a-z]{2,3}) (\d{4}) · (.+)$/, (m, d, mo, y, t) => d + ' ' + (MON[mo] || mo) + ' ' + y + ' · ' + t.replace(/\b([ap])m\b/i, x => x.toUpperCase())]); /* P6 s6: step counter, contact count, call/remove labels, incident title, incident date */
  Object.entries({"Add someone you trust": "किसी भरोसेमंद को जोड़ें", "They are the first person SafeHer calls when you press SOS.": "SOS दबाने पर SafeHer सबसे पहले इन्हीं को कॉल करता है।", "Name, like Mom": "नाम, जैसे मम्मी", "Continue": "आगे बढ़ें", "Skip for now": "अभी छोड़ें", "Allow what SOS needs": "SOS के लिए ज़रूरी अनुमतियां दें", "Your phone will ask for permission. SafeHer only uses these when you ask it to.": "आपका फ़ोन अनुमति मांगेगा। SafeHer इनका उपयोग तभी करता है, जब आप कहें।", "Location blocked. Allow it in your browser settings.": "लोकेशन ब्लॉक है। ब्राउज़र सेटिंग में इसकी अनुमति दें।", "Microphone blocked. Allow it in your browser settings.": "माइक्रोफ़ोन ब्लॉक है। ब्राउज़र सेटिंग में इसकी अनुमति दें।", "Location allowed": "लोकेशन की अनुमति मिल गई", "Microphone allowed": "माइक्रोफ़ोन की अनुमति मिल गई", "Practice once": "एक बार अभ्यास करें", "See what happens when you press SOS. Nothing is sent during practice.": "देखें कि SOS दबाने पर क्या होता है। अभ्यास के दौरान कुछ भी नहीं भेजा जाता।", "Finish": "पूरा करें", "Close": "बंद करें", "Practice run. SOS in": "अभ्यास। SOS चालू होने में"}).forEach(([k, v]) => { if (!Object.prototype.hasOwnProperty.call(HI, k)) HI[k] = v; }); /* P6 s6: first-run screens; never overwrites an existing entry */
  const OWN = Object.prototype.hasOwnProperty;
  function hi(k) {
    if (OWN.call(HI, k)) return HI[k]; /* own keys only: a contact named "constructor" must not translate */
    for (let i = 0; i < PAT.length; i++) if (PAT[i][0].test(k)) return k.replace(PAT[i][0], PAT[i][1]);
    return null;
  }
  const seen = new WeakMap(), ATTR = ['placeholder', 'aria-label', 'title'];
  const skip = n => !n.parentNode || /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentNode.nodeName);
  function text(n) {
    if (skip(n)) return;
    const key = n.data.replace(/\s+/g, ' ').trim(), rec = seen.get(n);
    if (lang() === 'hi') {
      const h = hi(key);
      if (h) { seen.set(n, { en: key, hi: h }); n.data = (/^\s/.test(n.data) ? ' ' : '') + h + (/\s$/.test(n.data) ? ' ' : ''); }
    } else if (rec && key === rec.hi) { n.data = n.data.replace(rec.hi, rec.en); seen.delete(n); }
  }
  function attrs(el) {
    ATTR.forEach(a => {
      if (!el.hasAttribute(a)) return;
      const k = 'data-en-' + a, cur = el.getAttribute(a);
      if (lang() === 'hi') { const h = hi(cur); if (h) { el.setAttribute(k, cur); el.setAttribute(a, h); } }
      else if (el.hasAttribute(k)) { el.setAttribute(a, el.getAttribute(k)); el.removeAttribute(k); }
    });
  }
  function sweep(root) {
    if (root.nodeType === 3) return text(root);
    if (root.nodeType !== 1) return;
    attrs(root);
    const w = document.createTreeWalker(root, 5); let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) text(n); else attrs(n); }
  }
  window.i18n = Object.assign(k => (lang() === 'hi' && hi(k)) || k, { lang });
  /* Shared loading / error state: window.setState(el, 'loading' | 'error', text, retryFn?) */
  window.setState = function (el, kind, text, retry) {
    if (!el) return;
    const cur = el.firstElementChild;
    if (cur && cur.classList.contains('state-msg') && cur.dataset.state === kind && !retry) { cur.querySelector('.state-txt').textContent = text; return; }
    const box = document.createElement('div'), ico = document.createElement('span'), t = document.createElement('span');
    box.className = 'state-msg'; box.dataset.state = kind; box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    ico.className = 'state-ico'; ico.setAttribute('aria-hidden', 'true'); t.className = 'state-txt'; t.textContent = text;
    box.append(ico, t);
    if (retry) { const b = document.createElement('button'); b.type = 'button'; b.className = 'state-retry'; b.textContent = 'Try again'; b.onclick = retry; box.append(b); }
    el.replaceChildren(box);
  };
  window.applyLang = function () { document.documentElement.lang = lang(); sweep(document.body); };
  new MutationObserver(ms => ms.forEach(m => { if (m.type === 'characterData') text(m.target); else m.addedNodes.forEach(sweep); }))
    .observe(document.body, { childList: true, subtree: true, characterData: true });
  window.applyLang();
})();
