const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const vm = require("node:vm")

const source = readFileSync(path.join(__dirname, "..", "youtube-list-view", "shorts-main.js"), "utf8")

function mountShelf({ pathname = "/feed/subscriptions", expanded = true } = {}) {
  let frames = []
  let notifyMutation
  const windowEvents = new Map()
  const documentEvents = new Map()
  const contents = Array.from({ length: 18 }, (_, id) => ({ id }))
  const attributes = new Set()

  const shelf = {
    isConnected: true,
    hasShorts: true,
    isExpanded: expanded,
    data: { isExpanded: expanded },
    contents,
    displayedContents: contents.slice(),
    nativeCollapses: 0,
    querySelector(selector) {
      if (selector.includes("ytm-shorts-lockup")) return this.hasShorts ? {} : null
      return { textContent: this.hasShorts ? "Shorts" : "Más relevantes" }
    },
    set(name, value) { this[name] = value },
    setAttribute(name) { attributes.add(name) },
    removeAttribute(name) { attributes.delete(name) },
    collapseShelf() {
      this.nativeCollapses++
      this.isExpanded = false
      this.data.isExpanded = false
      this.displayedContents = this.contents.slice(0, 5)
    },
  }

  const document = {
    documentElement: { getAttribute: () => "list" },
    querySelectorAll: () => [shelf],
    addEventListener(name, callback) { documentEvents.set(name, callback) },
  }

  const window = {
    addEventListener(name, callback) { windowEvents.set(name, callback) },
  }

  class MutationObserver {
    constructor(callback) { notifyMutation = callback }
    observe() {}
  }

  vm.runInNewContext(source, {
    window, document, location: { pathname }, MutationObserver,
    requestAnimationFrame(callback) { frames.push(callback) },
    queueMicrotask() {},
    setTimeout() {},
  })

  function flushFrames() {
    for (let i = 0; frames.length && i < 20; i++) {
      const pending = frames
      frames = []
      pending.forEach(callback => callback())
    }
    assert.equal(frames.length, 0, "shelf processing must settle")
  }

  function click(id) {
    const button = { id, closest: () => shelf }
    documentEvents.get("click")({ target: { closest: () => button } })
  }

  return { shelf, attributes, flushFrames, click, notifyMutation: () => notifyMutation(),
    navigate: () => windowEvents.get("yt-navigate-finish")() }
}

test("an initially expanded Shorts shelf returns to nine cards", () => {
  const view = mountShelf()
  view.flushFrames()
  assert.equal(view.shelf.displayedContents.length, 9)
  assert.equal(view.shelf.nativeCollapses, 1)
  assert.ok(view.attributes.has("data-yslv-shorts-collapsed"))

  // YouTube may replace the contents and expand the same component again.
  view.shelf.contents = Array.from({ length: 18 }, (_, id) => ({ id: `new-${id}` }))
  view.shelf.displayedContents = view.shelf.contents.slice()
  view.shelf.isExpanded = true
  view.shelf.data.isExpanded = true
  view.notifyMutation()
  view.flushFrames()
  assert.equal(view.shelf.nativeCollapses, 2)
  assert.deepEqual(Array.from(view.shelf.displayedContents), view.shelf.contents.slice(0, 9))
})

test("Mostrar más is respected, and a same-page navigation collapses again", () => {
  const view = mountShelf({ expanded: false })
  view.flushFrames()
  view.click("show-more-button")
  view.shelf.isExpanded = true
  view.shelf.data.isExpanded = true
  view.shelf.displayedContents = view.shelf.contents.slice()
  view.notifyMutation()
  view.flushFrames()
  assert.equal(view.shelf.displayedContents.length, 18)
  assert.equal(view.attributes.has("data-yslv-shorts-collapsed"), false)

  view.navigate()
  view.flushFrames()
  assert.equal(view.shelf.displayedContents.length, 9)
  assert.ok(view.attributes.has("data-yslv-shorts-collapsed"))
})

test("the native Mostrar menos action restores the nine-card limit", () => {
  const view = mountShelf({ expanded: false })
  view.flushFrames()
  view.click("show-more-button")
  view.shelf.isExpanded = true
  view.shelf.data.isExpanded = true
  view.click("show-less-button")
  view.shelf.collapseShelf()
  view.flushFrames()
  assert.equal(view.shelf.displayedContents.length, 9)
  assert.ok(view.attributes.has("data-yslv-shorts-collapsed"))
})

test("the Shorts controller does not modify shelves on video pages", () => {
  const view = mountShelf({ pathname: "/watch" })
  view.flushFrames()
  assert.equal(view.shelf.displayedContents.length, 18)
  assert.equal(view.attributes.has("data-yslv-shorts-collapsed"), false)
})

test("a shelf reused for other content loses the Shorts-only styling", () => {
  const view = mountShelf({ expanded: false })
  view.flushFrames()
  assert.ok(view.attributes.has("data-yslv-shorts-collapsed"))
  view.shelf.hasShorts = false
  view.notifyMutation()
  view.flushFrames()
  assert.equal(view.attributes.has("data-yslv-shorts-collapsed"), false)
})
