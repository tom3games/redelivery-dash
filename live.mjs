// 公開URLの確認。node live.mjs（ログインしていないブラウザで見る）。SKIPGH=1 で GitHub ページの確認を省く
import { chromium, webkit } from 'playwright'
const URL0 = 'https://tom3games.github.io/redelivery-dash/'
const ID = ['tmk', '4men'].join('') // 公開物に出てはいけない個人のID（文字列を分けて持つ）
const out = []
for (const [name, bt, opts] of [['chromium', chromium, {}], ['webkit', webkit, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const b = await bt.launch(), ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts }), p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  p.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errs.push('fail ' + r.url()) })
  await p.goto(URL0 + '?t=' + Date.now(), { waitUntil: 'networkidle' })
  await p.waitForFunction(() => window.__rdReady, null, { timeout: 20000 })
  // 遊びの通し: あそぶ → 走る → 玄関（結果発表まで）
  await (opts.hasTouch ? p.tap('#bPlay') : p.click('#bPlay'))
  await p.waitForFunction(() => rd.S.mode === 'run', null, { timeout: 8000 })
  await p.waitForTimeout(1500)
  const run = await p.evaluate(() => ({ d: +rd.P.d.toFixed(1), fps: +rd.fps().toFixed(1) }))
  await p.evaluate(() => { rd.dbg.pause(true); for (let i = 0; i < 3; i++) { rd.R.obs.forEach(o => o.hit = true); rd.P.d = rd.R.st.len - 0.3; rd.dbg.step(30); rd.nextStage(); rd.dbg.step(150) } rd.dbg.step(300); rd.dbg.pause(false) })
  await p.waitForTimeout(600)
  const res = await p.evaluate(() => ({ view: rd.S.view, title: document.querySelector('#hTitle').textContent }))
  await p.screenshot({ path: `shots/live-${name}.png` })
  const og = await p.evaluate(async () => { const r = await fetch(document.querySelector('meta[property="og:image"]').content); return r.status + ' ' + r.headers.get('content-type') })
  out.push(`${name}: run=${JSON.stringify(run)} result=${JSON.stringify(res)} og=${og} errors=${errs.length ? errs.join(' | ') : 'none'}`)
  await b.close()
}
if (process.env.SKIPGH) { console.log(out.join('\n')); process.exit(0) }
// ログアウト状態でリポジトリ・更新履歴に個人のIDが出ていないか
const b = await chromium.launch(), p = await b.newPage()
for (const u of ['https://github.com/tom3games/redelivery-dash', 'https://github.com/tom3games/redelivery-dash/commits/main', 'https://github.com/tom3games/redelivery-dash/activity']) {
  const res = await p.goto(u, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500)
  out.push(`${u} status=${res.status()} personal-id=${new RegExp(ID, 'i').test(await p.content()) ? 'FOUND' : 'none'}`)
}
await b.close()
console.log(out.join('\n'))
