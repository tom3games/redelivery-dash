// 場面ごとのスクショ（目視用）。node scenes.mjs [幅x高さ]
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync } from 'node:fs'
const ROOT = import.meta.dirname; mkdirSync(ROOT + '/shots', { recursive: true })
const port = await new Promise(r => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)) }) })
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port) } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const [W, H] = (process.argv[2] || '390x844').split('x').map(Number), tag = process.argv[2] ? '-' + process.argv[2] : ''
const p = await b.newPage({ viewport: { width: W, height: H }, locale: process.env.LANG_EN ? 'en-US' : 'ja-JP' })
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto(`http://localhost:${port}/`); await p.waitForFunction(() => window.__rdReady)
await p.evaluate(() => document.fonts.ready)
const shot = async n => { await p.evaluate(() => { for (let i = 0; i < 40; i++) rd.dbg.render() }); await p.waitForTimeout(250); await p.screenshot({ path: `${ROOT}/shots/sc-${n}${tag}.png` }) }
// 種を探す: ステージ i に kind がある種
const seedWith = (i, kind) => p.evaluate(([i, kind]) => { for (let s = 1; s < 500; s++) if (rd.genCourse(rd.D.STAGES[i], s * 7 + i * 101 + 3).some(o => o.k === kind)) return s }, [i, kind])
// 障害物の手前まで進めて、当たるまで回す
async function hitScene(kind, name, extra = 10) {
  const seed = await seedWith(0, kind)
  await p.evaluate(([seed, kind, extra]) => {
    rd.dbg.pause(true); rd.startGame(seed); rd.dbg.step(140)
    const o = rd.R.obs.find(o => o.k === kind); rd.P.d = o.d - 5; if (!o.all) { rd.P.lane = o.lane; rd.P.x = [-1.3, 0, 1.3][o.lane] }
    for (let i = 0; i < 200 && !rd.P.stun; i++) { rd.dbg.step(1); if (o.k === 'vacuum') { rd.P.x = o.x } }
    rd.dbg.step(extra)
  }, [seed, kind, extra])
  await shot(name)
}
await shot('title')
await hitScene('lego', 'lego', 30)
await hitScene('laundry', 'laundry', 8)
await hitScene('boxes', 'boxes', 14)
await hitScene('cat', 'cat', 10)
// 通過シーン（障害物の前を走る）
await p.evaluate(() => { rd.dbg.pause(true); rd.startGame(77); rd.dbg.step(140); rd.dbg.step(60 * 3.2) })
await shot('run2')
// 勝ち
await p.evaluate(() => { rd.dbg.pause(true); rd.startGame(5); rd.dbg.step(140); rd.R.obs.forEach(o => o.hit = true); rd.P.d = rd.R.st.len - 3; rd.dbg.step(30); rd.dbg.step(100) })
await shot('win')
// 次ステージの導入（風呂上がり）
await p.evaluate(() => { rd.startStage(2); rd.dbg.step(70) })
await shot('intro-bath')
await p.evaluate(() => { rd.dbg.step(140); rd.dbg.step(120) })
await shot('run-bath')
// 負け
await p.evaluate(() => { rd.R.wait = 0.02; rd.dbg.step(2); rd.dbg.step(110) })
await shot('lose')
// 結果
await p.evaluate(() => { rd.S.results = [{ ok: true, margin: 1, hits: 0, item: 0 }, { ok: true, margin: 1, hits: 2, item: 3 }, { ok: false, margin: 0, hits: 4, item: -1 }]; rd.showResult(); rd.dbg.step(60 * 4) })
await shot('result')
// 結果カード
const png = await p.evaluate(async () => { await rd.cardFonts(); return rd.buildCard().toDataURL('image/png') })
const { writeFileSync } = await import('node:fs'); writeFileSync(`${ROOT}/shots/sc-card${tag}.png`, Buffer.from(png.split(',')[1], 'base64'))
console.log('errs', errs)
await b.close(); server.kill()
