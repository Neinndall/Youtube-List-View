;(() => {
  "use strict"

  const CFG = {
    storageKey: "yslv",
    defaultView: "grid", // or "list"

    toggleMountSelector:
      'ytd-browse[page-subtype="subscriptions"] ytd-shelf-renderer .grid-subheader #title-container #subscribe-button,' +
      'ytd-two-column-browse-results-renderer[page-subtype="subscriptions"] ytd-shelf-renderer .grid-subheader #title-container #subscribe-button',

    descStore: {
      key: "yslv_desc_cache_v1",
      ttlMs: 60 * 60 * 1000,
      maxEntries: 1200,
      saveDebounceMs: 250,
    },

    list: {
      shorts: {
        enabled: true,
      },

      desc: {
        skeleton: {
          enabled: true,
          lines: 2,
          lineGap: 6,
          lineHeights: [12, 12, 12],
          lineWidthsPct: [82, 74, 58],
          radius: 9,
          maxW: 520,
          animMs: 5000,
        },
      },

      descFetch: {
        enabled: true,
        maxTotalFetchesPerNav: 60,
        maxConcurrent: 1,
        sentenceCount: 2,
        maxChars: 260,
      },
    },

    perf: {
      maxItemsPerTick: 60,
      descQueueIntervalMs: 350,
    },

    ids: {
      toggle: "yslv-subs-toggle",
    },

    cls: {
      rowHead: "yslv-subs-rowhead",
      rowHeadName: "yslv-subs-rowhead-name",
      metaRow: "yslv-subs-mrow",
      metaCh: "yslv-subs-mch",
      metaRt: "yslv-subs-mrt",
      desc: "yslv-subs-desc",
      descSkel: "yslv-subs-desc-skel",
      btn: "yslv-btn",
      btnIcon: "yslv-btn-ic",
      isShort: "yslv-is-short",
    },

    attr: {
      view: "data-yslv-subs-view",
    },

    cssVars: {
      shimmerX: "--yslvSkelX",
    },
  }

  const STATE = {
    active: false,
    view: "grid",
    q: [],
    qSet: new Set(),
    processing: false,

    movedAvatars: new WeakMap(),
    movedMetaAnchors: new WeakMap(),
    movedMenus: new WeakMap(),
    movedAttachments: new WeakMap(),

    mo: null,
    observedTarget: null,

    pmMo: null,

    descCache: new Map(),
    descInFlight: new Map(),
    descFetches: 0,
    descActive: 0,

    descQueue: [],
    descQueued: new Set(),
    descTimer: 0,
    descPumpRunning: false,
    lastQueueSig: "",

    lastPageSig: "",

    hideMostRelevant: false,
    hideShorts: false,
    sectionTimer: 0,

    thumbW: 260,
    rowPadY: 16,
    channelVideoGap: 18,
    containerW: 100,
    channelSize: 20,
    titleSize: 16,
    shortsW: 160,
    shortsGap: 14,
  }

  const SETTINGS_CACHE_KEY = "yslv_settings_cache_v1"

  function loadSettingsCache() {
    try {
      const raw = localStorage.getItem(SETTINGS_CACHE_KEY)
      if (raw) return JSON.parse(raw)
    } catch {}
    return null
  }

  function saveSettingsCache(settings) {
    try {
      const data = {
        hideMostRelevant: !!settings.hideMostRelevant,
        hideShorts: !!settings.hideShorts,
        thumbW: Number(settings.thumbW) || 260,
        rowPadY: Number(settings.rowPadY) || 16,
        channelVideoGap: Number(settings.channelVideoGap) || 18,
        headerGap: settings.headerGap !== undefined && !isNaN(settings.headerGap) ? Number(settings.headerGap) : 6,
        containerW: Number(settings.containerW) || 100,
        channelSize: Number(settings.channelSize) || 20,
        titleSize: Number(settings.titleSize) || 16,
        shortsW: Number(settings.shortsW) || 160,
        shortsGap: Number(settings.shortsGap) || 14,
      }
      localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(data))
    } catch {}
  }

  // Preload settings from cache immediately at document_start
  const _cached = loadSettingsCache()
  if (_cached && typeof _cached === "object") {
    if (_cached.hideMostRelevant !== undefined) STATE.hideMostRelevant = !!_cached.hideMostRelevant
    if (_cached.hideShorts !== undefined) STATE.hideShorts = !!_cached.hideShorts
    if (_cached.thumbW !== undefined) STATE.thumbW = Number(_cached.thumbW)
    if (_cached.rowPadY !== undefined) STATE.rowPadY = Number(_cached.rowPadY)
    if (_cached.channelVideoGap !== undefined) STATE.channelVideoGap = Number(_cached.channelVideoGap)
    if (_cached.headerGap !== undefined) STATE.headerGap = Number(_cached.headerGap)
    if (_cached.containerW !== undefined) STATE.containerW = Number(_cached.containerW)
    if (_cached.channelSize !== undefined) STATE.channelSize = Number(_cached.channelSize)
    if (_cached.titleSize !== undefined) STATE.titleSize = Number(_cached.titleSize)
    if (_cached.shortsW !== undefined) STATE.shortsW = Number(_cached.shortsW)
    if (_cached.shortsGap !== undefined) STATE.shortsGap = Number(_cached.shortsGap)
  }

  const SHIMMER = {
    raf: 0,
    running: false,
    t0: 0,
  }

  const DESC_STORE = {
    obj: null,
    dirty: false,
    saveT: 0,
  }

  function clearChildren(el) {
    if (!el) return
    while (el.firstChild) el.removeChild(el.firstChild)
  }

  function cloneInto(dest, src) {
    if (!dest) return
    clearChildren(dest)
    if (!src) return

    const frag = document.createDocumentFragment()
    for (const n of Array.from(src.childNodes || [])) frag.appendChild(n.cloneNode(true))

    for (const host of Array.from(frag.querySelectorAll?.(".ytIconWrapperHost, .yt-icon-shape") || [])) {
      if (!host.querySelector("svg")) host.remove()
    }

    dest.appendChild(frag)
  }

  function setTextOnly(dest, txt) {
    if (!dest) return
    clearChildren(dest)
    dest.textContent = normalizeText(txt)
  }

  function isContextValid() {
    return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id
  }

  function isSubsPage() {
    return location.pathname === "/feed/subscriptions"
  }

  function getActiveSubsBrowse() {
    return (
      document.querySelector('ytd-page-manager ytd-browse[page-subtype="subscriptions"]:not([hidden])') ||
      document.querySelector('ytd-browse[page-subtype="subscriptions"]:not([hidden])') ||
      null
    )
  }

  function isSubscriptionsCard(item) {
    if (!item || item.nodeType !== 1) return false
    const browse = item.closest?.('ytd-browse[page-subtype="subscriptions"], ytd-two-column-browse-results-renderer[page-subtype="subscriptions"]')
    if (browse) return true
    const active = getActiveSubsBrowse()
    if (active && active.contains(item)) return true
    return false
  }

  function getActiveSubsRoot() {
    const b = getActiveSubsBrowse()
    if (!b) return null
    return b.querySelector("ytd-rich-grid-renderer #contents") || b.querySelector("ytd-rich-grid-renderer") || b
  }

  function getActiveSubsDoc() {
    return getActiveSubsBrowse()
  }

  function normalizeText(s) {
    return String(s || "")
      .replace(/\u200B/g, "")
      .replace(/\s+/g, " ")
      .trim()
  }

  function loadView() {
    try {
      const v = localStorage.getItem(CFG.storageKey)
      return v === "list" || v === "grid" ? v : CFG.defaultView
    } catch {
      return CFG.defaultView
    }
  }

  function saveView(v) {
    try {
      localStorage.setItem(CFG.storageKey, v)
    } catch {}
  }

  function applyViewAttr(v) {
    STATE.view = v
    saveView(v)
    document.documentElement.setAttribute(CFG.attr.view, v)
    paintToggle()
  }

  function clearViewAttr() {
    document.documentElement.removeAttribute(CFG.attr.view)
  }

  function svgEl(paths, viewBox) {
    const NS = "http://www.w3.org/2000/svg"
    const svg = document.createElementNS(NS, "svg")
    svg.setAttribute("viewBox", viewBox || "0 0 24 24")
    svg.setAttribute("aria-hidden", "true")
    for (const d of paths) {
      const p = document.createElementNS(NS, "path")
      p.setAttribute("d", d)
      svg.appendChild(p)
    }
    return svg
  }

  function skNorm() {
    const s = CFG.list.desc.skeleton || {}
    const lines = Math.max(1, Math.min(3, Number(s.lines) || 1))
    const gap = Math.max(0, Number(s.lineGap) || 6)
    const heights = Array.isArray(s.lineHeights) ? s.lineHeights : [12, 12, 12]
    const widths = Array.isArray(s.lineWidthsPct) ? s.lineWidthsPct : [82, 74, 58]
    const h = i => Math.max(10, Number(heights[i] ?? heights[0] ?? 12))
    const w = i => Math.max(35, Math.min(100, Number(widths[i] ?? widths[0] ?? 82)))
    const r = Math.max(6, Number(s.radius) || 9)
    const maxW = Math.max(160, Number(s.maxW) || 520)
    const ms = Math.max(650, Number(s.animMs) || 5000)
    return { enabled: !!s.enabled, lines, gap, h, w, r, maxW, ms }
  }

  function nowMs() {
    return Date.now()
  }

  function ensureDescStoreLoaded() {
    if (DESC_STORE.obj) return
    if (!isContextValid()) {
      DESC_STORE.obj = {}
      return
    }
    return new Promise((resolve) => {
      chrome.storage.local.get([CFG.descStore.key], (result) => {
        let obj = {}
        const raw = result[CFG.descStore.key]
        if (raw && typeof raw === "object") {
          obj = raw
        }
        DESC_STORE.obj = obj
        pruneDescStore()
        resolve()
      })
    })
  }

  function scheduleDescStoreSave() {
    if (DESC_STORE.saveT) return
    DESC_STORE.saveT = setTimeout(() => {
      DESC_STORE.saveT = 0
      if (!DESC_STORE.dirty) return
      if (!isContextValid()) return

      try {
        DESC_STORE.dirty = false
        chrome.storage.local.set({ [CFG.descStore.key]: DESC_STORE.obj || {} }, () => {
          if (chrome.runtime.lastError) {
            console.warn("[YSLV] Storage error:", chrome.runtime.lastError.message)
          }
        })
      } catch (e) {
        console.warn("[YSLV] Failed to save storage:", e)
      }
    }, Math.max(0, Number(CFG.descStore.saveDebounceMs) || 250))
  }

  function pruneDescStore() {
    if (!DESC_STORE.obj) return
    const ttl = Math.max(1, Number(CFG.descStore.ttlMs) || 3600000)
    const maxEntries = Math.max(50, Number(CFG.descStore.maxEntries) || 1200)
    const tNow = nowMs()
    const obj = DESC_STORE.obj || {}
    const entries = []
    for (const k of Object.keys(obj)) {
      const e = obj[k]
      const t = Number(e?.t || 0)
      if (!t || tNow - t >= ttl) {
        delete obj[k]
        DESC_STORE.dirty = true
        continue
      }
      entries.push([k, t])
    }
    if (entries.length > maxEntries) {
      entries.sort((a, b) => a[1] - b[1])
      const drop = entries.length - maxEntries
      for (let i = 0; i < drop; i++) {
        delete obj[entries[i][0]]
        DESC_STORE.dirty = true
      }
    }
    if (DESC_STORE.dirty) scheduleDescStoreSave()
  }

  function getStoredDesc(vid) {
    if (!vid) return null
    if (!DESC_STORE.obj) return null
    const ttl = Math.max(1, Number(CFG.descStore.ttlMs) || 3600000)
    const tNow = nowMs()
    const obj = DESC_STORE.obj || {}
    const e = obj[vid]
    if (!e) return null
    const t = Number(e.t || 0)
    const d = typeof e.d === "string" ? e.d : ""
    if (!t || tNow - t >= ttl) {
      delete obj[vid]
      DESC_STORE.dirty = true
      scheduleDescStoreSave()
      return null
    }
    return d
  }

  function setStoredDesc(vid, desc) {
    if (!vid) return
    if (!DESC_STORE.obj) DESC_STORE.obj = {}
    const obj = DESC_STORE.obj || {}
    obj[vid] = { t: nowMs(), d: String(desc || "") }
    DESC_STORE.dirty = true
    pruneDescStore()
    scheduleDescStoreSave()
  }

  function findToggleMountAnchor() {
    const browse = getActiveSubsBrowse()
    if (!browse) return null

    // 1. Highest priority: The visible #subscribe-button ("Todas las suscripciones")
    const subsButtons = browse.querySelectorAll('#subscribe-button')
    for (const btn of subsButtons) {
      if (btn.isConnected && !btn.closest('.yslv-section-hidden') && !btn.closest('.yslv-shorts-hidden')) {
        return btn
      }
    }

    // 2. Second priority: Button renderer with subscription/manage text
    const allBtns = browse.querySelectorAll('ytd-button-renderer')
    for (const btn of allBtns) {
      if (btn.isConnected && !btn.closest('.yslv-section-hidden') && !btn.closest('.yslv-shorts-hidden')) {
        const txt = (btn.textContent || '').toLowerCase()
        if (txt.includes('suscrip') || txt.includes('subscri') || txt.includes('manage')) {
          return btn
        }
      }
    }

    // 3. Third priority: The actual title-container of the visible latest videos feed
    const titleContainers = browse.querySelectorAll('#title-container, .grid-subheader')
    for (const tc of titleContainers) {
      if (tc.isConnected && !tc.closest('.yslv-section-hidden') && !tc.closest('.yslv-shorts-hidden')) {
        const txt = (tc.textContent || '').toLowerCase()
        if (txt.includes('reciente') || txt.includes('latest') || txt.includes('today') || txt.includes('hoy')) {
          return tc
        }
      }
    }

    return null
  }

  function ensureToggle() {
    const mountAnchor = findToggleMountAnchor()
    if (!mountAnchor) return

    const existing = document.getElementById(CFG.ids.toggle)
    if (existing && existing.isConnected) {
      if (existing.closest('.yslv-section-hidden') || existing.closest('.yslv-shorts-hidden')) {
        existing.remove()
      } else {
        const isNextToAnchor = existing.previousElementSibling === mountAnchor || existing.parentElement === mountAnchor
        if (isNextToAnchor) {
          paintToggle()
          return
        }
        existing.remove()
      }
    }

    document.querySelectorAll(`#${CFG.ids.toggle}`).forEach(n => n.remove())

    const root = document.createElement("div")
    root.id = CFG.ids.toggle

    const mkBtn = (mode, label, svg) => {
      const b = document.createElement("button")
      b.className = CFG.cls.btn
      b.type = "button"
      b.setAttribute("data-mode", mode)
      b.setAttribute("aria-label", label)

      const ic = document.createElement("span")
      ic.className = CFG.cls.btnIcon
      ic.appendChild(svg)
      b.appendChild(ic)

      return b
    }

    const bGrid = mkBtn("grid", "Grid", svgEl(["M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"]))
    const bList = mkBtn(
      "list",
      "List",
      svgEl(["M4 6h3v3H4V6zm5 0h11v3H9V6zM4 11h3v3H4v-3zm5 0h11v3H9v-3zM4 16h3v3H4v-3zm5 0h11v3H9v-3z"])
    )

    root.appendChild(bGrid)
    root.appendChild(bList)

    root.addEventListener("click", e => {
      const btn = e.target?.closest?.("button[data-mode]")
      if (!btn) return
      const mode = btn.getAttribute("data-mode")
      if (mode !== "grid" && mode !== "list") return
      if (mode === STATE.view) return

      if (STATE.view === "list") cleanupListArtifacts()
      resetNavState()
      applyViewAttr(mode)
      attachObserver()
      ensureDescQueueLoop()
      triggerReflow()
      if (mode === "list") {
        enqueueAllOnce()
        startShimmer()
      } else {
        stopShimmer()
      }
    })

    if (mountAnchor.id === "title-container" || mountAnchor.classList?.contains("grid-subheader") || mountAnchor.id === "rich-shelf-header") {
      mountAnchor.appendChild(root)
    } else {
      mountAnchor.insertAdjacentElement("afterend", root)
    }
    paintToggle()
  }

  function removeToggle() {
    const root = document.getElementById(CFG.ids.toggle)
    if (root) root.remove()
  }

  function paintToggle() {
    const root = document.getElementById(CFG.ids.toggle)
    if (!root) return
    root.querySelectorAll("button[data-mode]").forEach(b => {
      const m = b.getAttribute("data-mode")
      if (m === STATE.view) b.setAttribute("data-active", "")
      else b.removeAttribute("data-active")
    })
  }

  function pickChannelDisplaySource(lockup) {
    // Try to find a metadata row that might contain multiple collaborators
    const metaRow =
      lockup.querySelector("yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-row") ||
      lockup.querySelector(".ytContentMetadataViewModelMetadataRow") ||
      lockup.querySelector(".yt-lockup-metadata-view-model__metadata-row") ||
      lockup.querySelector(".ytLockupMetadataViewModelMetadataRow")

    if (metaRow) {
      const links = metaRow.querySelectorAll('a[href^="/@"], a[href^="/channel/"]')
      // If it has multiple channel links or indicators of "more", return the whole row for full text
      if (
        links.length > 1 ||
        metaRow.textContent.includes(" y ") ||
        metaRow.textContent.includes(" and ") ||
        metaRow.textContent.includes(" más") ||
        metaRow.textContent.includes(" more")
      ) {
        return metaRow
      }
    }

    const a =
      lockup.querySelector('yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-row a[href^="/@"]') ||
      lockup.querySelector('yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-row a[href^="/channel/"]') ||
      lockup.querySelector('.ytContentMetadataViewModelMetadataRow a[href^="/@"]') ||
      lockup.querySelector('.ytContentMetadataViewModelMetadataRow a[href^="/channel/"]') ||
      lockup.querySelector('a[href^="/@"]') ||
      lockup.querySelector('a[href^="/channel/"]') ||
      null

    if (a) return a

    return (
      lockup.querySelector(
        "yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-row span.yt-content-metadata-view-model__metadata-text"
      ) ||
      lockup.querySelector(".ytContentMetadataViewModelMetadataRow .yt-content-metadata-view-model__metadata-text") ||
      null
    )
  }

  function pickChannelAnchor(lockup) {
    return (
      lockup.querySelector('yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-row a[href^="/@"]') ||
      lockup.querySelector('yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-row a[href^="/channel/"]') ||
      lockup.querySelector('.ytContentMetadataViewModelMetadataRow a[href^="/@"]') ||
      lockup.querySelector('.ytContentMetadataViewModelMetadataRow a[href^="/channel/"]') ||
      lockup.querySelector('a[href^="/@"]') ||
      lockup.querySelector('a[href^="/channel/"]') ||
      null
    )
  }

  function getChannelHref(lockup) {
    const a = pickChannelAnchor(lockup)
    const href = String(a?.getAttribute?.("href") || "").trim()
    if (!href) return ""
    try {
      return new URL(href, location.origin).href
    } catch {
      return ""
    }
  }

  function getChannelName(lockup) {
    const src = pickChannelDisplaySource(lockup)
    const direct = normalizeText(src?.textContent || "")
    if (direct) return direct

    // Collaborative lockups may expose names only through link accessibility
    // attributes while their visible text is rendered in a separate overlay.
    const names = []
    const seen = new Set()
    const links = lockup.querySelectorAll('a[href^="/@"], a[href^="/channel/"]')
    for (const link of links) {
      const label = normalizeText(
        link.textContent ||
        link.getAttribute("aria-label") ||
        link.getAttribute("title") ||
        link.querySelector("img")?.getAttribute("alt") ||
        ""
      )
      const key = label.toLocaleLowerCase()
      if (!label || seen.has(key)) continue
      seen.add(key)
      names.push(label)
    }
    if (names.length) return names.join(" y ")

    const avatarLabels = Array.from(
      lockup.querySelectorAll(
        "yt-avatar-stack-view-model [aria-label], yt-decorated-avatar-view-model [aria-label], yt-avatar-shape img[alt]"
      )
    )
      .map(node => normalizeText(node.getAttribute("aria-label") || node.getAttribute("alt") || ""))
      .filter(Boolean)
    if (avatarLabels.length) return [...new Set(avatarLabels)].join(" y ")

    if (lockup.querySelector("yt-avatar-stack-view-model")) return "Colaboradores"
    return ""
  }

  function isIconish(node) {
    if (!node || node.nodeType !== 1) return false
    if (node.matches("yt-icon-shape, .yt-icon-shape")) return true
    if (node.querySelector("yt-icon-shape, .yt-icon-shape")) return true
    if (node.querySelector("svg, img")) return true
    if (node.getAttribute("role") === "img") return true
    if (node.querySelector('[role="img"]')) return true
    return false
  }

  function collectBadgeNodesFromAnchor(a) {
    const out = []
    if (!a) return out

    const candidates = a.querySelectorAll(
      ".yt-core-attributed-string__image-element, .ytIconWrapperHost, .yt-core-attributed-string__image-element--image-alignment-vertical-center, yt-icon-shape, .yt-icon-shape"
    )

    const seen = new Set()
    for (const el of candidates) {
      if (!el) continue
      let root =
        el.closest(".yt-core-attributed-string__image-element") ||
        el.closest(".ytIconWrapperHost") ||
        el.closest(".yt-core-attributed-string__image-element--image-alignment-vertical-center") ||
        el

      if (!root || root === a) continue
      if (!isIconish(root)) continue

      const key =
        root.tagName + "|" + (root.getAttribute("class") || "") + "|" + (root.getAttribute("aria-label") || "")
      if (seen.has(key)) continue
      seen.add(key)
      out.push(root)
    }

    return out
  }

  function normalizeMetaAnchorInPlace(a, nameText) {
    if (!a) return
    const name = normalizeText(nameText || "")
    if (!name) return

    const badgeRoots = collectBadgeNodesFromAnchor(a)
    const badges = []

    for (const r of badgeRoots) {
      if (!r || !r.isConnected) continue
      badges.push(r)
    }

    for (const b of badges) {
      try {
        if (b.parentNode) b.parentNode.removeChild(b)
      } catch {}
    }

    clearChildren(a)
    a.appendChild(document.createTextNode(name))

    for (const b of badges) {
      if (!isIconish(b)) continue
      const wrap = document.createElement("span")
      wrap.style.display = "inline-flex"
      wrap.style.alignItems = "center"
      wrap.style.marginLeft = "4px"
      wrap.appendChild(b)
      a.appendChild(wrap)
    }

    for (const s of Array.from(a.querySelectorAll(":scope > span"))) {
      if (!s.querySelector || !isIconish(s)) s.remove()
    }
  }

  function detachMetaAnchorOnce(lockup) {
    if (!lockup) return null
    if (STATE.movedMetaAnchors.has(lockup)) return STATE.movedMetaAnchors.get(lockup)?.a || null

    const a = pickChannelAnchor(lockup)
    if (!a || !a.parentNode) return null

    const parent = a.parentNode
    const nextSibling = a.nextSibling
    STATE.movedMetaAnchors.set(lockup, { a, parent, nextSibling })
    return a
  }

  function restoreMovedMetaAnchors() {
    const entries = []
    document.querySelectorAll(
      "yt-lockup-view-model, .yt-lockup-view-model, .ytLockupViewModelWrapper, .ytLockupViewModelHost, ytd-video-renderer, ytd-rich-grid-media"
    ).forEach(lockup => {
      const info = STATE.movedMetaAnchors.get(lockup)
      if (!info) return
      entries.push(info)
    })

    for (const info of entries) {
      const { a, parent, nextSibling } = info
      if (!a || !parent) continue
      if (!a.isConnected) continue
      if (a.parentNode === parent) continue
      try {
        if (nextSibling && nextSibling.parentNode === parent) parent.insertBefore(a, nextSibling)
        else parent.appendChild(a)
      } catch {}
    }

    STATE.movedMetaAnchors = new WeakMap()
  }

  function setHeaderNameTextOnly(destLink, lockup) {
    if (!destLink) return
    const href = getChannelHref(lockup)
    if (href) destLink.href = href
    else destLink.removeAttribute("href")

    const src = pickChannelDisplaySource(lockup)
    const channelName = getChannelName(lockup)
    setTextOnly(destLink, channelName)
    destLink.dataset.yslvHasName = channelName ? "true" : "false"

    // Keep verified/artist badges for single and collaborative channels without
    // cloning nested links into this header anchor.
    const anchors = src?.matches?.("a") ? [src] : Array.from(src?.querySelectorAll?.("a") || [])
    const seen = new Set()
    for (const anchor of anchors) {
      for (const badge of collectBadgeNodesFromAnchor(anchor)) {
        const key = `${badge.tagName}|${badge.getAttribute("class") || ""}|${badge.getAttribute("aria-label") || ""}`
        if (seen.has(key)) continue
        seen.add(key)
        const wrap = document.createElement("span")
        wrap.className = "yslv-channel-badge"
        wrap.appendChild(badge.cloneNode(true))
        destLink.appendChild(wrap)
      }
    }
  }

  function moveAvatarToHeaderOnce(item, lockup, head) {
    if (!item || !lockup || !head) return null
    if (STATE.movedAvatars.has(item)) return STATE.movedAvatars.get(item)?.avatarEl || null

    // Robust avatar selector: tries multi-avatar containers first, then specific view models, then general classes
    const avatarEl =
      lockup.querySelector("yt-avatar-stack-view-model") ||
      lockup.querySelector("yt-decorated-avatar-view-model") ||
      lockup.querySelector(".ytLockupMetadataViewModelAvatar") ||
      lockup.querySelector(".yt-lockup-view-model__avatar-container") ||
      lockup.querySelector(".yt-lockup-metadata-view-model__avatar") ||
      lockup.querySelector(".yt-lockup-view-model__avatar") ||
      lockup.querySelector(".ytLockupViewModelAvatar") ||
      lockup.querySelector("yt-avatar-shape") ||
      lockup.querySelector(".yt-spec-avatar-shape")

    if (!avatarEl || !avatarEl.parentNode) return null

    // If we found a single avatar shape but it's inside a decorated/stack container we missed, move the container instead
    const decorated = avatarEl.closest("yt-decorated-avatar-view-model, yt-avatar-stack-view-model, .ytLockupMetadataViewModelAvatar")
    const finalEl = decorated || avatarEl

    const parent = finalEl.parentNode
    const nextSibling = finalEl.nextSibling
    STATE.movedAvatars.set(item, { avatarEl: finalEl, parent, nextSibling })

    try {
      head.insertBefore(finalEl, head.firstChild)
    } catch {}

    return finalEl
  }

  function ensureRowHeader(item, lockup) {
    let head = item.querySelector(`:scope > .${CFG.cls.rowHead}`)
    if (!head) {
      head = document.createElement("div")
      head.className = CFG.cls.rowHead
      item.prepend(head)
    }

    head.style.display = "flex"

    let name = head.querySelector(`:scope > a.${CFG.cls.rowHeadName}`)
    if (!name) {
      name = document.createElement("a")
      name.className = CFG.cls.rowHeadName
      head.appendChild(name)
    }

    setHeaderNameTextOnly(name, lockup)
    moveAvatarToHeaderOnce(item, lockup, head)
  }

  function getRightMetaRowsText(lockup) {
    const chName = getChannelName(lockup)
    const rows = Array.from(
      lockup.querySelectorAll(
        "yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-row, " +
        "yt-content-metadata-view-model .ytContentMetadataViewModelMetadataRow, " +
        ".yt-content-metadata-view-model__metadata-row, " +
        ".ytContentMetadataViewModelMetadataRow, " +
        ".yt-lockup-metadata-view-model__metadata-row, " +
        ".ytLockupMetadataViewModelMetadataRow"
      )
    )
      .map(r => normalizeText(r.textContent || ""))
      .filter(Boolean)
      .filter(t => (chName ? t !== chName : true))

    if (!rows.length) return ""

    const out = []
    const seen = new Set()
    for (const t of rows) {
      const k = t.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(t)
    }

    if (!out.length) return ""
    return out.join(" • ")
  }

  function ensureInlineMeta(textContainer, lockup) {
    let row = textContainer.querySelector(`.${CFG.cls.metaRow}`)
    if (!row) {
      row = document.createElement("div")
      row.className = CFG.cls.metaRow

      const heading =
        textContainer.querySelector(".yt-lockup-metadata-view-model__heading-reset") || 
        textContainer.querySelector(".ytLockupMetadataViewModelHeading") || 
        textContainer.querySelector("h3")
      if (heading && heading.parentNode) heading.parentNode.insertBefore(row, heading.nextSibling)
      else textContainer.appendChild(row)
    }

    row.style.display = "flex"

    let left = row.querySelector(`:scope > .${CFG.cls.metaCh}`)
    if (!left) {
      left = document.createElement("div")
      left.className = CFG.cls.metaCh
      row.appendChild(left)
    }

    const srcA = detachMetaAnchorOnce(lockup)
    const chName = getChannelName(lockup)

    if (srcA) {
      try {
        srcA.style.margin = "0"
      } catch {}
      normalizeMetaAnchorInPlace(srcA, chName)
      clearChildren(left)
      left.appendChild(srcA)
    } else {
      let link = left.querySelector("a")
      if (!link) {
        link = document.createElement("a")
        left.appendChild(link)
      }

      const href = getChannelHref(lockup)
      if (href) link.href = href
      else link.removeAttribute("href")

      const src = pickChannelDisplaySource(lockup)
      if (src) {
        cloneInto(link, src)
      } else {
        setTextOnly(link, chName || "")
      }
    }

    const right = getRightMetaRowsText(lockup)
    let r = row.querySelector(`:scope > .${CFG.cls.metaRt}`)
    if (right) {
      if (!r) {
        r = document.createElement("div")
        r.className = CFG.cls.metaRt
        row.appendChild(r)
      }
      r.textContent = right
      r.style.display = ""
    } else if (r) {
      r.textContent = ""
      r.style.display = "none"
    }

    return row
  }

  function pickPrimaryVideoAnchor(lockup) {
    return (
      lockup.querySelector('a.yt-lockup-view-model__content-image[href^="/watch"]') ||
      lockup.querySelector('a.yt-lockup-view-model__content-image[href^="/shorts/"]') ||
      lockup.querySelector('a.ytLockupViewModelContentImage[href^="/watch"]') ||
      lockup.querySelector('a.ytLockupViewModelContentImage[href^="/shorts/"]') ||
      lockup.querySelector('a[href^="/watch"][id="thumbnail"]') ||
      lockup.querySelector('a[href^="/shorts/"][id="thumbnail"]') ||
      lockup.querySelector('a[href^="/shorts/"].reel-item-endpoint') ||
      lockup.querySelector('a[href^="/watch"]') ||
      lockup.querySelector('a[href^="/shorts/"]') ||
      lockup.querySelector('a#video-title-link') ||
      lockup.querySelector('a#video-title') ||
      null
    )
  }

  function isShortsHref(href) {
    const h = String(href || "")
    return h.startsWith("/shorts/") || h.includes("youtube.com/shorts/")
  }

  function extractVideoIdFromHref(href) {
    const h = String(href || "")
    if (!h) return ""

    if (isShortsHref(h)) {
      try {
        const u = new URL(h, location.origin)
        const parts = u.pathname.split("/").filter(Boolean)
        const idx = parts.indexOf("shorts")
        const id = idx >= 0 ? String(parts[idx + 1] || "") : ""
        return id
      } catch {
        const m = h.match(/\/shorts\/([^?&#/]+)/)
        return m ? m[1] : ""
      }
    }

    try {
      const u = new URL(h, location.origin)
      return u.searchParams.get("v") || ""
    } catch {
      const m = h.match(/[?&]v=([^&]+)/)
      return m ? m[1] : ""
    }
  }

  function ensureDesc(textContainer, lockup, mRow) {
    let desc = textContainer.querySelector(`.${CFG.cls.desc}`)
    if (!desc) {
      desc = document.createElement("div")
      desc.className = CFG.cls.desc
      if (mRow && mRow.parentNode === textContainer) {
        textContainer.insertBefore(desc, mRow.nextSibling)
      } else {
        textContainer.appendChild(desc)
      }
    }

    const vLink = pickPrimaryVideoAnchor(lockup)
    const href = vLink?.getAttribute?.("href") || ""
    const vid = extractVideoIdFromHref(href)
    if (!vid) {
      desc.textContent = ""
      desc.style.display = "none"
      desc.classList.remove(CFG.cls.descSkel)
      delete desc.dataset.yslvVid
      return
    }

    desc.dataset.yslvVid = vid

    const mem = STATE.descCache.get(vid)
    if (mem != null) {
      desc.textContent = mem
      desc.style.display = mem ? "" : "none"
      desc.classList.remove(CFG.cls.descSkel)
      return
    }

    const stored = getStoredDesc(vid)
    if (stored != null) {
      STATE.descCache.set(vid, stored)
      desc.textContent = stored
      desc.style.display = stored ? "" : "none"
      desc.classList.remove(CFG.cls.descSkel)
      return
    }

    const S = skNorm()
    if (!S.enabled) {
      desc.textContent = ""
      desc.style.display = "none"
      desc.classList.remove(CFG.cls.descSkel)
      return
    }

    desc.style.display = ""
    desc.classList.add(CFG.cls.descSkel)

    const needs = desc.childElementCount !== S.lines || !desc.querySelector(":scope > span")
    if (needs) {
      clearChildren(desc)
      for (let i = 0; i < S.lines; i++) desc.appendChild(document.createElement("span"))
    }
  }

  function summarizeDesc(raw, sentenceCount, maxChars) {
    let s = String(raw || "").trim()
    if (!s) return ""

    s = s.replace(/\r/g, "").replace(/\n{2,}/g, "\n").replace(/[ \t]{2,}/g, " ").trim()

    const seg =
      typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "sentence" }) : null
    if (seg) {
      const out = []
      for (const part of seg.segment(s)) {
        const t = String(part.segment || "").trim()
        if (!t) continue
        out.push(t)
        if (out.length >= sentenceCount) break
      }
      s = out.join(" ").trim()
    } else {
      const urls = []
      s = s.replace(/\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/gi, m => {
        const k = `__YSU${urls.length}__`
        urls.push(m)
        return k
      })

      const parts = s.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean)
      s = parts.slice(0, sentenceCount).join(" ").trim()

      s = s.replace(/__YSU(\d+)__/g, (_, i) => urls[Number(i)] || "")
    }

    if (s.length > maxChars) s = s.slice(0, maxChars).trimEnd() + "…"
    return s
  }

  async function fetchDescriptionForVideoId(vid) {
    const F = CFG.list.descFetch
    if (!F.enabled) return ""
    if (!vid) return ""

    const mem = STATE.descCache.get(vid)
    if (mem != null) return mem

    const stored = getStoredDesc(vid)
    if (stored != null) {
      STATE.descCache.set(vid, stored)
      return stored
    }

    if (STATE.descInFlight.has(vid)) return STATE.descInFlight.get(vid)
    if (STATE.descFetches >= F.maxTotalFetchesPerNav) return ""

    const p = (async () => {
      while (STATE.descActive >= F.maxConcurrent) {
        await new Promise(r => setTimeout(r, 35))
      }
      STATE.descActive++
      STATE.descFetches++
      try {
        const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`, {
          credentials: "same-origin",
        })
        if (!res.ok) return ""
        const html = await res.text()
        const m =
          html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});/s) ||
          html.match(/["']ytInitialPlayerResponse["']\s*:\s*(\{.*?\})\s*,\s*["']/s)
        if (!m) return ""
        const json = JSON.parse(m[1])
        const raw = String(json?.videoDetails?.shortDescription || "").trim()
        if (!raw) return ""
        return summarizeDesc(raw, F.sentenceCount, F.maxChars)
      } catch {
        return ""
      } finally {
        STATE.descActive--
      }
    })()

    STATE.descInFlight.set(vid, p)
    const out = await p
    STATE.descInFlight.delete(vid)

    STATE.descCache.set(vid, out)
    setStoredDesc(vid, out)

    return out
  }

  function updateDescDomForVid(vid, text) {
    const nodes = document.querySelectorAll(`.${CFG.cls.desc}[data-yslv-vid="${CSS.escape(vid)}"]`)
    for (const n of nodes) {
      if (!n || !n.isConnected) continue
      n.classList.remove(CFG.cls.descSkel)
      clearChildren(n)
      n.textContent = text || ""
      n.style.display = text ? "" : "none"
    }
  }

  function buildDescQueueFromDom() {
    if (!STATE.active || STATE.view !== "list") return
    const root = getActiveSubsRoot()
    if (!root) return
    const descs = root.querySelectorAll(`.${CFG.cls.desc}[data-yslv-vid]`)
    if (!descs.length) return

    let sig = ""
    for (const d of descs) {
      const vid = d?.dataset?.yslvVid || ""
      if (!vid) continue
      sig += vid + "|"
    }
    if (sig === STATE.lastQueueSig) return
    STATE.lastQueueSig = sig

    for (const d of descs) {
      const vid = d?.dataset?.yslvVid || ""
      if (!vid) continue

      const stored = getStoredDesc(vid)
      if (stored != null) {
        STATE.descCache.set(vid, stored)
        updateDescDomForVid(vid, stored)
        continue
      }

      if (STATE.descCache.has(vid)) continue
      if (STATE.descInFlight.has(vid)) continue
      if (STATE.descQueued.has(vid)) continue
      STATE.descQueued.add(vid)
      STATE.descQueue.push(vid)
    }

    pumpDescQueue()
  }

  async function pumpDescQueue() {
    if (STATE.descPumpRunning) return
    STATE.descPumpRunning = true
    try {
      while (STATE.active && STATE.view === "list" && STATE.descQueue.length) {
        const vid = STATE.descQueue.shift()
        if (!vid) continue
        STATE.descQueued.delete(vid)

        const stored = getStoredDesc(vid)
        if (stored != null) {
          STATE.descCache.set(vid, stored)
          updateDescDomForVid(vid, stored)
          continue
        }

        if (STATE.descCache.has(vid)) {
          updateDescDomForVid(vid, STATE.descCache.get(vid) || "")
          continue
        }

        const txt = await fetchDescriptionForVideoId(vid)
        updateDescDomForVid(vid, txt || "")
      }
    } finally {
      STATE.descPumpRunning = false
    }
  }

  function hasSkeletons() {
    const root = getActiveSubsRoot()
    if (!root) return false
    return !!root.querySelector(`.${CFG.cls.desc}.${CFG.cls.descSkel}`)
  }

  function stopShimmer() {
    SHIMMER.running = false
    if (SHIMMER.raf) cancelAnimationFrame(SHIMMER.raf)
    SHIMMER.raf = 0
    document.documentElement.style.removeProperty(CFG.cssVars.shimmerX)
  }

  function startShimmer() {
    if (SHIMMER.running) return
    SHIMMER.running = true
    SHIMMER.t0 = performance.now()

    const tick = t => {
      if (!SHIMMER.running) return

      const S = skNorm()
      if (!STATE.active || STATE.view !== "list" || !S.enabled || !hasSkeletons()) {
        stopShimmer()
        return
      }

      const phase = ((t - SHIMMER.t0) % S.ms) / S.ms
      const x = 200 - phase * 400
      document.documentElement.style.setProperty(CFG.cssVars.shimmerX, `${x}%`)
      SHIMMER.raf = requestAnimationFrame(tick)
    }

    SHIMMER.raf = requestAnimationFrame(tick)
  }

  function ensureDescQueueLoop() {
    if (STATE.descTimer) clearInterval(STATE.descTimer)
    if (!STATE.active) return
    STATE.descTimer = setInterval(() => {
      if (!STATE.active || STATE.view !== "list") {
        stopShimmer()
        return
      }
      pruneDescStore()
      buildDescQueueFromDom()
      if (hasSkeletons()) startShimmer()
      else stopShimmer()
    }, CFG.perf.descQueueIntervalMs)
  }

  function patchItem(item) {
    if (!STATE.active || STATE.view !== "list") return
    if (!item || item.nodeType !== 1) return
    if (item.tagName !== "YTD-RICH-ITEM-RENDERER") return
    if (!isSubscriptionsCard(item)) return // STRICT GUARD: Never touch non-subscription cards!

    const shortsLockup = item.querySelector("ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model")
    if (shortsLockup && CFG.list.shorts.enabled) {
      item.classList.add(CFG.cls.isShort)
      return
    }

    item.classList.remove(CFG.cls.isShort)

    const lockup = 
      item.querySelector("yt-lockup-view-model") || 
      item.querySelector(".yt-lockup-view-model") ||
      item.querySelector(".ytLockupViewModelWrapper") ||
      item.querySelector(".ytLockupViewModelHost") ||
      item.querySelector("ytd-video-renderer") ||
      item.querySelector("ytd-rich-grid-media")
    if (!lockup) return

    ensureRowHeader(item, lockup)

    const metadataColumn =
      lockup.querySelector(".yt-lockup-view-model__metadata") ||
      lockup.querySelector(".ytLockupViewModelMetadata") ||
      lockup.querySelector("yt-lockup-metadata-view-model") ||
      lockup.querySelector(".yt-lockup-metadata-view-model") ||
      lockup.querySelector(".metadata") ||
      lockup.querySelector("#metadata") ||
      lockup
    
    const textContainer =
      metadataColumn.querySelector(".yt-lockup-metadata-view-model__text-container") ||
      metadataColumn.querySelector(".ytContentMetadataViewModelHost") ||
      metadataColumn

    // Move menu button to be a direct child of lockup for grid placement
    const menuBtn = 
      lockup.querySelector(".yt-lockup-metadata-view-model__menu-button") || 
      lockup.querySelector(".ytLockupMetadataViewModelMenu") ||
      lockup.querySelector("#menu-container.ytd-rich-grid-media") ||
      lockup.querySelector("#menu")
    
    if (menuBtn) {
      if (!STATE.movedMenus.has(item) && menuBtn.parentNode) {
        STATE.movedMenus.set(item, { node: menuBtn, parent: menuBtn.parentNode, nextSibling: menuBtn.nextSibling })
      }
      const wrapper = lockup.querySelector(":scope > div")
      if (wrapper && menuBtn.parentNode !== wrapper) {
        wrapper.appendChild(menuBtn)
      } else if (!wrapper && menuBtn.parentNode !== lockup) {
        lockup.appendChild(menuBtn)
      }
    }

    ensureRowHeader(item, lockup)
    const mRow = ensureInlineMeta(textContainer, lockup)
    ensureDesc(textContainer, lockup, mRow)

    // Move attachments (e.g. "Recibir Aviso" / Set Reminder button) into textContainer for ordering
    const attachments =
      lockup.querySelector("yt-lockup-attachments-view-model") ||
      lockup.querySelector(".yt-lockup-view-model__attachments") ||
      lockup.querySelector(".yt-lockup-metadata-view-model__attachments") ||
      lockup.querySelector(".ytLockupAttachmentsViewModelHost")
    
    if (attachments && attachments.parentNode !== textContainer) {
      if (!STATE.movedAttachments.has(item)) {
        STATE.movedAttachments.set(item, {
          node: attachments,
          parent: attachments.parentNode,
          nextSibling: attachments.nextSibling,
        })
      }
      textContainer.appendChild(attachments)
    }
  }

  function enqueue(node) {
    if (!STATE.active || STATE.view !== "list") return
    if (!node || node.nodeType !== 1) return

    // Ensure node belongs to subscriptions browse only
    if (!isSubscriptionsCard(node) && !getActiveSubsBrowse()?.contains(node)) return

    // Ignore mutations produced by our own generated UI to avoid feedback loops.
    if (
      node.matches?.(`.${CFG.cls.rowHead}, .${CFG.cls.metaRow}, .${CFG.cls.desc}, .yslv-channel-badge`) ||
      node.closest?.(`.${CFG.cls.rowHead}, .${CFG.cls.metaRow}, .${CFG.cls.desc}`)
    ) return

    // YouTube often hydrates an already-connected card by adding descendants.
    const owner = node.closest?.("ytd-rich-item-renderer")
    if (owner && owner !== node) {
      if (isSubscriptionsCard(owner)) enqueue(owner)
      return
    }

    if (node.tagName === "YTD-RICH-ITEM-RENDERER") {
      if (!isSubscriptionsCard(node)) return
      if (STATE.qSet.has(node)) return
      STATE.qSet.add(node)
      STATE.q.push(node)
      scheduleProcess()
      return
    }

    const subsBrowse = getActiveSubsBrowse()
    if (!subsBrowse) return

    const targetRoot = subsBrowse.contains(node) ? node : subsBrowse
    const found = targetRoot.querySelectorAll ? targetRoot.querySelectorAll("ytd-rich-item-renderer") : []
    if (found && found.length) {
      for (const it of found) {
        if (isSubscriptionsCard(it)) enqueue(it)
      }
    }
  }

  function scheduleProcess() {
    if (STATE.processing) return
    STATE.processing = true

    const run = () => {
      STATE.processing = false
      processQueue()
    }

    requestAnimationFrame(run)
  }

  function processQueue() {
    if (!STATE.active || STATE.view !== "list") {
      STATE.q.length = 0
      STATE.qSet.clear()
      return
    }

    let n = 0
    while (STATE.q.length && n < CFG.perf.maxItemsPerTick) {
      const item = STATE.q.shift()
      STATE.qSet.delete(item)
      patchItem(item)
      n++
    }

    buildDescQueueFromDom()

    if (STATE.q.length) scheduleProcess()
  }

  function enqueueAllOnce() {
    if (!STATE.active || STATE.view !== "list") return
    const root = getActiveSubsRoot()
    if (!root) return
    const items = root.querySelectorAll ? root.querySelectorAll("ytd-rich-item-renderer") : []
    for (const it of items) {
      if (isSubscriptionsCard(it)) enqueue(it)
    }
  }

  function processSections() {
    if (!STATE.active) return
    const subsBrowse = getActiveSubsBrowse()
    if (!subsBrowse) return

    const shelfSelectors = 'ytd-rich-section-renderer, ytd-rich-shelf-renderer, ytd-shelf-renderer, ytd-item-section-renderer, ytd-reel-shelf-renderer'
    const containers = subsBrowse.querySelectorAll(shelfSelectors)
    
    containers.forEach(el => {
      const titleEl = el.querySelector('#title, #title-text, .title, h2, h3, yt-formatted-string')
      const hasShortsContent = el.querySelector('ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model, ytd-reel-item-renderer, [is-shorts]')
      const hasShortsTitle = titleEl?.textContent?.toLowerCase().includes("shorts")
      const hasShortsIcon = el.querySelector('path[d^="M17.7,9.3c0.3-0.2,0.5-0.5,0.6-0.8"], svg[viewBox="0 0 24 24"] g path[d*="M17.77,10.32"]')
      const isShortsShelf = !!(hasShortsContent || hasShortsTitle || hasShortsIcon)

      // 1. "Most Relevant"
      let isRelevant = false
      if (titleEl && titleEl.textContent) {
        const txt = titleEl.textContent.trim().toLowerCase()
        isRelevant = ["most relevant", "más relevantes", "más relevante", "relevantes", "relevancia", "relevance"].some(t => txt.includes(t))
      } else {
        const headerEl = el.querySelector('#rich-shelf-header, .grid-subheader, #header')
        if (headerEl && headerEl.textContent) {
          const txt = headerEl.textContent.trim().toLowerCase()
          isRelevant = ["most relevant", "más relevantes", "más relevante"].some(t => txt.includes(t))
        }
      }

      if (isRelevant) {
        if (STATE.hideMostRelevant) el.classList.add("yslv-section-hidden")
        else el.classList.remove("yslv-section-hidden")
      }

      // 2. "Shorts"
      if (STATE.hideShorts) {
        if (isShortsShelf) {
          el.classList.add("yslv-shorts-hidden")
        }
      } else {
        el.classList.remove("yslv-shorts-hidden")
      }
    })

    // 3. Fallback for individual Shorts items inside subscriptions
    if (STATE.hideShorts) {
      subsBrowse.querySelectorAll("ytd-rich-item-renderer").forEach(item => {
        const isShort = item.querySelector('ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model, ytd-reel-item-renderer') || item.hasAttribute("is-shorts")
        if (isShort) item.classList.add("yslv-shorts-hidden")
      })
    } else {
      subsBrowse.querySelectorAll(".yslv-shorts-hidden").forEach(el => el.classList.remove("yslv-shorts-hidden"))
    }
  }

  function triggerReflow() {
    window.dispatchEvent(new Event('resize'))
  }

  function attachObserver() {
    if (!STATE.active) return
    const subsBrowse = getActiveSubsBrowse()
    const target = subsBrowse || document.documentElement || document.body
    if (!target) return
    if (STATE.observedTarget === target && STATE.mo) return

    if (STATE.mo) STATE.mo.disconnect()
    STATE.observedTarget = target

    STATE.mo = new MutationObserver(muts => {
      if (!STATE.active) return
      
      processSections()
      ensureToggle()

      if (STATE.view !== "list") return
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) enqueue(node)
        }
      }
    })

    STATE.mo.observe(target, { childList: true, subtree: true })
  }

  function attachPageManagerObserver() {
    if (STATE.pmMo) return
    const pm = document.querySelector("ytd-page-manager")
    if (!pm) return

    STATE.pmMo = new MutationObserver(() => {
      if (!STATE.active) return
      processSections()
      attachObserver()
      ensureToggleMountLoop()
      if (STATE.view === "list") {
        setTimeout(() => {
          if (!STATE.active || STATE.view !== "list") return
          enqueueAllOnce()
          triggerReflow()
        }, 50)
      }
    })

    STATE.pmMo.observe(pm, { childList: true, subtree: false })
  }

  function restoreMovedAvatars() {
    document.querySelectorAll("ytd-rich-item-renderer").forEach(item => {
      const info = STATE.movedAvatars.get(item)
      if (!info) return
      const { avatarEl, parent, nextSibling } = info
      if (!avatarEl || !parent) return
      if (!avatarEl.isConnected) return
      if (avatarEl.parentNode === parent) return
      try {
        if (nextSibling && nextSibling.parentNode === parent) parent.insertBefore(avatarEl, nextSibling)
        else parent.appendChild(avatarEl)
      } catch {}
    })
    STATE.movedAvatars = new WeakMap()
  }

  function restoreMovedNodes(map) {
    document.querySelectorAll("ytd-rich-item-renderer").forEach(item => {
      const info = map.get(item)
      if (!info) return
      const { node, parent, nextSibling } = info
      if (!node || !parent || !node.isConnected || node.parentNode === parent) return
      try {
        if (nextSibling && nextSibling.parentNode === parent) parent.insertBefore(node, nextSibling)
        else parent.appendChild(node)
      } catch {}
    })
  }

  function cleanupListArtifacts() {
    restoreMovedAvatars()
    restoreMovedMetaAnchors()
    restoreMovedNodes(STATE.movedMenus)
    restoreMovedNodes(STATE.movedAttachments)
    STATE.movedMenus = new WeakMap()
    STATE.movedAttachments = new WeakMap()
    document.querySelectorAll(`.${CFG.cls.rowHead}`).forEach(n => n.remove())
    document.querySelectorAll(`.${CFG.cls.metaRow}`).forEach(n => n.remove())
    document.querySelectorAll(`.${CFG.cls.desc}`).forEach(n => n.remove())
    STATE.descQueue.length = 0
    STATE.descQueued.clear()
    STATE.lastQueueSig = ""
  }

  function resetNavState() {
    STATE.q.length = 0
    STATE.qSet.clear()

    STATE.descInFlight.clear()
    STATE.descCache.clear()
    STATE.descFetches = 0
    STATE.descActive = 0

    STATE.descQueue.length = 0
    STATE.descQueued.clear()
    STATE.descPumpRunning = false
    STATE.lastQueueSig = ""

    STATE.observedTarget = null
  }

  function teardown() {
    stopShimmer()
    if (STATE.mo) {
      STATE.mo.disconnect()
      STATE.mo = null
    }
    STATE.observedTarget = null
    if (STATE.descTimer) {
      clearInterval(STATE.descTimer)
      STATE.descTimer = 0
    }
    resetNavState()
  }

  function ensureToggleMountLoop(attempt = 0) {
    if (!STATE.active) return
    ensureToggle()
    const toggle = document.getElementById(CFG.ids.toggle)
    const browse = getActiveSubsBrowse()
    const idealBtn = browse?.querySelector(':not(.yslv-section-hidden) #subscribe-button')
    const needsMove = idealBtn && toggle && toggle.previousElementSibling !== idealBtn
    if (STATE.active && (!toggle || needsMove) && attempt < 15) {
      setTimeout(() => ensureToggleMountLoop(attempt + 1), 200)
    }
  }

  function pageSig() {
    return `${location.pathname}|${location.search}|${document.querySelector("ytd-page-manager") ? "pm" : "nopm"}`
  }

  function applyDynamicSettings(settings) {
    const root = document.documentElement
    if (!root) return
    if (settings.thumbW != null) root.style.setProperty("--yslv-thumb-w", settings.thumbW + "px")
    if (settings.rowPadY != null) root.style.setProperty("--yslv-row-pad-y", settings.rowPadY + "px")
    if (settings.channelVideoGap != null) root.style.setProperty("--yslv-channel-video-gap", settings.channelVideoGap + "px")
    if (settings.headerGap != null) root.style.setProperty("--yslv-header-gap", settings.headerGap + "px")
    if (settings.containerW != null) root.style.setProperty("--yslv-container-w", settings.containerW + "%")
    if (settings.channelSize != null) root.style.setProperty("--yslv-channel-size", settings.channelSize + "px")
    if (settings.titleSize != null) root.style.setProperty("--yslv-title-size", settings.titleSize + "px")
    if (settings.shortsW != null) root.style.setProperty("--yslv-shorts-w", settings.shortsW + "px")
    if (settings.shortsGap != null) root.style.setProperty("--yslv-shorts-gap", settings.shortsGap + "px")

    if (settings.hideMostRelevant) root.setAttribute("data-yslv-hide-relevant", "true")
    else root.removeAttribute("data-yslv-hide-relevant")

    if (settings.hideShorts) root.setAttribute("data-yslv-hide-shorts", "true")
    else root.removeAttribute("data-yslv-hide-shorts")
  }

  async function apply() {
    if (!isContextValid()) return
    await ensureDescStoreLoaded()
    if (!STATE.active || !isContextValid()) return
    
    const keys = ["hideMostRelevant", "hideShorts", "thumbW", "rowPadY", "channelVideoGap", "headerGap", "containerW", "channelSize", "titleSize", "shortsW", "shortsGap"]
    chrome.storage.local.get(keys, result => {
      if (chrome.runtime.lastError || !isContextValid()) return
      
      STATE.hideMostRelevant = result.hideMostRelevant ?? STATE.hideMostRelevant
      STATE.hideShorts = result.hideShorts ?? STATE.hideShorts
      STATE.thumbW = result.thumbW ?? STATE.thumbW
      STATE.rowPadY = result.rowPadY ?? STATE.rowPadY
      STATE.channelVideoGap = result.channelVideoGap ?? STATE.channelVideoGap
      STATE.headerGap = result.headerGap ?? STATE.headerGap
      STATE.containerW = result.containerW ?? STATE.containerW
      STATE.channelSize = result.channelSize ?? STATE.channelSize
      STATE.titleSize = result.titleSize ?? STATE.titleSize
      STATE.shortsW = result.shortsW ?? STATE.shortsW
      STATE.shortsGap = result.shortsGap ?? STATE.shortsGap

      saveSettingsCache(STATE)
      processSections()
      applyDynamicSettings(STATE)
    })

    pruneDescStore()
    ensureToggleMountLoop()
    attachObserver()
    attachPageManagerObserver()
    ensureDescQueueLoop()
    if (STATE.view === "list") {
      enqueueAllOnce()
      startShimmer()
      triggerReflow()
    } else {
      stopShimmer()
    }
  }

  function syncActive(isNavFinish) {
    const shouldBeActive = isSubsPage()
    const sig = pageSig()

    // 1. Maintain view and dynamic settings
    if (shouldBeActive) {
      const savedView = loadView()
      if (document.documentElement.getAttribute(CFG.attr.view) !== savedView) {
        applyViewAttr(savedView)
      }
      applyDynamicSettings(STATE)
    }

    // 2. Initial activation (Navigation from other page or Reload)
    if (shouldBeActive && !STATE.active) {
      STATE.active = true
      STATE.lastPageSig = sig
      apply()
      return
    }

    // 3. Deactivation (Navigation to other page)
    if (!shouldBeActive && STATE.active) {
      STATE.active = false
      STATE.lastPageSig = sig
      teardown()
      return
    }

    // 4. Maintenance (Already active, but URL/Content changed)
    if (shouldBeActive && STATE.active) {
      ensureToggleMountLoop()
      paintToggle()
      attachObserver()
      processSections()

      // If we finished navigation (even to the same URL), ensure content is processed
      if (isNavFinish) {
        STATE.lastPageSig = sig

        if (STATE.view === "list") {
          // If signature changed or it's a forced finish (click on same link), re-process
          resetNavState()
          enqueueAllOnce()
          startShimmer()
          triggerReflow()
        } else {
          stopShimmer()
        }
      }
    }
  }

  function init() {
    // Early synchronous styling at document_start
    if (isSubsPage()) {
      const savedView = loadView()
      STATE.view = savedView
      if (savedView === "list") {
        document.documentElement.setAttribute(CFG.attr.view, savedView)
        applyDynamicSettings(STATE)
      }
    }

    syncActive(true)

    if (isContextValid()) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!isContextValid()) return
        if (area === "local") {
          const keys = ["hideMostRelevant", "hideShorts", "thumbW", "rowPadY", "channelVideoGap", "headerGap", "containerW", "channelSize", "titleSize", "shortsW", "shortsGap"]
          let needsSectionUpdate = false
          let needsDynamicUpdate = false

          keys.forEach(k => {
            if (changes[k] !== undefined) {
              STATE[k] = changes[k].newValue
              if (k.startsWith("hide")) needsSectionUpdate = true
              else needsDynamicUpdate = true
            }
          })

          saveSettingsCache(STATE)

          if (needsSectionUpdate) processSections()
          if (needsDynamicUpdate) applyDynamicSettings(STATE)
        }
      })
    }

    window.addEventListener(
      "yt-navigate-start",
      () => {
        if (isSubsPage()) {
          const savedView = loadView()
          applyViewAttr(savedView)
          applyDynamicSettings(STATE)
        }
      },
      { passive: true }
    )

    window.addEventListener(
      "yt-navigate-finish",
      () => {
        syncActive(true)
      },
      { passive: true }
    )

    window.addEventListener(
      "yt-page-data-updated",
      () => {
        // Handle SPA internal updates without full navigation
        syncActive(false)
      },
      { passive: true }
    )

    window.addEventListener(
      "popstate",
      () => {
        syncActive(true)
      },
      { passive: true }
    )

    setTimeout(() => {
      attachPageManagerObserver()
    }, 250)
  }

  init()
})()
