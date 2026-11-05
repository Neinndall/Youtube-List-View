const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const source = readFileSync(path.join(__dirname, '../youtube-list-view/content.js'), 'utf8')

function fixture() {
  const state = { active: false, view: 'list', hideMostRelevant: false, activationId: 0 }
  let subscriptions = true, resizes = 0, enqueues = 0, observer, resets = 0, saved = 0
  const storage = []
  const timers = []
  const noop = () => {}
  const context = vm.createContext({
    STATE: state,
    isContextValid: () => true,
    ensureDescStoreLoaded: async () => {},
    chrome: { runtime: {}, storage: { local: { get: (_, callback) => storage.push(callback) } } },
    document: { documentElement: { getAttribute: () => 'list', hasAttribute: () => false,
      setAttribute() {}, removeAttribute() {} }, querySelector: () => ({}) },
    CFG: { attr: { view: 'data-yslv-subs-view' } },
    isSubsPage: () => subscriptions,
    pageSig: () => subscriptions ? '/feed/subscriptions' : '/',
    loadView: () => 'list',
    prepareRelevantHideTransition: () => false,
    enqueueAllOnce: () => enqueues++,
    // Represents the old implementation's global synthetic resize.
    triggerReflow: () => resizes++,
    MutationObserver: class { constructor(callback) { observer = callback } observe() {} },
    setTimeout: callback => timers.push(callback),
    saveSettingsCache: () => saved++, processSections: noop, applyDynamicSettings: noop,
    pruneDescStore: noop, ensureToggleMountLoop: noop, attachObserver: noop,
    attachPageManagerObserver: noop, ensureDescQueueLoop: noop, startShimmer: noop,
    stopShimmer: noop, applyViewAttr: noop, paintToggle: noop, teardown: noop,
    resetNavState: () => resets++, scheduleRelevantHeaderAlignment: noop,
  })
  vm.runInContext(source.slice(source.indexOf('  async function apply()'), source.indexOf('  function init()')), context)
  return { state, context, timers, storage, navigate: value => { subscriptions = value; context.syncActive(true) },
    get resizes() { return resizes }, get enqueues() { return enqueues },
    get resets() { return resets }, get saved() { return saved },
    pageManager() {
      vm.runInContext(source.slice(source.indexOf('  function attachPageManagerObserver()'), source.indexOf('  function restoreMovedAvatars()')), context)
      context.attachPageManagerObserver()
      observer()
      timers.splice(0).forEach(callback => callback())
    },
  }
}

test('Home → Subscriptions → Home → Subscriptions processes cards without synthetic window resizes', async () => {
  const f = fixture()
  f.navigate(true)
  await new Promise(setImmediate)
  f.navigate(false)
  f.navigate(true)
  await new Promise(setImmediate)
  assert.equal(f.enqueues, 2)
  assert.equal(f.resizes, 0)
})

test('a repeated subscription navigation requeues cards without resetting native thumbnail layout', () => {
  const f = fixture()
  f.state.active = true
  f.navigate(true)
  assert.equal(f.enqueues, 1)
  assert.equal(f.resizes, 0)
  assert.equal(f.resets, 0, 'a repeated finish must preserve pending work and header alignment')
})

test('a delayed settings response from an earlier activation is ignored after leaving and returning', async () => {
  const f = fixture()
  f.navigate(true)
  await new Promise(setImmediate)
  f.navigate(false)
  f.navigate(true)
  await new Promise(setImmediate)
  assert.equal(f.storage.length, 2)
  f.storage[0]({ thumbW: 390 })
  assert.equal(f.saved, 0)
  assert.equal(f.state.thumbW, undefined)
  f.storage[1]({ thumbW: 260 })
  assert.equal(f.state.thumbW, 260)
  assert.equal(f.saved, 1)
})

test('a delayed description-store read cannot activate a previous navigation twice', async () => {
  const f = fixture()
  const reads = []
  f.context.ensureDescStoreLoaded = () => new Promise(resolve => reads.push(resolve))
  f.navigate(true)
  f.navigate(false)
  f.navigate(true)
  reads[0]()
  await new Promise(setImmediate)
  assert.equal(f.enqueues, 0)
  reads[1]()
  await new Promise(setImmediate)
  assert.equal(f.enqueues, 1)
})

test('page manager updates process new subscription cards without another global resize', () => {
  const f = fixture()
  f.state.active = true
  f.pageManager()
  assert.equal(f.enqueues, 1)
  assert.equal(f.resizes, 0)
})
