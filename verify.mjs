// 自分で壊す検証。node verify.mjs（全部 pass で 0 終了。shots/ にスクショ）
import { chromium, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
const ROOT = import.meta.dirname
mkdirSync(ROOT + '/shots', { recursive: true })
// 並行して他のゲームも検証するので、空いているポートを取る
const PORT = await new Promise(r => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)) }) })
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const URL0 = `http://localhost:${PORT}/`
let pass = 0, fail = 0
const results = [], notes = []
async function t(name, fn) {
  try { const r = await fn(); if (r === false) throw new Error('false'); pass++; results.push(`ok   ${name}${r && r !== true ? '  ' + JSON.stringify(r) : ''}`) }
  catch (e) { fail++; results.push(`FAIL ${name}  ${e.message.split('\n')[0]}`) }
}
const expect = (c, msg) => { if (!c) throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)) }
async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, acceptDownloads: true, ...opts })
  await ctx.addInitScript(() => { try { localStorage.clear() } catch (e) {} })
  const p = await ctx.newPage(); p.errs = []
  p.on('pageerror', e => p.errs.push('pageerror ' + e.message))
  p.on('console', m => { if (m.type() === 'error') p.errs.push('console ' + m.text()) })
  p.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) p.errs.push('reqfail ' + r.url()) })
  await p.goto(URL0); await p.waitForFunction(() => window.__rdReady, null, { timeout: 30000 })
  return p
}
const overflow = p => p.evaluate(() => {
  const W = document.documentElement.clientWidth, bad = []
  for (const el of document.querySelectorAll('main:not([hidden]) *')) {
    if (el.closest('[hidden]') || el.closest('#fx') || (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true }))) continue
    const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) bad.push((el.id || el.className || el.tagName) + ':' + Math.round(r.left) + '-' + Math.round(r.right))
  }
  return { sw: document.documentElement.scrollWidth, W, bad: bad.slice(0, 5) }
})
const fit = (q, noOverlap) => q.evaluate(noOverlap => {
  const H = innerHeight, W = innerWidth, de = document.documentElement, over = []
  if (de.scrollHeight > H + 1) over.push('page:' + de.scrollHeight)
  const vis = el => el.offsetParent && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none'
  for (const el of document.querySelectorAll('main:not([hidden]) button, #corner button')) {
    if (!vis(el)) continue
    const r = el.getBoundingClientRect(); if (r.bottom > H + 1 || r.top < -1 || r.right > W + 1 || r.left < -1) over.push((el.id || el.className) + ':' + Math.round(r.top) + '-' + Math.round(r.bottom))
  }
  for (const el of document.querySelectorAll('main:not([hidden]) .howCard, main:not([hidden]) .rCard, main:not([hidden]) .hud, main:not([hidden]) .outc')) { if (!vis(el)) continue; const r = el.getBoundingClientRect(); if (r.bottom > H + 1 || r.top < -1) over.push(el.className + ':' + Math.round(r.top) + '-' + Math.round(r.bottom)) }
  if (!noOverlap) {
    const bs = [...document.querySelectorAll('main:not([hidden]) button, #corner button')].filter(vis).map(b => [b.id || b.className, b.getBoundingClientRect()])
    // HUD（忍耐ゲージ）とボタンも重ならない
    const hud = document.querySelector('main:not([hidden]) .hud'); if (hud && vis(hud)) bs.push(['hud', hud.getBoundingClientRect()])
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const a = bs[i][1], b = bs[j][1]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) over.push('overlap ' + bs[i][0] + '/' + bs[j][0]) }
  }
  return { H, over: over.slice(0, 6) }
}, noOverlap)
const glVariance = p => p.evaluate(() => {
  rd.dbg.render(); const src = document.querySelector('#gl'), c = document.createElement('canvas'); c.width = 200; c.height = 200
  const x = c.getContext('2d'); x.drawImage(src, 0, 0, 200, 200); const d = x.getImageData(0, 0, 200, 200).data
  let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 7) { const v = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; s += v; s2 += v * v; n++ }
  return Math.round(s2 / n - (s / n) ** 2)
})
// ---- Xでポスト の検査道具
// window.open をスタブして押す → 開いたURLを分解して確かめる
const xStub = async (pg, ns, pub, tag) => {
  await pg.evaluate(() => { window.__opened = []; if (!window.__origOpen) window.__origOpen = window.open; window.open = (...a) => { window.__opened.push(a); return null } })
  const vis = await pg.evaluate(() => { const b = document.querySelector('#bX'), r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, clip: b.scrollWidth > b.clientWidth + 1, bg: getComputedStyle(b).backgroundColor, label: b.textContent.trim(), svg: !!b.querySelector('svg path') } })
  await pg.click('#bX')
  const r = await pg.evaluate(ns => ({ opened: window.__opened, text: window[ns].xText(), url: window[ns].xUrl() }), ns)
  await pg.evaluate(() => { window.open = window.__origOpen })
  expect(r.opened.length === 1, r)
  const [u, target, feat] = r.opened[0], q = new URL(u)
  const text = q.searchParams.get('text'), url = q.searchParams.get('url')
  expect(u.startsWith('https://x.com/intent/post?') && target === '_blank' && /noopener/.test(feat || '') && u === r.url, r.opened[0])
  expect(text === r.text && text.includes(tag) && (text.match(/#/g) || []).length === 1 && url === pub && !/https?:\/\//.test(text), { text, url })
  expect(vis.inView && !vis.clip && vis.svg && vis.bg === 'rgb(0, 0, 0)' && vis.h >= 36, vis)
  return { label: vis.label, text }
}
// 本物のクリックで新しいタブ（popup）が開く。x.com へは出ずにダミーを返す
const xPopup = async (pg, pub) => {
  await pg.context().route(/^https:\/\/x\.com\//, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>x</title>ok' }))
  const [pop] = await Promise.all([pg.waitForEvent('popup', { timeout: 8000 }), pg.click('#bX')])
  await pop.waitForLoadState().catch(() => {})
  const u = new URL(pop.url()); await pop.close()
  expect(u.origin + u.pathname === 'https://x.com/intent/post' && u.searchParams.get('url') === pub && u.searchParams.get('text'), pop.url())
  return u.searchParams.get('text')
}
// 結果画面のボタンの文字が切れていない
const btnClip = pg => pg.evaluate(() => [...document.querySelectorAll('#vResult button')].filter(b => b.offsetParent && b.scrollWidth > b.clientWidth + 1).map(b => b.id + ':' + b.scrollWidth + '>' + b.clientWidth))
const PUB = 'https://tom3games.github.io/redelivery-dash/'
const SIZES = [[360, 640, 'small'], [390, 844, 'phone'], [844, 390, 'land'], [667, 375, 'land-se'], [768, 1024, 'tab'], [1440, 900, 'pc']]
const GPU = { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }

const browser = await chromium.launch(GPU)
const p = await open(browser)
await t('起動時にエラーが出ない', async () => { expect(p.errs.length === 0, p.errs.join('|')) })
await t('ブラウザの拡大が起きない（viewport・ピンチ・Ctrl+ホイール・Ctrl+プラス）', async () => {
  const r = await p.evaluate(() => {
    const vp = document.querySelector('meta[name=viewport]').content
    const g = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(g)
    const w = new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, bubbles: true, cancelable: true }); window.dispatchEvent(w)
    const k = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(k)
    return { vp, gesture: g.defaultPrevented, wheel: w.defaultPrevented, key: k.defaultPrevented, ta: getComputedStyle(document.documentElement).touchAction, us: getComputedStyle(document.body).userSelect }
  })
  expect(/user-scalable=no/.test(r.vp) && r.gesture && r.wheel && r.key && r.ta === 'manipulation' && r.us === 'none', r); return r
})
await t('OGP 一式があり、画像のURLが本番を指す', async () => {
  const r = await p.evaluate(() => ({ ks: ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].map(k => document.querySelector(`meta[property="${k}"]`)?.content || ''), tw: document.querySelector('meta[name="twitter:card"]')?.content }))
  expect(r.ks.every(Boolean) && r.tw === 'summary_large_image' && r.ks[2] === 'https://tom3games.github.io/redelivery-dash/og.png?v=1' && r.ks[3] === 'https://tom3games.github.io/redelivery-dash/', r)
})
await t('og.png が 1200x630 で置いてある', async () => {
  const r = await p.evaluate(async () => { const b = await (await fetch('og.png')).blob(); const i = await createImageBitmap(b); return [i.width, i.height, b.size] })
  expect(r[0] === 1200 && r[1] === 630, r); return r
})
await t('タイトルが日本語で出て、3Dの部屋が描けている（輝度の散らばり）', async () => {
  const s = await p.textContent('.logo .l2'); await p.waitForTimeout(300); const v = await glVariance(p); expect(s.includes('イヤだ') && v > 200, s + ' ' + v); return { s, v }
})
await t('three.js は importmap を使わず直接読んでいる', async () => {
  const r = await p.evaluate(async () => ({ im: !!document.querySelector('script[type=importmap]'), src: (await (await fetch('game.js')).text()).includes("from './vendor/three.module.js'") }))
  expect(!r.im && r.src, r)
})
await p.screenshot({ path: ROOT + '/shots/01-title.png' })

// ---------- 遊び方
await p.click('#bHow')
await t('遊び方: PC向けのキー説明が出る', async () => { const s = await p.textContent('#ctrlLine'); expect(/スペース/.test(s), s); return s })
await p.screenshot({ path: ROOT + '/shots/02-how.png' })
await p.click('#bHowBack')

// ---------- 通しで遊ぶ（実際のクリックとキー）
await p.click('#bPlay')
await t('あそぶ → ステージ1の導入（ピンポーン）が出て、音が鳴る', async () => {
  await p.waitForFunction(() => document.querySelector('#inDing').textContent.length > 0, null, { timeout: 4000 })
  const r = await p.evaluate(() => ({ sit: document.querySelector('#inSit').textContent, ding: rd.Snd.played.ding || 0, mode: rd.S.mode, ctx: !!rd.Snd.ctx }))
  expect(r.sit === 'ゲーム中に' && r.mode === 'intro' && (r.ding > 0 || !r.ctx), r); return r
})
await p.screenshot({ path: ROOT + '/shots/03-intro.png' })
await t('導入のあと自動で走り出し、配達員ゲージが減っていく', async () => {
  await p.waitForFunction(() => rd.S.mode === 'run', null, { timeout: 5000 }); const a = await p.evaluate(() => rd.R.wait)
  await p.waitForTimeout(700); const b = await p.evaluate(() => ({ w: rd.R.wait, d: rd.P.d, bgm: rd.Snd.played['bgm:run'] || 0 }))
  expect(b.w < a - 0.3 && b.d > 2, { a, b }); return { a: +a.toFixed(2), ...b }
})
await t('キー: ←で左レーン、→→で右レーン', async () => {
  await p.keyboard.press('ArrowLeft'); const a = await p.evaluate(() => rd.P.lane)
  await p.keyboard.press('d'); await p.keyboard.press('ArrowRight'); const b = await p.evaluate(() => rd.P.lane)
  expect(a === 0 && b === 2, { a, b }); return { a, b }
})
await t('キー: スペースでジャンプ（空中にいる）', async () => {
  await p.evaluate(() => rd.dbg.pause(true)); await p.keyboard.press(' ')
  const r = await p.evaluate(() => { rd.dbg.step(8); return { y: rd.P.y, stun: rd.P.stun } }); expect(r.y > 0.3 || r.stun > 0, r); return r
})
await t('キー: ↓でスライディング（空中なら急降下してから）', async () => {
  const r = await p.evaluate(() => { rd.dbg.step(40); rd.P.stun = 0; return 0 }); void r
  await p.keyboard.press('ArrowDown'); const s = await p.evaluate(() => { rd.dbg.step(2); return rd.P.slide }); expect(s > 0.3, s); return s
})
await p.evaluate(() => rd.dbg.pause(false))
await p.screenshot({ path: ROOT + '/shots/04-run.png' })
await t('Esc で一時停止すると時間が止まり、つづけるで再開', async () => {
  await p.keyboard.press('Escape'); const a = await p.evaluate(() => rd.R.wait); await p.waitForTimeout(400); const b = await p.evaluate(() => ({ w: rd.R.wait, vis: !document.querySelector('#vPause').hidden }))
  await p.screenshot({ path: ROOT + '/shots/05-pause.png' })
  await p.click('#bResume'); await p.waitForTimeout(300); const c = await p.evaluate(() => rd.R.wait)
  expect(b.vis && Math.abs(a - b.w) < 0.001 && c < b.w, { a, b, c }); return { paused: b.vis }
})
await t('時間は固定60Hz: 実時間1秒で走る距離が速さ×1秒（±15%）', async () => {
  await p.evaluate(() => { rd.P.stun = 0; rd.R.obs.forEach(o => o.hit = true); rd.R.wait = 99 })
  const a = await p.evaluate(() => ({ d: rd.P.d, t: performance.now() })); await p.waitForTimeout(1000); const b = await p.evaluate(() => ({ d: rd.P.d, t: performance.now(), v: rd.R.st.speed }))
  const v = (b.d - a.d) / ((b.t - a.t) / 1000); expect(Math.abs(v - b.v) / b.v < 0.15, { v, want: b.v }); return { v: +v.toFixed(2), want: b.v }
})
await t('fps（chromium・390x844・走行中）', async () => { await p.waitForTimeout(1200); const f = await p.evaluate(() => rd.fps()); notes.push('fps chromium ' + f.toFixed(1)); expect(f > 30, f); return +f.toFixed(1) })

// ---------- 当たり判定
const placeBefore = (kind, opts = {}) => p.evaluate(([kind, opts]) => {
  rd.dbg.pause(true)
  let seed = 1; for (; seed < 800; seed++) if (rd.genCourse(rd.D.STAGES[0], seed * 7 + 3).some(o => o.k === kind)) break
  rd.startGame(seed); rd.dbg.step(200)
  const o = rd.R.obs.find(o => o.k === kind); rd.R.obs.forEach(q => { if (q !== o) q.hit = true })
  rd.P.d = o.d - 3; rd.P.stun = 0; rd.P.inv = 0; rd.R.wait = 50
  if (!o.all) { rd.P.lane = o.lane; rd.P.x = [-1.3, 0, 1.3][o.lane] }
  if (opts.side) { rd.P.lane = (o.lane + 1) % 3; rd.P.x = [-1.3, 0, 1.3][rd.P.lane] }
  return { seed, d: o.d, lane: o.lane }
}, [kind, opts])
const runTill = (kind, act) => p.evaluate(([kind, act]) => {
  const o = rd.R.obs.find(o => o.k === kind)
  for (let i = 0; i < 120; i++) {
    const front = o.d - o.len / 2 - 0.25 - rd.P.d
    if (act && !o.acted && front < rd.P.speed * 0.1 + 0.1) { o.acted = true; rd.input(act) }
    if (o.k === 'vacuum') { rd.P.x = o.x; rd.P.lane = 1 }
    rd.dbg.step(1); if (rd.P.stun > 0) break
  }
  return { hits: rd.P.hits, stun: +rd.P.stun.toFixed(2), type: rd.P.stunType, passed: rd.P.d > o.d + 1 }
}, [kind, act])
for (const [kind, act, wantHit] of [['lego', null, true], ['lego', 'jump', false], ['cat', null, true], ['cat', 'jump', false], ['cable', 'jump', false], ['cable', null, true], ['clothes', 'jump', false], ['laundry', null, true], ['laundry', 'slide', false], ['laundry', 'jump', true], ['boxes', 'jump', true], ['vacuum', 'jump', false]]) {
  await t(`当たり判定: ${kind} に ${act || '何もしない'} → ${wantHit ? 'ぶつかる' : 'よけられる'}`, async () => {
    await placeBefore(kind); const r = await runTill(kind, act); expect((r.hits > 0) === wantHit, r); return r
  })
}
await t('当たり判定: 段ボールは隣のレーンなら当たらない', async () => { await placeBefore('boxes', { side: true }); const r = await runTill('boxes', null); expect(r.hits === 0, r); return r })
await t('レゴを踏むと悶絶（1.45秒止まる・痛い顔・擬音と悲鳴）', async () => {
  await placeBefore('lego'); const r = await runTill('lego', null)
  const s = await p.evaluate(() => (rd.dbg.step(1), { ono: [...document.querySelectorAll('#fx .ono')].map(e => e.textContent).pop(), bub: document.querySelector('#pBub').textContent, snd: rd.Snd.played.lego || 0, speed: rd.P.speed }))
  await p.evaluate(() => { for (let i = 0; i < 20; i++) rd.dbg.render() }); await p.screenshot({ path: ROOT + '/shots/06-lego.png' })
  expect(r.type === 'agony' && r.stun > 1.3 && s.ono === 'いっっったぁ！！' && s.speed === 0, { r, s }); return { ...r, ...s }
})
await t('止まったあとは走りを再開し、少しの間は無敵', async () => {
  const r = await p.evaluate(() => { rd.dbg.step(110); return { stun: rd.P.stun, inv: rd.P.inv, speed: rd.P.speed } }); expect(r.stun <= 0 && r.speed > 3 && r.inv >= 0, r); return r
})
await t('部屋干しに当たると前が見えない（服が顔にかかる）', async () => {
  await placeBefore('laundry'); await runTill('laundry', null)
  const v = await p.evaluate(() => !document.querySelector('#blind').hidden); await p.evaluate(() => { for (let i = 0; i < 20; i++) rd.dbg.render() }); await p.screenshot({ path: ROOT + '/shots/07-laundry.png' })
  const after = await p.evaluate(() => { rd.dbg.step(70); return !document.querySelector('#blind').hidden }); expect(v && !after, { v, after })
})

// ---------- ステージの終わり方
await t('時間切れ → 不在票がヒラリ（判定は負け・票が床に落ちる）', async () => {
  await p.evaluate(() => { rd.dbg.pause(true); rd.startGame(11); rd.dbg.step(200); rd.R.wait = 0.03; rd.dbg.step(3) })
  const a = await p.evaluate(() => ({ mode: rd.S.mode, ok: rd.S.results[0].ok }))
  await p.evaluate(() => { rd.dbg.step(120); for (let i = 0; i < 30; i++) rd.dbg.render() })
  const b = await p.evaluate(() => ({ big: document.querySelector('#ocBig').textContent, next: !document.querySelector('#bNext').hidden, photo: !!rd.S.photos[0] }))
  await p.screenshot({ path: ROOT + '/shots/08-missed.png' })
  expect(a.mode === 'outcome' && a.ok === false && b.big.includes('不在票') && b.next, { a, b }); return { ...a, ...b }
})
await t('次へ → ステージ2（カップ麺）の導入', async () => {
  await p.click('#bNext'); const r = await p.evaluate(() => ({ idx: rd.S.idx, sit: document.querySelector('#inSit').textContent, mode: rd.S.mode })); expect(r.idx === 1 && r.mode === 'intro' && /カップ麺/.test(r.sit), r); return r
})
await t('玄関に着く → はーい！ドアが開いて配達員が渡す（中身が出る）', async () => {
  await p.evaluate(() => { rd.dbg.step(140); rd.R.obs.forEach(o => o.hit = true); rd.P.d = rd.R.st.len - 0.5; rd.dbg.step(20); rd.dbg.step(60); for (let i = 0; i < 30; i++) rd.dbg.render() })
  const r = await p.evaluate(() => ({ ok: rd.S.results[1].ok, big: document.querySelector('#ocBig').textContent, item: document.querySelector('#ocB').textContent, bub: document.querySelector('#pBub').textContent, fan: rd.Snd.played.fanfare || 0 }))
  await p.screenshot({ path: ROOT + '/shots/09-received.png' })
  expect(r.ok && r.big === '受け取った！' && r.item.length > 2 && r.bub === 'はーい！', r); return r
})
await t('ステージ3（風呂上がり・バスローブ）まで進み、最後は結果発表へ', async () => {
  await p.evaluate(() => { rd.dbg.step(100); rd.nextStage(); rd.dbg.step(100) })
  const a = await p.evaluate(() => ({ idx: rd.S.idx, sit: document.querySelector('#inSit').textContent }))
  await p.evaluate(() => { for (let i = 0; i < 30; i++) rd.dbg.render() }); await p.screenshot({ path: ROOT + '/shots/10-bath.png' })
  await p.evaluate(() => { rd.dbg.step(60); rd.R.obs.forEach(o => o.hit = true); rd.P.d = rd.R.st.len - 0.5; rd.dbg.step(200) })
  await p.click('#bNext'); const b = await p.evaluate(() => ({ view: rd.S.view, hanko: document.querySelector('#hanko').className }))
  expect(a.idx === 2 && /バスローブ/.test(a.sit) && b.view === 'result' && !/show/.test(b.hanko), { a, b }); return { ...a, ...b }
})
await t('結果発表: 判定は発表まで見せない → 集計のあとハンコ（称号）', async () => {
  const a = await p.evaluate(() => ({ got: document.querySelector('#nGot').textContent, drum: !document.querySelector('#drum').hidden }))
  await p.screenshot({ path: ROOT + '/shots/11-result-before.png' })
  await p.evaluate(() => rd.dbg.step(60 * 4))
  const b = await p.evaluate(() => ({ got: document.querySelector('#nGot').textContent, miss: document.querySelector('#nMiss').textContent, title: document.querySelector('#hTitle').textContent, stamp: /show/.test(document.querySelector('#hanko').className) }))
  await p.evaluate(() => rd.dbg.pause(false)); await p.waitForTimeout(700); await p.screenshot({ path: ROOT + '/shots/12-result.png' })
  expect(a.got === '?' && a.drum && b.got === '2' && b.miss === '1' && b.title === 'ギリ在宅' && b.stamp, { a, b }); return b
})
await t('結果を画像に保存（1080x1350・ダウンロードされる）', async () => {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.click('#bSave')])
  const path = ROOT + '/shots/13-card.png'; await dl.saveAs(path)
  const r = await p.evaluate(async () => { const c = rd.buildCard(); const x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 97) { const v = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; s += v; s2 += v * v; n++ } return { w: c.width, h: c.height, v: Math.round(s2 / n - (s / n) ** 2) } })
  expect(dl.suggestedFilename() === 'redelivery-dash.png' && r.w === 1080 && r.h === 1350 && r.v > 500, r); return { file: dl.suggestedFilename(), ...r }
})
await t('Xでポスト: 日本語（ボタンが見える・x.com/intent/post・本文に受け取り数と称号とハッシュタグ・url=公開URL）', async () => {
  const r = await xStub(p, 'rd', PUB, '#再配達はイヤだ')
  const n = await p.evaluate(() => [document.querySelector('#nGot').textContent, document.querySelector('#hTitle').textContent])
  expect(r.label === 'Xでポスト' && r.text.includes('3個中' + n[0] + '個') && r.text.includes('「' + n[1] + '」'), { r, n }); return r.text
})
await t('Xでポスト: 本物のクリックで新しいタブが開く', async () => { const tx = await xPopup(p, PUB); expect(/#再配達はイヤだ/.test(tx), tx); return tx.length })
await t('Xでポスト: 英語', async () => {
  await p.click('#bLang')
  const r = await xStub(p, 'rd', PUB, '#DontLeaveDeliveryGuy')
  const n = await p.evaluate(() => [document.querySelector('#nGot').textContent, document.querySelector('#hTitle').textContent])
  await p.screenshot({ path: ROOT + '/shots/12-result-en-x.png' })
  await p.click('#bLang')
  expect(r.label === 'Post on X' && r.text.includes(n[0] + '/3') && r.text.includes(n[1]) && !/[ぁ-んァ-ン一-龥]/.test(r.text), { r, n }); return r.text
})
await t('もう一回ですぐ遊べる（ステージ1から・前の結果は消える）', async () => {
  await p.click('#bAgain'); const r = await p.evaluate(() => ({ idx: rd.S.idx, mode: rd.S.mode, res: rd.S.results.length, view: rd.S.view })); expect(r.idx === 0 && r.mode === 'intro' && r.res === 0 && r.view === 'play', r); return r
})

// ---------- 採点の再現性と難しさ（台本のボット）
await t('コースは同じ種なら同じ・違う種なら違う', async () => {
  const r = await p.evaluate(() => { const a = JSON.stringify(rd.genCourse(rd.D.STAGES[2], 1234).map(o => [o.k, o.lane, +o.d.toFixed(2)])), b = JSON.stringify(rd.genCourse(rd.D.STAGES[2], 1234).map(o => [o.k, o.lane, +o.d.toFixed(2)])), c = JSON.stringify(rd.genCourse(rd.D.STAGES[2], 999).map(o => [o.k, o.lane, +o.d.toFixed(2)])); return { same: a === b, diff: a !== c } }); expect(r.same && r.diff, r)
})
await t('どのコースも必ずよけられる（全部のレーンを段ボールがふさぐ所がない・間隔が詰まりすぎない）', async () => {
  const r = await p.evaluate(() => { let bad = 0, n = 0; for (let s = 1; s <= 300; s++) for (const st of rd.D.STAGES) { const obs = rd.genCourse(st, s); n++; for (const o of obs) { const tall = obs.filter(q => q.t === 'tall' && Math.abs(q.d - o.d) < 1.2); if (new Set(tall.map(q => q.lane)).size >= 3) bad++ } const ds = [...new Set(obs.map(o => +o.d.toFixed(1)))].sort((a, b) => a - b); for (let i = 1; i < ds.length; i++) if (ds[i] - ds[i - 1] > 0.5 && ds[i] - ds[i - 1] < 5.5) bad++ } return { bad, n } }); expect(r.bad === 0, r); return r
})
await t('同じ種・同じボットなら結果が同じ（採点の再現性）', async () => {
  const r = await p.evaluate(() => [JSON.stringify(rd.simulate('normal', 42)), JSON.stringify(rd.simulate('normal', 42))]); expect(r[0] === r[1], r); return JSON.parse(r[0]).title
})
const dist = await p.evaluate(() => {
  const out = {}
  for (const k of ['good', 'normal', 'sloppy', 'none']) { const tally = { oni: 0, ace: 0, giri: 0, rusu: 0, col: 0 }; let got = 0, hits = 0; for (let s = 1; s <= 100; s++) { const r = rd.simulate(k, s); tally[r.title]++; got += r.got; hits += r.hits } out[k] = { tally, got: got / 100, hits: hits / 100 } }
  return out
})
notes.push('bots(100 runs each) ' + JSON.stringify(dist))
await t('難しさ: 上手いは最高ランク「玄関の鬼」がたまに（15〜35%）、ほぼ受け取れる', async () => { const d = dist.good; expect(d.tally.oni >= 15 && d.tally.oni <= 35 && d.got >= 2.3, d); return d })
await t('難しさ: ふつうは中間（ギリ在宅・居留守が一番多い）', async () => { const d = dist.normal, mid = d.tally.giri + d.tally.rusu; expect(mid >= 45 && d.tally.oni <= 10 && d.got > 1 && d.got < 2.4, d); return d })
await t('難しさ: 雑は低い（不在票コレクター・居留守が大半）', async () => { const d = dist.sloppy; expect(d.tally.col + d.tally.rusu >= 80 && d.tally.oni === 0, d); return d })
await t('難しさ: 何もしないと全部不在票', async () => { const d = dist.none; expect(d.tally.col === 100, d); return d })
await t('称号の判定（境界）', async () => {
  const r = await p.evaluate(() => { const R = (oks, hits) => rd.titleOf(oks.map((ok, i) => ({ ok, hits: hits[i] }))).id; return [R([1, 1, 1], [0, 0, 0]), R([1, 1, 1], [0, 1, 0]), R([1, 1, 0], [0, 0, 0]), R([1, 0, 0], [0, 0, 0]), R([0, 0, 0], [0, 0, 0])] })
  expect(r.join() === 'oni,ace,giri,rusu,col', r); return r
})

// ---------- 英語
await t('英語に切り替えると全部英語（タイトル・結果・カード）', async () => {
  await p.evaluate(() => { rd.dbg.pause(true); rd.S.results = [{ ok: false, hits: 3, item: -1 }, { ok: true, hits: 0, item: 4 }, { ok: false, hits: 5, item: -1 }]; rd.showResult(); rd.dbg.step(60 * 4) })
  await p.click('#bLang')
  const r = await p.evaluate(() => ({ lang: document.documentElement.lang, title: document.querySelector('#hTitle').textContent, btn: document.querySelector('#bAgain').textContent.trim(), row: document.querySelector('.sRow .it').textContent, jp: /[ぁ-んァ-ン一-龥]/.test(document.querySelector('#vResult').innerText) }))
  await p.evaluate(() => rd.dbg.pause(false)); await p.waitForTimeout(500); await p.screenshot({ path: ROOT + '/shots/14-result-en.png' })
  const png = await p.evaluate(async () => { await rd.cardFonts(); return rd.buildCard().toDataURL('image/png') }); writeFileSync(ROOT + '/shots/15-card-en.png', Buffer.from(png.split(',')[1], 'base64'))
  const o = await overflow(p)
  expect(r.lang === 'en' && r.title === 'NATURAL NO-SHOW' && r.btn === 'PLAY AGAIN' && !r.jp && o.sw <= o.W && !o.bad.length, { r, o }); return r
})
await t('英語のまま遊べる（導入の文が英語）', async () => {
  await p.click('#bAgain'); await p.waitForTimeout(900); const s = await p.textContent('#inSit'); expect(s === 'Mid boss fight', s); await p.screenshot({ path: ROOT + '/shots/16-intro-en.png' }); return s
})
await t('音: 曲・効果音を鳴らしてもエラーなし・音が出ている', async () => {
  const r = await p.evaluate(async () => { const S = rd.Snd; S.init(); for (const n of ['tap', 'ding', 'go', 'jump', 'slide', 'lane', 'step', 'land', 'lego', 'cat', 'trip', 'crash', 'cloth', 'laundry', 'vacuum', 'warn', 'knock', 'door', 'hai', 'fanfare', 'paper', 'sad', 'truck', 'drum', 'stamp', 'reveal', 'boo']) S.sfx(n); await new Promise(r => setTimeout(r, 300)); return { lvl: S.level(), state: S.ctx && S.ctx.state, n: Object.keys(S.played).length } })
  expect(p.errs.length === 0 && (r.lvl > 0.01 || r.state !== 'running'), { r, e: p.errs }); return r
})
await t('通しでエラーが出ていない', async () => { expect(p.errs.length === 0, p.errs.join('|')) })
await p.close()

// ---------- 6サイズ × 全画面で一画面に収まる
for (const [w, h, name] of SIZES) {
  for (const touch of (w < 900 ? [false, true] : [false])) {
    const q = await open(browser, { viewport: { width: w, height: h }, ...(touch ? { hasTouch: true, isMobile: true } : {}) })
    const tag = name + (touch ? '-touch' : '')
    const views = {}
    views.title = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${tag}-title.png` })
    await q.click('#bHow'); views.how = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${tag}-how.png` }); await q.click('#bHowBack')
    await q.click('#bPlay'); await q.waitForTimeout(1100); views.intro = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${tag}-intro.png` })
    await q.evaluate(() => { rd.dbg.pause(true); rd.dbg.step(150); rd.dbg.step(100); rd.dbg.render() }); views.run = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${tag}-run.png` })
    await q.evaluate(() => { rd.dbg.pause(false) }); await q.click('#bPause'); views.pause = await fit(q, true); await q.click('#bResume')
    await q.evaluate(() => { rd.dbg.pause(true); rd.R.obs.forEach(o => o.hit = true); rd.P.d = rd.R.st.len - 0.3; rd.dbg.step(120); rd.dbg.render() }); views.outcome = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${tag}-outcome.png` })
    await q.evaluate(() => { rd.S.results = [{ ok: true, hits: 0, item: 1 }, { ok: false, hits: 2, item: -1 }, { ok: true, hits: 1, item: 8 }]; rd.showResult(); rd.dbg.step(60 * 4); rd.dbg.pause(false) }); await q.waitForTimeout(600)
    views.result = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${tag}-result.png` })
    const clipJa = await btnClip(q)
    await q.click('#bLang'); await q.waitForTimeout(200); views.resultEn = await fit(q); const clipEn = await btnClip(q); await q.screenshot({ path: `${ROOT}/shots/fit-${tag}-result-en.png` }); await q.click('#bLang')
    await t(`${tag}: 結果画面のボタンの文字が切れない（日英）`, async () => { expect(!clipJa.length && !clipEn.length, [clipJa, clipEn]) })
    for (const [v, r] of Object.entries(views)) await t(`一画面に収まる ${tag} ${w}x${h} ${v}`, async () => { expect(!r.over.length, r) })
    await t(`${tag}: はみ出し・エラーなし`, async () => { const o = await overflow(q); expect(o.sw <= o.W && !o.bad.length && !q.errs.length, JSON.stringify(o) + q.errs.join('|')) })
    await q.close()
  }
}
await browser.close()

// ---------- WebKit（iPhone 相当）でタッチの通し
const wb = await webkit.launch(), wp = await open(wb, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await t('WebKit: 2本指の touchmove を止める', async () => {
  const r = await wp.evaluate(() => { const e = new Event('touchmove', { cancelable: true, bubbles: true }); Object.defineProperty(e, 'touches', { value: [{}, {}] }); document.body.dispatchEvent(e); return e.defaultPrevented })
  expect(r, r)
})
await t('WebKit: スマホ向けの遊び方（ボタンとスワイプ）', async () => { await wp.tap('#bHow'); const s = await wp.textContent('#ctrlLine'); await wp.tap('#bHowBack'); expect(/スワイプ/.test(s), s); return s })
await t('WebKit: タップで始まり、画面ボタンで左右・ジャンプ・スライド', async () => {
  await wp.tap('#bPlay'); await wp.waitForFunction(() => rd.S.mode === 'run', null, { timeout: 6000 })
  await wp.tap('#bL'); const a = await wp.evaluate(() => rd.P.lane)
  await wp.tap('#bJ'); await wp.waitForTimeout(120); const y = await wp.evaluate(() => rd.P.y + rd.P.stun)
  await wp.waitForTimeout(700); await wp.tap('#bR'); await wp.tap('#bR'); const b = await wp.evaluate(() => rd.P.lane)
  await wp.tap('#bS'); const s = await wp.evaluate(() => rd.P.slide + rd.P.stun)
  expect(a === 0 && y > 0 && b === 2 && s > 0, { a, y, b, s }); return { a, y: +y.toFixed(2), b, s: +s.toFixed(2) }
})
await t('WebKit: スワイプでもよけられる（左スワイプで左へ）', async () => {
  const r = await wp.evaluate(() => {
    const before = rd.P.lane, fire = (type, x, y) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }))
    fire('pointerdown', 220, 400); fire('pointermove', 200, 402); fire('pointermove', 150, 404); fire('pointerup', 150, 404)
    return { before, after: rd.P.lane }
  })
  expect(r.after === r.before - 1 || (r.before === 0 && r.after === 0), r); return r
})
await t('WebKit: 3D が描けている', async () => { const v = await glVariance(wp); expect(v > 200, v); return v })
await wp.screenshot({ path: ROOT + '/shots/20-webkit-run.png' })
await t('fps（WebKit・iPhone相当・走行中）', async () => { await wp.waitForTimeout(1500); const f = await wp.evaluate(() => rd.fps()); notes.push('fps webkit ' + f.toFixed(1)); expect(f > 20, f); return +f.toFixed(1) })
await t('WebKit: 結果カードを作れる', async () => { const r = await wp.evaluate(async () => { rd.S.results = [{ ok: true, hits: 0, item: 2 }, { ok: true, hits: 0, item: 5 }, { ok: true, hits: 0, item: 7 }]; rd.showResult(); rd.dbg.step(260); await rd.cardFonts(); const c = rd.buildCard(); return [c.width, c.height, document.querySelector('#hTitle').textContent] }); expect(r[0] === 1080 && r[2] === '玄関の鬼', r); return r })
await wp.waitForTimeout(500); await wp.screenshot({ path: ROOT + '/shots/21-webkit-result.png' })
await t('WebKit: エラーなし', async () => { expect(wp.errs.length === 0, wp.errs.join('|')) })
await wb.close()
server.kill()
console.log(results.join('\n'))
console.log('\n' + notes.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
