// SNS用サムネ og.png（1200x630）。node og.mjs。遊んでいる一番おもしろい場面（レゴを踏んで悶絶）＋タイトル＋一言
import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
const ROOT = import.meta.dirname
const port = await new Promise(r => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)) }) })
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port) } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, locale: 'ja-JP' })
await p.goto(`http://localhost:${port}/`); await p.waitForFunction(() => window.__rdReady)
await p.evaluate(async () => { await document.fonts.ready; await rd.cardFonts() })
await p.evaluate(() => {
  rd.dbg.pause(true)
  let seed = 1; for (; seed < 800; seed++) { const c = rd.genCourse(rd.D.STAGES[0], seed * 7 + 3); const i = c.findIndex(o => o.k === 'lego'); if (i >= 0 && c[i].d < 50 && c[i].lane !== 2) break }
  rd.startGame(seed); rd.dbg.step(150)
  const o = rd.R.obs.find(o => o.k === 'lego'); rd.P.d = o.d - 3; rd.P.lane = o.lane; rd.P.x = [-1.3, 0, 1.3][o.lane]; rd.R.wait = rd.R.waitMax * 0.3
  for (let i = 0; i < 200 && !rd.P.stun; i++) rd.dbg.step(1)
  rd.dbg.step(22); rd.P.spin = -0.35
  const z = -rd.P.d
  for (const q of rd.R.obs) if (q !== o && q.m && q.d > rd.P.d && q.d < rd.P.d + 5) q.m.visible = false
  rd.S.camOv = { p: [rd.P.x * 0.4 + 0.5, 1.75, z - 2.9], l: [rd.P.x - 1.05, 0.55, z + 0.4] }
  for (let i = 0; i < 4; i++) rd.dbg.render()
})
await p.addStyleTag({ content: `.hud,#bPause,#corner,.keys,.ctl,#tut,#pBub,#fx,#dBub{display:none!important}
  body::after{content:'';position:fixed;inset:0 0 0 50%;background:linear-gradient(90deg,rgba(42,34,56,0),rgba(42,34,56,.93) 22%);z-index:30}` })
await p.evaluate(() => {
  const d = document.createElement('div'); d.style.cssText = 'position:fixed;right:34px;top:0;bottom:0;width:540px;z-index:31;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:20px;color:#fff;text-align:center'
  d.innerHTML = `<div style="font-family:'Dela Gothic One';font-size:20px;background:#ffd23f;color:#221c2e;padding:6px 16px;border-radius:12px;transform:rotate(-4deg);box-shadow:0 4px 0 #a8820c">ピンポーン</div>
  <div style="font-family:'Dela Gothic One';line-height:1.05;transform:rotate(-4deg)"><div style="font-size:62px;text-shadow:0 5px 0 #120e1a">再配達は</div><div style="font-size:124px;color:#ff5d73;text-shadow:0 7px 0 #a8283c,0 0 30px rgba(255,93,115,.5)">イヤだ！</div></div>
  <div style="font-weight:900;font-size:28px;line-height:1.5;font-family:'M PLUS Rounded 1c'">チャイムが鳴った。<br>宅配便が帰る前に、玄関まで走れ。</div>`
  document.body.appendChild(d)
  const o = document.createElement('div'); o.style.cssText = "position:fixed;left:30px;top:26px;z-index:32;font-family:'Dela Gothic One';font-size:62px;color:#ff5d73;-webkit-text-stroke:6px #221c2e;paint-order:stroke fill;transform:rotate(-8deg)"; o.textContent = 'いっっったぁ！！'; document.body.appendChild(o)
  const bb = document.createElement('div'); bb.style.cssText = "position:fixed;left:70px;bottom:44px;z-index:32;background:#ffe3e3;color:#a8283c;border:4px solid #a8283c;border-radius:20px;padding:10px 20px;font-weight:900;font-size:28px;font-family:'M PLUS Rounded 1c';box-shadow:0 5px 0 rgba(0,0,0,.35)"; bb.textContent = 'ドアの向こう「…お留守ですかねー」'; document.body.appendChild(bb)
})
await p.waitForTimeout(500)
await p.screenshot({ path: ROOT + '/og.png' })
await b.close(); server.kill()
console.log('ok')
