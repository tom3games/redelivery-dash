// 音のエンジン（素材なし・WebAudio）。曲・効果音・情けない声。templates/snd.js をこのゲーム用に書き換えたもの
// 使い方: 最初のタップで Snd.init()、画面切替で Snd.setTrack('名前')、ループで毎フレーム Snd.tick()、検証は Snd.played と Snd.level()
const Snd = {
  ctx: null, muted: false, next: 0, step: 0, track: null, want: null, switchAt: 0, played: {}, lastStep: 0,
  TEMPO: { title: 112, run: 168, result: 120 },
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return
    try {
      this.ctx = new AC()
      this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.7
      this.an = this.ctx.createAnalyser(); this.an.fftSize = 2048; this.master.connect(this.an); this.an.connect(this.ctx.destination)
      this.bgm = this.ctx.createGain(); this.bgm.gain.value = 0.0001; this.bgm.connect(this.master)
      const len = this.ctx.sampleRate; this.noiseBuf = this.ctx.createBuffer(1, len, len)
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      if (this.want) { const w = this.want; this.want = null; this.setTrack(w) }
    } catch (e) { this.ctx = null }
  },
  setMute(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.7 },
  tone(f, t0, dur, type = 'square', vol = 0.2, dest, f2) {
    if (!this.ctx) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain()
    o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur)
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g); g.connect(dest || this.master); o.start(t0); o.stop(t0 + dur + 0.02)
  },
  noise(t0, dur, vol, freq, type = 'highpass', dest, q) {
    if (!this.ctx) return; const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain()
    s.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq; if (q) f.Q.value = q
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    s.connect(f); f.connect(g); g.connect(dest || this.master); s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02)
  },
  // 声っぽい音: のこぎり波を母音のフォルマント2つに通す。pts は [時刻, 高さ] の折れ線
  voice(t0, dur, pts, vowel = 'a', vol = 0.22, vib = 0) {
    if (!this.ctx) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain()
    const F = { a: [800, 1200], i: [300, 2300], u: [350, 1200], e: [500, 1900], o: [500, 850] }[vowel]
    o.type = 'sawtooth'; o.frequency.setValueAtTime(pts[0][1], t0)
    for (const [dt, f] of pts.slice(1)) o.frequency.linearRampToValueAtTime(f, t0 + dt)
    if (vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 7; lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(t0); l.stop(t0 + dur + 0.05) }
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.03); g.gain.setValueAtTime(vol, t0 + dur * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    for (const ff of F) { const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = ff; b.Q.value = 6; o.connect(b); b.connect(g) }
    g.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.05)
  },
  now() { return this.ctx ? this.ctx.currentTime : 0 },
  level() { if (!this.an) return 0; const d = new Float32Array(this.an.fftSize); this.an.getFloatTimeDomainData(d); let m = 0; for (const v of d) m = Math.max(m, Math.abs(v)); return m },
  mtof: m => 440 * Math.pow(2, (m - 69) / 12),
  mark(n) { this.played[n] = (this.played[n] || 0) + 1 },
  setTrack(name) {
    if (this.want === name) return
    this.want = name; if (!this.ctx) return
    const now = this.ctx.currentTime, g = this.bgm.gain
    g.cancelScheduledValues(now); g.setValueAtTime(Math.max(0.0001, g.value), now); g.linearRampToValueAtTime(0.0001, now + 0.2)
    this.switchAt = now + 0.22
  },
  tick() {
    if (!this.ctx) return; const c = this.ctx
    if (this.switchAt && c.currentTime >= this.switchAt) {
      this.track = this.want; this.step = 0; this.next = c.currentTime + 0.05; this.switchAt = 0
      const g = this.bgm.gain; g.cancelScheduledValues(c.currentTime); g.setValueAtTime(0.0001, c.currentTime); g.linearRampToValueAtTime(0.24, c.currentTime + 0.3)
      if (this.track) this.mark('bgm:' + this.track)
    }
    if (!this.track || this.switchAt) return
    const spb = 60 / this.TEMPO[this.track] / 4
    if (this.next < c.currentTime) this.next = c.currentTime + 0.05
    while (this.next < c.currentTime + 0.25) { this['p_' + this.track](this.step, this.next); this.next += spb; this.step++ }
  },
  kick(t, v = 0.7) { this.tone(150, t, 0.16, 'sine', v, this.bgm, 42) },
  snare(t, v = 0.18) { this.noise(t, 0.12, v, 1800, 'bandpass', this.bgm, 0.7); this.tone(220, t, 0.06, 'triangle', v * 0.6, this.bgm, 160) },
  hat(t, v = 0.05, open) { this.noise(t, open ? 0.12 : 0.03, v, 8000, 'highpass', this.bgm) },
  bass(n, t, dur = 0.18, vol = 0.42, type = 'triangle') { this.tone(this.mtof(n), t, dur, type, vol, this.bgm) },
  // タイトル: ゆるいファンク（生活感）。F - Bb - C - Bb
  p_title(i, t) {
    const bar = Math.floor(i / 16) % 4, s = i % 16
    const root = [41, 46, 48, 46][bar]
    if (s === 0 || s === 10) this.kick(t, 0.55); if (s === 4 || s === 12) this.snare(t, 0.12); if (s % 2 === 0) this.hat(t, s % 4 ? 0.05 : 0.03)
    if ([0, 3, 6, 8, 11, 14].includes(s)) this.bass(root + ([6, 14].includes(s) ? 12 : 0), t, 0.13, 0.36, 'square')
    if (s === 4 || s === 12) for (const n of [root + 24, root + 28, root + 31]) this.tone(this.mtof(n), t, 0.09, 'triangle', 0.03, this.bgm)
    const mel = [77, -1, 80, 77, -1, 75, 77, -1]
    if (Math.floor(i / 64) % 2 && s % 2 === 0) { const n = mel[s / 2]; if (n > 0) this.tone(this.mtof(n + (bar === 2 ? 2 : 0)), t, 0.16, 'square', 0.025, this.bgm) }
  },
  // 走る: せかせかした速い曲（Dm - Bb - C - A）。時計の秒針みたいなハイハット
  p_run(i, t) {
    const bar = Math.floor(i / 16) % 4, s = i % 16
    const root = [38, 34, 36, 33][bar]
    if (s % 4 === 0) this.kick(t, 0.7); if (s === 4 || s === 12) this.snare(t, 0.16); this.hat(t, s % 2 ? 0.025 : 0.05)
    if (s % 2 === 0) this.bass(root + (s % 4 === 2 ? 12 : 0), t, 0.1, 0.4, 'sawtooth')
    const mel = [[74, 77, 81, 77, 74, 77, 81, 84], [74, 77, 82, 77, 74, 77, 82, 86], [76, 79, 84, 79, 76, 79, 84, 88], [73, 76, 81, 76, 73, 76, 79, 81]][bar]
    if (s % 2 === 0) this.tone(this.mtof(mel[s / 2]), t, 0.08, 'square', 0.03, this.bgm)
  },
  // 結果: 軽いシャッフル
  p_result(i, t) {
    const bar = Math.floor(i / 16) % 4, s = i % 16
    const root = [43, 48, 45, 50][bar]
    if (s === 0 || s === 8) this.kick(t, 0.5); if (s === 4 || s === 12) this.snare(t, 0.1); if (s % 4 === 2) this.hat(t, 0.05, true)
    if (s % 4 === 0) this.bass(root, t, 0.2, 0.32); if (s % 4 === 3) this.bass(root + 7, t, 0.1, 0.25)
  },
  // 効果音
  sfx(name, v = 1) {
    if (!this.ctx) return; const t = this.ctx.currentTime; this.mark(name)
    switch (name) {
      case 'tap': this.tone(880, t, 0.06, 'triangle', 0.12 * v); break
      case 'ding': // ピンポーン
        this.tone(659, t, 0.9, 'sine', 0.35); this.tone(1318, t, 0.4, 'sine', 0.06)
        this.tone(523, t + 0.5, 1.3, 'sine', 0.35); this.tone(1046, t + 0.5, 0.5, 'sine', 0.06); break
      case 'go': this.voice(t, 0.45, [[0, 330], [0.15, 420], [0.45, 360]], 'a', 0.2); this.voice(t + 0.42, 0.35, [[0, 400], [0.35, 300]], 'u', 0.16); break
      case 'jump': this.tone(300, t, 0.18, 'square', 0.06, null, 700); break
      case 'slide': this.noise(t, 0.35, 0.12, 900, 'bandpass', null, 1.5); break
      case 'lane': this.noise(t, 0.07, 0.06, 2500, 'bandpass', null, 2); break
      case 'step': if (t - this.lastStep < 0.12) return; this.lastStep = t; this.noise(t, 0.04, 0.05 * v, 600, 'lowpass'); break
      case 'land': this.noise(t, 0.07, 0.12, 400, 'lowpass'); break
      case 'lego': // 情けない悲鳴「いっっったぁ」
        this.tone(4200, t, 0.05, 'square', 0.05)
        this.voice(t + 0.03, 0.18, [[0, 520], [0.18, 700]], 'i', 0.22)
        this.voice(t + 0.25, 0.9, [[0, 900], [0.2, 1100], [0.9, 420]], 'a', 0.26, 40); break
      case 'cat':
        this.voice(t, 0.55, [[0, 600], [0.15, 1000], [0.55, 500]], 'e', 0.18, 25); this.noise(t + 0.4, 0.4, 0.12, 3000, 'highpass'); break
      case 'trip': this.voice(t, 0.25, [[0, 260], [0.25, 160]], 'u', 0.22); this.tone(110, t + 0.18, 0.3, 'sine', 0.5, null, 40); this.noise(t + 0.18, 0.2, 0.2, 500, 'lowpass'); break
      case 'crash': for (let k = 0; k < 6; k++) { this.noise(t + k * 0.07, 0.12, 0.2, 600 + k * 200, 'bandpass', null, 1); this.tone(180 - k * 15, t + k * 0.07, 0.1, 'triangle', 0.15) } this.voice(t, 0.3, [[0, 300], [0.3, 200]], 'o', 0.18); break
      case 'cloth': this.noise(t, 0.3, 0.1, 1200, 'bandpass', null, 0.8); this.voice(t + 0.05, 0.3, [[0, 400], [0.3, 500]], 'a', 0.15); break
      case 'laundry': this.noise(t, 0.25, 0.14, 2000, 'bandpass', null, 0.7); this.voice(t + 0.1, 0.4, [[0, 350], [0.4, 450]], 'u', 0.15); break
      case 'vacuum': this.tone(190, t, 0.5, 'sawtooth', 0.06, null, 260); this.voice(t, 0.3, [[0, 350], [0.3, 600]], 'a', 0.16); break
      case 'warn': this.tone(1200, t, 0.06, 'square', 0.05); break
      case 'knock': for (let k = 0; k < 3; k++) this.tone(180, t + k * 0.14, 0.08, 'sine', 0.4, null, 90); break
      case 'door': this.tone(140, t, 0.5, 'sawtooth', 0.04, null, 260); this.noise(t, 0.2, 0.08, 1500, 'bandpass'); break
      case 'hai': this.voice(t, 0.2, [[0, 340], [0.2, 380]], 'a', 0.22); this.voice(t + 0.18, 0.55, [[0, 440], [0.15, 470], [0.55, 380]], 'i', 0.22); break
      case 'fanfare': [72, 76, 79, 84].forEach((n, k) => { this.tone(this.mtof(n), t + k * 0.1, 0.3, 'square', 0.07); this.tone(this.mtof(n - 12), t + k * 0.1, 0.3, 'triangle', 0.1) }); this.tone(this.mtof(88), t + 0.42, 0.6, 'square', 0.06); break
      case 'paper': for (let k = 0; k < 5; k++) this.noise(t + k * 0.22, 0.14, 0.05, 3000 + k * 300, 'bandpass', null, 2); break
      case 'sad': [67, 66, 65, 64].forEach((n, k) => this.tone(this.mtof(n), t + k * 0.28, 0.32, 'triangle', 0.12)); this.tone(this.mtof(52), t + 1.1, 0.9, 'sine', 0.15); break
      case 'truck': this.tone(70, t, 1.6, 'sawtooth', 0.06, null, 50); this.noise(t, 1.6, 0.05, 300, 'lowpass'); break
      case 'drum': for (let k = 0; k < 22; k++) this.noise(t + k * 0.05, 0.05, 0.06 + k * 0.004, 1600, 'bandpass', null, 0.8); break
      case 'stamp': this.tone(90, t, 0.25, 'sine', 0.6, null, 40); this.noise(t, 0.15, 0.25, 900, 'lowpass'); break
      case 'reveal': this.tone(660, t, 0.1, 'triangle', 0.12); this.tone(990, t + 0.06, 0.12, 'triangle', 0.08); break
      case 'boo': this.tone(196, t, 0.6, 'sawtooth', 0.06, null, 140); break
    }
  },
}
window.Snd = Snd
