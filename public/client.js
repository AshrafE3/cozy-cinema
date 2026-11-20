// Cozy Cinema - 100% Synchronized Playback & Live Chat Engine
// Automatically bypass ngrok interstitial warning on all internal API calls
const _nativeFetch = window.fetch;
window.fetch = function(url, options = {}) {
  options = options || {};
  options.headers = options.headers || {};
  if (options.headers instanceof Headers) {
    options.headers.set('ngrok-skip-browser-warning', 'true');
  } else {
    options.headers['ngrok-skip-browser-warning'] = 'true';
  }
  return _nativeFetch(url, options);
};

document.addEventListener('DOMContentLoaded', async () => {
  // Extract Room ID from pathname
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  let roomId = decodeURIComponent(pathParts[pathParts.length - 1] || 'general');

  // Persistent Client Session ID across reconnects (prevents duplicate joins & drops)
  let myClientId = sessionStorage.getItem('cozy_client_id');
  if (!myClientId) {
    myClientId = 'usr_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).substring(4);
    sessionStorage.setItem('cozy_client_id', myClientId);
  }
  let hasJoinedRoomOnce = false;

  const firebaseConfig = {
    apiKey: "AIzaSyAwXcgbHxSYKagqTReqgeSXYcO4nnrRgiU",
    authDomain: "cozy-cinema.firebaseapp.com",
    databaseURL: "https://cozy-cinema-default-rtdb.firebaseio.com",
    projectId: "cozy-cinema",
    storageBucket: "cozy-cinema.firebasestorage.app",
    messagingSenderId: "80222677579",
    appId: "1:80222677579:web:04c57f205f7fb1c952fbce"
  };

  let socket;
  if (typeof FirebaseSocketAdapter !== 'undefined' && typeof firebase !== 'undefined') {
    console.log('[CozyCinema] 🚀 Connected to 24/7 Google Firebase Realtime Cloud Sync!');
    socket = new FirebaseSocketAdapter(firebaseConfig, roomId, myClientId);
  } else {
    console.log('[CozyCinema] Using Local Socket.io fallback');
    socket = io({
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket', 'polling']
    });
  }

  // DOM Elements
  const displayRoomName = document.getElementById('displayRoomName');
  const userCountText = document.getElementById('userCountText');
  const mainVideo = document.getElementById('mainVideo');
  const videoWrapper = document.getElementById('videoWrapper');
  const iframeContainer = document.getElementById('iframeContainer');
  const embedFrame = document.getElementById('embedFrame');
  const nowPlayingTitle = document.getElementById('nowPlayingTitle');
  const syncToast = document.getElementById('syncToast');
  const reactionOverlay = document.getElementById('reactionOverlay');
  const mobileUnlockBanner = document.getElementById('mobileUnlockBanner');
  const customSubtitlesOverlay = document.getElementById('customSubtitlesOverlay');
  const btnSubtitleSettings = document.getElementById('btnSubtitleSettings');
  const subtitleSettingsModal = document.getElementById('subtitleSettingsModal');
  const btnCloseSubSettings = document.getElementById('btnCloseSubSettings');
  const btnDoneSubSettings = document.getElementById('btnDoneSubSettings');
  const subSizeGroup = document.getElementById('subSizeGroup');
  const subBgGroup = document.getElementById('subBgGroup');
  const subColorGroup = document.getElementById('subColorGroup');
  const subPreviewText = document.getElementById('subPreviewText');
  const btnUnlockMobile = document.getElementById('btnUnlockMobile');
  const centerPlayOverlay = document.getElementById('centerPlayOverlay');
  const btnCenterPlay = document.getElementById('btnCenterPlay');
  const centerPlayIcon = document.getElementById('centerPlayIcon');
  const bigPlayOverlay = centerPlayOverlay;

  // Popup Blocker to keep movie viewing 100% ad-free
  window.open = function(url) {
    console.log('[CozyCinema] Prevented popup window:', url);
    return null;
  };

  // URL Auto-Extractor Elements
  const autoMovieUrlInput = document.getElementById('autoMovieUrlInput');
  const btnAutoExtract = document.getElementById('btnAutoExtract');
  const extractBtnText = document.getElementById('extractBtnText');
  const extractSpinner = document.getElementById('extractSpinner');

  // ================= 🎛️ UNIVERSAL MEDIA SELECTOR TABS (RAVE STYLE) =================
  const sourceTabs = document.querySelectorAll('.source-tab');
  sourceTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sourceTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const targetId = 'pane' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1);
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.remove('hidden');
    });
  });

  // YouTube Watch Together
  const youtubeUrlInput = document.getElementById('youtubeUrlInput');
  const btnPlayYoutube = document.getElementById('btnPlayYoutube');
  if (btnPlayYoutube) {
    btnPlayYoutube.addEventListener('click', async () => {
      const url = youtubeUrlInput.value.trim();
      if (!url) {
        showToast('⚠️ Please paste a YouTube link first');
        return;
      }
      showToast('⏳ Loading YouTube video for both screens...');
      try {
        const res = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (data.success) {
          loadSource(data, 0, true);
          socket.emit('change-source', data);
          socket.emit('media-play', { time: 0 });
          showToast('▶️ Playing YouTube in full sync!');
        } else {
          showToast('⚠️ Could not load YouTube video. Check the link.');
        }
      } catch (e) {
        console.error('[YouTube Load Error]', e);
        showToast('⚠️ Error: ' + (e.message || 'Connecting to server'));
      }
    });
  }

  // Local File Watch Together (0 Server Bandwidth, 4K Sync, 0 Ads)
  const localFileInput = document.getElementById('localFileInput');
  const fileSelectLabel = document.getElementById('fileSelectLabel');
  if (localFileInput) {
    localFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fileUrl = URL.createObjectURL(file);
      fileSelectLabel.textContent = `📁 ${file.name} (${(file.size / (1024*1024)).toFixed(1)} MB)`;
      const source = {
        type: 'local',
        url: fileUrl,
        title: file.name
      };
      loadSource(source, 0, true);
      socket.emit('change-source', {
        type: 'local',
        title: file.name
      });
      socket.emit('media-play', { time: 0 });
      showToast(`📁 Loaded local file: ${file.name}`);
      appendChatMessage('System', `📁 You loaded local file: "${file.name}". Partner can select the same file on their device to watch together!`, 'system');
    });
  }

  // Chat Sound Toggle (boop.ogg from Rave)
  let isChatSoundOn = true;
  const boopAudio = new Audio('/sounds/boop.ogg');
  boopAudio.volume = 0.5;

  const btnToggleChatSound = document.getElementById('btnToggleChatSound');
  if (btnToggleChatSound) {
    btnToggleChatSound.addEventListener('click', () => {
      isChatSoundOn = !isChatSoundOn;
      btnToggleChatSound.textContent = isChatSoundOn ? '🔔' : '🔕';
      btnToggleChatSound.title = isChatSoundOn ? 'Chat sound on' : 'Chat sound muted';
      showToast(isChatSoundOn ? '🔔 Chat notification sound enabled' : '🔕 Chat notification sound muted');
    });
  }
      // Custom Player Controls
  const btnPlayPause = document.getElementById('btnPlayPause');
  const btnRewind10 = document.getElementById('btnRewind10');
  const btnForward10 = document.getElementById('btnForward10');
  const btnSubtitleToggle = document.getElementById('btnSubtitleToggle');
  const btnMuteToggle = document.getElementById('btnMuteToggle');
  const btnFullscreen = document.getElementById('btnFullscreen');
  const timeDisplay = document.getElementById('timeDisplay');
  const progressWrap = document.getElementById('progressWrap');
  const progressFilled = document.getElementById('progressFilled');
  const progressHandle = document.getElementById('progressHandle');

  // Header & Modals
  const btnShareLink = document.getElementById('btnShareLink');
  const btnQuickSync = document.getElementById('btnQuickSync');
  const btnJumpToChatMobile = document.getElementById('btnJumpToChatMobile');
  const btnScrollDownToChat = document.getElementById('btnScrollDownToChat');
  const shareModal = document.getElementById('shareModal');
  const btnCloseShareModal = document.getElementById('btnCloseShareModal');
  const shareUrlDisplay = document.getElementById('shareUrlDisplay');
  const btnCopyShareUrl = document.getElementById('btnCopyShareUrl');
  const qrImage = document.getElementById('qrImage');

  // Name Modal Elements
  const nameModal = document.getElementById('nameModal');
  const modalNameInput = document.getElementById('modalNameInput');
  const btnSubmitName = document.getElementById('btnSubmitName');

  // Chat Form & Sidebar
  const chatSidebar = document.getElementById('chatSidebar');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const chatMessages = document.getElementById('chatMessages');

  displayRoomName.textContent = `Room: ${roomId}`;

  let hlsInstance = null;
  let isRemoteAction = false;
  let isMediaUnlocked = false;
  let serverInfo = { localIp: 'localhost', port: 3000 };

  // Fetch Network Info
  try {
    const infoRes = await fetch('/api/info');
    serverInfo = await infoRes.json();
  } catch (e) {
    console.log('Error fetching network info');
  }

  // Handle Username & Room Join
  const currentUserNameDisplay = document.getElementById('currentUserNameDisplay');
  const userBadge = document.getElementById('userBadge');
  const btnCloseNameModal = document.getElementById('btnCloseNameModal');

  function updateNameBadgeUI(name) {
    if (currentUserNameDisplay) {
      currentUserNameDisplay.textContent = name || 'Set Name';
    }
  }

  let myName = localStorage.getItem('cozy_username');
  // If no name is set or it was defaulted to 'Viewer', prompt user to enter their real name!
  if (!myName || myName === 'Viewer' || myName.trim() === '') {
    localStorage.removeItem('cozy_username');
    myName = '';
    modalNameInput.value = '';
    nameModal.classList.remove('hidden');
    setTimeout(() => modalNameInput.focus(), 150);
  } else {
    updateNameBadgeUI(myName);
    joinRoomWithUser(myName);
  }

  if (userBadge) {
    userBadge.addEventListener('click', () => {
      modalNameInput.value = (myName && myName !== 'Viewer') ? myName : '';
      nameModal.classList.remove('hidden');
      setTimeout(() => modalNameInput.focus(), 100);
    });
  }

  if (btnCloseNameModal) {
    btnCloseNameModal.addEventListener('click', () => {
      if (myName && myName !== 'Viewer') {
        nameModal.classList.add('hidden');
      }
    });
  }

  btnSubmitName.addEventListener('click', () => {
    const val = modalNameInput.value.trim();
    if (!val) {
      modalNameInput.focus();
      return;
    }
    const oldName = myName;
    myName = val;
    localStorage.setItem('cozy_username', myName);
    nameModal.classList.add('hidden');
    updateNameBadgeUI(myName);

    if (oldName && oldName !== myName) {
      socket.emit('change-name', { name: myName });
      appendChatMessage('System', `You changed your name to "${myName}"`, 'system');
    } else {
      joinRoomWithUser(myName);
    }
  });

  modalNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btnSubmitName.click();
  });

  function joinRoomWithUser(name) {
    if (!socket.connected) {
      socket.connect();
      return;
    }
    socket.emit('join-room', { 
      roomId, 
      name: name || 'Viewer', 
      clientId: myClientId, 
      isReconnect: hasJoinedRoomOnce 
    });
    hasJoinedRoomOnce = true;
  }

  // Auto-Rejoin Room on Every Connect / Reconnect
  socket.on('connect', () => {
    console.log('[Socket] Connected! Socket ID:', socket.id);
    if (myName) {
      socket.emit('join-room', { 
        roomId, 
        name: myName, 
        clientId: myClientId, 
        isReconnect: hasJoinedRoomOnce 
      });
      hasJoinedRoomOnce = true;
    }
    const chatOnlinePill = document.getElementById('chatOnlinePill');
    if (chatOnlinePill) {
      chatOnlinePill.textContent = '🟢 Connected';
      chatOnlinePill.style.color = '#4ade80';
    }
  });

  socket.on('disconnect', (reason) => {
    console.warn('[Socket] Disconnected:', reason);
    const chatOnlinePill = document.getElementById('chatOnlinePill');
    if (chatOnlinePill) {
      chatOnlinePill.textContent = '🟡 Reconnecting...';
      chatOnlinePill.style.color = '#fbbf24';
    }
  });

  // Mobile Background / Screen Wake Re-sync
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!socket.connected) {
        console.log('[Visibility] Tab active & socket disconnected, reconnecting...');
        socket.connect();
      }
      // CRITICAL: DO NOT emit join-room if socket is already connected!
      // Emitting join-room on Alt+Tab caused user-joined spam and black screen player reloads.
    }
  });

  // Keep-alive heartbeat every 15 seconds to prevent Cloudflare Tunnel & Mobile idle timeouts
  setInterval(() => {
    if (socket && socket.connected && myName) {
      socket.emit('heartbeat', { roomId, name: myName, clientId: myClientId });
    }
  }, 15000);

  socket.on('name-changed', (data) => {
    if (data.id !== socket.id) {
      appendChatMessage('System', `✏️ ${data.oldName} is now "${data.newName}"`, 'system');
    }
  });

  // ================= MOBILE GESTURE & AUDIO UNLOCKER =================
  // Unlocks iOS Safari & Chrome autoplay so socket play commands work!
  function unlockMedia() {
    if (isMediaUnlocked) return;
    isMediaUnlocked = true;
    mobileUnlockBanner.classList.add('hidden');

    // Attempt a silent micro-play to authorize programmatic playback
    const playPromise = mainVideo.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        // Paused immediately so it doesn't run ahead
        if (mainVideo.paused) mainVideo.pause();
      }).catch(err => {
        console.log('Unlock media gesture handled');
      });
    }
  }

  btnUnlockMobile.addEventListener('click', unlockMedia);
  window.addEventListener('touchstart', unlockMedia, { once: true });
  window.addEventListener('click', unlockMedia, { once: true });

  // Mobile Jump to Chat buttons
  function scrollToChat() {
    chatSidebar.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => { chatInput.focus(); }, 350);
  }
  if (btnJumpToChatMobile) btnJumpToChatMobile.addEventListener('click', scrollToChat);
  if (btnScrollDownToChat) btnScrollDownToChat.addEventListener('click', scrollToChat);

  // Calculate Mobile URL
  function getMobileFriendlyUrl() {
    const origin = window.location.origin;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return `http://${serverInfo.localIp}:${serverInfo.port}/room/${encodeURIComponent(roomId)}`;
    }
    return `${origin}/room/${encodeURIComponent(roomId)}`;
  }

  // Share Modal
  btnShareLink.addEventListener('click', () => {
    const targetUrl = getMobileFriendlyUrl();
    shareUrlDisplay.value = targetUrl;
    qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(targetUrl)}`;
    shareModal.classList.remove('hidden');
  });

  btnCloseShareModal.addEventListener('click', () => {
    shareModal.classList.add('hidden');
  });

  btnCopyShareUrl.addEventListener('click', () => {
    const targetUrl = shareUrlDisplay.value;
    navigator.clipboard.writeText(targetUrl).then(() => {
      showToast('Room link copied! Send it to your partner 📋');
    });
  });

  function showToast(text, duration = 2500) {
    syncToast.textContent = text;
    syncToast.classList.remove('hidden');
    clearTimeout(syncToast._timer);
    syncToast._timer = setTimeout(() => {
      syncToast.classList.add('hidden');
    }, duration);
  }

  function formatTime(sec) {
    if (isNaN(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // ================= SUBTITLE PREFERENCE =================
  // ================= SUBTITLE PREFERENCE & CUSTOMIZATION =================
  let currentSubLang = localStorage.getItem('cozy_sub_lang');
  if (!currentSubLang) {
    const isMobileOrAr = /mobile|android|iphone|ipad/i.test(navigator.userAgent) || (navigator.language && navigator.language.startsWith('ar'));
    currentSubLang = isMobileOrAr ? 'ar' : 'en';
    localStorage.setItem('cozy_sub_lang', currentSubLang);
  }

  // Customization preferences (Default to 'none' for clean cinema outline with NO background box!)
  let subBgPref = localStorage.getItem('cozy_sub_bg') || 'none';
  let subSizePref = localStorage.getItem('cozy_sub_size') || 'md';
  let subColorPref = localStorage.getItem('cozy_sub_color') || 'white';

  let arCues = [];
  let enCues = [];
  let lastRenderedCueText = null;

  function parseVttText(vttText) {
    const cues = [];
    const vLines = vttText.replace(/\r\n/g, '\n').split('\n');
    let cur = null;
    for (let l of vLines) {
      l = l.trim();
      const m = l.match(/(\d{2}):(\d{2}):(\d{2})[\.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[\.,](\d{3})/);
      if (m) {
        const start = parseInt(m[1])*3600 + parseInt(m[2])*60 + parseInt(m[3]) + parseInt(m[4])/1000;
        const end = parseInt(m[5])*3600 + parseInt(m[6])*60 + parseInt(m[7]) + parseInt(m[8])/1000;
        cur = { start, end, text: '' };
        cues.push(cur);
      } else if (cur && l.length > 0 && !l.startsWith('WEBVTT') && !l.startsWith('NOTE') && !/^\d+$/.test(l)) {
        cur.text = (cur.text ? cur.text + '\n' : '') + l;
      }
    }
    return cues;
  }

  function clearAllSubtitles() {
    arCues = [];
    enCues = [];
    lastRenderedCueText = '';
    if (customSubtitlesOverlay) {
      customSubtitlesOverlay.innerHTML = '';
      customSubtitlesOverlay.classList.remove('hidden');
    }
    if (btnSubtitleToggle) btnSubtitleToggle.style.display = 'none';
    if (btnSubtitleSettings) btnSubtitleSettings.style.display = 'none';
  }

  async function loadSubtitlesForMovie(arUrl, enUrl) {
    clearAllSubtitles();
    try {
      const fetches = [];
      if (arUrl) fetches.push(fetch(arUrl).then(r => r.ok ? r.text() : '').then(t => { if (t) arCues = parseVttText(t); }));
      if (enUrl) fetches.push(fetch(enUrl).then(r => r.ok ? r.text() : '').then(t => { if (t) enCues = parseVttText(t); }));
      await Promise.all(fetches);

      if (enCues.length > 0 && (currentSubLang === 'en' || arCues.length === 0)) {
        currentSubLang = 'en';
      } else if (arCues.length > 0) {
        currentSubLang = 'ar';
      } else {
        currentSubLang = 'off';
      }

      if (arCues.length > 0 || enCues.length > 0) {
        if (btnSubtitleToggle) btnSubtitleToggle.style.display = 'inline-flex';
        if (btnSubtitleSettings) btnSubtitleSettings.style.display = 'inline-flex';
        applySubtitlePreference();
        renderSubtitlesAtTime(mainVideo.currentTime);
        showToast(`💬 Subtitles: ${currentSubLang === 'en' ? 'English' : 'Arabic'}`);
      }
    } catch (e) {
      console.log('Error loading subtitles:', e);
    }
  }
  // Initialize cleanly with NO ghost subtitles
  clearAllSubtitles();

  function getSubtitleClassString(isRtl) {
    return [
      'custom-subtitle-text',
      isRtl ? 'rtl' : '',
      `bg-${subBgPref}`,
      `size-${subSizePref}`,
      `color-${subColorPref}`
    ].filter(Boolean).join(' ');
  }

  function updateSubtitlePreview() {
    if (!subPreviewText) return;
    const isRtl = currentSubLang === 'ar';
    subPreviewText.className = getSubtitleClassString(isRtl);
  }

  function renderSubtitlesAtTime(currentTime) {
    if (!customSubtitlesOverlay) return;
    if (currentSubLang === 'off') {
      if (lastRenderedCueText !== '') {
        customSubtitlesOverlay.innerHTML = '';
        lastRenderedCueText = '';
      }
      return;
    }

    const cues = currentSubLang === 'ar' ? arCues : enCues;
    if (!cues || cues.length === 0) {
      if (lastRenderedCueText !== '') {
        customSubtitlesOverlay.innerHTML = '';
        lastRenderedCueText = '';
      }
      return;
    }

    const adjustedTime = currentTime - subtitleOffset;
    const activeCue = cues.find(c => adjustedTime >= c.start && adjustedTime <= c.end);
    const newText = activeCue && activeCue.text ? activeCue.text.trim() : '';

    if (newText !== lastRenderedCueText) {
      lastRenderedCueText = newText;
      if (newText) {
        customSubtitlesOverlay.classList.remove('hidden');
        const isRtl = currentSubLang === 'ar';
        const classes = getSubtitleClassString(isRtl);
        customSubtitlesOverlay.innerHTML = `<span class="${classes}">${newText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
      } else {
        customSubtitlesOverlay.innerHTML = '';
      }
    }
  }

  function applySubtitlePreference() {
    lastRenderedCueText = null; // force immediate fresh redraw
    // Completely disable native browser tracks so duplicate text never displays
    const tracks = mainVideo.textTracks;
    if (tracks && tracks.length > 0) {
      for (let t = 0; t < tracks.length; t++) {
        tracks[t].mode = 'disabled';
      }
    }

    if (btnSubtitleToggle) {
      if (currentSubLang === 'en') {
        btnSubtitleToggle.innerHTML = '💬 Subs: EN';
        btnSubtitleToggle.style.color = '#38bdf8';
      } else if (currentSubLang === 'ar') {
        btnSubtitleToggle.innerHTML = '💬 Subs: Ar';
        btnSubtitleToggle.style.color = '#ff4b72';
      } else {
        btnSubtitleToggle.innerHTML = '💬 Subs: Off';
        btnSubtitleToggle.style.color = '#9ca3af';
      }
    }

    updateSubtitlePreview();
    renderSubtitlesAtTime(mainVideo.currentTime);
  }

  if (btnSubtitleToggle) {
    btnSubtitleToggle.addEventListener('click', () => {
      if (currentSubLang === 'en') {
        currentSubLang = arCues.length > 0 ? 'ar' : 'off';
      } else if (currentSubLang === 'ar') {
        currentSubLang = 'off';
      } else {
        currentSubLang = enCues.length > 0 ? 'en' : (arCues.length > 0 ? 'ar' : 'off');
      }
      localStorage.setItem('cozy_sub_lang', currentSubLang);
      applySubtitlePreference();
      showToast(`💬 Subtitles: ${currentSubLang === 'ar' ? 'Arabic' : currentSubLang === 'en' ? 'English' : 'Off'}`);
    });
  }

  // Subtitle Settings Modal Controls
  let isSubSettingsOpen = false;

  function openSubSettings() {
    isSubSettingsOpen = true;
    subtitleSettingsModal.classList.remove('hidden');
    videoWrapper.classList.add('modal-open');
    syncModalButtons();
    updateSubtitlePreview();
    videoWrapper.classList.remove('controls-hidden');
  }

  function closeSubSettings() {
    isSubSettingsOpen = false;
    subtitleSettingsModal.classList.add('hidden');
    videoWrapper.classList.remove('modal-open');
    showControls();
  }

  if (btnSubtitleSettings) {
    btnSubtitleSettings.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSubSettingsOpen) closeSubSettings();
      else openSubSettings();
    });
  }

  if (btnCloseSubSettings) {
    btnCloseSubSettings.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSubSettings();
    });
  }

  if (btnDoneSubSettings) {
    btnDoneSubSettings.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSubSettings();
    });
  }

  window.addEventListener('click', (e) => {
    if (isSubSettingsOpen && !e.target.closest('#subtitleSettingsModal') && !e.target.closest('#btnSubtitleSettings')) {
      closeSubSettings();
    }
  });

  function syncModalButtons() {
    if (subSizeGroup) {
      subSizeGroup.querySelectorAll('.sub-opt-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.size === subSizePref);
      });
    }
    if (subBgGroup) {
      subBgGroup.querySelectorAll('.sub-opt-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.bg === subBgPref);
      });
    }
    if (subColorGroup) {
      subColorGroup.querySelectorAll('.sub-opt-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color === subColorPref);
      });
    }
  }

  if (subSizeGroup) {
    subSizeGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.sub-opt-btn');
      if (!btn || !btn.dataset.size) return;
      subSizePref = btn.dataset.size;
      localStorage.setItem('cozy_sub_size', subSizePref);
      syncModalButtons();
      updateSubtitlePreview();
      lastRenderedCueText = null;
      renderSubtitlesAtTime(mainVideo.currentTime);
    });
  }

  if (subBgGroup) {
    subBgGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.sub-opt-btn');
      if (!btn || !btn.dataset.bg) return;
      subBgPref = btn.dataset.bg;
      localStorage.setItem('cozy_sub_bg', subBgPref);
      syncModalButtons();
      updateSubtitlePreview();
      lastRenderedCueText = null;
      renderSubtitlesAtTime(mainVideo.currentTime);
    });
  }

  // Subtitle Timing / Sync Controls
  let subtitleOffset = parseFloat(localStorage.getItem('cozy_sub_offset') || '0');
  const subOffsetDisplay = document.getElementById('subOffsetDisplay');
  const btnSubDelayMinus1 = document.getElementById('btnSubDelayMinus1');
  const btnSubDelayMinus05 = document.getElementById('btnSubDelayMinus05');
  const btnSubDelayPlus05 = document.getElementById('btnSubDelayPlus05');
  const btnSubDelayPlus1 = document.getElementById('btnSubDelayPlus1');
  const btnSubResetOffset = document.getElementById('btnSubResetOffset');

  function updateOffsetDisplay() {
    if (subOffsetDisplay) {
      subOffsetDisplay.textContent = (subtitleOffset > 0 ? '+' : '') + subtitleOffset.toFixed(1) + 's';
    }
    localStorage.setItem('cozy_sub_offset', subtitleOffset);
    lastRenderedCueText = null;
    renderSubtitlesAtTime(mainVideo.currentTime);
  }

  function adjustSubOffset(delta) {
    subtitleOffset = Math.round((subtitleOffset + delta) * 10) / 10;
    updateOffsetDisplay();
    showToast(`⏱️ Subtitle Sync: ${subtitleOffset > 0 ? '+' : ''}${subtitleOffset.toFixed(1)}s`);
  }

  if (btnSubDelayMinus1) btnSubDelayMinus1.addEventListener('click', () => adjustSubOffset(-1.0));
  if (btnSubDelayMinus05) btnSubDelayMinus05.addEventListener('click', () => adjustSubOffset(-0.5));
  if (btnSubDelayPlus05) btnSubDelayPlus05.addEventListener('click', () => adjustSubOffset(0.5));
  if (btnSubDelayPlus1) btnSubDelayPlus1.addEventListener('click', () => adjustSubOffset(1.0));
  if (btnSubResetOffset) btnSubResetOffset.addEventListener('click', () => {
    subtitleOffset = 0;
    updateOffsetDisplay();
    showToast('⏱️ Subtitle Sync: Reset to 0.0s');
  });
  updateOffsetDisplay();

  mainVideo.addEventListener('loadedmetadata', applySubtitlePreference);


  // ================= 🎬 YOUTUBE REAL-TIME SYNC ENGINE =================
  let currentSourceType = 'hls';
  let ytPlayer = null;
  let isYtReady = false;
  let isRemoteYtSync = false;
  let lastYtTime = 0;
  const youtubeContainer = document.getElementById('youtubeContainer');

  window.onYouTubeIframeAPIReady = function() {
    console.log('[YouTube API] Ready');
    isYtReady = true;
  };

  function onYouTubePlayerStateChange(event) {
    updatePlayButtonUI();
    if (event.data === YT.PlayerState.PLAYING) {
      hideBigPlayOverlay();
      startControlsHideTimer(2500);
    } else if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
      videoWrapper.classList.remove('controls-hidden');
      clearTimeout(controlsHideTimer);
    }
  }

  function loadYouTubeVideo(videoId, startSeek = 0, shouldPlay = false) {
    currentSourceType = 'youtube';
    clearAllSubtitles();

    // Show YouTube in background, but show OUR CUSTOM PLAYER CONTROLS on top!
    mainVideo.pause();
    mainVideo.classList.add('hidden');
    iframeContainer.classList.add('hidden');
    embedFrame.src = '';
    customControls.classList.remove('hidden');
    if (btnSubtitleToggle) btnSubtitleToggle.style.display = 'none';
    if (btnSubtitleSettings) btnSubtitleSettings.style.display = 'none';
    if (bigPlayOverlay) bigPlayOverlay.classList.add('hidden');
    youtubeContainer.classList.remove('hidden');

    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
      isRemoteYtSync = true;
      if (isMediaDucked) {
        try { ytPlayer.setVolume(15); } catch (e) {}
      }
      ytPlayer.loadVideoById({
        videoId: videoId,
        startSeconds: startSeek
      });
      if (!shouldPlay) {
        setTimeout(() => { if (ytPlayer.pauseVideo) ytPlayer.pauseVideo(); isRemoteYtSync = false; updatePlayButtonUI(); }, 300);
      } else {
        setTimeout(() => { isRemoteYtSync = false; updatePlayButtonUI(); }, 600);
      }
    } else {
      if (!window.YT || !window.YT.Player) {
        setTimeout(() => loadYouTubeVideo(videoId, startSeek, shouldPlay), 200);
        return;
      }
      ytPlayer = new YT.Player('youtubePlayer', {
        videoId: videoId,
        playerVars: {
          autoplay: shouldPlay ? 1 : 0,
          controls: 0,           // HIDE YouTube native controls bar!
          disablekb: 1,          // Disable keyboard capture so our shortcuts work
          fs: 0,                 // Hide YouTube native fullscreen button
          iv_load_policy: 3,     // Hide YouTube annotations
          modestbranding: 1,     // No big logo
          rel: 0,                // No related videos
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin
        },
        events: {
          onReady: (event) => {
            isRemoteYtSync = true;
            if (isMediaDucked) {
              try { event.target.setVolume(15); } catch (e) {}
            }
            if (startSeek > 0) event.target.seekTo(startSeek, true);
            if (shouldPlay) event.target.playVideo();
            else event.target.pauseVideo();
            setTimeout(() => { isRemoteYtSync = false; }, 800);
          },
          onStateChange: onYouTubePlayerStateChange
        }
      });
    }
  }

  // ================= LOAD MEDIA SOURCE =================
  let activeMediaKey = '';

  function loadSource(source, startSeek = 0, shouldPlay = false) {
    if (!source) return;
    const mediaKey = source.url || source.embedUrl || source.videoId || source.title || '';
    activeMediaKey = mediaKey;
    nowPlayingTitle.textContent = source.title || 'Movie Stream';
    clearAllSubtitles();

    if (source.subtitles) {
      const ar = source.subtitles.ar || null;
      const en = source.subtitles.en || null;
      loadSubtitlesForMovie(ar, en);
    }

    if (source.type === 'youtube') {
      loadYouTubeVideo(source.videoId, startSeek, shouldPlay);
      showToast('▶️ YouTube video playing in sync!');
      return;
    }

    // Normal video or local file - switch back from YouTube
    currentSourceType = source.type || 'hls';
    if (youtubeContainer) youtubeContainer.classList.add('hidden');
    if (ytPlayer && ytPlayer.pauseVideo) {
      try { ytPlayer.pauseVideo(); } catch (e) {}
    }

    if (source.type === 'embed') {
      mainVideo.classList.add('hidden');
      mainVideo.pause();
      customControls.classList.add('hidden');
      iframeContainer.classList.remove('hidden');
      embedFrame.src = source.embedUrl;
      showToast('🎬 Movie loaded (Playing on both screens)');
      return;
    }

    if (source.type === 'local' && !source.url) {
      showToast(`📁 Partner selected local file: "${source.title}". Select the same file in "Local File" tab to watch together!`);
      appendChatMessage('System', `📁 Partner selected local file: "${source.title}". Select the same file on your device to watch together in 4K!`, 'system');
      return;
    }

    // Direct HLS (.m3u8) or MP4 - 100% Native Mutual Lockstep Sync
    customControls.classList.remove('hidden');
    iframeContainer.classList.add('hidden');
    embedFrame.src = '';
    mainVideo.classList.remove('hidden');

    const videoUrl = source.url;
    if (!videoUrl) return;

    if (videoUrl.includes('.m3u8')) {
      if (Hls.isSupported()) {
        if (hlsInstance) {
          try { hlsInstance.destroy(); } catch (e) {}
        }
        hlsInstance = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          maxBufferSize: 60 * 1000 * 1000,
          manifestLoadingTimeOut: 20000,
          manifestLoadingMaxRetry: 5,
          levelLoadingTimeOut: 20000,
          levelLoadingMaxRetry: 5,
          fragLoadingTimeOut: 30000,
          fragLoadingMaxRetry: 6
        });
        hlsInstance.loadSource(videoUrl);
        hlsInstance.attachMedia(mainVideo);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          // Immediately select highest available resolution (1080p FHD!)
          if (hlsInstance.levels && hlsInstance.levels.length > 0) {
            hlsInstance.currentLevel = hlsInstance.levels.length - 1;
            const topLevel = hlsInstance.levels[hlsInstance.levels.length - 1];
            if (topLevel && topLevel.height) {
              console.log(`[HLS Quality] Locked to highest resolution: ${topLevel.width}x${topLevel.height}`);
              showToast(`🎬 Playing in ${topLevel.height}p Full HD`);
            }
          }
          if (startSeek > 0) mainVideo.currentTime = startSeek;
          if (shouldPlay) {
            mainVideo.play().catch(() => {});
          }
          applySubtitlePreference();
          updatePlayButtonUI();
        });

        // 🛡️ Multi-tier bulletproof auto-recovery: prevents black screen on media or buffer stall!
        let mediaRecoveryAttempts = 0;
        hlsInstance.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.warn('[HLS Fatal Error]', data.type, data.details);
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.log('[HLS] Network error encountered. Retrying load...');
                hlsInstance.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                mediaRecoveryAttempts++;
                if (mediaRecoveryAttempts <= 2) {
                  console.log(`[HLS] Media decoding glitch. Calling recoverMediaError (attempt ${mediaRecoveryAttempts})...`);
                  hlsInstance.recoverMediaError();
                } else {
                  console.log('[HLS] Swapping audio/video codec track to recover cleanly...');
                  hlsInstance.swapAudioCodec();
                  hlsInstance.recoverMediaError();
                }
                break;
              default:
                console.error('[HLS] Unrecoverable error. Re-attaching media smoothly...');
                const savedTime = mainVideo.currentTime || 0;
                hlsInstance.destroy();
                hlsInstance = new Hls({ enableWorker: true });
                hlsInstance.loadSource(videoUrl);
                hlsInstance.attachMedia(mainVideo);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                  mainVideo.currentTime = savedTime;
                  mainVideo.play().catch(() => {});
                });
                break;
            }
          }
        });
      } else if (mainVideo.canPlayType('application/vnd.apple.mpegurl')) {
        // Native Apple iOS Safari
        mainVideo.src = videoUrl;
        mainVideo.load();

        mainVideo.onerror = () => {
          console.warn('[Native Safari HLS] Error detected, auto-reloading...');
          const saved = mainVideo.currentTime || 0;
          mainVideo.src = videoUrl;
          mainVideo.load();
          mainVideo.currentTime = saved;
          mainVideo.play().catch(() => {});
        };

        const onSafariReady = () => {
          if (startSeek > 0) {
            try { mainVideo.currentTime = startSeek; } catch (e) {}
          }
          if (shouldPlay) {
            mainVideo.play().then(() => {
              hideBigPlayOverlay();
            }).catch(() => {
              showBigPlayOverlay();
            });
          }
          applySubtitlePreference();
          updatePlayButtonUI();
        };

        mainVideo.addEventListener('loadedmetadata', onSafariReady, { once: true });
        mainVideo.addEventListener('canplay', () => {
          hideBigPlayOverlay();
        }, { once: true });
      }
    } else {
      if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
      }
      mainVideo.src = videoUrl;
      mainVideo.load();
      mainVideo.addEventListener('loadedmetadata', () => {
        if (startSeek > 0) {
          try { mainVideo.currentTime = startSeek; } catch (e) {}
        }
        if (shouldPlay) {
          mainVideo.play().then(() => {
            hideBigPlayOverlay();
          }).catch(() => {
            showBigPlayOverlay();
          });
        }
        applySubtitlePreference();
        updatePlayButtonUI();
      }, { once: true });
    }
  }

  // ================= 1-CLICK AUTOMATIC STREAM EXTRACTOR =================
  async function handleAutoExtract() {
    const rawUrl = autoMovieUrlInput.value.trim();
    if (!rawUrl) {
      showToast('⚠️ Please paste a movie link first');
      return;
    }

    extractBtnText.textContent = 'Loading...';
    extractSpinner.classList.remove('hidden');
    btnAutoExtract.disabled = true;

    try {
      showToast('🔍 Resolving movie stream across all servers...');
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl }),
        signal: AbortSignal.timeout(15000)
      });
      const data = await response.json();

      if (data.success) {
        showToast(`🎬 Loaded: ${data.title}! Playing on both screens ❤️`);
        autoMovieUrlInput.value = '';
        // Broadcast new movie to everyone in room
        socket.emit('change-source', data);
      } else {
        showToast('⚠️ Could not resolve this link. Try another site.');
      }
    } catch (err) {
      showToast('⚠️ Server connection timed out. Please try again.');
    } finally {
      extractBtnText.textContent = '🎬 Play';
      extractSpinner.classList.add('hidden');
      btnAutoExtract.disabled = false;
    }
  }

  btnAutoExtract.addEventListener('click', handleAutoExtract);
  autoMovieUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAutoExtract();
  });

  // ================= MUTUAL SYNCHRONIZED CONTROLS =================
  // ================= AUTO-HIDE VIDEO CONTROLS =================
  let controlsHideTimer = null;

  function isMediaPlaying() {
    if (currentSourceType === 'youtube' && ytPlayer) {
      try {
        const state = (typeof ytPlayer.getPlayerState === 'function') ? ytPlayer.getPlayerState() : -1;
        return (state === 1);
      } catch (e) {
        return false;
      }
    }
    return !mainVideo.paused;
  }

  function startControlsHideTimer(delay = 2500) {
    clearTimeout(controlsHideTimer);
    if (!isSubSettingsOpen && !isScrubbing && isMediaPlaying()) {
      controlsHideTimer = setTimeout(() => {
        if (!isSubSettingsOpen && !isScrubbing && isMediaPlaying()) {
          videoWrapper.classList.add('controls-hidden');
        }
      }, delay);
    }
  }

  function showControls() {
    videoWrapper.classList.remove('controls-hidden');
    startControlsHideTimer(2500);
  }

  function hideControlsImmediately() {
    if (isMediaPlaying() && !isSubSettingsOpen && !isScrubbing) {
      clearTimeout(controlsHideTimer);
      videoWrapper.classList.add('controls-hidden');
    }
  }

  videoWrapper.addEventListener('mousemove', showControls);
  videoWrapper.addEventListener('mouseleave', hideControlsImmediately);
  videoWrapper.addEventListener('touchstart', showControls, { passive: true });

  videoWrapper.addEventListener('click', (e) => {
    // If click was inside controls, settings modal, quick chat, or close buttons, just show controls
    if (e.target.closest('.custom-video-controls') || 
        e.target.closest('.sub-settings-modal') || 
        e.target.closest('.video-quick-chat-bar') ||
        e.target.closest('.btn-close-sub')) {
      showControls();
      return;
    }

    // Tapping anywhere on the video player directly toggles Play/Pause!
    togglePlayPause();
  });

  // ================= ▶️ CINEMA CENTER PLAY/PAUSE CONTROLLER =================
  function showBigPlayOverlay() {
    if (centerPlayOverlay) centerPlayOverlay.classList.remove('hidden');
  }

  function hideBigPlayOverlay() {
    if (centerPlayOverlay) centerPlayOverlay.classList.add('hidden');
  }

  function updatePlayButtonUI() {
    let isPaused = true;
    if (currentSourceType === 'youtube' && ytPlayer) {
      try {
        const state = (typeof ytPlayer.getPlayerState === 'function') ? ytPlayer.getPlayerState() : -1;
        isPaused = (state !== 1);
      } catch (e) {
        isPaused = true;
      }
    } else {
      isPaused = mainVideo.paused;
    }

    if (isPaused) {
      btnPlayPause.textContent = '▶ Play';
      videoWrapper.classList.remove('controls-hidden');
      clearTimeout(controlsHideTimer);
      if (centerPlayOverlay) centerPlayOverlay.classList.remove('hidden');
      if (centerPlayIcon) {
        centerPlayIcon.textContent = '▶';
        centerPlayIcon.classList.remove('paused-icon');
      }
    } else {
      btnPlayPause.textContent = '⏸ Pause';
      if (centerPlayOverlay) centerPlayOverlay.classList.add('hidden');
    }
  }

  function flashCenterIcon(icon) {
    if (!centerPlayOverlay) return;
    if (centerPlayIcon) {
      centerPlayIcon.textContent = icon;
      if (icon === '⏸') centerPlayIcon.classList.add('paused-icon');
      else centerPlayIcon.classList.remove('paused-icon');
    }
    centerPlayOverlay.classList.remove('hidden');
    centerPlayOverlay.classList.remove('center-flash-pop');
    void centerPlayOverlay.offsetWidth;
    centerPlayOverlay.classList.add('center-flash-pop');
    setTimeout(() => {
      centerPlayOverlay.classList.remove('center-flash-pop');
      updatePlayButtonUI();
    }, 450);
  }

  function togglePlayPause() {
    unlockMedia();
    if (currentSourceType === 'youtube' && ytPlayer) {
      let isPlaying = false;
      try {
        isPlaying = (typeof ytPlayer.getPlayerState === 'function' && ytPlayer.getPlayerState() === 1);
      } catch (e) {}

      const cur = (ytPlayer.getCurrentTime && typeof ytPlayer.getCurrentTime === 'function') ? ytPlayer.getCurrentTime() : 0;

      if (isPlaying) {
        try { ytPlayer.pauseVideo(); } catch (e) {}
        socket.emit('media-pause', { time: cur });
        showToast('⏸️ You paused the video');
        videoWrapper.classList.remove('controls-hidden');
        clearTimeout(controlsHideTimer);
        flashCenterIcon('⏸');
      } else {
        try { ytPlayer.playVideo(); } catch (e) {}
        socket.emit('media-play', { time: cur });
        showToast('▶️ You played the video');
        startControlsHideTimer(2500);
        flashCenterIcon('▶');
      }
      updatePlayButtonUI();
      return;
    }

    if (mainVideo.paused) {
      mainVideo.play().then(() => {
        socket.emit('media-play', { time: mainVideo.currentTime });
        showToast('▶️ You played the movie');
        startControlsHideTimer(2500);
        flashCenterIcon('▶');
        updatePlayButtonUI();
      }).catch(err => {
        console.warn('Play error:', err);
      });
    } else {
      mainVideo.pause();
      socket.emit('media-pause', { time: mainVideo.currentTime });
      showToast('⏸️ You paused the movie');
      videoWrapper.classList.remove('controls-hidden');
      clearTimeout(controlsHideTimer);
      flashCenterIcon('⏸');
      updatePlayButtonUI();
    }
  }

  if (btnCenterPlay) {
    btnCenterPlay.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayPause();
    });
  }

  btnPlayPause.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlayPause();
  });

  mainVideo.addEventListener('play', () => {
    hideBigPlayOverlay();
    updatePlayButtonUI();
    if (isMediaDucked) mainVideo.volume = 0.15;
  });

  mainVideo.addEventListener('pause', () => {
    updatePlayButtonUI();
  });

  mainVideo.addEventListener('error', (e) => {
    console.warn('Video element error:', mainVideo.error);
    showBigPlayOverlay();
  });

  // Keyboard shortcut: Press Spacebar to play/pause anytime!
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
    }
  });

  // Rewind 10s (Controls both native video AND YouTube!)
  btnRewind10.addEventListener('click', () => {
    if (currentSourceType === 'youtube' && ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
      const target = Math.max(0, ytPlayer.getCurrentTime() - 10);
      ytPlayer.seekTo(target, true);
      socket.emit('media-seek', { time: target });
      showToast('↺ Rewound 10s');
      return;
    }
    const target = Math.max(0, mainVideo.currentTime - 10);
    mainVideo.currentTime = target;
    socket.emit('media-seek', { time: target });
    showToast('↺ Rewound 10s');
  });

  // Forward 10s (Controls both native video AND YouTube!)
  btnForward10.addEventListener('click', () => {
    if (currentSourceType === 'youtube' && ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
      const dur = ytPlayer.getDuration ? ytPlayer.getDuration() : 999999;
      const target = Math.min(dur, ytPlayer.getCurrentTime() + 10);
      ytPlayer.seekTo(target, true);
      socket.emit('media-seek', { time: target });
      showToast('10s ↻ Forwarded');
      return;
    }
    const target = mainVideo.currentTime + 10;
    mainVideo.currentTime = target;
    socket.emit('media-seek', { time: target });
    showToast('10s ↻ Forwarded');
  });

  // Mute / Unmute
  btnMuteToggle.addEventListener('click', () => {
    if (currentSourceType === 'youtube' && ytPlayer) {
      const isMuted = ytPlayer.isMuted ? ytPlayer.isMuted() : false;
      if (isMuted) {
        ytPlayer.unMute();
        btnMuteToggle.textContent = '🔊';
      } else {
        ytPlayer.mute();
        btnMuteToggle.textContent = '🔇';
      }
      return;
    }
    mainVideo.muted = !mainVideo.muted;
    btnMuteToggle.textContent = mainVideo.muted ? '🔇' : '🔊';
  });


  // Periodic Timeline Scrubber Updater for YouTube
  setInterval(() => {
    if (currentSourceType !== 'youtube' || !ytPlayer || isScrubbing) return;
    if (typeof ytPlayer.getCurrentTime !== 'function' || typeof ytPlayer.getDuration !== 'function') return;

    const cur = ytPlayer.getCurrentTime() || 0;
    const dur = ytPlayer.getDuration() || 0;

    if (dur > 0) {
      timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
      const pct = (cur / dur) * 100;
      progressFilled.style.width = `${pct}%`;
      progressHandle.style.left = `${pct}%`;
    }
  }, 250);

  // Progress Bar Timeline Updates
  mainVideo.addEventListener('timeupdate', () => {
    renderSubtitlesAtTime(mainVideo.currentTime);
    if (!mainVideo.duration) return;
    const progress = (mainVideo.currentTime / mainVideo.duration) * 100;
    progressFilled.style.width = `${progress}%`;
    progressHandle.style.left = `${progress}%`;
    timeDisplay.textContent = `${formatTime(mainVideo.currentTime)} / ${formatTime(mainVideo.duration)}`;

  });

  // Scrubber Seeking (Works for both native video and YouTube!)
  let isScrubbing = false;
  function seekToPosition(e) {
    const rect = progressWrap.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = clickX / rect.width;

    if (currentSourceType === 'youtube' && ytPlayer && typeof ytPlayer.getDuration === 'function') {
      const dur = ytPlayer.getDuration() || 0;
      const targetTime = percentage * dur;
      ytPlayer.seekTo(targetTime, true);
      socket.emit('media-seek', { time: targetTime });
      progressFilled.style.width = `${percentage * 100}%`;
      progressHandle.style.left = `${percentage * 100}%`;
      timeDisplay.textContent = `${formatTime(targetTime)} / ${formatTime(dur)}`;
      showToast(`⏩ Jumped to ${formatTime(targetTime)}`);
      return;
    }

    if (!mainVideo.duration) return;
    const targetTime = percentage * mainVideo.duration;
    mainVideo.currentTime = targetTime;
    socket.emit('media-seek', { time: targetTime });
    showToast(`⏩ Jumped to ${formatTime(targetTime)}`);
  }

  progressWrap.addEventListener('click', seekToPosition);
  progressWrap.addEventListener('touchstart', (e) => {
    isScrubbing = true;
    seekToPosition(e);
  });
  window.addEventListener('touchmove', (e) => {
    if (isScrubbing) seekToPosition(e);
  });
  window.addEventListener('touchend', () => {
    isScrubbing = false;
  });

  // Video Direct Tapping
  mainVideo.addEventListener('play', () => {
    updatePlayButtonUI();
    if (isRemoteAction) return;
    socket.emit('media-play', { time: mainVideo.currentTime });
  });

  mainVideo.addEventListener('pause', () => {
    updatePlayButtonUI();
    if (isRemoteAction) return;
    socket.emit('media-pause', { time: mainVideo.currentTime });
  });

  mainVideo.addEventListener('seeked', () => {
    if (isRemoteAction) return;
    socket.emit('media-seek', { time: mainVideo.currentTime });
  });


  // ================= 🔲 SCREEN FILL / BLACK BARS REMOVER =================
  const btnFitToggle = document.getElementById('btnFitToggle');
  const fitModes = ['fill', 'zoom', 'stretch', 'fit'];
  let currentFitIndex = 0; // Default to 'fill' (no black bars!)

  function applyFitMode(mode) {
    videoWrapper.classList.remove('fill-screen', 'zoom-screen', 'stretch-screen', 'fit-screen');
    if (mode === 'fill') {
      videoWrapper.classList.add('fill-screen');
      if (btnFitToggle) btnFitToggle.textContent = '🔲 Fill';
      showToast('🔲 Screen: Fill (No black bars)');
    } else if (mode === 'zoom') {
      videoWrapper.classList.add('zoom-screen');
      if (btnFitToggle) btnFitToggle.textContent = '🔍 Zoom+';
      showToast('🔍 Screen: Zoom+ (Crop letterbox)');
    } else if (mode === 'stretch') {
      videoWrapper.classList.add('stretch-screen');
      if (btnFitToggle) btnFitToggle.textContent = '↔️ Stretch';
      showToast('↔️ Screen: Stretch Full');
    } else {
      videoWrapper.classList.add('fit-screen');
      if (btnFitToggle) btnFitToggle.textContent = '🔳 Fit';
      showToast('🔳 Screen: Original Fit');
    }
    localStorage.setItem('cozy_video_fit', mode);
  }

  const savedFit = localStorage.getItem('cozy_video_fit') || 'fill';
  currentFitIndex = Math.max(0, fitModes.indexOf(savedFit));
  applyFitMode(savedFit);

  if (btnFitToggle) {
    btnFitToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      currentFitIndex = (currentFitIndex + 1) % fitModes.length;
      applyFitMode(fitModes[currentFitIndex]);
    });
  }

  // Fullscreen & Screen Orientation Auto-Rotation
  btnFullscreen.addEventListener('click', async () => {
    const isFs = document.fullscreenElement || document.webkitFullscreenElement || videoWrapper.classList.contains('ios-pseudo-fullscreen');
    if (isFs) {
      if (document.exitFullscreen) await document.exitFullscreen().catch(() => {});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      videoWrapper.classList.remove('ios-pseudo-fullscreen');
      btnFullscreen.textContent = '⛶';
      if (screen.orientation && screen.orientation.unlock) {
        try { screen.orientation.unlock(); } catch (e) {}
      }
    } else {
      // 1. Standard Fullscreen API (Works on PC, Android Chrome, iPad, Mac)
      const req = videoWrapper.requestFullscreen || videoWrapper.webkitRequestFullscreen || videoWrapper.mozRequestFullScreen;
      if (req) {
        try {
          await req.call(videoWrapper);
          btnFullscreen.textContent = '✕';
          if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape').catch(() => {});
          }
          return;
        } catch (err) {}
      }

      // 2. iOS Native video fullscreen (if not in youtube mode)
      if (currentSourceType !== 'youtube' && mainVideo.webkitEnterFullscreen) {
        mainVideo.webkitEnterFullscreen();
        return;
      }

      // 3. Fallback Smooth Pseudo-Fullscreen (Works everywhere on iOS Safari / iPhone)
      videoWrapper.classList.add('ios-pseudo-fullscreen');
      btnFullscreen.textContent = '✕';
    }
  });

  document.addEventListener('fullscreenchange', () => {
    btnFullscreen.textContent = document.fullscreenElement ? '✕' : '⛶';
  });

  // ================= SOCKET EVENT LISTENERS (MUTUAL SYNC) =================
  socket.on('init-state', (data) => {
    userCountText.textContent = `${data.userCount} Online`;
    if (!data.source) return;

    const incomingMediaKey = data.source.url || data.source.embedUrl || data.source.videoId || data.source.title || '';
    if (!incomingMediaKey) return;

    // Check if player already has this exact media actively loaded and playing:
    const isAlreadyLoaded = (activeMediaKey && activeMediaKey === incomingMediaKey) &&
      ((currentSourceType === 'youtube' && ytPlayer) || 
       (mainVideo && (!mainVideo.classList.contains('hidden') || hlsInstance)));

    if (isAlreadyLoaded) {
      console.log('[Init-State] Same media already loaded. Preventing reload / black screen.');
      if (typeof data.currentTime === 'number' && !isNaN(data.currentTime)) {
        if (currentSourceType === 'youtube' && ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
          const diff = Math.abs(ytPlayer.getCurrentTime() - data.currentTime);
          if (diff > 3) ytPlayer.seekTo(data.currentTime, true);
        } else if (mainVideo && mainVideo.duration) {
          const diff = Math.abs(mainVideo.currentTime - data.currentTime);
          if (diff > 3) mainVideo.currentTime = data.currentTime;
        }
      }
      if (data.isPlaying) {
        if (currentSourceType === 'youtube' && ytPlayer && typeof ytPlayer.playVideo === 'function') {
          ytPlayer.playVideo();
        } else if (mainVideo && mainVideo.paused) {
          mainVideo.play().catch(() => {});
        }
      }
      return;
    }

    loadSource(data.source, data.currentTime, data.isPlaying);
  });

  socket.on('user-joined', (data) => {
    userCountText.textContent = `${data.userCount} Online`;
    if (data.name !== myName) {
      appendChatMessage('System', `🟢 ${data.name} joined the room!`, 'system');
      showToast(`🟢 ${data.name} joined!`);
    }
  });

  socket.on('user-left', (data) => {
    userCountText.textContent = `${data.userCount} Online`;
    if (data.name !== myName) {
      appendChatMessage('System', `⚪ ${data.name} left the room`, 'system');
    }
  });

  socket.on('source-changed', (data) => {
    showToast(`🎬 ${data.senderName} loaded new media`);
    if (data.senderName !== myName) {
      loadSource(data.source, 0, true);
    }
  });

  // Mutual Play: The other person pressed Play
  socket.on('media-play', (data) => {
    isRemoteAction = true;

    if (currentSourceType === 'youtube' && ytPlayer && typeof ytPlayer.playVideo === 'function') {
      try {
        const cur = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
        if (Math.abs(cur - data.time) > 1.5) {
          ytPlayer.seekTo(data.time, true);
        }
        ytPlayer.playVideo();
        hideBigPlayOverlay();
        startControlsHideTimer(2500);
      } catch (e) {
        showBigPlayOverlay();
      }
      updatePlayButtonUI();
      showToast(`▶️ ${data.senderName} played the video`);
      setTimeout(() => { isRemoteAction = false; }, 300);
      return;
    }

    if (mainVideo.readyState > 0 && Math.abs(mainVideo.currentTime - data.time) > 1.5) {
      try { mainVideo.currentTime = data.time; } catch (e) {}
    }

    const p = mainVideo.play();
    if (p !== undefined) {
      p.then(() => {
        hideBigPlayOverlay();
        updatePlayButtonUI();
        startControlsHideTimer(2500);
      }).catch(() => {
        showBigPlayOverlay();
        showToast(`▶️ ${data.senderName} started the movie! Tap play button to join`);
      });
    }

    updatePlayButtonUI();
    showToast(`▶️ ${data.senderName} played the movie`);
    setTimeout(() => { isRemoteAction = false; }, 300);
  });

  // Mutual Pause: The other person pressed Pause
  socket.on('media-pause', (data) => {
    isRemoteAction = true;

    if (currentSourceType === 'youtube' && ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
      try {
        ytPlayer.seekTo(data.time, true);
        ytPlayer.pauseVideo();
      } catch (e) {}
      videoWrapper.classList.remove('controls-hidden');
      clearTimeout(controlsHideTimer);
      updatePlayButtonUI();
      showToast(`⏸️ ${data.senderName} paused the video`);
      setTimeout(() => { isRemoteAction = false; }, 300);
      return;
    }

    mainVideo.currentTime = data.time;
    mainVideo.pause();
    videoWrapper.classList.remove('controls-hidden');
    clearTimeout(controlsHideTimer);
    updatePlayButtonUI();
    showToast(`⏸️ ${data.senderName} paused the movie`);
    setTimeout(() => { isRemoteAction = false; }, 300);
  });

  // Mutual Seek: The other person jumped time
  socket.on('media-seek', (data) => {
    isRemoteAction = true;

    if (currentSourceType === 'youtube' && ytPlayer && typeof ytPlayer.seekTo === 'function') {
      try {
        ytPlayer.seekTo(data.time, true);
      } catch (e) {}
      showToast(`⏩ ${data.senderName} jumped to ${formatTime(data.time)}`);
      setTimeout(() => { isRemoteAction = false; }, 300);
      return;
    }

    mainVideo.currentTime = data.time;
    showToast(`⏩ ${data.senderName} jumped to ${formatTime(data.time)}`);
    setTimeout(() => { isRemoteAction = false; }, 300);
  });

  // Active Drift Lockstep (Every 1.5 seconds for both HTML5 and YouTube)
  setInterval(() => {
    if (!mainVideo.classList.contains('hidden') || (currentSourceType === 'youtube' && ytPlayer)) {
      socket.emit('sync-heartbeat');
    }
  }, 1500);

  socket.on('sync-heartbeat-response', (data) => {
    if (isRemoteAction) return;

    // YouTube Lockstep Heartbeat
    if (currentSourceType === 'youtube' && ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
      let cur = 0;
      let state = -1;
      try {
        cur = ytPlayer.getCurrentTime() || 0;
        state = (typeof ytPlayer.getPlayerState === 'function') ? ytPlayer.getPlayerState() : -1;
      } catch (e) { return; }

      const isPlaying = (state === 1);

      if (!isPlaying && data.isPlaying && state !== 3) {
        try {
          if (Math.abs(cur - data.time) > 2.0) {
            ytPlayer.seekTo(data.time, true);
          }
          ytPlayer.playVideo();
          startControlsHideTimer(2500);
        } catch (e) {}
        updatePlayButtonUI();
        return;
      }

      if (isPlaying && !data.isPlaying) {
        try {
          ytPlayer.pauseVideo();
          ytPlayer.seekTo(data.time, true);
        } catch (e) {}
        videoWrapper.classList.remove('controls-hidden');
        clearTimeout(controlsHideTimer);
        updatePlayButtonUI();
        return;
      }

      const drift = Math.abs(cur - data.time);
      if (drift > 2.5) {
        try {
          ytPlayer.seekTo(data.time, true);
        } catch (e) {}
      }
      return;
    }

    if (mainVideo.classList.contains('hidden')) return;

    // Both MUST be in the same playing state
    if (mainVideo.paused && data.isPlaying) {
      isRemoteAction = true;
      mainVideo.currentTime = data.time;
      mainVideo.play().catch(() => {});
      setTimeout(() => { isRemoteAction = false; }, 300);
      return;
    }

    if (!mainVideo.paused && !data.isPlaying) {
      isRemoteAction = true;
      mainVideo.pause();
      mainVideo.currentTime = data.time;
      setTimeout(() => { isRemoteAction = false; }, 300);
      return;
    }

    // Drift correction
    const drift = Math.abs(mainVideo.currentTime - data.time);
    if (drift > 1.0) {
      isRemoteAction = true;
      mainVideo.currentTime = data.time;
      setTimeout(() => { isRemoteAction = false; }, 300);
    } else if (drift > 0.3) {
      mainVideo.playbackRate = mainVideo.currentTime < data.time ? 1.05 : 0.95;
      setTimeout(() => { mainVideo.playbackRate = 1.0; }, 800);
    }
  });

  btnQuickSync.addEventListener('click', () => {
    if (!iframeContainer.classList.contains('hidden') && embedFrame.src) {
      const cur = embedFrame.src;
      embedFrame.src = cur;
      socket.emit('sync-embed-reload');
      showToast('⚡ Re-synced stream on both screens!');
      return;
    }
    socket.emit('media-seek', { time: mainVideo.currentTime });
    showToast('⚡ Synced with partner');
  });

  socket.on('sync-embed-reload', () => {
    if (embedFrame.src) {
      const cur = embedFrame.src;
      embedFrame.src = cur;
    }
    showToast('⚡ Partner synced the stream!');
  });

  // ================= FLOATING REACTIONS =================
  function triggerReaction(emoji) {
    socket.emit('send-reaction', { emoji });
  }

  socket.on('reaction', (data) => {
    createFloatingHeart(data.emoji);
  });

  function createFloatingHeart(emoji) {
    const el = document.createElement('div');
    el.className = 'floating-heart';
    el.textContent = emoji;

    const randomOffset = Math.floor(Math.random() * 80) + 20;
    el.style.right = `${randomOffset}px`;

    reactionOverlay.appendChild(el);
    setTimeout(() => { el.remove(); }, 3000);
  }

  document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.getAttribute('data-emoji');
      triggerReaction(emoji);
    });
  });

  // ================= LIVE CHAT =================
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    if (!socket.connected) {
      console.log('[Chat] Socket disconnected, attempting reconnection...');
      socket.connect();
    }
    socket.emit('chat-message', { text });
    chatInput.value = '';
  });

  socket.on('chat-message', (data) => {
    const isMine = data.sender === myName;
    appendChatMessage(data.sender, data.text, isMine ? 'mine' : 'theirs', data.time);
  });


  // ================= 💬 ON-VIDEO FLOATING CINEMA CHAT =================
  const videoChatOverlay = document.getElementById('videoChatOverlay');
  const videoQuickChatBar = document.getElementById('videoQuickChatBar');
  const videoQuickChatInput = document.getElementById('videoQuickChatInput');
  const btnVideoQuickChatSend = document.getElementById('btnVideoQuickChatSend');
  const btnVideoQuickChatClose = document.getElementById('btnVideoQuickChatClose');
  const btnFullscreenChat = document.getElementById('btnFullscreenChat');

  function showOnVideoChat(sender, text, isMine) {
    if (!videoChatOverlay) return;
    const bubble = document.createElement('div');
    bubble.className = `video-chat-bubble ${isMine ? 'mine' : 'theirs'}`;
    
    const isRtl = /[؀-ۿ]/.test(text);

    const authorSpan = document.createElement('span');
    authorSpan.className = 'video-chat-author';
    authorSpan.textContent = sender + ':';

    const textSpan = document.createElement('span');
    textSpan.className = `video-chat-text ${isRtl ? 'rtl' : ''}`;
    textSpan.textContent = text;

    bubble.appendChild(authorSpan);
    bubble.appendChild(textSpan);
    videoChatOverlay.appendChild(bubble);

    // Keep at most 4 bubbles simultaneously
    while (videoChatOverlay.children.length > 4) {
      videoChatOverlay.removeChild(videoChatOverlay.firstChild);
    }

    // Auto disappear after 4.5 seconds with smooth fade-out
    setTimeout(() => {
      bubble.classList.add('fade-out');
      setTimeout(() => {
        if (bubble.parentElement) bubble.parentElement.removeChild(bubble);
      }, 450);
    }, 4500);
  }

  function toggleQuickChat() {
    if (!videoQuickChatBar) return;
    const isHidden = videoQuickChatBar.classList.contains('hidden');
    if (isHidden) {
      videoQuickChatBar.classList.remove('hidden');
      videoQuickChatInput.focus();
    } else {
      videoQuickChatBar.classList.add('hidden');
      videoQuickChatInput.blur();
    }
  }

  if (btnFullscreenChat) {
    btnFullscreenChat.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleQuickChat();
    });
  }

  if (btnVideoQuickChatClose) {
    btnVideoQuickChatClose.addEventListener('click', (e) => {
      e.stopPropagation();
      videoQuickChatBar.classList.add('hidden');
    });
  }

  function sendQuickChatMessage() {
    const text = videoQuickChatInput.value.trim();
    if (!text) return;
    if (!socket.connected) {
      socket.connect();
    }
    socket.emit('chat-message', { text });
    videoQuickChatInput.value = '';
    videoQuickChatBar.classList.add('hidden');
  }

  if (btnVideoQuickChatSend) {
    btnVideoQuickChatSend.addEventListener('click', (e) => {
      e.stopPropagation();
      sendQuickChatMessage();
    });
  }

  if (videoQuickChatInput) {
    videoQuickChatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        sendQuickChatMessage();
      } else if (e.key === 'Escape') {
        videoQuickChatBar.classList.add('hidden');
      }
    });
  }

  // Keyboard shortcuts for cinema player (Space, Left/Right, F, M, C)
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      toggleQuickChat();
    } else if (e.code === 'Space') {
      e.preventDefault();
      btnPlayPause.click();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      btnRewind10.click();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      btnForward10.click();
    } else if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      if (btnFitToggle) btnFitToggle.click();
    } else if (e.key === 'g' || e.key === 'G') {
      e.preventDefault();
      adjustSubOffset(0.5);
    } else if (e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      adjustSubOffset(-0.5);
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      btnFullscreen.click();
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      btnMuteToggle.click();
    }
  });

  // ================= 🎙️ WEBRTC AUTO-VOICE & LIVE WALKIE-TALKIE ENGINE =================
  const btnVoiceCall = document.getElementById('btnVoiceCall');
  const btnVoiceMute = document.getElementById('btnVoiceMute');
  const voiceCallIcon = document.getElementById('voiceCallIcon');
  const voiceCallText = document.getElementById('voiceCallText');
  const voiceMuteIcon = document.getElementById('voiceMuteIcon');
  const btnPlayerMic = document.getElementById('btnPlayerMic');
  const playerMicIcon = document.getElementById('playerMicIcon');
  const playerMicText = document.getElementById('playerMicText');

  // ================= 🎙️ WEBRTC AUTO-VOICE CALL ENGINE (DISCORD STYLE) =================
  let localAudioStream = null;
  let peerConnection = null;
  let audioSender = null;
  let isMicLive = false;
  let remoteAudioElement = null;
  let audioContext = null;
  let duckingAnalyser = null;
  let duckingInterval = null;
  let isDucking = false;
  const originalMovieVolume = 1.0;
  let dummyAudioStream = null;
  const iceCandidateQueue = [];

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp'
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ],
    iceCandidatePoolSize: 4
  };

  // Helper: Generates a lightweight silent track so WebRTC connection is 100% established
  // without asking for mic permissions upfront. When user talks, we replaceTrack instantly!
  function getOrCreateSilentTrack() {
    if (dummyAudioStream && dummyAudioStream.getAudioTracks().length > 0) {
      return dummyAudioStream.getAudioTracks()[0];
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const dst = osc.connect(ctx.createMediaStreamDestination());
      osc.start();
      const track = dst.stream.getAudioTracks()[0];
      track.enabled = false; // Muted / zero sound
      dummyAudioStream = dst.stream;
      return track;
    } catch (e) {
      console.warn('[VoiceChat] Could not generate silent audio track:', e);
      return null;
    }
  }

  // 1. Mobile & Desktop Audio Autoplay Unlocker
  function ensureAudioUnlocked() {
    try {
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
      const remoteEl = document.getElementById('remoteVoiceAudio') || remoteAudioElement;
      if (remoteEl && remoteEl.paused && remoteEl.srcObject) {
        remoteEl.play().catch(() => {});
      }
    } catch (e) {}
  }
  document.addEventListener('pointerdown', ensureAudioUnlocked, { passive: true });
  document.addEventListener('click', ensureAudioUnlocked, { passive: true });
  document.addEventListener('touchstart', ensureAudioUnlocked, { passive: true });

  // 2. Initialize WebRTC Peer Connection (Always-Listening Receiver)
  function initAutoVoice() {
    if (peerConnection && peerConnection.connectionState !== 'closed' && peerConnection.connectionState !== 'failed') {
      return;
    }

    try {
      if (peerConnection) {
        try { peerConnection.close(); } catch (e) {}
      }

      peerConnection = new RTCPeerConnection(rtcConfig);

      // Standard W3C Audio Transceiver: establishes two-way voice channel without requiring mic upfront
      // or suspended Web Audio contexts on iOS Safari and Android Chrome
      let transceiver = peerConnection.getTransceivers().find(t => t.receiver.track && t.receiver.track.kind === 'audio');
      if (!transceiver) {
        transceiver = peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
      }
      audioSender = transceiver.sender;

      // Handle ICE Candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('voice-signal', {
            signal: { type: 'candidate', candidate: event.candidate }
          });
        }
      };

      // Handle incoming partner audio track -> Play immediately through speakers!
      peerConnection.ontrack = (event) => {
        console.log('[VoiceChat] Remote audio track received from partner!', event);
        const remoteStream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);

        let audioEl = document.getElementById('remoteVoiceAudio');
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.id = 'remoteVoiceAudio';
          document.body.appendChild(audioEl);
        }
        audioEl.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.001;pointer-events:none;bottom:0;right:0;';
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        audioEl.volume = 1.0;
        audioEl.muted = false;
        audioEl.srcObject = remoteStream;
        remoteAudioElement = audioEl;

        const p = audioEl.play();
        if (p !== undefined) {
          p.catch(e => console.log('[VoiceChat] Autoplay waiting for tap:', e));
        }

        event.track.onunmute = () => {
          console.log('[VoiceChat] Remote track unmuted, playing audio');
          if (remoteAudioElement) remoteAudioElement.play().catch(() => {});
        };

        showToast('🔊 Partner voice connected! Speakers ready.');
      };

      peerConnection.onconnectionstatechange = () => {
        console.log('[VoiceChat] Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
          console.log('[VoiceChat] WebRTC voice connected successfully!');
        } else if (peerConnection.connectionState === 'failed') {
          console.warn('[VoiceChat] Connection failed, resetting...');
          setTimeout(initAutoVoice, 2000);
        }
      };

      // Announce readiness in room
      socket.emit('voice-join', { roomId, name: myName });

    } catch (err) {
      console.warn('[VoiceChat Init Error]', err);
    }
  }

  // ================= 🎧 UNIVERSAL AUDIO DUCKING (MOVIES, SHOWS & YOUTUBE) =================
  let isMediaDucked = false;
  let savedMainVideoVolume = 1.0;
  let savedYtVolume = 100;
  let partnerSpeakingViaSocket = false;

  function updateMicUI(isLive, isGlowing) {
    if (btnVoiceCall) {
      if (isLive) {
        btnVoiceCall.classList.add('in-call');
        if (voiceCallIcon) voiceCallIcon.textContent = '🟢';
        if (voiceCallText) voiceCallText.textContent = 'Mic Live';
      } else {
        btnVoiceCall.classList.remove('in-call');
        if (voiceCallIcon) voiceCallIcon.textContent = '🎙️';
        if (voiceCallText) voiceCallText.textContent = 'Mic Off';
      }
      if (isGlowing) btnVoiceCall.classList.add('speaking-glow');
      else if (!isLive) btnVoiceCall.classList.remove('speaking-glow');
    }

    if (btnPlayerMic) {
      if (isLive) {
        btnPlayerMic.classList.add('in-call');
        if (playerMicIcon) playerMicIcon.textContent = '🟢';
        if (playerMicText) playerMicText.textContent = 'Mic Live';
      } else {
        btnPlayerMic.classList.remove('in-call');
        if (playerMicIcon) playerMicIcon.textContent = '🎙️';
        if (playerMicText) playerMicText.textContent = 'Mic Off';
      }
      if (isGlowing) btnPlayerMic.classList.add('speaking-glow');
      else if (!isLive) btnPlayerMic.classList.remove('speaking-glow');
    }
  }

  function duckMediaAudio(shouldDuck) {
    if (shouldDuck) {
      if (isMediaDucked) return;
      isMediaDucked = true;

      // 1. HTML5 Video (HLS Movies, Direct MP4, Local Files)
      if (mainVideo) {
        if (mainVideo.volume > 0.25) savedMainVideoVolume = mainVideo.volume;
        mainVideo.volume = 0.15; // Smooth ducking to 15%
      }

      // 2. YouTube Player
      if (ytPlayer && typeof ytPlayer.setVolume === 'function') {
        try {
          const curYt = (typeof ytPlayer.getVolume === 'function') ? ytPlayer.getVolume() : 100;
          if (curYt > 25) savedYtVolume = curYt;
          ytPlayer.setVolume(15); // Smooth ducking to 15%
        } catch (e) {}
      }

      updateMicUI(isMicLive, true);

    } else {
      // Don't unduck if local user is still speaking or partner is speaking
      if (isMicLive || partnerSpeakingViaSocket) return;
      if (!isMediaDucked) return;
      isMediaDucked = false;

      // Restore HTML5 Video
      if (mainVideo) {
        mainVideo.volume = savedMainVideoVolume || 1.0;
      }

      // Restore YouTube
      if (ytPlayer && typeof ytPlayer.setVolume === 'function') {
        try {
          ytPlayer.setVolume(savedYtVolume || 100);
        } catch (e) {}
      }

      updateMicUI(isMicLive, false);
    }
  }

  // 3. Single-Tap Microphone Toggle (Speak Freely!)
  async function toggleMicrophone() {
    ensureAudioUnlocked();
    if (!isMicLive) {
      // TURN MIC ON
      try {
        showToast('🎙️ Starting mic...');
        if (!localAudioStream) {
          localAudioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
            video: false
          });
        }

        const realMicTrack = localAudioStream.getAudioTracks()[0];
        if (realMicTrack) realMicTrack.enabled = true;

        if (!peerConnection) initAutoVoice();

        // Find active audio sender & guarantee transceiver direction is sendrecv
        const transceivers = peerConnection.getTransceivers ? peerConnection.getTransceivers() : [];
        let audioTransceiver = transceivers.find(t => 
          (t.receiver && t.receiver.track && t.receiver.track.kind === 'audio') ||
          (t.sender && t.sender.track && t.sender.track.kind === 'audio') ||
          t.mid !== null
        );
        if (audioTransceiver) {
          audioTransceiver.direction = 'sendrecv';
          audioSender = audioTransceiver.sender;
        } else if (!audioSender) {
          const senders = peerConnection.getSenders();
          audioSender = senders.find(s => (s.track && s.track.kind === 'audio') || s.dtmf !== undefined) || senders[0];
        }

        if (audioSender) {
          console.log('[VoiceChat] Swapping silent track with live microphone track!');
          await audioSender.replaceTrack(realMicTrack);
        } else {
          audioSender = peerConnection.addTrack(realMicTrack, localAudioStream);
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          socket.emit('voice-signal', { signal: { type: 'offer', sdp: offer } });
        }

        isMicLive = true;
        updateMicUI(true, true);
        showToast('🎙️ Mic is ON! Your partner hears you now ❤️');

        duckMediaAudio(true); // Duck movie/YouTube volume on speaker's own device
        socket.emit('voice-speaking', { roomId, isSpeaking: true });

      } catch (err) {
        console.error('[Mic Access Error]', err);
        showToast('⚠️ Please allow microphone permission in your browser.');
      }
    } else {
      // TURN MIC OFF (MUTE & RELEASE HARDWARE COMPLETELY)
      if (localAudioStream) {
        localAudioStream.getAudioTracks().forEach(t => {
          t.enabled = false;
          t.stop(); // 🔒 Releases microphone hardware completely! Removes red dot from browser tab.
        });
        localAudioStream = null;
      }
      
      if (audioSender) {
        audioSender.replaceTrack(null).catch(() => {});
      }

      isMicLive = false;
      updateMicUI(false, false);
      showToast('🔇 Mic Muted. Hardware released.');

      duckMediaAudio(false); // Restore movie/YouTube volume on speaker's device
      socket.emit('voice-speaking', { roomId, isSpeaking: false });
    }
  }

  if (btnVoiceCall) {
    voiceCallText.textContent = 'Mic Off';
    btnVoiceCall.addEventListener('click', toggleMicrophone);
  }

  if (btnPlayerMic) {
    if (playerMicText) playerMicText.textContent = 'Mic Off';
    btnPlayerMic.addEventListener('click', toggleMicrophone);
  }

  // Keyboard shortcut: Press 'V' to toggle microphone anytime (super convenient in fullscreen!)
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      toggleMicrophone();
    }
  });

  // Visual speaking indicator & real-time audio ducking from partner
  socket.on('voice-peer-speaking', ({ isSpeaking }) => {
    partnerSpeakingViaSocket = isSpeaking;
    if (isSpeaking) {
      duckMediaAudio(true);
      // Guarantee remote speaker audio element is unmuted, at full volume, and actively playing!
      const remoteEl = document.getElementById('remoteVoiceAudio') || remoteAudioElement;
      if (remoteEl) {
        remoteEl.volume = 1.0;
        remoteEl.muted = false;
        if (remoteEl.paused) {
          remoteEl.play().catch(e => console.log('[VoiceChat] Remote play wake:', e));
        }
      }
    } else {
      duckMediaAudio(false);
    }
  });

  // Partner Joined -> Initiate Offer
  socket.on('voice-peer-joined', async (data) => {
    console.log(`[VoiceChat] Partner ${data.name} is ready in room`);
    if (!peerConnection) initAutoVoice();

    try {
      // Ensure local audio transceiver is bidirectional ('sendrecv') before offering
      const transceivers = peerConnection.getTransceivers ? peerConnection.getTransceivers() : [];
      for (const t of transceivers) {
        if ((t.receiver && t.receiver.track && t.receiver.track.kind === 'audio') || t.mid !== null) {
          t.direction = 'sendrecv';
          audioSender = t.sender;
        }
      }
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('voice-signal', {
        to: data.peerId,
        signal: { type: 'offer', sdp: offer }
      });
    } catch (err) {
      console.warn('[Voice Offer Error]', err);
    }
  });

  // WebRTC Signal Exchange (Offers, Answers, ICE Candidates with Queuing)
  socket.on('voice-signal', async (data) => {
    try {
      if (!peerConnection) initAutoVoice();
      if (!data.signal) return;

      if (data.signal.type === 'offer') {
        if (peerConnection.signalingState !== 'stable') {
          console.warn('[WebRTC] Signaling state collision, rolling back local description');
          await peerConnection.setLocalDescription({ type: 'rollback' }).catch(() => {});
        }
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
        while (iceCandidateQueue.length > 0) {
          const cand = iceCandidateQueue.shift();
          await peerConnection.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }

        // CRITICAL FOR MOBILE & BIDIRECTIONAL AUDIO:
        // Set direction to 'sendrecv' on the transceiver matching the offer so createAnswer()
        // generates an answer SDP with 'a=sendrecv'. This allows sending mic audio from phone to laptop!
        const transceivers = peerConnection.getTransceivers ? peerConnection.getTransceivers() : [];
        for (const t of transceivers) {
          if ((t.receiver && t.receiver.track && t.receiver.track.kind === 'audio') || t.mid !== null) {
            t.direction = 'sendrecv';
            audioSender = t.sender;
          }
        }

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('voice-signal', {
          to: data.from,
          signal: { type: 'answer', sdp: answer }
        });
      } else if (data.signal.type === 'answer') {
        if (peerConnection.signalingState !== 'stable') {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
          while (iceCandidateQueue.length > 0) {
            const cand = iceCandidateQueue.shift();
            await peerConnection.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
          const transceivers = peerConnection.getTransceivers ? peerConnection.getTransceivers() : [];
          for (const t of transceivers) {
            if ((t.receiver && t.receiver.track && t.receiver.track.kind === 'audio') || t.mid !== null) {
              if (!audioSender) audioSender = t.sender;
            }
          }
        }
      } else if (data.signal.type === 'candidate' && data.signal.candidate) {
        if (!peerConnection.remoteDescription || !peerConnection.remoteDescription.type) {
          iceCandidateQueue.push(data.signal.candidate);
        } else {
          await peerConnection.addIceCandidate(new RTCIceCandidate(data.signal.candidate)).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[WebRTC Signal Error]', e);
    }
  });

  socket.on('voice-peer-left', () => {
    partnerSpeakingViaSocket = false;
    duckMediaAudio(false);
    if (remoteAudioElement) remoteAudioElement.srcObject = null;
  });

  // Automatically start voice listener upon room connection!
  socket.on('connect', () => {
    setTimeout(initAutoVoice, 600);
  });


  // ================= 🔍 IN-APP MOVIE BROWSER & POSTERS =================
  const browseMovieInput = document.getElementById('browseMovieInput');
  const btnBrowseSearch = document.getElementById('btnBrowseSearch');
  const moviesCardsGrid = document.getElementById('moviesCardsGrid');
  const genrePills = document.querySelectorAll('.genre-pill');

  async function loadTrendingMovies(genre = 'trending') {
    if (!moviesCardsGrid) return;
    moviesCardsGrid.innerHTML = '<div style="color: #94a3b8; padding: 20px; text-align: center; grid-column: 1 / -1;">⏳ Loading movies...</div>';

    try {
      const res = await fetch(`/api/movies/trending?genre=${encodeURIComponent(genre)}`);
      const data = await res.json();
      if (data.success && data.movies && data.movies.length > 0) {
        renderMovieCards(data.movies);
      } else {
        moviesCardsGrid.innerHTML = '<div style="color: #94a3b8; padding: 20px; text-align: center; grid-column: 1 / -1;">No movies found for this category.</div>';
      }
    } catch (e) {
      moviesCardsGrid.innerHTML = '<div style="color: #f87171; padding: 20px; text-align: center; grid-column: 1 / -1;">Error loading movies catalog.</div>';
    }
  }

  async function searchMovies(query) {
    if (!moviesCardsGrid || !query.trim()) return;
    moviesCardsGrid.innerHTML = `<div style="color: #94a3b8; padding: 20px; text-align: center; grid-column: 1 / -1;">🔍 Searching for "${query}"...</div>`;

    try {
      const res = await fetch(`/api/movies/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.success && data.movies && data.movies.length > 0) {
        renderMovieCards(data.movies);
      } else {
        moviesCardsGrid.innerHTML = `<div style="color: #94a3b8; padding: 20px; text-align: center; grid-column: 1 / -1;">No matches found for "${query}". Try another title!</div>`;
      }
    } catch (e) {
      moviesCardsGrid.innerHTML = '<div style="color: #f87171; padding: 20px; text-align: center; grid-column: 1 / -1;">Search failed. Try again.</div>';
    }
  }

  function renderMovieCards(movies) {
    if (!moviesCardsGrid) return;
    moviesCardsGrid.innerHTML = '';

    movies.forEach(movie => {
      const card = document.createElement('div');
      card.className = 'movie-card';

      const posterUrl = movie.poster || 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=400&q=80';
      const yearStr = movie.year ? `(${movie.year})` : '';
      const ratingBadge = movie.rating ? `<span class="movie-card-badge">★ ${movie.rating}</span>` : '';

      card.innerHTML = `
        <div class="movie-poster-wrap">
          <img src="${posterUrl}" alt="${movie.title}" loading="lazy">
          ${ratingBadge}
        </div>
        <div class="movie-card-info">
          <div class="movie-card-title" title="${movie.title}">${movie.title}</div>
          <div class="movie-card-meta">${yearStr} ${movie.actors ? '• ' + movie.actors : ''}</div>
          <button class="btn-card-play" type="button" data-title="${movie.title}" data-id="${movie.id || ''}">
            <span>🎬 Play Together</span>
          </button>
        </div>
      `;

      const playBtn = card.querySelector('.btn-card-play');
      playBtn.addEventListener('click', async () => {
        playMovieFromCard(movie.title, movie.id);
      });

      moviesCardsGrid.appendChild(card);
    });
  }

  async function playMovieFromCard(title, id) {
    showToast(`🔍 Loading "${title}" for both screens...`);
    const tabUrl = document.querySelector('.source-tab[data-tab="url"]');
    if (tabUrl) tabUrl.click();

    autoMovieUrlInput.value = id || title;
    btnAutoExtract.click();
  }

  genrePills.forEach(pill => {
    pill.addEventListener('click', () => {
      genrePills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      loadTrendingMovies(pill.dataset.genre);
    });
  });

  if (btnBrowseSearch) {
    btnBrowseSearch.addEventListener('click', () => {
      const q = browseMovieInput.value.trim();
      if (q) searchMovies(q);
    });
  }

  if (browseMovieInput) {
    browseMovieInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btnBrowseSearch.click();
      }
    });
  }

  // Auto-load trending movies when Browse tab is clicked
  const tabBrowse = document.querySelector('.source-tab[data-tab="browse"]');
  if (tabBrowse) {
    tabBrowse.addEventListener('click', () => {
      if (!moviesCardsGrid.hasChildNodes() || moviesCardsGrid.innerHTML.includes('Loading')) {
        loadTrendingMovies('trending');
      }
    });
  }


  // ================= 📂 SUBTITLE DRAG & DROP AND PARSER =================
  const subDropOverlay = document.getElementById('subDropOverlay');
  const subFileInput = document.getElementById('subFileInput');
  const btnUploadSubFile = document.getElementById('btnUploadSubFile');

  // Convert .srt text to WebVTT format
  function convertSrtToVtt(srtText) {
    let vtt = 'WEBVTT\n\n' + srtText.trim();
    // Replace comma millisecond separators with periods (00:01:23,456 --> 00:01:23.456)
    vtt = vtt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return vtt;
  }

  function handleSubtitleFile(file) {
    if (!file) return;
    const isSrt = file.name.toLowerCase().endsWith('.srt');
    const isVtt = file.name.toLowerCase().endsWith('.vtt');

    if (!isSrt && !isVtt) {
      showToast('⚠️ Please upload a .srt or .vtt subtitle file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      let rawText = e.target.result;
      let finalVtt = isSrt ? convertSrtToVtt(rawText) : rawText;

      // Broadcast to room so both users immediately get the subtitle
      socket.emit('custom-subtitle', {
        roomId,
        vttText: finalVtt,
        fileName: file.name
      });

      // Load locally
      loadCustomVttSubtitle(finalVtt, file.name);
      showToast(`📁 Subtitle "${file.name}" loaded for both of you!`);
      appendChatMessage('System', `📁 You uploaded subtitle: "${file.name}" (Active for both)`, 'system');
    };

    reader.readAsText(file, 'UTF-8');
  }

  function loadCustomVttSubtitle(vttText, fileName) {
    currentParsedCues = parseVttText(vttText);
    currentActiveSubtitle = 'custom';
    if (btnSubtitleToggle) {
      btnSubtitleToggle.textContent = `💬 Subs: ${fileName.substring(0, 10)}...`;
      btnSubtitleToggle.style.display = 'inline-flex';
    }
    applySubtitlePreference();
  }

  // Socket listener for custom subtitle broadcast
  socket.on('custom-subtitle-loaded', (data) => {
    if (data.senderName !== myName) {
      loadCustomVttSubtitle(data.vttText, data.fileName);
      showToast(`📁 ${data.senderName} synced custom subtitle: "${data.fileName}"`);
      appendChatMessage('System', `📁 ${data.senderName} loaded subtitle: "${data.fileName}"`, 'system');
    }
  });

  // Drag and drop event listeners on video player
  if (videoWrapper && subDropOverlay) {
    let dragCounter = 0;

    ['dragenter', 'dragover'].forEach(eventType => {
      videoWrapper.addEventListener(eventType, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter++;
        subDropOverlay.classList.remove('hidden');
      });
    });

    ['dragleave', 'drop'].forEach(eventType => {
      videoWrapper.addEventListener(eventType, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = Math.max(0, dragCounter - 1);
        if (eventType === 'drop' || dragCounter === 0) {
          subDropOverlay.classList.add('hidden');
        }
      });
    });

    videoWrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      subDropOverlay.classList.add('hidden');
      dragCounter = 0;

      const files = e.dataTransfer ? e.dataTransfer.files : null;
      if (files && files.length > 0) {
        handleSubtitleFile(files[0]);
      }
    });
  }

  if (btnUploadSubFile && subFileInput) {
    btnUploadSubFile.addEventListener('click', () => subFileInput.click());
    subFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleSubtitleFile(e.target.files[0]);
        if (subtitleSettingsModal) subtitleSettingsModal.classList.add('hidden');
      }
    });
  }

  function appendChatMessage(sender, text, type, time = '') {
    if (type === 'system') {
      const msg = document.createElement('div');
      msg.className = 'system-msg';
      msg.textContent = text;
      chatMessages.appendChild(msg);
    } else {
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${type}`;
      bubble.innerHTML = `
        <div class="bubble-meta">
          <b>${sender}</b>
          <small>${time}</small>
        </div>
        <div>${text}</div>
      `;
      chatMessages.appendChild(bubble);

      // 💬 Show floating bubble directly on the video player (disappears after 4.5s)
      showOnVideoChat(sender, text, type === 'mine');

      // 🔔 Play gentle ping sound for incoming partner messages
      if (type === 'theirs' && isChatSoundOn) {
        try {
          boopAudio.currentTime = 0;
          boopAudio.play().catch(() => {});
        } catch (e) {}
      }
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
});
