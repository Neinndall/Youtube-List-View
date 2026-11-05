const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const vm = require("node:vm")

const source = readFileSync(path.join(__dirname, "..", "youtube-list-view", "content.js"), "utf8")
const avatarCode = source.slice(source.indexOf("  function moveAvatarToHeaderOnce("), source.indexOf("  function ensureRowHeader("))
const restoreCode = source.slice(source.indexOf("  function restoreMovedAvatars("), source.indexOf("  function restoreMovedNodes("))

function fixture() {
  const state = { active: true, view: "list", movedAvatars: new WeakMap() }
  const queued = []
  const head = {
    firstChild: null,
    insertBefore(node) {
      if (this.fail) throw new Error("detached header")
      node.parentNode = this
      this.firstChild = node
    },
  }
  const parent = {
    insertBefore(node) { node.parentNode = this },
    appendChild(node) { node.parentNode = this },
  }
  const item = { subscriptions: true, contains: node => node === parent }
  let nativeAvatar
  const lockup = { querySelector: () => nativeAvatar?.parentNode === parent ? nativeAvatar : null }
  function avatar(images = [{ complete: false, naturalWidth: 0 }]) {
    const node = {
      images, parentNode: parent, nextSibling: null, isConnected: true,
      querySelectorAll: () => images,
      closest: () => null,
      remove() { this.parentNode = null; this.isConnected = false },
    }
    nativeAvatar = node
    return node
  }
  const context = vm.createContext({
    STATE: state, CFG: { cls: { rowHead: "yslv-subs-rowhead" } },
    isSubscriptionsCard: node => node.subscriptions,
    enqueue: node => queued.push(node),
    document: { querySelectorAll: () => [item] },
  })
  vm.runInContext(avatarCode + restoreCode, context)
  return { state, queued, head, parent, item, avatar,
    move: () => context.moveAvatarToHeaderOnce(item, lockup, head),
    load: (target) => context.onAvatarImageLoad({ target }),
    restore: () => context.restoreMovedAvatars(),
  }
}

test("an offscreen avatar stays in its native host until its image finishes loading", () => {
  const f = fixture()
  const avatar = f.avatar()
  assert.equal(f.move(), null)
  assert.equal(avatar.parentNode, f.parent)
  assert.equal(f.state.movedAvatars.has(f.item), false)
  avatar.images[0].complete = true
  avatar.images[0].naturalWidth = 48
  assert.equal(f.move(), avatar)
  assert.equal(avatar.parentNode, f.head)
  assert.equal(f.move(), avatar)
  f.restore()
  assert.equal(avatar.parentNode, f.parent)
})

test("empty hosts, failed images and partially loaded collaborator stacks are deferred", () => {
  const f = fixture()
  for (const images of [[], [{ complete: true, naturalWidth: 0 }],
    [{ complete: true, naturalWidth: 48 }, { complete: false, naturalWidth: 0 }]]) {
    const avatar = f.avatar(images)
    assert.equal(f.move(), null)
    assert.equal(avatar.parentNode, f.parent)
  }
})

test("a native replacement supersedes the cached avatar after SPA hydration", () => {
  const f = fixture()
  const old = f.avatar([{ complete: true, naturalWidth: 48 }])
  f.move()
  const replacement = f.avatar()
  assert.equal(f.move(), null)
  assert.equal(old.parentNode, f.head)
  replacement.images[0] = { complete: true, naturalWidth: 48 }
  assert.equal(f.move(), replacement)
  assert.equal(old.parentNode, null)
  assert.equal(f.state.movedAvatars.get(f.item).avatarEl, replacement)
})

test("a failed DOM move is retried instead of being permanently cached", () => {
  const f = fixture()
  const avatar = f.avatar([{ complete: true, naturalWidth: 48 }])
  f.head.fail = true
  assert.equal(f.move(), null)
  assert.equal(f.state.movedAvatars.has(f.item), false)
  f.head.fail = false
  assert.equal(f.move(), avatar)
})

test("late image loads enqueue only subscription cards in list view", () => {
  const f = fixture()
  const target = { tagName: "IMG", closest: selector => selector === "ytd-rich-item-renderer" ? f.item : null }
  f.load(target)
  assert.deepEqual(f.queued, [f.item])
  f.state.view = "grid"
  f.load(target)
  f.state.view = "list"
  f.item.subscriptions = false
  f.load(target)
  f.item.subscriptions = true
  f.state.active = false
  f.load(target)
  f.state.active = true
  f.load({ ...target, closest: () => f.item }) // Already inside our header.
  assert.equal(f.queued.length, 1)
})

test("restoring grid view does not move an avatar into a discarded native parent", () => {
  const f = fixture()
  const avatar = f.avatar([{ complete: true, naturalWidth: 48 }])
  f.move()
  f.item.contains = () => false
  f.restore()
  assert.equal(avatar.parentNode, f.head)
  assert.equal(f.state.movedAvatars.has(f.item), false)
})
