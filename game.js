// 再配達はイヤだ！ / DON'T LEAVE, DELIVERY GUY
// 3D の散らかった部屋を玄関まで走る。前進は自動、左右・ジャンプ・スライディングでよける。時間は固定60Hz（performance.now で数える）
import * as THREE from './vendor/three.module.js'
if (!CanvasRenderingContext2D.prototype.roundRect) CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath() }

const D = window.RD_DATA, Snd = window.Snd
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)]
const DT = 1 / 60
const clamp = (v, a, b) => v < a ? a : v > b ? b : v
const lerp = (a, b, k) => a + (b - a) * k
const isTouch = matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0)
const store = { get(k, d) { try { const v = localStorage.getItem('rd.' + k); return v == null ? d : v } catch (e) { return d } }, set(k, v) { try { localStorage.setItem('rd.' + k, v) } catch (e) {} } }
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const LANES = [-1.3, 0, 1.3], WALL = 2.9

// ---------- 状態
const S = {
  lang: store.get('lang', (navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en'),
  muted: store.get('mute', '0') === '1',
  view: 'title', mode: 'idle', mt: 0, idx: 0, seed: 1, rng: Math.random, results: [], items: [], photos: [],
  bot: null, paused: false, tutT: 0, resT: -1, sim: false, capture: -1,
}
const P = { d: 0, x: 0, lane: 1, y: 0, vy: 0, slide: 0, stun: 0, stunType: '', speed: 0, inv: 0, hits: 0, phase: 0, buf: null, bufT: 0, face: 'normal', spin: 0 }
const R = { st: null, obs: [], wait: 0, waitMax: 0, said: {}, t: 0, warnT: 0 }
const T = k => D.TXT[S.lang][k] ?? k

// ---------- 描画の土台
const canvas = $('#gl')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch || devicePixelRatio < 2, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isTouch ? 1.6 : 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 60)
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a5a70, 1.9))
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(2, 6, 3); scene.add(sun)
const CAM = { back: 5, h: 3, fov: 60, side: 0 }
function resize() {
  const w = innerWidth, h = innerHeight, a = w / h
  renderer.setSize(w, h, false); camera.aspect = a
  // 縦長でも3レーンが見えるよう、縦画面はカメラを引いて視野を広げる
  CAM.fov = a < 1 ? clamp(2 * Math.atan(Math.tan(23 * Math.PI / 180) / a) * 180 / Math.PI, 56, 78) : 56
  const hh = Math.atan(Math.tan(CAM.fov * Math.PI / 360) * a)
  CAM.back = clamp(2.15 / Math.tan(hh), 4.4, 6.4); CAM.h = 2.6 + CAM.back * 0.14; CAM.port = a < 0.8
  // 縦持ち: 近く・低めに寄せて主人公を下3分の1に大きく。左右はカメラが追うので3レーン全部を手前で映す必要はない
  if (CAM.port) { CAM.fov = 64; CAM.back = 4.4; CAM.h = 2.35 }
  camera.fov = CAM.fov; camera.updateProjectionMatrix()
}

// 共有ジオメトリ・色ごとの材質
const GB = new THREE.BoxGeometry(1, 1, 1), GS = new THREE.SphereGeometry(1, 14, 10), GC = new THREE.CylinderGeometry(1, 1, 1, 16), GP = new THREE.PlaneGeometry(1, 1)
const GCone = new THREE.ConeGeometry(1, 1, 4)
const MATS = {}
function mat(c, opt) { const k = c + (opt ? JSON.stringify(opt) : ''); return MATS[k] || (MATS[k] = new THREE.MeshLambertMaterial({ color: c, ...opt })) }
function mesh(geo, c, sx, sy, sz, x, y, z, parent, opt) { const m = new THREE.Mesh(geo, typeof c === 'object' && c.isMaterial ? c : mat(c, opt)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); if (parent) parent.add(m); return m }
const box = (c, w, h, d, x, y, z, p, o) => mesh(GB, c, w, h, d, x, y, z, p, o)
const ball = (c, r, x, y, z, p, o) => mesh(GS, c, r, r, r, x, y, z, p, o)
const cyl = (c, r, h, x, y, z, p, o) => mesh(GC, c, r, h, r, x, y, z, p, o)

// キャンバスのテクスチャ
function canvasTex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]) }
  return t
}
const TEX = {}
function floorTex(kind) {
  return TEX['f' + kind] || (TEX['f' + kind] = canvasTex(256, 256, (x, w, h) => {
    if (kind === 'wood' || kind === 'wood2') {
      const base = kind === 'wood' ? ['#c58f5a', '#b98250', '#cf9a63', '#bf8955'] : ['#a77a52', '#9c6f48', '#b08359', '#a1744c']
      for (let i = 0; i < 4; i++) { x.fillStyle = base[i]; x.fillRect(i * 64, 0, 64, h); x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(i * 64, 0, 2, h); x.fillRect(i * 64, (i * 97) % 256, 64, 2) }
      x.strokeStyle = 'rgba(90,50,20,.18)'; for (let i = 0; i < 40; i++) { const px = (i * 37) % 256; x.beginPath(); x.moveTo(px, (i * 53) % 256); x.lineTo(px + 2, (i * 53) % 256 + 40); x.stroke() }
    } else if (kind === 'tile') {
      x.fillStyle = '#dcd6cc'; x.fillRect(0, 0, w, h); x.fillStyle = '#c9c1b4'; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) x.fillRect(i * 64, j * 64, 64, 64)
      x.strokeStyle = '#a99f90'; x.lineWidth = 3; for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, h); x.moveTo(0, i * 64); x.lineTo(w, i * 64); x.stroke() }
    } else if (kind === 'stone') {
      x.fillStyle = '#7d7a76'; x.fillRect(0, 0, w, h); for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},.08)`; x.fillRect((i * 71) % 256, (i * 113) % 256, 6, 6) }
    }
  }, [2, 8]))
}
function wallTex(c1, c2) {
  const k = 'w' + c1 + c2; return TEX[k] || (TEX[k] = canvasTex(128, 128, (x, w, h) => { x.fillStyle = c1; x.fillRect(0, 0, w, h); x.fillStyle = c2; for (let i = 0; i < 8; i++) x.fillRect(i * 16, 0, 5, h) }, [20, 1]))
}
// 顔（表情ごとに1枚）
const FACES = {}
function faceTex(kind) {
  return FACES[kind] || (FACES[kind] = canvasTex(128, 128, (x) => {
    x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#221c2e'; x.fillStyle = '#221c2e'; x.lineWidth = 7
    const eye = (cx, cy, r) => { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill() }
    const blush = () => { x.fillStyle = 'rgba(255,90,110,.45)'; x.beginPath(); x.ellipse(28, 78, 12, 7, 0, 0, 7); x.ellipse(100, 78, 12, 7, 0, 0, 7); x.fill(); x.fillStyle = '#221c2e' }
    if (kind === 'normal') { eye(42, 58, 8); eye(86, 58, 8); x.beginPath(); x.moveTo(30, 40); x.lineTo(52, 46); x.moveTo(98, 40); x.lineTo(76, 46); x.stroke(); x.beginPath(); x.ellipse(64, 90, 14, 9, 0, 0, 7); x.fill() }
    if (kind === 'panic') { x.fillStyle = '#fff'; x.beginPath(); x.arc(42, 58, 15, 0, 7); x.arc(86, 58, 15, 0, 7); x.fill(); x.stroke(); x.fillStyle = '#221c2e'; eye(42, 60, 5); eye(86, 60, 5); x.beginPath(); x.ellipse(64, 98, 12, 15, 0, 0, 7); x.fill(); x.fillStyle = '#7ad3ff'; x.beginPath(); x.moveTo(112, 30); x.quadraticCurveTo(122, 50, 112, 54); x.quadraticCurveTo(102, 50, 112, 30); x.fill() }
    if (kind === 'pain') { x.beginPath(); x.moveTo(30, 48); x.lineTo(52, 58); x.lineTo(30, 68); x.moveTo(98, 48); x.lineTo(76, 58); x.lineTo(98, 68); x.stroke(); x.beginPath(); x.moveTo(36, 96); for (let i = 0; i < 6; i++) x.lineTo(42 + i * 9, i % 2 ? 90 : 102); x.stroke(); x.fillStyle = '#7ad3ff'; x.fillRect(24, 70, 8, 30); x.fillRect(96, 70, 8, 30) }
    if (kind === 'happy') { x.beginPath(); x.arc(42, 62, 11, Math.PI * 1.1, Math.PI * 1.9); x.moveTo(97, 62); x.arc(86, 62, 11, Math.PI * 1.1, Math.PI * 1.9); x.stroke(); x.beginPath(); x.moveTo(38, 82); x.quadraticCurveTo(64, 118, 90, 82); x.closePath(); x.fill(); blush() }
    if (kind === 'sad') { x.beginPath(); x.moveTo(30, 60); x.lineTo(54, 60); x.moveTo(74, 60); x.lineTo(98, 60); x.stroke(); x.fillStyle = '#7ad3ff'; x.fillRect(36, 62, 10, 40); x.fillRect(82, 62, 10, 40); x.fillStyle = '#221c2e'; x.beginPath(); x.moveTo(44, 100); x.quadraticCurveTo(64, 84, 84, 100); x.stroke() }
    if (kind === 'shock') { x.fillStyle = '#fff'; x.beginPath(); x.arc(42, 56, 16, 0, 7); x.arc(86, 56, 16, 0, 7); x.fill(); x.stroke(); x.fillStyle = '#221c2e'; eye(42, 56, 3); eye(86, 56, 3); x.beginPath(); x.ellipse(64, 96, 16, 20, 0, 0, 7); x.fill() }
    if (kind === 'smile') { eye(44, 58, 7); eye(84, 58, 7); x.beginPath(); x.arc(64, 78, 18, 0.2, Math.PI - 0.2); x.stroke() }
    if (kind === 'sleep') { x.beginPath(); x.arc(42, 58, 10, 0.2, Math.PI - 0.2); x.moveTo(96, 60); x.arc(86, 58, 10, 0.2, Math.PI - 0.2); x.stroke(); x.beginPath(); x.ellipse(64, 92, 6, 5, 0, 0, 7); x.fill() }
  }))
}
const FACE_MAT = {}
function faceMat(kind) { return FACE_MAT[kind] || (FACE_MAT[kind] = new THREE.MeshBasicMaterial({ map: faceTex(kind), transparent: true })) }

// ---------- キャラクター（ボックスで組む）
function makeChar(kind) {
  const g = new THREE.Group(), C = {
    hoodie: { top: 0x7a5cd6, top2: 0x5a40a8, leg: 0x55575e, shoe: 0xeeeeee, hair: 0x2a2030 },
    tee: { top: 0xffc93c, top2: 0xe0a91c, leg: 0x3d6fb6, shoe: 0x4a4a4a, hair: 0x2a2030 },
    robe: { top: 0xfff2f4, top2: 0xf1c4cc, leg: 0xffd9b5, shoe: 0xff8fa3, hair: 0x2a2030 },
    driver: { top: 0x2f8f6f, top2: 0x226b52, leg: 0x2b3b47, shoe: 0x222222, hair: 0x3a2a20 },
  }[kind]
  const SK = 0xffd9b5
  const body = new THREE.Group(); g.add(body)
  const parts = { body }
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(s * 0.12, 0.8, 0); body.add(leg)
    box(C.leg, 0.15, 0.78, 0.16, 0, -0.39, 0, leg)
    box(C.shoe, 0.17, 0.09, 0.28, 0, -0.78, -0.05, leg)
    parts[s < 0 ? 'legL' : 'legR'] = leg
  }
  const torso = new THREE.Group(); torso.position.set(0, 0.8, 0); body.add(torso); parts.torso = torso
  box(C.top, 0.46, 0.56, 0.28, 0, 0.3, 0, torso)
  if (kind === 'robe') {
    mesh(GC, C.top, 0.3, 0.5, 0.22, 0, -0.08, 0, torso) // 膝までのバスローブ
    box(C.top2, 0.48, 0.06, 0.3, 0, 0.1, 0, torso) // 帯
    box(C.top2, 0.08, 0.5, 0.02, 0.06, 0.32, -0.145, torso).rotation.z = 0.35 // 合わせ
  } else if (kind === 'hoodie') { box(C.top2, 0.3, 0.12, 0.05, 0, 0.18, -0.15, torso); box(C.top2, 0.36, 0.2, 0.12, 0, 0.56, 0.12, torso) }
  else if (kind === 'driver') { box(0xffffff, 0.46, 0.05, 0.29, 0, 0.42, 0, torso); box(0xf0d040, 0.1, 0.08, 0.02, 0.12, 0.38, -0.15, torso) }
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.3, 0.52, 0); torso.add(arm)
    box(kind === 'tee' ? SK : C.top, 0.12, 0.5, 0.13, 0, -0.24, 0, arm)
    if (kind === 'tee') box(C.top, 0.14, 0.16, 0.15, 0, -0.06, 0, arm)
    ball(SK, 0.075, 0, -0.52, 0, arm)
    parts[s < 0 ? 'armL' : 'armR'] = arm
  }
  const head = new THREE.Group(); head.position.set(0, 0.8, 0); torso.add(head); parts.head = head
  ball(SK, 0.22, 0, 0.02, 0, head)
  const hair = ball(C.hair, 0.225, 0, 0.1, 0.07, head); hair.scale.set(0.232, 0.2, 0.2)
  const face = mesh(GP, faceMat('normal'), 0.32, 0.32, 1, 0, -0.01, -0.228, head); face.rotation.y = Math.PI; parts.face = face
  if (kind === 'hoodie') { // ヘッドセット
    const band = mesh(new THREE.TorusGeometry(0.24, 0.025, 6, 16, Math.PI), 0x222222, 1, 1, 1, 0, 0.04, 0, head); band.rotation.z = 0
    for (const s of [-1, 1]) cyl(0x222222, 0.07, 0.06, s * 0.23, 0.0, 0, head).rotation.z = Math.PI / 2
    box(0x3df5a0, 0.02, 0.02, 0.12, -0.2, -0.08, -0.08, head, { emissive: 0x3df5a0 })
  }
  if (kind === 'robe') { const tw = cyl(0xffffff, 0.2, 0.16, 0, 0.2, 0.02, head); tw.scale.set(0.23, 0.17, 0.23); ball(0xffffff, 0.11, 0, 0.3, 0.02, head) }
  if (kind === 'driver') { cyl(C.top, 0.23, 0.12, 0, 0.17, 0, head); box(C.top2, 0.3, 0.025, 0.18, 0, 0.12, -0.2, head) }
  if (kind === 'tee') { // カップ麺
    const cup = new THREE.Group(); cup.position.set(0, -0.58, -0.08); parts.armR.add(cup)
    mesh(new THREE.CylinderGeometry(0.1, 0.075, 0.16, 12), 0xffffff, 1, 1, 1, 0, 0, 0, cup); cyl(0xe8413b, 0.092, 0.04, 0, 0.02, 0, cup); cyl(0xd9c38a, 0.1, 0.01, 0, 0.085, 0, cup)
    parts.cup = cup
  }
  if (kind === 'driver') { const pk = box(0xd9a066, 0.5, 0.36, 0.38, 0, 1.05, -0.36, body); box(0x7a4f22, 0.52, 0.04, 0.06, 0, 1.16, -0.36, body); parts.parcel = pk }
  // 影
  const sh = mesh(new THREE.CircleGeometry(0.34, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }), 1, 1, 1, 0, 0.012, 0, g); sh.rotation.x = -Math.PI / 2; parts.shadow = sh
  g.userData = parts
  return g
}
function setFace(ch, kind) { const f = ch.userData.face; if (f.material !== faceMat(kind)) f.material = faceMat(kind) }
function pose(ch, o) {
  const u = ch.userData
  u.legL.rotation.set(o.ll || 0, 0, 0); u.legR.rotation.set(o.lr || 0, 0, 0)
  u.armL.rotation.set(o.al || 0, 0, o.alz || 0); u.armR.rotation.set(o.ar || 0, 0, o.arz || 0)
  u.torso.rotation.set(o.tx || 0, 0, o.tz || 0); u.head.rotation.set(o.hx || 0, o.hy || 0, 0)
  u.body.position.set(0, o.by || 0, 0); u.body.rotation.set(o.bx || 0, o.bry || 0, o.bz || 0)
}

// ---------- 部屋の家具（側面の飾り）
function decor(kind, side, d, g, rng) {
  const x0 = side * (WALL - 0.42), z = -d, s = side, f = new THREE.Group(); f.position.set(x0, 0, z); g.add(f)
  const r = rng(), pal = [0xe85d5d, 0x4f8fe0, 0x56c27a, 0xf2b84b, 0x9a6ad6, 0xff8fa3]
  const pc = pal[Math.floor(r * pal.length)]
  switch (kind) {
    case 'bed': box(0x8a5a32, 0.8, 0.32, 1.9, 0, 0.16, 0, f); box(0xf4f0e6, 0.76, 0.14, 1.86, 0, 0.38, 0, f); box(pc, 0.78, 0.1, 1.2, 0, 0.47, 0.3, f).rotation.z = 0.05; box(0xffffff, 0.5, 0.12, 0.34, 0, 0.5, -0.7, f); break
    case 'desk': box(0x5a4636, 0.62, 0.05, 1.2, 0, 0.72, 0, f); for (const zz of [-0.55, 0.55]) box(0x3a2c22, 0.05, 0.72, 0.05, -s * 0.25, 0.36, zz, f); box(0x222226, 0.06, 0.42, 0.7, s * 0.15, 1.0, 0, f); box(0x6ae0ff, 0.02, 0.36, 0.64, s * 0.12 - s * 0.0, 1.0, 0, f, { emissive: 0x3aa0c0 }); break
    case 'tv': box(0x3a2c22, 0.5, 0.45, 1.4, 0, 0.22, 0, f); box(0x18181c, 0.08, 0.72, 1.25, s * 0.1, 0.84, 0, f); box(0xff5d73, 0.02, 0.6, 1.1, s * 0.05, 0.84, 0, f, { emissive: 0x80303a }); break
    case 'shelf': box(0xb07a48, 0.4, 1.7, 0.9, 0, 0.85, 0, f); for (let i = 0; i < 4; i++) { box(0x8a5a32, 0.42, 0.03, 0.9, -s * 0.0, 0.25 + i * 0.42, 0, f); for (let j = 0; j < 5; j++) box(pal[(i * 5 + j) % 6], 0.26, 0.3, 0.12, -s * 0.05, 0.42 + i * 0.42, -0.32 + j * 0.16, f) } break
    case 'manga': for (let i = 0; i < 3; i++) { const hh = 0.2 + rng() * 0.5; box(pal[(i + 2) % 6], 0.3, hh, 0.22, -s * 0.12, hh / 2, -0.3 + i * 0.3, f).rotation.y = rng() - 0.5 } break
    case 'trash': for (let i = 0; i < 2; i++) { const b = ball(0x3a3f4a, 0.3, -s * 0.05, 0.28, -0.25 + i * 0.5, f); b.scale.set(0.3, 0.32, 0.28); ball(0x3a3f4a, 0.08, -s * 0.05, 0.62, -0.25 + i * 0.5, f) } break
    case 'beanbag': { const b = ball(pc, 0.45, -s * 0.05, 0.25, 0, f); b.scale.set(0.45, 0.3, 0.45); break }
    case 'plant': cyl(0xc8643c, 0.16, 0.3, -s * 0.05, 0.15, 0, f); { const l = mesh(GCone, 0x3e9a4e, 0.25, 0.6, 0.25, -s * 0.05, 0.6, 0, f); l.rotation.y = 0.4 } break
    case 'fridge': box(0xe8ecef, 0.6, 1.75, 0.65, 0, 0.875, 0, f); box(0xb0b8c0, 0.02, 0.02, 0.5, -s * 0.31, 1.25, 0, f); box(0xffd23f, 0.01, 0.12, 0.1, -s * 0.305, 1.45, 0.12, f); box(0xff5d73, 0.01, 0.1, 0.1, -s * 0.305, 1.4, -0.1, f); break
    case 'sink': box(0xd8d2c6, 0.6, 0.86, 1.6, 0, 0.43, 0, f); box(0xb7c0c8, 0.62, 0.04, 1.62, 0, 0.88, 0, f); box(0x8a9098, 0.04, 0.3, 0.04, s * 0.2, 1.05, 0.3, f); for (let i = 0; i < 3; i++) box(pal[i + 1], 0.12, 0.14, 0.12, -s * 0.05, 0.97, -0.5 + i * 0.18, f); break
    case 'washer': box(0xf2f2f2, 0.6, 0.85, 0.6, 0, 0.425, 0, f); cyl(0x8ab6d8, 0.2, 0.02, -s * 0.31, 0.45, 0, f).rotation.z = Math.PI / 2; break
    case 'micro': box(0xd8d2c6, 0.5, 0.86, 0.8, 0, 0.43, 0, f); box(0x2a2a2e, 0.42, 0.28, 0.5, 0, 1.0, 0, f); box(0x6ae0a0, 0.01, 0.04, 0.08, -s * 0.215, 1.05, 0.15, f, { emissive: 0x2a8050 }); break
    case 'shoes': box(0x9a7650, 0.36, 0.9, 1.0, 0, 0.45, 0, f); for (let i = 0; i < 3; i++) box(pal[i], 0.12, 0.08, 0.22, -s * 0.28, 0.04, -0.3 + i * 0.3, f).rotation.y = rng() - 0.5; break
    case 'umbrella': cyl(0x606a74, 0.12, 0.45, -s * 0.05, 0.22, 0, f); for (let i = 0; i < 3; i++) cyl(pal[i + 2], 0.025, 0.9, -s * 0.05 + (i - 1) * 0.05, 0.6, (i - 1) * 0.05, f).rotation.z = (i - 1) * 0.15; break
    case 'boxpile': for (let i = 0; i < 3; i++) box(0xd9a066, 0.5, 0.4, 0.5, -s * 0.02, 0.2 + i * 0.4, (i % 2) * 0.1, f).rotation.y = (i - 1) * 0.2; break
  }
  // 壁のポスター・時計
  if (rng() < 0.35) { const pk = mesh(GP, poster(Math.floor(rng() * 4)), 0.7, 0.9, 1, side * (0.4), 1.7, 0, f); pk.rotation.y = -side * Math.PI / 2 }
  return f
}
function poster(i) {
  const k = 'poster' + i
  return MATS[k] || (MATS[k] = new THREE.MeshLambertMaterial({ map: canvasTex(64, 80, (x) => {
    const bg = ['#ff5d73', '#4f8fe0', '#ffd23f', '#56c27a'][i]; x.fillStyle = bg; x.fillRect(0, 0, 64, 80)
    x.fillStyle = '#fff'; if (i === 0) { x.beginPath(); x.arc(32, 34, 16, 0, 7); x.fill(); x.fillStyle = bg; x.fillRect(20, 30, 24, 4) } else if (i === 1) { x.fillRect(12, 14, 40, 6); x.fillRect(12, 26, 28, 6); x.fillRect(12, 38, 34, 6) } else if (i === 2) { x.fillStyle = '#221c2e'; x.beginPath(); x.moveTo(32, 10); x.lineTo(54, 60); x.lineTo(10, 60); x.fill() } else { x.beginPath(); x.ellipse(32, 40, 20, 14, 0, 0, 7); x.fill(); x.beginPath(); x.moveTo(16, 30); x.lineTo(20, 16); x.lineTo(26, 28); x.moveTo(48, 30); x.lineTo(44, 16); x.lineTo(38, 28); x.fill() }
    x.strokeStyle = '#fff'; x.lineWidth = 4; x.strokeRect(2, 2, 60, 76)
  }) }))
}

// ---------- 障害物
function makeObs(o, g) {
  const m = new THREE.Group(); m.position.set(o.x, 0, -o.d); g.add(m); o.m = m
  switch (o.k) {
    case 'clothes': {
      const t = box(0xe85d5d, 0.7, 0.12, 0.55, 0, 0.06, 0, m); t.rotation.y = 0.3
      box(0x3d6fb6, 0.5, 0.1, 0.6, 0.12, 0.17, 0.05, m).rotation.y = -0.4
      box(0xffffff, 0.12, 0.08, 0.28, -0.25, 0.25, -0.1, m).rotation.y = 0.8
      box(0x56c27a, 0.4, 0.08, 0.3, -0.1, 0.24, 0.1, m).rotation.y = 1.2
      break
    }
    case 'cable': {
      const c = cyl(0x1c1c22, 0.035, 5.6, -o.x, 0.12, 0, m); c.rotation.z = Math.PI / 2
      for (const xx of [-1.9, -0.7, 0.6, 1.8]) box(0x1c1c22, 0.08, 0.12, 0.08, xx - o.x, 0.06, 0, m)
      box(0x2a2a30, 0.28, 0.08, 0.18, 2.3 - o.x, 0.05, 0.1, m); ball(0xe85d5d, 0.03, 2.25 - o.x, 0.1, 0.06, m)
      box(0xf0f0f0, 0.16, 0.08, 0.1, -2.5 - o.x, 0.12, 0, m)
      break
    }
    case 'cat': {
      const b = ball(0xf0a040, 0.3, 0, 0.2, 0, m); b.scale.set(0.3, 0.2, 0.4)
      ball(0xf0a040, 0.16, 0, 0.26, -0.36, m)
      for (const s of [-1, 1]) { const e = mesh(GCone, 0xf0a040, 0.06, 0.12, 0.06, s * 0.08, 0.42, -0.36, m); e.rotation.y = Math.PI / 4 }
      const tl = cyl(0xf0a040, 0.04, 0.5, 0.22, 0.1, 0.25, m); tl.rotation.set(Math.PI / 2, 0, 0.9)
      for (let i = 0; i < 3; i++) box(0xc06a20, 0.32, 0.03, 0.06, 0, 0.38, -0.1 + i * 0.12, m)
      const f = mesh(GP, faceMat('sleep'), 0.26, 0.26, 1, 0, 0.27, -0.52, m); f.rotation.y = Math.PI
      o.zz = mesh(GP, zzMat(), 0.3, 0.3, 1, 0.15, 0.7, -0.3, m)
      break
    }
    case 'boxes': {
      const n = o.tall2 ? 3 : 2
      for (let i = 0; i < n; i++) { const b = box(0xd9a066, 0.9 - i * 0.08, 0.5, 0.75, (i % 2 ? 0.04 : -0.03), 0.25 + i * 0.5, 0, m); b.rotation.y = (i - 1) * 0.12; box(0xc9b48a, 0.92 - i * 0.08, 0.06, 0.2, 0, 0.5 + i * 0.5, 0, m).rotation.y = b.rotation.y; o.parts = (o.parts || []).concat([b]) }
      break
    }
    case 'lego': {
      const cols = [0xe83b3b, 0x3b7be8, 0xffd23f, 0x3bc06a]
      for (let i = 0; i < 6; i++) { const b = box(cols[i % 4], 0.16, 0.08, 0.08, (i % 3 - 1) * 0.28 + Math.sin(i * 7) * 0.08, 0.04, -0.5 + i * 0.2, m, { emissive: cols[i % 4], emissiveIntensity: 0.25 }); b.rotation.y = i * 1.3; for (const s of [-1, 1]) cyl(cols[i % 4], 0.022, 0.03, s * 0.04, 0.095, 0, b).scale.set(0.14, 0.4, 0.28) }
      break
    }
    case 'laundry': {
      const rope = cyl(0xeeeeee, 0.015, 5.8, -o.x, 1.32, 0, m); rope.rotation.z = Math.PI / 2
      for (const xx of [-2.6, 2.6]) box(0x8a8f96, 0.06, 1.4, 0.06, xx - o.x, 0.7, 0, m)
      const items = [[-1.9, 0x4f8fe0, 'shirt'], [-1.1, 0xffffff, 'towel'], [-0.3, 0xff8fa3, 'pants'], [0.5, 0xf2b84b, 'shirt'], [1.3, 0x56c27a, 'towel'], [2.0, 0xffffff, 'pants']]
      for (const [xx, c, k] of items) {
        if (k === 'shirt') { box(c, 0.5, 0.42, 0.03, xx - o.x, 1.08, 0, m); box(c, 0.75, 0.12, 0.03, xx - o.x, 1.24, 0, m) }
        else if (k === 'towel') box(c, 0.45, 0.6, 0.03, xx - o.x, 1.0, 0, m)
        else { box(c, 0.36, 0.14, 0.03, xx - o.x, 1.2, 0, m); box(c, 0.12, 0.12, 0.03, xx - o.x - 0.1, 1.08, 0, m); box(c, 0.12, 0.12, 0.03, xx - o.x + 0.1, 1.08, 0, m) }
      }
      break
    }
    case 'vacuum': {
      cyl(0x2e3238, 0.34, 0.1, 0, 0.06, 0, m); cyl(0x50565e, 0.26, 0.02, 0, 0.12, 0, m)
      cyl(0x3df5a0, 0.05, 0.02, 0, 0.135, -0.12, m, { emissive: 0x3df5a0 })
      // 上に乗っているのは猫ではなくミカン
      ball(0xff9a2e, 0.07, 0.1, 0.19, 0.08, m)
      break
    }
  }
}
const zzMat = () => MATS.zz || (MATS.zz = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: canvasTex(64, 64, x => { x.font = '900 30px sans-serif'; x.fillStyle = '#fff'; x.strokeStyle = '#221c2e'; x.lineWidth = 5; x.strokeText('z', 8, 50); x.fillText('z', 8, 50); x.font = '900 22px sans-serif'; x.strokeText('z', 34, 26); x.fillText('z', 34, 26) }) }))

// 障害物の当たり方: low=跳ぶ / high=しゃがむ / tall=横へ
const KIND = {
  clothes: { t: 'low', h: 0.3, len: 0.7, w: 0.9 }, cable: { t: 'low', h: 0.2, len: 0.22, all: true }, cat: { t: 'low', h: 0.44, len: 0.8, w: 0.6 },
  boxes: { t: 'tall', h: 1.4, len: 0.8, w: 0.95 }, lego: { t: 'low', h: 0.09, len: 1.3, w: 0.9 }, laundry: { t: 'high', h: 0.85, len: 0.3, all: true },
  vacuum: { t: 'low', h: 0.17, len: 0.66, w: 0.68 },
}

// コース生成（同じ種なら同じ並び）
function genCourse(st, seed) {
  const rng = mulberry(seed), obs = []
  const add = (k, lane, d, extra) => { const K = KIND[k]; obs.push({ k, lane, x: K.all ? 0 : LANES[lane], d, ...K, ...extra }) }
  let d = st.id === 'game' ? 21 : 14
  let last = ''
  while (d < st.len - 9) {
    let pat = st.mix[Math.floor(rng() * st.mix.length)]
    if (pat === last && rng() < 0.7) pat = st.mix[Math.floor(rng() * st.mix.length)]
    last = pat
    // 1レーンだけの障害物は真ん中にも多めに置く（何もしないで通り抜けられないように）
    const lane = rng() < 0.4 ? 1 : Math.floor(rng() * 3)
    let gap = st.gap[0] + rng() * (st.gap[1] - st.gap[0])
    switch (pat) {
      case 'clothes': case 'cat': case 'lego': add(pat, lane, d); break
      case 'boxes': add('boxes', lane, d, { tall2: rng() < 0.5 }); break
      case 'cable': case 'laundry': add(pat, 1, d); break
      case 'vacuum': add('vacuum', lane, d, { amp: 1.3, w0: 2.2 + rng() * 1.2, ph: rng() * 6.28, cx: 0 }); break
      case 'boxes2': { const free = lane; for (const l of [0, 1, 2]) if (l !== free) add('boxes', l, d, { tall2: rng() < 0.5 }); gap += 1.2; break }
      case 'lego2': { const free = lane; for (const l of [0, 1, 2]) if (l !== free) add('lego', l, d); break }
      case 'combo': { const free = lane; for (const l of [0, 1, 2]) if (l !== free) add('boxes', l, d); add(rng() < 0.5 ? 'cat' : 'clothes', free, d + 0.1); gap += 1.6; break }
    }
    d += gap
  }
  return obs
}

// ---------- 世界の組み立て（ステージごと）
let owned = [], world = null, chunks = [], player = null, driver = null, door = null, slip = null, startProps = null
const PALS = {
  game: { wall: ['#5c6688', '#56607f'], floor: 'wood2', fog: 0x2e3048, led: 0xb06aff },
  noodle: { wall: ['#efe4cc', '#e7dcc2'], floor: 'wood', fog: 0xcfc3a8, led: 0 },
  bath: { wall: ['#dfe9ef', '#d4e0e8'], floor: 'wood', fog: 0xb9c8d2, led: 0 },
}
function disposeWorld() {
  if (!world) return
  scene.remove(world)
  world.traverse(o => { if (o.geometry && ![GB, GS, GC, GP, GCone].includes(o.geometry)) o.geometry.dispose() })
  for (const x of owned) x.dispose(); owned = []
  world = null
}
function buildWorld(st, seed) {
  disposeWorld()
  world = new THREE.Group(); scene.add(world); chunks = []
  const pal = PALS[st.id], L = st.len, rng = mulberry(seed * 13 + 5)
  scene.background = new THREE.Color(pal.fog); scene.fog = new THREE.Fog(pal.fog, 16, 44)
  // 床（部屋→台所→玄関）
  const segs = [[-4, L * 0.58, pal.floor], [L * 0.58, L * 0.86, 'tile'], [L * 0.86, L + 1.2, 'stone']]
  for (const [a, b, k] of segs) {
    const t = floorTex(k).clone(); t.needsUpdate = true; t.repeat.set(2.5, (b - a) / 3)
    const fm = new THREE.MeshLambertMaterial({ map: t }); owned.push(t, fm)
    const f = mesh(GP, fm, WALL * 2, b - a, 1, 0, 0, -(a + b) / 2, world); f.rotation.x = -Math.PI / 2
  }
  // 玄関の段差
  box(0x9c8f80, WALL * 2, 0.06, 0.12, 0, 0.03, -(L * 0.86), world)
  // 壁
  const wt = wallTex(pal.wall[0], pal.wall[1]).clone(); wt.needsUpdate = true; wt.repeat.set((L + 6) / 1.2, 1)
  const wm = new THREE.MeshLambertMaterial({ map: wt }); owned.push(wt, wm)
  const wallM = new THREE.MeshLambertMaterial({ color: pal.wall[0] }); owned.push(wallM)
  for (const s of [-1, 1]) {
    const w = mesh(GP, wm, L + 6, 2.5, 1, s * WALL, 1.25, -(L - 2) / 2, world); w.rotation.y = -s * Math.PI / 2
    box(0xf4efe4, 0.04, 0.1, L + 6, s * (WALL - 0.02), 0.05, -(L - 2) / 2, world)
    if (pal.led) box(pal.led, 0.04, 0.04, L * 0.58, s * (WALL - 0.03), 2.4, -L * 0.29, world, { emissive: pal.led })
  }
  box(wallM, WALL * 2, 2.5, 0.1, 0, 1.25, 4.0, world) // 後ろの壁
  // 家具を区画ごとに（遠いものは隠す）
  const ROOM = ['bed', 'desk', 'tv', 'shelf', 'manga', 'trash', 'beanbag', 'plant', 'boxpile', 'manga'], KIT = ['fridge', 'sink', 'washer', 'micro', 'trash', 'sink'], GEN = ['shoes', 'umbrella', 'shoes', 'boxpile']
  for (let c = -1; c * 10 < L + 2; c++) {
    const g = new THREE.Group(); world.add(g); chunks.push({ g, a: c * 10, b: c * 10 + 10 })
    for (const s of [-1, 1]) {
      let d = c * 10 + rng() * 1.5
      while (d < c * 10 + 10) {
        if (d > L - 4.5 || d < -2.5) { d += 2; continue }
        const list = d < L * 0.58 ? ROOM : d < L * 0.86 ? KIT : GEN
        decor(list[Math.floor(rng() * list.length)], s, d + 0.9, g, rng)
        d += 2.2 + rng() * 1.6
      }
    }
  }
  // 玄関ドアと正面の壁
  door = new THREE.Group(); door.position.set(0, 0, -(L + 1.2)); world.add(door)
  box(wallM, WALL - 0.55, 2.5, 0.12, -(WALL + 0.55) / 2, 1.25, 0, door)
  box(wallM, WALL - 0.55, 2.5, 0.12, (WALL + 0.55) / 2, 1.25, 0, door)
  box(wallM, 1.1, 0.4, 0.12, 0, 2.3, 0, door)
  for (const sx of [-0.55, 0.55]) box(0x5a3a1e, 0.08, 2.16, 0.18, sx, 1.08, 0.01, door) // 枠
  box(0x5a3a1e, 1.18, 0.08, 0.18, 0, 2.12, 0.01, door)
  const hinge = new THREE.Group(); hinge.position.set(-0.5, 0, 0.02); door.add(hinge); door.userData.hinge = hinge
  box(0x8a5a32, 1.0, 2.05, 0.06, 0.5, 1.025, 0, hinge)
  box(0x1c1410, 0.32, 0.06, 0.07, 0.5, 1.0, 0, hinge) // 郵便受け
  ball(0xffd23f, 0.04, 0.88, 1.0, 0.05, hinge); cyl(0x222222, 0.025, 0.02, 0.5, 1.55, 0.04, hinge).rotation.x = Math.PI / 2 // ノブ・のぞき穴
  // 外の廊下（開いた時に見える）
  const out = new THREE.Group(); out.position.set(0, 0, -(L + 1.2)); world.add(out)
  box(0xf2f6fa, 3, 0.05, 3, 0, 0, -1.6, out); box(0xbfe6ff, 6, 3, 0.1, 0, 1.5, -3.2, out, { emissive: 0x6aa8d0 }); for (let i = -3; i <= 3; i++) box(0x7d8a96, 0.05, 1.0, 0.05, i * 0.4, 0.5, -2.6, out); box(0x7d8a96, 3, 0.06, 0.06, 0, 1.0, -2.6, out)
  // 配達員（ドアの外）
  driver = makeChar('driver'); driver.position.set(0.1, 0, -(L + 1.9)); driver.rotation.y = Math.PI; world.add(driver); driver.visible = false
  // 不在票
  slip = mesh(GP, slipMat(), 0.42, 0.28, 1, 0, 1.0, -(L + 1.1), world, null); slip.material.side = THREE.DoubleSide; slip.visible = false
  // スタート地点の小道具
  startProps = new THREE.Group(); world.add(startProps)
  if (st.id === 'game') { box(0x222226, 1.4, 0.05, 0.7, 0, 0.74, 2.0, startProps); box(0x18181c, 0.9, 0.5, 0.05, 0, 1.08, 2.2, startProps); box(0x7a5cff, 0.82, 0.42, 0.02, 0, 1.08, 2.17, startProps, { emissive: 0x5a3ad0 }); box(0xe83b3b, 0.55, 0.9, 0.55, 0.0, 0.45, 1.1, startProps); box(0xe83b3b, 0.55, 0.7, 0.12, 0.0, 1.1, 1.38, startProps) }
  if (st.id === 'noodle') { box(0xd8d2c6, 1.6, 0.86, 0.6, 0, 0.43, 2.0, startProps); box(0xb7c0c8, 1.62, 0.04, 0.62, 0, 0.88, 2.0, startProps); cyl(0xc0c6cc, 0.13, 0.24, -0.4, 1.02, 2.0, startProps); cyl(0xffffff, 0.1, 0.15, 0.3, 0.98, 1.9, startProps); cyl(0xe8413b, 0.102, 0.04, 0.3, 0.99, 1.9, startProps) }
  if (st.id === 'bath') { box(0xffffff, 1.0, 2.1, 0.1, 0, 1.05, 2.6, startProps); box(0x9ad0e8, 0.84, 1.9, 0.02, 0, 1.0, 2.54, startProps, { emissive: 0x4a90b0 }); for (let i = 0; i < 4; i++) { const s = ball(0xffffff, 0.4, (i - 1.5) * 0.4, 1.2 + (i % 2) * 0.5, 2.2, startProps, { transparent: true, opacity: 0.35, depthWrite: false }); s.scale.set(0.5, 0.35, 0.3) } }
}
const slipMat = () => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, map: MATS.slipTex || (MATS.slipTex = canvasTex(128, 84, x => { x.fillStyle = '#ffe3e3'; x.fillRect(0, 0, 128, 84); x.fillStyle = '#ff5d73'; x.fillRect(0, 0, 128, 20); x.fillStyle = '#fff'; x.font = '900 13px sans-serif'; x.fillText(S.lang === 'ja' ? 'ご不在連絡票' : 'MISSED', 8, 15); x.strokeStyle = '#d9a0a8'; x.lineWidth = 2; for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(8, 34 + i * 13); x.lineTo(120, 34 + i * 13); x.stroke() } x.strokeStyle = '#d7263d'; x.lineWidth = 3; x.beginPath(); x.arc(100, 56, 14, 0, 7); x.stroke() })) })

// ---------- ステージの流れ
function startGame(seed) {
  S.seed = seed ?? Math.floor(Math.random() * 1e9); S.results = []; S.photos = []; S.idx = 0
  const r = mulberry(S.seed ^ 0x5bd1e995), it = D.ITEMS.map((_, i) => i)
  for (let i = it.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [it[i], it[j]] = [it[j], it[i]] }
  S.items = it
  startStage(0)
}
function startStage(i) {
  S.idx = i; const st = D.STAGES[i]; R.st = st
  const seed = S.seed * 7 + i * 101 + 3
  if (!S.sim) buildWorld(st, seed)
  R.obs = genCourse(st, seed); R.wait = R.waitMax = st.wait; R.said = {}; R.t = 0; R.warnT = 0
  if (!S.sim) for (const o of R.obs) makeObs(o, chunkFor(o.d))
  if (!S.sim) { if (player && player.parent) player.parent.remove(player); player = makeChar(st.outfit); world.add(player); S.snapCam = true }
  Object.assign(P, { d: 0, x: 0, lane: 1, y: 0, vy: 0, slide: 0, stun: 0, stunType: '', speed: 0, inv: 0, hits: 0, phase: 0, buf: null, bufT: 0, face: 'panic', spin: 0 })
  S.mode = 'intro'; S.mt = 0; S.tutT = i === 0 ? 3.0 : 0
  if (!S.sim) {
    go('vPlay'); $('#vPlay').classList.remove('oc'); $('#intro').hidden = false; $('#outc').hidden = true; $('#bNext').hidden = true; $('#dBub').hidden = true; $('#pBub').hidden = true; $('#blind').hidden = true; $('#tut').hidden = true
    $('#inNo').textContent = `${T('stage')} ${i + 1}`; $('#inSit').textContent = T('s_' + st.id); $('#inDing').textContent = ''; $('#stgNo').textContent = `${i + 1}/3`
    Snd.setTrack(null)
  }
}
function chunkFor(d) { return (chunks.find(c => d >= c.a && d < c.b) || chunks[chunks.length - 1]).g }
function beginRun() {
  S.mode = 'run'; S.mt = 0; P.speed = R.st.speed * 0.6
  if (S.sim) return
  $('#intro').hidden = true; Snd.setTrack('run')
  if (S.tutT > 0) { $('#pBub').hidden = true; bubT = 0; $('#tut').hidden = false; $('#tutTxt').textContent = isTouch ? T('tutSP') : T('tutPC') }
}

// ---------- 入力
function input(a) {
  if (S.view !== 'play' || S.paused) return
  if (S.mode === 'intro') { if (S.mt > 0.9) beginRun(); else return }
  if (S.mode !== 'run' || P.stun > 0) { if (S.mode === 'run' && P.stun > 0 && (a === 'jump' || a === 'slide')) { P.buf = a; P.bufT = 0.15 } return }
  if (a === 'left' || a === 'right') { const n = clamp(P.lane + (a === 'left' ? -1 : 1), 0, 2); if (n !== P.lane) { P.lane = n; if (!S.sim) Snd.sfx('lane') } }
  else if (a === 'jump') { if (P.y <= 0.001) { P.vy = 6.4; P.slide = 0; if (!S.sim) Snd.sfx('jump') } else { P.buf = 'jump'; P.bufT = 0.15 } }
  else if (a === 'slide') { if (P.y > 0.001) { P.vy = Math.min(P.vy, -11); P.buf = 'slide'; P.bufT = 0.4 } else if (P.slide <= 0) { P.slide = 0.62; if (!S.sim) Snd.sfx('slide') } }
}

// ---------- 1ステップ（固定60Hz）
function step() {
  if (S.view === 'result') { stepResult(); return }
  if (S.view !== 'play' || S.paused) return
  S.mt += DT
  if (S.mode === 'intro') {
    if (!S.sim) {
      if (S.mt > 0.45 && !R.said.ding) { R.said.ding = 1; $('#inDing').textContent = T('ding'); Snd.sfx('ding') }
      if (S.mt > 1.5 && !R.said.go) { R.said.go = 1; say(T('go_' + R.st.id), 1.6); Snd.sfx('go') }
    }
    if (S.mt >= (S.sim ? 0 : 2.3)) beginRun()
    return
  }
  if (S.mode === 'run') { stepRun(); return }
  if (S.mode === 'outcome') stepOutcome()
}
function stepRun() {
  const st = R.st
  if (S.bot) botThink()
  R.t += DT; R.wait -= DT
  if (S.tutT > 0) { S.tutT -= DT; if (S.tutT <= 0 && !S.sim) $('#tut').hidden = true }
  // 速さ
  if (P.stun > 0) {
    P.stun -= DT; P.speed = 0; if (P.stunType === 'agony') P.spin += 0.09
    if (P.stun <= 0) { P.inv = 0.4; P.stunType = ''; if (!S.sim) { setFace(player, 'panic'); $('#blind').hidden = true } if (P.buf) { const b = P.buf; P.buf = null; input(b) } }
  } else P.speed = Math.min(st.speed, P.speed + 16 * DT)
  if (P.inv > 0) P.inv -= DT
  P.d += P.speed * DT
  // 左右
  const tx = LANES[P.lane]; P.x += clamp(tx - P.x, -11 * DT, 11 * DT)
  // 縦
  if (P.y > 0 || P.vy > 0) { P.vy -= 22 * DT; P.y += P.vy * DT; if (P.y <= 0) { P.y = 0; P.vy = 0; if (!S.sim) Snd.sfx('land'); if (P.buf && P.bufT > 0) { const b = P.buf; P.buf = null; input(b) } } }
  if (P.bufT > 0) { P.bufT -= DT; if (P.bufT <= 0) P.buf = null }
  if (P.slide > 0) P.slide -= DT
  P.phase += P.speed * DT * 1.6
  if (!S.sim && P.speed > 1 && P.y === 0 && P.slide <= 0) { if (Math.floor(P.phase / Math.PI) !== Math.floor((P.phase - P.speed * DT * 1.6) / Math.PI)) Snd.sfx('step', 0.8) }
  // 障害物
  for (const o of R.obs) {
    if (o.k === 'vacuum') o.x = clamp(o.cx + Math.sin(R.t * o.w0 * 0.55 + o.ph) * o.amp, -1.4, 1.4)
    if (o.hit || P.inv > 0 || P.stun > 0) continue
    if (Math.abs(o.d - P.d) > o.len / 2 + 0.25) continue
    if (!o.all && Math.abs(P.x - o.x) > o.w / 2 + 0.26) continue
    let hit = false
    if (o.t === 'tall') hit = true
    else if (o.t === 'low') hit = P.y < o.h
    else if (o.t === 'high') hit = P.slide <= 0
    if (hit) crash(o)
  }
  // 配達員のひとこと
  if (!S.sim) doorTalk()
  // ゴール・時間切れ
  if (P.d >= st.len) { P.d = st.len; endStage(true) }
  else if (R.wait <= 0) { R.wait = 0; endStage(false) }
}
function crash(o) {
  o.hit = true; P.hits++
  if (S.tutT > 0) { S.tutT = 0; if (!S.sim) $('#tut').hidden = true } // 操作ガイドと擬音を重ねない
  const k = o.k, typ = { lego: 'agony', cat: 'trip', cable: 'trip', vacuum: 'trip', boxes: 'crash', clothes: 'tangle', laundry: 'blind' }[k]
  P.stun = D.HIT[k]; P.stunType = typ; P.slide = 0; P.spin = 0
  if (P.y > 0 && typ !== 'blind') { P.vy = Math.min(P.vy, 0) }
  if (S.sim) return
  setFace(player, typ === 'agony' ? 'pain' : typ === 'blind' ? 'shock' : 'shock')
  Snd.sfx({ lego: 'lego', cat: 'cat', cable: 'trip', vacuum: 'vacuum', boxes: 'crash', clothes: 'cloth', laundry: 'laundry' }[k])
  if (k === 'cat') Snd.sfx('trip')
  ono(T('o_' + k), k === 'lego')
  say(T('v_' + k), 1.3)
  if (typ === 'blind') $('#blind').hidden = false
  if (k === 'boxes' && o.parts) o.fly = o.parts.map((b, i) => ({ b, vx: (Math.random() - 0.5) * 3, vy: 3 + i * 1.5, vz: -2 - Math.random() * 2, r: (Math.random() - 0.5) * 8 }))
  if (k === 'cat') o.jump = 0.01
  const f = $('#flash'); f.style.transition = 'none'; f.style.opacity = '0.5'; requestAnimationFrame(() => { f.style.transition = 'opacity .3s'; f.style.opacity = '0' })
  shake = 0.35
}
let shake = 0
function doorTalk() {
  const fr = R.wait / R.waitMax
  const lines = [[0.86, 'd1'], [0.62, 'd2'], [0.4, 'd3'], [0.18, 'd4'], [0.06, 'd5']]
  for (const [th, k] of lines) if (fr < th && !R.said[k]) { R.said[k] = 1; const b = $('#dBub'); b.hidden = false; b.textContent = T(k); b.className = 'dBub' + (th <= 0.4 ? ' red' : ''); b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; if (k === 'd2') Snd.sfx('knock') }
  if (fr < 0.25) { R.warnT -= DT; if (R.warnT <= 0) { R.warnT = 0.5; Snd.sfx('warn') } }
}
function endStage(ok) {
  const it = S.items[S.idx]
  S.results[S.idx] = { ok, margin: +R.wait.toFixed(2), hits: P.hits, item: ok ? it : -1, dist: +(P.d / R.st.len).toFixed(3) }
  S.mode = 'outcome'; S.mt = 0; P.stun = 0
  if (S.sim) return
  $('#vPlay').classList.add('oc')
  Snd.setTrack(null); $('#tut').hidden = true; $('#blind').hidden = true; $('#pBub').hidden = true; S.snapCam = true
  if (ok) {
    setFace(player, 'happy'); say(T('hai'), 2); Snd.sfx('hai'); $('#dBub').hidden = true; P.x = 0.75; P.d = R.st.len - 0.2
  } else {
    setFace(player, 'sad'); const b = $('#dBub'); b.hidden = false; b.textContent = T('d4'); b.className = 'dBub red'
    P.d = R.st.len - 2.3; P.x = 0; P.lane = 1; P.y = 0
    Snd.sfx('boo')
  }
}
function stepOutcome() {
  const r = S.results[S.idx], t = S.mt
  if (S.sim) { if (t > 0.05) nextStage(); return }
  const L = R.st.len
  if (r.ok) {
    if (t > 0.3) { driver.visible = true; door.userData.hinge.rotation.y = lerp(0, 1.9, clamp((t - 0.3) / 0.5, 0, 1)) }
    if (t > 0.3 && !R.said.door) { R.said.door = 1; Snd.sfx('door') }
    if (t > 0.65 && !R.said.fan) { R.said.fan = 1; Snd.sfx('fanfare'); showOutcome(true) }
  } else {
    if (t > 0.15 && !R.said.paper) { R.said.paper = 1; Snd.sfx('paper'); slip.visible = true }
    const k = clamp((t - 0.15) / 1.7, 0, 1)
    slip.position.set(Math.sin(k * 9) * 0.35 * (1 - k), lerp(1.0, 0.02, k), -(L + 1.1) + k * 1.9)
    slip.rotation.set(lerp(0, -Math.PI / 2, k) + Math.sin(k * 12) * 0.5 * (1 - k), Math.sin(k * 7) * 0.6 * (1 - k), Math.sin(k * 10) * 0.4 * (1 - k) + Math.PI * k)
    if (t > 0.9 && !R.said.truck) { R.said.truck = 1; Snd.sfx('truck'); showOutcome(false) }
    if (t > 1.5 && !R.said.sad) { R.said.sad = 1; Snd.sfx('sad'); $('#dBub').hidden = true }
  }
  if (t > 1.45 && !R.said.cap) { R.said.cap = 1; S.capture = S.idx }
  if (t > 1.3) $('#bNext').hidden = false
  if (t > 5.5) nextStage()
}
function showOutcome(ok) {
  const r = S.results[S.idx], o = $('#outc'); o.hidden = false; $('#dBub').hidden = true
  const big = $('#ocBig'), card = $('#ocCard')
  big.textContent = ok ? T('gotIt') : (S.lang === 'ja' ? '不在票…' : 'MISSED...'); big.className = 'big ' + (ok ? 'ok' : 'ng')
  card.className = 'card' + (ok ? '' : ' ng')
  if (ok) { const it = D.ITEMS[r.item]; $('#ocSmall').textContent = T('inside'); $('#ocB').textContent = it[S.lang]; $('#ocI').textContent = S.lang === 'ja' ? it.jc : it.ec }
  else { $('#ocSmall').textContent = ''; $('#ocB').textContent = T('missed'); $('#ocI').textContent = T('missedSub') }
}
function nextStage() {
  if (S.mode !== 'outcome') return
  if (S.idx < 2) startStage(S.idx + 1); else showResult()
}

// ---------- ボット（検証用。上手い／ふつう／雑／何もしない）
const BOTS = { good: { p: 0.97, jit: 0.02 }, normal: { p: 0.86, jit: 0.06 }, sloppy: { p: 0.6, jit: 0.1 }, none: { p: 0, jit: 0 } }
function botThink() {
  const B = BOTS[S.bot.kind], rng = S.bot.rng
  if (P.stun > 0) return
  const v = Math.max(P.speed, R.st.speed * 0.8)
  // 先にある障害物で、自分の進路にかかるもの
  const ahead = R.obs.filter(o => !o.hit && o.d - P.d > -0.3 && o.d - P.d < 9).sort((a, b) => a.d - b.d)
  for (const o of ahead) if (o.seen === undefined) { o.seen = rng() < B.p; o.jit = (rng() - 0.5) * 2 * B.jit }
  // 横へよける（段ボール）: 先の8m以内で今のレーンに段ボールがあれば、空いているレーンへ
  const tallHere = ahead.find(o => o.t === 'tall' && o.seen && o.lane === P.lane && o.d - P.d < v * 0.7 + 0.8)
  if (tallHere) {
    const blocked = new Set(ahead.filter(o => o.t === 'tall' && Math.abs(o.d - tallHere.d) < 1.5).map(o => o.lane))
    let best = -1, bd = 9
    for (const l of [0, 1, 2]) if (!blocked.has(l) && Math.abs(l - P.lane) < bd) { bd = Math.abs(l - P.lane); best = l }
    if (best >= 0 && best !== P.lane) { input(best < P.lane ? 'left' : 'right'); return }
  }
  for (const o of ahead) {
    if (!o.seen) continue
    const front = o.d - o.len / 2 - 0.25 - P.d
    if (front < -0.1) continue
    let inLane
    if (o.all) inLane = true
    else if (o.k === 'vacuum') { const ta = Math.max(0, front) / v, fx = clamp(o.cx + Math.sin((R.t + ta) * o.w0 * 0.55 + o.ph) * o.amp, -1.4, 1.4); inLane = Math.abs(fx - LANES[P.lane]) < o.w / 2 + 0.5 }
    else inLane = o.lane === P.lane
    if (!inLane) continue
    if (o.t === 'low' && P.y === 0 && front < v * (0.1 + o.jit) + 0.1) { input('jump'); return }
    if (o.t === 'high' && P.slide <= 0 && front < v * (0.08 + o.jit) + 0.15) { input('slide'); return }
    break
  }
}
// ボットで1回分を一気に回す（画面を出さない）
function simulate(kind, seed) {
  const keep = { view: S.view, sim: S.sim, bot: S.bot, mode: S.mode, mt: S.mt, idx: S.idx, results: S.results, items: S.items, seed: S.seed, tutT: S.tutT }, keepP = { ...P }, keepR = { ...R }
  S.sim = true; S.view = 'play'; S.paused = false; S.bot = { kind, rng: mulberry(seed * 31 + 7) }
  startGame(seed)
  let n = 0
  while (S.view === 'play' && n < 60 * 120) { step(); n++; if (S.mode === 'outcome' && S.idx === 2 && S.results[2]) break }
  const res = S.results.map(r => ({ ok: r.ok, margin: r.margin, hits: r.hits }))
  const out = { res, got: res.filter(r => r.ok).length, hits: res.reduce((a, r) => a + r.hits, 0), title: titleOf(res).id }
  Object.assign(S, keep); Object.assign(P, keepP); Object.assign(R, keepR)
  return out
}
function titleOf(res) {
  const got = res.filter(r => r.ok).length, hits = res.reduce((a, r) => a + r.hits, 0)
  const id = got === 3 && hits === 0 ? 'oni' : got === 3 ? 'ace' : got === 2 ? 'giri' : got === 1 ? 'rusu' : 'col'
  return D.TITLES.find(t => t.id === id)
}

// ---------- 結果
// 称号の語のまとまり（英語は空白、日本語は jw の | で区切る）。この単位の途中では改行しない
const titleWords = (tt, lang) => lang === 'ja' ? (tt.jw || tt.ja).split('|') : tt.en.split(' ').flatMap(w => w.replace(/-/g, '-\n').split('\n'))
function setHankoTitle(tt) {
  const b = $('#hTitle'); b.innerHTML = ''
  titleWords(tt, S.lang).forEach((w, i, arr) => { if (i) b.append(S.lang === 'ja' || /-$/.test(arr[i - 1]) ? document.createElement('wbr') : ' '); const s = document.createElement('span'); s.className = 'w'; s.textContent = w; b.append(s) })
  fitHanko()
}
// 丸の内側（内接する正方形くらい）に収まるまで字を小さくする
function fitHanko() {
  const hk = $('#hanko'), b = $('#hTitle'), sm = hk.querySelector('small'); if (!hk.offsetWidth || !b.firstChild) return
  b.style.fontSize = ''
  // 日本語は丸（内接する正方形くらいに収める）、英語は四角（横幅に収め、3行まで）
  const round = S.lang === 'ja', lim = round ? hk.clientWidth * 0.74 : hk.clientWidth - 24
  let fs = parseFloat(getComputedStyle(b).fontSize)
  const over = () => Math.max(...[...b.querySelectorAll('.w')].map(s => s.offsetWidth)) > lim || (round ? sm.offsetHeight + b.offsetHeight > lim * 1.08 : b.offsetHeight > fs * 1.05 * 3 + 2)
  while (fs > 8 && over()) { fs -= 0.5; b.style.fontSize = fs + 'px' }
}
addEventListener('resize', () => { if (S.view === 'result') fitHanko() })
// 見出しの字体は使われた時に読み込まれ、読み込み後に幅が変わるので測り直す
try { document.fonts.addEventListener('loadingdone', () => fitHanko()) } catch (e) {}
function showResult() {
  S.mode = 'done'; go('vResult'); S.resT = 0; Snd.setTrack('result')
  const rows = $('#sRows'); rows.innerHTML = ''
  S.results.forEach((r, i) => {
    const it = r.ok ? D.ITEMS[r.item] : null
    const d = document.createElement('div'); d.className = 'sRow'
    d.innerHTML = `<span class="n">${i + 1}</span><span class="it">${it ? it[S.lang] : T('missed').replace('…', '').replace('...', '')}<small>${T('s_' + D.STAGES[i].id)} / ${T('hits')} ${r.hits}</small></span><span class="tag ${r.ok ? 'ok' : 'ng'}">${r.ok ? T('cardGot') : T('cardMiss')}</span>`
    rows.appendChild(d)
  })
  $('#nGot').textContent = '?'; $('#nMiss').textContent = '?'
  $('#hanko').className = 'hanko'; $('#rLine').classList.remove('on'); $('#rBtns').classList.remove('on'); $('#drum').hidden = false
  const tt = titleOf(S.results); setHankoTitle(tt); $('#rLine').textContent = S.lang === 'ja' ? tt.jl : tt.el
  // 背景はドアの前
  if (player) { player.visible = true }
}
function stepResult() {
  if (S.resT < 0) return
  const t0 = S.resT; S.resT += DT; const t = S.resT
  const at = s => t0 < s && t >= s
  for (let i = 0; i < 3; i++) if (at(0.35 + i * 0.5)) { const r = $$('.sRow')[i]; if (r) r.classList.add('on'); Snd.sfx('reveal') }
  if (at(1.9)) Snd.sfx('drum')
  if (at(3.1)) {
    const got = S.results.filter(r => r.ok).length
    $('#nGot').textContent = got; $('#nMiss').textContent = 3 - got; $('#drum').hidden = true
    $('#hanko').className = 'hanko show'; Snd.sfx('stamp'); if (got >= 2) Snd.sfx('fanfare'); else Snd.sfx('sad')
  }
  if (at(3.5)) { $('#rLine').classList.add('on'); $('#rBtns').classList.add('on') }
}
// Xでポスト: クリックの同期処理内で開く（ポップアップブロック回避）。URL は url パラメータで渡す
const PUB_URL = 'https://tom3games.github.io/redelivery-dash/'
function xText() { const res = S.results; if (!res || res.length < 3) return ''; const tt = titleOf(res); return T('xText').replace('{got}', res.filter(r => r.ok).length).replace('{title}', tt[S.lang]) }
function xUrl() { return 'https://x.com/intent/post?text=' + encodeURIComponent(xText()) + '&url=' + encodeURIComponent(PUB_URL) }
// 結果を1枚の画像に（不在票風）
async function saveImage() {
  await cardFonts()
  const c = buildCard(), blob = await new Promise(r => c.toBlob(r, 'image/png'))
  const file = new File([blob], 'redelivery-dash.png', { type: 'image/png' })
  if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: T('title1') + T('title2'), text: 'https://tom3games.github.io/redelivery-dash/' }); toast(T('shared')); return blob } catch (e) { if (e && e.name === 'AbortError') return blob }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'redelivery-dash.png'; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast(T('saved')); return blob
}
function buildCard() {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d')
  const ja = S.lang === 'ja', res = S.results, got = res.filter(r => r.ok).length, tt = titleOf(res)
  const disp = "'Dela Gothic One','Hiragino Sans',sans-serif", body = "'M PLUS Rounded 1c','Hiragino Maru Gothic ProN',sans-serif"
  x.fillStyle = '#2a2238'; x.fillRect(0, 0, W, H)
  // 紙
  x.save(); x.translate(W / 2, H / 2); x.rotate(-0.015); x.translate(-W / 2, -H / 2)
  x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(70, 70, 960, 1230)
  x.fillStyle = '#ffe3e3'; x.fillRect(56, 56, 960, 1230)
  x.strokeStyle = 'rgba(168,40,60,.14)'; x.lineWidth = 2; for (let y = 230; y < 1270; y += 44) { x.beginPath(); x.moveTo(56, y); x.lineTo(1016, y); x.stroke() }
  x.fillStyle = '#ff5d73'; x.fillRect(56, 56, 960, 128)
  x.fillStyle = '#fff'; x.textAlign = 'left'; x.font = `64px ${disp}`; fitText(x, T('card1'), 96, 146, 560)
  x.textAlign = 'right'; x.font = `900 26px ${body}`; x.fillText(ja ? '再配達はイヤだ！' : "DON'T LEAVE, DELIVERY GUY", 980, 108); x.fillText(new Date().toLocaleDateString(ja ? 'ja-JP' : 'en-US'), 980, 148)
  x.textAlign = 'left'; x.fillStyle = '#221c2e'; x.font = `900 40px ${body}`; x.fillText(ja ? `${T('cardYou')} ${T('cardName')}` : T('cardYou'), 96, 248)
  x.font = `800 26px ${body}`; x.fillStyle = '#6a6076'; x.fillText(got === 3 ? T('cardNoteOk') : T('cardNote'), 96, 296)
  // 3件の明細（現場写真つき）
  for (let i = 0; i < 3; i++) {
    const r = res[i] || { ok: false, hits: 0, item: -1 }, y = 330 + i * 236
    x.fillStyle = 'rgba(255,255,255,.8)'; x.fillRect(96, y, 880, 210)
    x.setLineDash([12, 8]); x.strokeStyle = 'rgba(168,40,60,.45)'; x.lineWidth = 3; x.strokeRect(96, y, 880, 210); x.setLineDash([])
    const ph = S.photos[i]
    x.save(); x.translate(196, y + 105); x.rotate(i % 2 ? 0.04 : -0.04)
    x.fillStyle = '#fff'; x.fillRect(-96, -86, 192, 172); if (ph) x.drawImage(ph, -84, -74, 168, 132); else { x.fillStyle = '#ccc'; x.fillRect(-84, -74, 168, 132) }
    x.fillStyle = 'rgba(255,210,63,.75)'; x.fillRect(-40, -96, 80, 22); x.restore()
    x.fillStyle = '#a8283c'; x.font = `34px ${disp}`; x.fillText(`${i + 1}`, 316, y + 56)
    x.fillStyle = '#6a6076'; x.font = `800 24px ${body}`; x.fillText(T('s_' + D.STAGES[i].id), 360, y + 52)
    x.fillStyle = '#221c2e'; x.font = `900 ${ja ? 38 : 32}px ${body}`
    const name = r.ok ? D.ITEMS[r.item][S.lang] : (ja ? '持ち戻り（不在）' : 'Taken back (nobody home)')
    fitText(x, name, 316, y + 112, 470)
    x.fillStyle = '#6a6076'; x.font = `800 24px ${body}`; x.fillText(`${T('hits')} ${r.hits}`, 316, y + 160)
    // 受取／持ち戻りのハンコ
    x.save(); x.translate(880, y + 120); x.rotate(-0.12); x.strokeStyle = x.fillStyle = r.ok ? '#1f7a44' : '#d7263d'; x.lineWidth = 6
    x.font = `${ja ? 34 : 21}px ${disp}`; x.textAlign = 'center'; const lab = r.ok ? T('cardGot') : T('cardMiss'), tw = x.measureText(lab).width + 34
    x.strokeRect(-tw / 2, -36, tw, 64); x.fillText(lab, 0, 10); x.restore(); x.textAlign = 'left'
  }
  // 合計と称号
  const y2 = 1060
  x.fillStyle = '#221c2e'; x.font = `900 30px ${body}`; x.fillText(T('received'), 96, y2 + 10); x.fillText(T('slips'), 96, y2 + 110)
  x.font = `86px ${disp}`; x.fillStyle = '#1f7a44'; x.fillText(String(got), 330, y2 + 30); x.fillStyle = '#a8283c'; x.fillText(String(3 - got), 330, y2 + 130)
  x.save(); x.translate(800, y2 + 60); x.rotate(-0.2); x.strokeStyle = x.fillStyle = '#d7263d'; x.lineWidth = 10
  x.beginPath(); x.arc(0, 0, 150, 0, 7); x.stroke(); x.lineWidth = 3; x.beginPath(); x.arc(0, 0, 134, 0, 7); x.stroke()
  x.textAlign = 'center'; x.font = `900 26px ${body}`; x.fillText(T('cardStamp'), 0, -70)
  x.font = `${ja ? 52 : 30}px ${disp}`; wrapCenter(x, x.measureText(tt[S.lang]).width <= 230 ? tt[S.lang] : titleWords(tt, S.lang), 0, 2, 230, ja ? 58 : 36)
  x.restore()
  x.restore()
  x.textAlign = 'center'; x.fillStyle = '#b9aec8'; x.font = `800 26px ${body}`; x.fillText('tom3games.github.io/redelivery-dash', W / 2, H - 16)
  return c
}
// キャンバスに使う文字のフォントを先に読む（Google Fonts は使う文字の分しか読まない）
async function cardFonts() {
  const txt = Object.values(D.TXT).flatMap(o => Object.values(o)).join('') + D.ITEMS.map(i => i.ja + i.en).join('') + D.TITLES.map(t => t.ja + t.en).join('') + '0123456789/'
  try { await Promise.race([Promise.all([document.fonts.load("64px 'Dela Gothic One'", txt), document.fonts.load("900 30px 'M PLUS Rounded 1c'", txt), document.fonts.load("800 30px 'M PLUS Rounded 1c'", txt)]), new Promise(r => setTimeout(r, 2500))]) } catch (e) {}
}
function fitText(x, s, px, py, maxW) { const f = x.font; let size = parseInt(f.match(/(\d+)px/)[1]); while (x.measureText(s).width > maxW && size > 18) { size -= 2; x.font = f.replace(/\d+px/, size + 'px') } x.fillText(s, px, py) }
function wrapCenter(x, s, cx, cy, maxW, lh) {
  if (!Array.isArray(s) && x.measureText(s).width <= maxW) { x.fillText(s, cx, cy + lh * 0.35); return }
  const sep = Array.isArray(s) ? (/^[\x00-\x7f]+$/.test(s.join('')) ? ' ' : '') : s.includes(' ') ? ' ' : ''
  const words = Array.isArray(s) ? s : s.includes(' ') ? s.split(' ') : [...s]; const lines = []; let cur = ''
  // 1語が枠より広い時は字を小さくする（語の途中では折らない）
  const wMax = Math.max(...words.map(w => x.measureText(w).width)); if (wMax > maxW) { const m = /([\d.]+)px/.exec(x.font); x.font = x.font.replace(m[0], (+m[1] * maxW / wMax).toFixed(1) + 'px'); lh *= maxW / wMax }
  for (const w of words) { const t = cur ? cur + (/-$/.test(cur) ? '' : sep) + w : w; if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w } else cur = t }
  lines.push(cur); lines.forEach((l, i) => x.fillText(l, cx, cy + (i - (lines.length - 1) / 2) * lh + lh * 0.35))
}
function toast(s) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = s; document.body.appendChild(d); setTimeout(() => d.remove(), 1600) }

// ---------- 吹き出し・擬音
let bubT = 0
function say(s, dur) { const b = $('#pBub'); b.textContent = s; b.hidden = false; bubT = dur }
function ono(s, pain) { const d = document.createElement('div'); d.className = 'ono' + (pain ? ' pain' : ''); d.textContent = s; const p = screenOf(P.x, 2.0, -P.d), fs = Math.min(innerWidth * 0.84 / Math.max(4, [...s].length), innerHeight * 0.075, 64); d.style.left = '50%'; d.style.fontSize = fs + 'px'
  // 主人公の頭の上（自分の一言の吹き出しのさらに上）。上のゲージ・配達員のセリフの帯には入れない
  const wEst = fs * [...s].length; let topMin = 0
  for (const sel of ['.hud', '#dBub']) { const e = $(sel); if (!e || e.hidden) continue; const r = e.getBoundingClientRect(); if (r.width && r.right > (innerWidth - wEst) / 2 && r.left < (innerWidth + wEst) / 2) topMin = Math.max(topMin, r.bottom) }
  topMin += fs * 0.7 + wEst * 0.08 + 6
  d.style.top = clamp(p.y - 80 - fs / 2, topMin, innerHeight - 120) + 'px'; $('#fx').appendChild(d); setTimeout(() => d.remove(), 1000) }
const _v = new THREE.Vector3()
function screenOf(x, y, z) { _v.set(x, y, z).project(camera); return { x: (_v.x + 1) / 2 * innerWidth, y: (1 - _v.y) / 2 * innerHeight } }

// ---------- 描画（毎フレーム）
const camPos = new THREE.Vector3(0, 3, 5), camLook = new THREE.Vector3(0, 1, -5)
function render(rt) {
  if (!world) return
  const t = rt
  // 遠い区画は隠す
  for (const c of chunks) c.g.visible = c.b > P.d - 8 && c.a < P.d + 46
  if (player) {
    player.position.set(P.x, P.y, -P.d)
    animChar(player, t)
  }
  // 障害物の動き
  for (const o of R.obs) {
    if (!o.m) continue
    if (o.k === 'vacuum') { o.m.position.x = o.x; o.m.rotation.y = t * 3 }
    if (o.k === 'cat') { if (o.zz) o.zz.position.y = 0.7 + Math.sin(t * 2) * 0.05; if (o.jump !== undefined && o.jump < 1) { o.jump = Math.min(1, o.jump + 0.03); o.m.position.y = Math.sin(o.jump * Math.PI) * 0.9; o.m.position.x = o.x + o.jump * 1.2 * (o.x > 0 ? -1 : 1) } }
    if (o.fly) for (const f of o.fly) { f.vy -= 0.4; f.b.position.x += f.vx * 0.016; f.b.position.y = Math.max(0.25, f.b.position.y + f.vy * 0.016); f.b.position.z += f.vz * 0.016; f.b.rotation.z += f.r * 0.016 }
    if (o.zz && o.hit) o.zz.visible = false
  }
  // カメラ
  const L = R.st ? R.st.len : 100
  let px, py, pz, lx, ly, lz
  if (S.view === 'title') {
    const a = Math.sin(t * 0.25) * 0.35
    const far = camera.aspect < 1 ? 5.4 : 4.2
    px = Math.sin(a) * 2.4 - 0.4; py = 1.35; pz = -P.d - far + Math.abs(a); lx = 0; ly = camera.aspect < 1 ? 1.25 : 1.0; lz = -P.d
  } else if (S.mode === 'intro') {
    px = -1.2; py = 1.6; pz = -3.0; lx = 0; ly = 1.1; lz = 0
  } else if (S.mode === 'outcome' || S.view === 'result') {
    const r = S.results[S.idx]
    const far = camera.aspect < 1 ? 1.5 : 1
    if (r && r.ok) { px = -1.1 * far; py = 1.55; pz = -(L - 2.6 * far); lx = 0.25; ly = 1.15; lz = -(L + 1.2) }
    else { px = 0.7; py = 1.05; pz = -(L + 0.75); lx = -0.1; ly = 0.35; lz = -(L - 2.2) } // ドアの内側から、床の不在票とうなだれる人
    if (S.view === 'result') { const a = t * 0.2; px += Math.sin(a) * 0.4 }
  } else {
    if (CAM.port) { px = P.x * 0.8; py = CAM.h + P.y * 0.3; pz = -P.d + CAM.back; lx = P.x * 0.6; ly = 0.75; lz = -P.d - 10 }
    else { px = P.x * 0.55; py = CAM.h + P.y * 0.3; pz = -P.d + CAM.back; lx = P.x * 0.35; ly = 0.9; lz = -P.d - 7 }
  }
  if (S.camOv) { [px, py, pz] = S.camOv.p; [lx, ly, lz] = S.camOv.l; S.snapCam = true }
  const k = S.mode === 'run' && S.view === 'play' ? 0.14 : 0.06
  camPos.lerp(_v.set(px, py, pz), S.snapCam ? 1 : k); camLook.lerp(_v.set(lx, ly, lz), S.snapCam ? 1 : k); S.snapCam = false
  camera.position.copy(camPos)
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.4; camera.position.y += (Math.random() - 0.5) * shake * 0.3; shake = Math.max(0, shake - 0.016) }
  camera.lookAt(camLook)
  renderer.render(scene, camera)
  if (S.capture >= 0) { const c = document.createElement('canvas'); c.width = 336; c.height = 264; const x = c.getContext('2d'); const sw = canvas.width, sh = canvas.height, ar = 336 / 264; let w = sw, h = sw / ar; if (h > sh) { h = sh; w = sh * ar } x.drawImage(canvas, (sw - w) / 2, (sh - h) / 2, w, h, 0, 0, 336, 264); S.photos[S.capture] = c; S.capture = -1 }
}
function animChar(ch, t) {
  const r = S.results[S.idx]
  if (S.view === 'title') { const b = Math.sin(t * 6); pose(ch, { ll: b * 0.3, lr: -b * 0.3, al: -b * 0.5 - 0.3, ar: b * 0.5 - 0.3, by: Math.abs(b) * 0.04, alz: -0.3, arz: 0.3 }); setFace(ch, Math.floor(t / 2.2) % 2 ? 'panic' : 'shock'); return }
  if (S.mode === 'intro') { const j = S.mt > 0.45 && S.mt < 0.8 ? Math.sin((S.mt - 0.45) / 0.35 * Math.PI) * 0.35 : 0; pose(ch, { by: j, al: -2.6, ar: -2.6, alz: -0.4, arz: 0.4 }); setFace(ch, S.mt > 0.45 ? 'shock' : 'normal'); return }
  if (S.mode === 'outcome' || S.view === 'result') {
    if (r && r.ok) { const w = Math.sin(t * 8) * 0.3; pose(ch, { al: -2.8 + w, ar: -2.8 - w, alz: -0.3, arz: 0.3, bry: Math.PI * 0.8, by: Math.abs(Math.sin(t * 5)) * 0.08 }) }
    else pose(ch, { ll: -1.03, lr: -1.03, by: -0.4, tx: -1.15, al: 1.15, ar: 1.15, hx: 0.55 }) // orz（ドアに向かって手をつく）
    return
  }
  if (P.stun > 0) {
    const s = P.stunType, k = P.stun
    if (s === 'agony') { const hop = Math.abs(Math.sin(t * 14)) * 0.18; pose(ch, { ll: 0, lr: -1.6, al: -0.9, ar: -1.1, alz: -0.5, arz: 0.5, tx: 0.5, by: hop, bry: P.spin }) }
    else if (s === 'trip') pose(ch, { bx: -1.45, by: 0.15, al: -3, ar: -3, ll: 0.4, lr: -0.2 })
    else if (s === 'crash') pose(ch, { bx: 1.2, by: 0.2, al: -2.4, ar: -2.0, ll: -0.6, lr: -1.0 })
    else if (s === 'tangle') { const w = Math.sin(t * 18) * 0.35; pose(ch, { bz: w, ll: 0.3, lr: -0.3, al: -2, ar: -2, alz: -0.8, arz: 0.8 }) }
    else if (s === 'blind') { const w = Math.sin(t * 16); pose(ch, { al: -2.4 + w * 0.6, ar: -2.4 - w * 0.6, alz: -0.4, arz: 0.4, ll: w * 0.3, lr: -w * 0.3 }) }
    void k; return
  }
  if (P.slide > 0) { pose(ch, { bx: 1.15, by: 0.08, ll: -1.2, lr: -1.0, al: 1.2, ar: 1.0 }); return }
  if (P.y > 0) { pose(ch, { ll: -1.0, lr: 0.5, al: -2.6, ar: -2.2, alz: -0.3, arz: 0.3 }); return }
  const ph = P.phase, s = Math.sin(ph) * 1.0
  const cupHold = R.st && R.st.id === 'noodle'
  pose(ch, { ll: s, lr: -s, al: -s * 0.9, ar: cupHold ? 1.3 : s * 0.9, tx: -0.18, by: Math.abs(Math.cos(ph)) * 0.06 })
}

// ---------- HUD
function hud() {
  if (S.view !== 'play') return
  const fr = R.waitMax ? R.wait / R.waitMax : 1
  $('#patBar').style.width = (fr * 100).toFixed(1) + '%'
  $('#pat').className = 'pat' + (fr < 0.25 ? ' dang' : fr < 0.5 ? ' warn' : '')
  $('#patMouth').setAttribute('d', fr < 0.25 ? 'M12 25q4-4 8 0' : fr < 0.5 ? 'M12 24h8' : 'M12 23q4 3 8 0')
  $('#progMan').style.left = (clamp(P.d / (R.st ? R.st.len : 1), 0, 1) * 100).toFixed(1) + '%'
  const b = $('#pBub')
  if (!b.hidden) {
    const p = screenOf(P.x, 2.2 + P.y, -P.d); b.style.left = clamp(p.x, 90, innerWidth - 90) + 'px'; let top = clamp(p.y, 150, innerHeight - 100); b.style.top = top + 'px'
    // 擬音・配達員のセリフ・ゲージと重なったら、その下へずらす
    const bh = b.offsetHeight, bw = b.offsetWidth, bl = parseFloat(b.style.left) - bw / 2
    for (const e of [...$$('#fx .ono'), $('.hud'), $('#dBub')]) { if (!e || e.hidden) continue; const r = e.getBoundingClientRect(); if (!r.width) continue; if (bl < r.right && r.left < bl + bw && top - bh < r.bottom && r.top < top) top = r.bottom + bh + 6 }
    b.style.top = Math.min(top, innerHeight - 90) + 'px'
  }
}

// ---------- 画面切替・文言
function go(v) {
  S.view = { vTitle: 'title', vHow: 'how', vPlay: 'play', vResult: 'result', vPause: 'play' }[v]
  for (const m of $$('main.view')) m.hidden = m.id !== v
  if (v === 'vTitle') { Snd.setTrack('title') }
}
function applyLang() {
  document.documentElement.lang = S.lang
  for (const el of $$('[data-t]')) el.textContent = T(el.dataset.t)
  $('#langLab').textContent = S.lang === 'ja' ? 'EN' : 'JA'
  $('#ctrlLine').textContent = isTouch ? T('ctrlSP') : T('ctrlPC')
  $('#keys').textContent = T('tutPC')
  document.title = S.lang === 'ja' ? "再配達はイヤだ！ | DON'T LEAVE, DELIVERY GUY" : "DON'T LEAVE, DELIVERY GUY | 再配達はイヤだ！"
  if (MATS.slipTex) { MATS.slipTex.dispose(); MATS.slipTex = null; if (slip) slip.material = slipMat() }
}
function setPaused(v) {
  if (S.view !== 'play' && v) return
  S.paused = v; $('#vPause').hidden = !v
  if (v) { $('#vPlay').hidden = false }
}

// ---------- ループ（固定60Hz）
let acc = 0, lastT = performance.now(), dbgPause = false, fpsN = 0, fpsT = performance.now(), fps = 0
function loop() {
  const now = performance.now(); let dt = (now - lastT) / 1000; lastT = now; if (dt > 0.25) dt = 0.25
  if (!dbgPause) { acc += dt; while (acc >= DT) { step(); acc -= DT } } else acc = 0
  if (bubT > 0) { bubT -= dt; if (bubT <= 0) $('#pBub').hidden = true }
  render(now / 1000); hud(); Snd.tick()
  fpsN++; if (now - fpsT > 1000) { fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now }
  requestAnimationFrame(loop)
}

// ---------- 起動
function titleScene() {
  R.st = D.STAGES[0]; buildWorld(D.STAGES[0], 4242); R.obs = genCourse(D.STAGES[0], 4242); for (const o of R.obs) makeObs(o, chunkFor(o.d))
  if (player) player.parent && player.parent.remove(player)
  player = makeChar('hoodie'); world.add(player); Object.assign(P, { d: 6, x: 0, y: 0, lane: 1, stun: 0, slide: 0 }); S.results = []; S.snapCam = true
}
function boot() {
  resize(); window.addEventListener('resize', resize)
  document.body.classList.add(isTouch ? 'spmode' : 'pcmode')
  if (S.muted) { Snd.muted = true; $('#icOn').hidden = true; $('#icOff').hidden = false }
  applyLang(); titleScene(); go('vTitle')
  const on = (id, fn) => $(id).addEventListener('click', e => { Snd.init(); fn(e) })
  on('#bPlay', () => { Snd.sfx('tap'); startGame() })
  on('#bHow', () => { Snd.sfx('tap'); go('vHow') })
  on('#bHowBack', () => { Snd.sfx('tap'); go('vTitle') })
  on('#bPause', () => setPaused(true))
  on('#bResume', () => { setPaused(false); lastT = performance.now() })
  on('#bQuit', () => { setPaused(false); titleScene(); go('vTitle') })
  on('#bNext', () => { Snd.sfx('tap'); nextStage() })
  on('#bAgain', () => { Snd.sfx('tap'); startGame() })
  on('#bSave', () => saveImage())
  on('#bX', () => { window.open(xUrl(), '_blank', 'noopener') })
  on('#bTitle', () => { Snd.sfx('tap'); titleScene(); go('vTitle') })
  on('#bLang', () => { S.lang = S.lang === 'ja' ? 'en' : 'ja'; store.set('lang', S.lang); applyLang(); if (S.view === 'result') showResultTexts() })
  on('#bMute', () => { Snd.setMute(!Snd.muted); S.muted = Snd.muted; $('#icOn').hidden = Snd.muted; $('#icOff').hidden = !Snd.muted; store.set('mute', Snd.muted ? '1' : '0') })
  // 画面のボタン（押した瞬間に反応させる）
  for (const [id, a] of [['#bL', 'left'], ['#bR', 'right'], ['#bJ', 'jump'], ['#bS', 'slide']]) {
    const el = $(id)
    el.addEventListener('pointerdown', e => { e.preventDefault(); Snd.init(); input(a); el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 120) })
  }
  // スワイプ
  let sw = null
  window.addEventListener('pointerdown', e => { if (e.target && e.target.closest && e.target.closest('button')) return; Snd.init(); sw = { x: e.clientX, y: e.clientY, done: false }; if (S.view === 'play' && S.mode === 'intro') input('tap') })
  window.addEventListener('pointermove', e => {
    if (!sw || sw.done) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y
    if (Math.hypot(dx, dy) > 26) { sw.done = true; input(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'jump' : 'slide')) }
  })
  window.addEventListener('pointerup', () => { sw = null })
  window.addEventListener('keydown', e => {
    if (e.repeat) return
    const k = e.key, m = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'jump', w: 'jump', W: 'jump', ' ': 'jump', ArrowDown: 'slide', s: 'slide', S: 'slide' }[k]
    if (m && S.view === 'play') { e.preventDefault(); Snd.init(); input(m); return }
    if ((k === 'Escape' || k === 'p' || k === 'P') && S.view === 'play') { setPaused(!S.paused); lastT = performance.now(); return }
    if (k === 'Enter') { if (S.view === 'title') { Snd.init(); startGame() } else if (S.view === 'play' && !$('#bNext').hidden) nextStage() }
  })
  document.addEventListener('visibilitychange', () => { lastT = performance.now(); acc = 0; if (document.hidden && S.view === 'play' && S.mode === 'run') setPaused(true) })
  requestAnimationFrame(loop)
  window.__rdReady = true
}
function showResultTexts() {
  const tt = titleOf(S.results); setHankoTitle(tt); $('#rLine').textContent = S.lang === 'ja' ? tt.jl : tt.el
  $$('.sRow').forEach((d, i) => { const r = S.results[i], it = r.ok ? D.ITEMS[r.item] : null; d.querySelector('.it').innerHTML = `${it ? it[S.lang] : T('missed').replace('…', '').replace('...', '')}<small>${T('s_' + D.STAGES[i].id)} / ${T('hits')} ${r.hits}</small>`; d.querySelector('.tag').textContent = r.ok ? T('cardGot') : T('cardMiss') })
}

// 検証用の窓口
window.rd = {
  S, P, R, D, Snd, cardFonts, startGame, startStage, input, simulate, titleOf, titleWords, fitHanko, setHankoTitle, buildCard, saveImage, xText, xUrl, PUB_URL, genCourse, nextStage, showResult,
  fps: () => fps,
  dbg: { pause: v => { dbgPause = v }, step: n => { for (let i = 0; i < n; i++) step() }, render: () => render(performance.now() / 1000), setBot: k => { S.bot = k ? { kind: k, rng: mulberry(99) } : null } },
}
boot()
