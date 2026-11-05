const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const source = readFileSync(path.join(__dirname, '../youtube-list-view/content.js'), 'utf8')
function code(name) {
  const start = source.search(new RegExp('  (?:async )?function ' + name + '\\('))
  assert.ok(start >= 0, name)
  return source.slice(start, source.indexOf('\n  }', start) + 4)
}
function run(names, globals) {
  const context = vm.createContext(globals)
  vm.runInContext(names.map(code).join('\n'), context)
  return context
}

test('reset preserves the real in-flight request count and the running description pump', () => {
  const pending = Promise.resolve('description')
  const state = { q: [], qSet: new Set(), descInFlight: new Map([['video', pending]]),
    descCache: new Map(), descFetches: 3, descActive: 1, descQueue: ['next'], descQueued: new Set(['next']),
    descPumpRunning: true, lastQueueSig: 'video|' }
  const c = run(['resetNavState'], { STATE: state, clearRelevantHeaderAlignment() {} })
  c.resetNavState()
  assert.equal(state.descActive, 1)
  assert.equal(state.descInFlight.get('video'), pending)
  assert.equal(state.descPumpRunning, true)
  assert.equal(state.descQueue.length, 0)
})

test('toggle mount retries share one timer and stop after the toggle appears', () => {
  let present = false, nextId = 0
  const timers = new Map()
  const state = { active: true, toggleTimer: 0 }
  const c = run(['ensureToggleMountLoop'], {
    STATE: state, CFG: { ids: { toggle: 'toggle' } }, ensureToggle() {},
    document: { getElementById: () => present ? {} : null }, findToggleMountAnchor: () => null,
    setTimeout: callback => { timers.set(++nextId, callback); return nextId },
    clearTimeout: id => timers.delete(id),
  })
  for (let n = 0; n < 20; n++) c.ensureToggleMountLoop()
  assert.equal(timers.size, 1)
  present = true
  c.ensureToggleMountLoop()
  assert.equal(timers.size, 0)
})

test('an unchanged channel name does not recreate its DOM text node', () => {
  let cleared = 0, written = 0
  const node = { textContent: 'Channel' }
  Object.defineProperty(node, 'textContent', { get: () => 'Channel', set: () => written++ })
  const c = run(['setTextOnly'], { normalizeText: s => s.trim(), clearChildren: () => cleared++ })
  c.setTextOnly(node, ' Channel ')
  assert.equal(cleared + written, 0)
})

test('a zero channel/video gap survives the synchronous settings cache', () => {
  let cached
  const c = run(['saveSettingsCache'], { SETTINGS_CACHE_KEY: 'settings',
    localStorage: { setItem: (_, value) => { cached = JSON.parse(value) } } })
  c.saveSettingsCache({ channelVideoGap: 0 })
  assert.equal(cached.channelVideoGap, 0)
})

test('completed descriptions never mutate the cached subscription DOM while Home is active', () => {
  let queries = 0
  const c = run(['updateDescDomForVid'], { STATE: { active: false, view: 'list' },
    CFG: { cls: { desc: 'description' } },
    document: { querySelectorAll: () => { queries++; return [] } }, CSS: { escape: s => s } })
  c.updateDescDomForVid('video', 'description')
  assert.equal(queries, 0)
})

test('extension text/description updates do not trigger another full feed scan', () => {
  let scanned = 0, notified
  const native = { nodeType: 1, closest: () => null }
  const generated = { nodeType: 1, closest: () => generated }
  const state = { active: true, view: 'list', mo: null }
  const c = run(['isGeneratedUi', 'isOwnUiMutation', 'attachObserver'], {
    STATE: state, CFG: { ids: { toggle: 'toggle' }, cls: { rowHead: 'head', metaRow: 'meta', desc: 'description' } },
    getActiveSubsBrowse: () => native,
    MutationObserver: class { constructor(callback) { notified = callback } observe() {} },
    processSections: () => scanned++, ensureToggle() {}, enqueue() {},
  })
  c.attachObserver()
  notified([{ type: 'childList', target: generated, addedNodes: [native], removedNodes: [] }])
  notified([{ type: 'childList', target: native, addedNodes: [generated], removedNodes: [] }])
  assert.equal(scanned, 0)
  notified([{ type: 'childList', target: native, addedNodes: [native], removedNodes: [] }])
  assert.equal(scanned, 1, 'native hydration must still be processed')
})

test('an in-flight description is deduplicated across a reset and finishes with an accurate count', async () => {
  let requests = 0, finish
  const state = { q: [], qSet: new Set(), descInFlight: new Map(), descCache: new Map(),
    descFetches: 0, descActive: 0, descQueue: [], descQueued: new Set(), descPumpRunning: true }
  const c = run(['fetchDescriptionForVideoId', 'resetNavState'], {
    STATE: state, CFG: { list: { descFetch: { enabled: true, maxTotalFetchesPerNav: 60, maxConcurrent: 1 } } },
    getStoredDesc: () => null, setStoredDesc() {}, clearRelevantHeaderAlignment() {},
    summarizeDesc: text => text,
    fetch: () => { requests++; return new Promise(resolve => finish = resolve) }, setTimeout,
  })
  const first = c.fetchDescriptionForVideoId('video')
  c.resetNavState()
  const second = c.fetchDescriptionForVideoId('video')
  assert.equal(requests, 1)
  finish({ ok: true, text: async () => 'ytInitialPlayerResponse = {"videoDetails":{"shortDescription":"Description"}};' })
  assert.deepEqual(await Promise.all([first, second]), ['Description', 'Description'])
  assert.equal(state.descActive, 0)
  assert.equal(state.descInFlight.size, 0)
})
