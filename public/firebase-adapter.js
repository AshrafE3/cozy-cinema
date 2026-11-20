// ================= 🌐 24/7 GOOGLE FIREBASE REALTIME ADAPTER =================
class FirebaseSocketAdapter {
  constructor(config, roomId, clientId) {
    if (!window.firebase) {
      console.error('[FirebaseSocket] Firebase SDK not loaded!');
      return;
    }
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(config);
    }
    this.db = firebase.database();
    this.cleanRoomId = (roomId || 'general').replace(/[.#$\[\]/]/g, '_');
    this.roomId = this.cleanRoomId;
    this.clientId = clientId;
    this.id = clientId;
    this.roomRef = this.db.ref('rooms/' + this.cleanRoomId);
    this.presenceRef = this.roomRef.child('members/' + this.clientId);
    this.listeners = {};
    this.userName = 'Viewer';
    this.hasInitializedPresence = false;
    this.lastPlaybackTs = 0;
    this.lastSourceTs = 0;
    this.lastReactionTs = 0;
    this.connected = false;

    // Monitor real-time connection to Google Firebase cloud
    this.db.ref('.info/connected').on('value', (snap) => {
      if (snap.val() === true) {
        this.connected = true;
        this.presenceRef.onDisconnect().remove();
        if (this.userName) {
          this.presenceRef.set({
            id: this.clientId,
            clientId: this.clientId,
            name: this.userName,
            lastSeen: Date.now()
          });
        }
        this.trigger('connect');
      } else {
        this.connected = false;
        this.trigger('disconnect');
      }
    });

    this.setupListeners();
  }

  connect() {
    if (this.db) this.db.goOnline();
  }

  disconnect() {
    if (this.db) this.db.goOffline();
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
    if (event === 'connect' && this.connected) {
      setTimeout(() => callback(), 10);
    }
  }

  trigger(event, data) {
    const list = this.listeners[event];
    if (list) {
      list.forEach(cb => {
        try { cb(data); } catch (err) { console.error(`[FirebaseSocket] Error in '${event}':`, err); }
      });
    }
  }

  setupListeners() {
    // 1. Members Presence
    this.roomRef.child('members').on('child_added', (snap) => {
      const u = snap.val();
      const uid = snap.key;
      if (this.hasInitializedPresence && uid !== this.clientId && u) {
        this.roomRef.child('members').once('value', (memSnap) => {
          const count = Object.keys(memSnap.val() || {}).length;
          this.trigger('user-joined', {
            name: u.name || 'Viewer',
            userCount: count
          });
        });
      }
    });

    this.roomRef.child('members').on('child_removed', (snap) => {
      const u = snap.val();
      const uid = snap.key;
      if (uid !== this.clientId) {
        this.roomRef.child('members').once('value', (memSnap) => {
          const count = Object.keys(memSnap.val() || {}).length;
          this.trigger('user-left', {
            name: (u && u.name) ? u.name : 'Viewer',
            userCount: count
          });
        });
      }
    });

    setTimeout(() => {
      this.hasInitializedPresence = true;
    }, 1200);

    // 2. Authoritative Playback Events (Play, Pause, Seek)
    this.roomRef.child('events/playback').on('value', (snap) => {
      const evt = snap.val();
      if (!evt || evt.senderId === this.clientId) return;
      if (this.lastPlaybackTs && evt.ts === this.lastPlaybackTs) return;
      this.lastPlaybackTs = evt.ts;

      if (evt.type === 'play') {
        this.trigger('media-play', { time: evt.time, senderName: evt.senderName });
      } else if (evt.type === 'pause') {
        this.trigger('media-pause', { time: evt.time, senderName: evt.senderName });
      } else if (evt.type === 'seek') {
        this.trigger('media-seek', { time: evt.time, senderName: evt.senderName });
      }
    });

    // 3. Source Changed
    this.roomRef.child('events/source').on('value', (snap) => {
      const val = snap.val();
      if (!val || val.senderId === this.clientId) return;
      if (this.lastSourceTs && val.ts === this.lastSourceTs) return;
      this.lastSourceTs = val.ts;
      this.trigger('source-changed', {
        source: val.source,
        senderName: val.senderName
      });
    });

    // 4. Live Chat
    const joinTime = Date.now() - 3000;
    this.roomRef.child('chat').orderByChild('ts').startAt(joinTime).on('child_added', (snap) => {
      const msg = snap.val();
      if (!msg) return;
      this.trigger('chat-message', {
        sender: msg.sender,
        text: msg.text,
        time: msg.time
      });
    });

    // 5. Floating Reactions
    this.roomRef.child('events/reaction').on('value', (snap) => {
      const r = snap.val();
      if (!r || r.senderId === this.clientId) return;
      if (this.lastReactionTs && r.ts === this.lastReactionTs) return;
      this.lastReactionTs = r.ts;
      this.trigger('reaction', {
        emoji: r.emoji,
        sender: r.sender
      });
    });

    // 6. Name Changed
    this.roomRef.child('events/name_change').on('value', (snap) => {
      const nc = snap.val();
      if (!nc || nc.id === this.clientId) return;
      this.trigger('name-changed', {
        id: nc.id,
        oldName: nc.oldName,
        newName: nc.newName
      });
    });

    // 7. Custom Subtitle Sync
    this.roomRef.child('custom_subtitle').on('value', (snap) => {
      const sub = snap.val();
      if (!sub || sub.senderId === this.clientId) return;
      this.trigger('custom-subtitle-loaded', sub);
    });

    // 8. Embed Sync Reload
    this.roomRef.child('events/embed_reload').on('value', (snap) => {
      const er = snap.val();
      if (!er || er.senderId === this.clientId) return;
      this.trigger('sync-embed-reload');
    });

    // 9. WebRTC Voice Peers
    this.roomRef.child('voice_peers').on('child_added', (snap) => {
      const peerId = snap.key;
      const val = snap.val();
      if (peerId !== this.clientId && val) {
        this.trigger('voice-peer-joined', { peerId, name: val.name || 'Partner' });
      }
    });

    this.roomRef.child('voice_peers').on('child_removed', (snap) => {
      const peerId = snap.key;
      const val = snap.val();
      if (peerId !== this.clientId) {
        this.trigger('voice-peer-left', { peerId, name: (val && val.name) ? val.name : 'Partner' });
      }
    });

    // 10. WebRTC Voice Signals (Incoming to this clientId)
    this.roomRef.child('voice_signals/' + this.clientId).on('child_added', (snap) => {
      const sigData = snap.val();
      snap.ref.remove().catch(() => {});
      if (sigData && sigData.from && sigData.signal) {
        this.trigger('voice-signal', sigData);
      }
    });

    // 11. Voice Speaking (Audio Ducking)
    this.roomRef.child('voice_speaking').on('value', (snap) => {
      const val = snap.val() || {};
      let anyoneSpeaking = false;
      for (const [uid, sp] of Object.entries(val)) {
        if (uid !== this.clientId && sp && sp.isSpeaking) {
          anyoneSpeaking = true;
          break;
        }
      }
      this.trigger('voice-peer-speaking', { isSpeaking: anyoneSpeaking });
    });
  }

  emit(event, data) {
    data = data || {};

    if (event === 'join-room') {
      this.userName = data.name || this.userName || 'Viewer';
      this.presenceRef.set({
        id: this.clientId,
        clientId: this.clientId,
        name: this.userName,
        lastSeen: Date.now()
      });
      this.presenceRef.onDisconnect().remove();

      // Read initial authoritative room state
      this.roomRef.child('state').once('value', (snap) => {
        const state = snap.val() || {};
        const source = state.source || {
          type: 'hls',
          url: '',
          embedUrl: '',
          title: 'No Media Loaded — Paste a link or select a file above'
        };
        let accurateTime = state.currentTime || 0;
        if (state.isPlaying && state.lastUpdate) {
          accurateTime += (Date.now() - state.lastUpdate) / 1000;
        }

        this.roomRef.child('members').once('value', (memSnap) => {
          const members = memSnap.val() || {};
          const count = Object.keys(members).length;
          this.trigger('init-state', {
            source,
            currentTime: accurateTime,
            isPlaying: !!state.isPlaying,
            userCount: Math.max(1, count)
          });
        });
      });

    } else if (event === 'heartbeat') {
      this.presenceRef.update({ lastSeen: Date.now() });

    } else if (event === 'change-name') {
      const oldName = this.userName;
      this.userName = (data.name || '').trim() || this.userName;
      this.presenceRef.update({ name: this.userName });
      this.roomRef.child('events/name_change').set({
        id: this.clientId,
        oldName,
        newName: this.userName,
        ts: Date.now()
      });

    } else if (event === 'change-source') {
      this.roomRef.child('state').set({
        source: data,
        currentTime: 0,
        isPlaying: true,
        lastUpdate: Date.now(),
        sender: this.clientId,
        senderName: this.userName
      });
      this.roomRef.child('events/source').set({
        source: data,
        senderId: this.clientId,
        senderName: this.userName,
        ts: Date.now()
      });

    } else if (event === 'media-play') {
      this.roomRef.child('state').update({
        isPlaying: true,
        currentTime: data.time || 0,
        lastUpdate: Date.now(),
        sender: this.clientId,
        senderName: this.userName
      });
      this.roomRef.child('events/playback').set({
        type: 'play',
        time: data.time || 0,
        senderId: this.clientId,
        senderName: this.userName,
        ts: Date.now()
      });

    } else if (event === 'media-pause') {
      this.roomRef.child('state').update({
        isPlaying: false,
        currentTime: data.time || 0,
        lastUpdate: Date.now(),
        sender: this.clientId,
        senderName: this.userName
      });
      this.roomRef.child('events/playback').set({
        type: 'pause',
        time: data.time || 0,
        senderId: this.clientId,
        senderName: this.userName,
        ts: Date.now()
      });

    } else if (event === 'media-seek') {
      this.roomRef.child('state').update({
        currentTime: data.time || 0,
        lastUpdate: Date.now(),
        sender: this.clientId,
        senderName: this.userName
      });
      this.roomRef.child('events/playback').set({
        type: 'seek',
        time: data.time || 0,
        senderId: this.clientId,
        senderName: this.userName,
        ts: Date.now()
      });

    } else if (event === 'sync-heartbeat') {
      this.roomRef.child('state').once('value', (snap) => {
        const state = snap.val() || {};
        let accurateTime = state.currentTime || 0;
        if (state.isPlaying && state.lastUpdate) {
          accurateTime += (Date.now() - state.lastUpdate) / 1000;
        }
        this.trigger('sync-heartbeat-response', {
          time: accurateTime,
          isPlaying: !!state.isPlaying
        });
      });

    } else if (event === 'chat-message') {
      const msg = {
        sender: this.userName,
        text: data.text,
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        senderId: this.clientId,
        ts: Date.now()
      };
      this.roomRef.child('chat').push(msg);

    } else if (event === 'send-reaction') {
      this.roomRef.child('events/reaction').set({
        emoji: data.emoji || '❤️',
        sender: this.userName,
        senderId: this.clientId,
        ts: Date.now()
      });

    } else if (event === 'custom-subtitle') {
      this.roomRef.child('custom_subtitle').set({
        vttText: data.vttText,
        fileName: data.fileName || 'Custom Subtitles',
        senderName: this.userName,
        senderId: this.clientId,
        ts: Date.now()
      });

    } else if (event === 'sync-embed-reload') {
      this.roomRef.child('events/embed_reload').set({
        senderId: this.clientId,
        ts: Date.now()
      });

    } else if (event === 'voice-join') {
      const vpRef = this.roomRef.child('voice_peers/' + this.clientId);
      vpRef.set({ name: this.userName, ts: Date.now() });
      vpRef.onDisconnect().remove();

    } else if (event === 'voice-signal') {
      if (data.to) {
        this.roomRef.child('voice_signals/' + data.to).push({
          from: this.clientId,
          signal: data.signal,
          name: this.userName,
          ts: Date.now()
        });
      } else {
        this.roomRef.child('voice_peers').once('value', (snap) => {
          const peers = snap.val() || {};
          for (const peerId of Object.keys(peers)) {
            if (peerId !== this.clientId) {
              this.roomRef.child('voice_signals/' + peerId).push({
                from: this.clientId,
                signal: data.signal,
                name: this.userName,
                ts: Date.now()
              });
            }
          }
        });
      }

    } else if (event === 'voice-speaking') {
      this.roomRef.child('voice_speaking/' + this.clientId).set({
        isSpeaking: !!data.isSpeaking,
        ts: Date.now()
      });

    } else if (event === 'voice-leave') {
      this.roomRef.child('voice_peers/' + this.clientId).remove();
      this.roomRef.child('voice_speaking/' + this.clientId).remove();
    }
  }
}
