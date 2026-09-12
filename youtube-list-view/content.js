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
    relevantHeaderTop: null,
    relevantHeaderAlignmentRaf: 0,
    relevantHeaderAlignmentToken: 0,
    alignedChronologicalSection: null,
    alignedChronologicalOriginalMarginTop: "",
    alignedChronologicalOriginalMarginTopPriority: "",
    alignedChronologicalBaseMarginTop: 0,
    alignedChronologicalAppliedOffset: 0,

    thumbW: 260,
    rowPadY: 16,
    channelVideoGap: 18,
    headerGap: 12,
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
        headerGap: settings.headerGap !== undefined && !isNaN(settings.headerGap) ? Number(settings.headerGap) : 12,
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
        if (STATE.hideMostRelevant) scheduleRelevantHeaderAlignment()
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

  function isIconish(node) {
    if (!node || node.nodeType !== 1) return false
    if (node.matches("yt-icon-shape, .yt-icon-shape")) return true
    if (node.querySelector("yt-icon-shape, .yt-icon-shape")) return true
    if (node.querySelector("svg, img")) return true
    if (node.getAttribute("role") === "img") return true
    if (node.querySelector('[role="img"]')) return true
    return false
  }

  function cleanBylineText(s) {
    return normalizeText(s)
      .replace(/([a-zA-Z0-9\u00C0-\u024F])\s*y\s+([a-zA-Z0-9\u00C0-\u024F])/g, "$1 y $2")
      .replace(/([a-zA-Z0-9\u00C0-\u024F])\s*and\s+([a-zA-Z0-9\u00C0-\u024F])/gi, "$1 and $2")
      .replace(/\s+/g, " ")
      .trim()
  }

  function extractChannelFromCombined(raw) {
    return cleanBylineText(
      normalizeText(String(raw || ""))
        .replace(/\s*\d+[\d,\.]*\s*(?:k|m|b|mil|millones)?\s*(?:visualizaciones|views)?\s*(?:hace|\d+\s*(?:d|h|m|s|d[ií]as|horas|min|minutos|meses|a[ñn]os|days|hours|weeks|months|years)).*$/i, "")
    )
  }

  function extractStatsFromCombined(raw, chName) {
    let rest = cleanBylineText(normalizeText(String(raw || "")))
    if (chName && rest.toLowerCase().startsWith(chName.toLowerCase())) {
      rest = rest.slice(chName.length).trim()
    }
    return rest
      .replace(/^[•\s\-_–—|/]+/, "")
      .replace(/(\d+(?:[,\.]\d+)?\s*(?:[kmb]|mil|millones)?(?:\s*(?:visualizaciones|views))?)\s*(hace\s+\d+.*)/i, (m, a, b) => `${a} ${b}`)
      .trim()
  }

  function getElementCleanText(el) {
    if (!el) return ""
    const parts = []
    function walk(node) {
      if (!node) return
      if (node.nodeType === 3) {
        const t = normalizeText(node.textContent || "")
        if (t) parts.push(t)
        return
      }
      if (node.nodeType === 1) {
        if (isIconish(node)) return
        for (const child of node.childNodes) {
          walk(child)
        }
      }
    }
    walk(el)
    if (!parts.length) return cleanBylineText(el.textContent || "")
    return cleanBylineText(parts.join(" "))
  }

  function isCollaborative(lockup, item, head) {
    const scope = head || item || lockup
    if (!scope) return false
    if (
      scope.querySelector(
        "yt-avatar-stack-view-model, .ytLockupMetadataViewModelAvatar:has(yt-avatar-stack-view-model), .yslv-subs-rowhead yt-avatar-stack-view-model"
      )
    ) {
      return true
    }
    if (item && STATE.movedAvatars.get(item)?.avatarEl?.matches?.("yt-avatar-stack-view-model, :has(yt-avatar-stack-view-model)")) {
      return true
    }
    return false
  }

  function pickChannelAnchor(lockup) {
    if (!lockup) return null
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

  function pickChannelDisplaySource(lockup, item, head) {
    if (!lockup) return null

    // For standard videos with channel anchor, return that anchor
    const a = pickChannelAnchor(lockup)
    if (a) return a

    if (isCollaborative(lockup, item, head)) {
      const scope = head || item || lockup
      const metaRows = lockup.querySelectorAll(
        "yt-content-metadata-view-model > .yt-content-metadata-view-model__metadata-row, " +
        "yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-row, " +
        ".ytContentMetadataViewModelMetadataRow"
      )
      if (metaRows.length > 1) return metaRows[0]
      return scope.querySelector("yt-avatar-stack-view-model") || metaRows[0] || null
    }

    return (
      lockup.querySelector(
        "yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-row span.yt-content-metadata-view-model__metadata-text"
      ) ||
      lockup.querySelector(".ytContentMetadataViewModelMetadataRow .yt-content-metadata-view-model__metadata-text") ||
      null
    )
  }

  function getChannelHref(lockup, item, head) {
    const a = pickChannelAnchor(lockup)
    let href = String(a?.getAttribute?.("href") || "").trim()
    if (!href) {
      const scope = head || item || lockup
      const anyA = scope?.querySelector?.(
        'a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"], #avatar-link[href]'
      )
      href = String(anyA?.getAttribute?.("href") || "").trim()
    }
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return ""
    try {
      return new URL(href, location.origin).href
    } catch {
      return ""
    }
  }

  function getChannelName(lockup, item, head) {
    if (!lockup && !item && !head) return ""

    // 1. Standard single-channel video: If it has a channel anchor, use it directly!
    const a = pickChannelAnchor(lockup)
    if (a) {
      const name = normalizeText(a.textContent || "")
      if (name) return name
    }

    // 2. Collaborative video (avatar stack or multiple channels)
    if (isCollaborative(lockup, item, head)) {
      const scope = head || item || lockup

      // A) Extract from metadata rows/texts using combined channel extraction
      if (lockup) {
        const rawTexts = Array.from(
          lockup.querySelectorAll(
            "yt-content-metadata-view-model > .yt-content-metadata-view-model__metadata-row, " +
            "yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-row, " +
            ".ytContentMetadataViewModelMetadataRow, " +
            "yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-text, " +
            "yt-content-metadata-view-model span[role='text']"
          )
        )
          .map(el => cleanBylineText(getElementCleanText(el)))
          .filter(Boolean)

        for (const raw of rawTexts) {
          const ch = extractChannelFromCombined(raw)
          if (ch && (ch.includes(" y ") || ch.includes(" and ") || ch.includes(" & ") || ch.length > 3)) {
            return ch
          }
        }
      }

      return "Colaboradores"
    }

    // 3. Fallback for non-collaborative videos without <a> tag
    const src = pickChannelDisplaySource(lockup, item, head)
    const direct = normalizeText(src?.textContent || "")
    if (direct && !/\b(?:visualizaciones|views|usuarios|espectadores)\b/i.test(direct) && !/\bhace\s+\d+/i.test(direct)) {
      return direct
    }

    return ""
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

  function copyBadgesFromSource(src, destLink) {
    if (!src || !destLink) return
    const anchors = src.matches?.("a") ? [src] : Array.from(src.querySelectorAll?.("a") || [])
    const seen = new Set()
    for (const anchor of (anchors.length ? anchors : [src])) {
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

  function setHeaderNameTextOnly(destLink, lockup, item, head) {
    if (!destLink) return
    const href = getChannelHref(lockup, item, head)
    if (href) {
      destLink.href = href
      destLink.style.cursor = "pointer"
    } else {
      destLink.removeAttribute("href")
      destLink.style.cursor = "default"
    }

    const src = pickChannelDisplaySource(lockup, item, head)
    const channelName = getChannelName(lockup, item, head)
    setTextOnly(destLink, channelName)
    destLink.dataset.yslvHasName = channelName ? "true" : "false"

    if (!href && src) {
      destLink.onclick = e => {
        e.preventDefault()
        e.stopPropagation()
        const clickTarget = src.querySelector("button, a, [role='button']") || src
        clickTarget.click?.()
      }
      destLink.style.cursor = "pointer"
    } else {
      destLink.onclick = null
    }

    // Keep verified/artist badges for single and collaborative channels without
    // cloning nested links into this header anchor.
    copyBadgesFromSource(src, destLink)
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

    setHeaderNameTextOnly(name, lockup, item, head)
    moveAvatarToHeaderOnce(item, lockup, head)
  }

  function getRightMetaRowsText(lockup, item, chName) {
    if (!lockup) return ""
    if (!chName) chName = getChannelName(lockup, item)
    const rows = Array.from(
      lockup.querySelectorAll(
        "yt-content-metadata-view-model > .yt-content-metadata-view-model__metadata-row, " +
        "yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-row, " +
        ".ytContentMetadataViewModelMetadataRow"
      )
    )
      .map(r => cleanBylineText(getElementCleanText(r)))
      .filter(Boolean)

    if (!rows.length) return ""

    const normCh = normalizeText(chName || "").toLowerCase()
    const chParts = normCh
      ? normCh.split(/\s+(?:y|and|&)\s+|,/i).map(s => s.trim().toLowerCase()).filter(Boolean)
      : []

    const out = []
    const seen = new Set()
    for (let t of rows) {
      let normT = normalizeText(t).toLowerCase()
      if (!normT) continue

      if (normCh && normT.startsWith(normCh)) {
        t = extractStatsFromCombined(t, chName)
        normT = normalizeText(t).toLowerCase()
      } else if (normCh && (normT === normCh || normCh.includes(normT))) {
        continue
      }

      let isCollabPart = false
      for (const part of chParts) {
        if (normT === part) {
          isCollabPart = true
          break
        }
      }
      if (isCollabPart || !t) continue

      const k = t.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(t)
    }

    if (!out.length) return ""
    return out.join(" • ")
  }

  function ensureInlineMeta(textContainer, lockup, item) {
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
    const chName = getChannelName(lockup, item)

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

      const href = getChannelHref(lockup, item)
      if (href) {
        link.href = href
        link.style.cursor = "pointer"
      } else {
        link.removeAttribute("href")
        link.style.cursor = "default"
      }

      const src = pickChannelDisplaySource(lockup, item)
      setTextOnly(link, chName || (src ? cleanBylineText(getElementCleanText(src)) : ""))

      if (!href && src) {
        link.onclick = e => {
          e.preventDefault()
          e.stopPropagation()
          const clickTarget = src.querySelector("button, a, [role='button']") || src
          clickTarget.click?.()
        }
        link.style.cursor = "pointer"
      } else {
        link.onclick = null
      }

      copyBadgesFromSource(src, link)
    }

    const right = getRightMetaRowsText(lockup, item, chName)
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

  function refreshMissingRowHeadNames() {
    if (!STATE.active || STATE.view !== "list") return
    const root = getActiveSubsRoot()
    if (!root) return
    const missing = root.querySelectorAll(`.${CFG.cls.rowHeadName}[data-yslv-has-name="false"]`)
    if (!missing.length) return
    for (const nameLink of missing) {
      const item = nameLink.closest("ytd-rich-item-renderer")
      if (!item || !item.isConnected) continue
      const lockup =
        item.querySelector("yt-lockup-view-model") ||
        item.querySelector(".yt-lockup-view-model") ||
        item.querySelector(".ytLockupViewModelWrapper") ||
        item.querySelector(".ytLockupViewModelHost") ||
        item.querySelector("ytd-video-renderer") ||
        item.querySelector("ytd-rich-grid-media")
      if (lockup) {
        setHeaderNameTextOnly(nameLink, lockup, item, nameLink.parentNode)
      }
    }
  }

  function ensureDescQueueLoop() {
    if (STATE.descTimer) clearInterval(STATE.descTimer)
    if (!STATE.active) return
    STATE.descTimer = setInterval(() => {
      if (!STATE.active || STATE.view !== "list") {
        stopShimmer()
        return
      }
      refreshMissingRowHeadNames()
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
    if (item.classList.contains("yslv-section-hidden") || item.closest(".yslv-section-hidden")) return

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
    const mRow = ensureInlineMeta(textContainer, lockup, item)
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

  const SECTION_HEADING_SELECTORS = [
    "#header #title",
    "#title-container #title",
    ".grid-subheader #title",
  ]
  const RELEVANT_SECTION_TITLES = new Set(["most relevant", "mas relevantes", "mas relevante", "relevantes", "relevancia"])
  const CHRONOLOGICAL_SECTION_TITLES = new Set(["most recent", "most recent videos", "mas recientes", "mas reciente", "recientes", "latest", "today", "hoy"])

  function normalizeSectionHeadingText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  }

  function findListSectionAnchors(subsBrowse = getActiveSubsBrowse()) {
    const gridContents = subsBrowse?.querySelector("#contents.ytd-rich-grid-renderer")
    if (!gridContents) return null

    const children = Array.from(gridContents.children || [])
    const headerSection = children.find(c =>
      c.classList.contains("yslv-header-section") ||
      c.matches?.("ytd-rich-section-renderer:has(ytd-rich-list-header-renderer)") ||
      c.querySelector?.(".yslv-header-section, #subscribe-button, #" + CFG.ids.toggle)
    )
    const relevantSection = children.find(c =>
      c.classList.contains("yslv-relevant-shelf") ||
      c.querySelector?.(".yslv-relevant-shelf")
    )

    if (!headerSection || !relevantSection || headerSection.parentNode !== gridContents || relevantSection.parentNode !== gridContents) {
      return null
    }

    let relevantHeader = null
    let chronologicalHeader = null
    for (const selector of SECTION_HEADING_SELECTORS) {
      const relevantCandidate = Array.from(relevantSection.querySelectorAll(selector)).find(candidate =>
        RELEVANT_SECTION_TITLES.has(normalizeSectionHeadingText(candidate.textContent))
      )
      const chronologicalCandidate = Array.from(headerSection.querySelectorAll(selector)).find(candidate => {
        if (!CHRONOLOGICAL_SECTION_TITLES.has(normalizeSectionHeadingText(candidate.textContent))) return false
        const rect = candidate.getBoundingClientRect()
        return candidate.isConnected && (rect.width > 0 || rect.height > 0)
      })
      if (relevantCandidate && chronologicalCandidate) {
        relevantHeader = relevantCandidate
        chronologicalHeader = chronologicalCandidate
        break
      }
    }

    return { gridContents, relevantHeader, chronologicalHeader, chronologicalSection: headerSection }
  }

  function getAnchorTop(anchor, gridContents) {
    if (!anchor?.isConnected || !gridContents?.isConnected) return null
    const anchorRect = anchor.getBoundingClientRect()
    const gridRect = gridContents.getBoundingClientRect()
    if ((anchorRect.width === 0 && anchorRect.height === 0) || !Number.isFinite(anchorRect.top) || !Number.isFinite(gridRect.top)) {
      return null
    }
    return anchorRect.top - gridRect.top
  }

  function restoreAlignedChronologicalSection() {
    const section = STATE.alignedChronologicalSection
    if (section) {
      if (STATE.alignedChronologicalOriginalMarginTop) {
        section.style.setProperty(
          "margin-top",
          STATE.alignedChronologicalOriginalMarginTop,
          STATE.alignedChronologicalOriginalMarginTopPriority
        )
      } else {
        section.style.removeProperty("margin-top")
      }
    }
    STATE.alignedChronologicalSection = null
    STATE.alignedChronologicalOriginalMarginTop = ""
    STATE.alignedChronologicalOriginalMarginTopPriority = ""
    STATE.alignedChronologicalBaseMarginTop = 0
    STATE.alignedChronologicalAppliedOffset = 0
  }

  function clearRelevantHeaderAlignment() {
    if (STATE.relevantHeaderAlignmentRaf) {
      cancelAnimationFrame(STATE.relevantHeaderAlignmentRaf)
      STATE.relevantHeaderAlignmentRaf = 0
    }
    STATE.relevantHeaderAlignmentToken++
    STATE.relevantHeaderTop = null
    restoreAlignedChronologicalSection()
  }

  function captureRelevantHeaderPosition() {
    if (!STATE.active || STATE.view !== "list" || !isSubsPage()) return false

    const wasHidden = STATE.hideMostRelevant
    const root = document.documentElement
    const hadHideAttribute = root?.getAttribute("data-yslv-hide-relevant")
    if (wasHidden) STATE.hideMostRelevant = false
    if (wasHidden) root?.removeAttribute("data-yslv-hide-relevant")
    try {
      processSections()
      const anchors = findListSectionAnchors()
      const top = getAnchorTop(anchors?.relevantHeader, anchors?.gridContents)
      if (top == null) return false
      STATE.relevantHeaderTop = top
      return true
    } finally {
      STATE.hideMostRelevant = wasHidden
      if (hadHideAttribute != null) root?.setAttribute("data-yslv-hide-relevant", hadHideAttribute)
      else if (wasHidden) root?.removeAttribute("data-yslv-hide-relevant")
    }
  }

  function prepareRelevantHideTransition(nextValue) {
    const nextHideMostRelevant = !!nextValue
    if (!nextHideMostRelevant) {
      clearRelevantHeaderAlignment()
      return false
    }

    // Do not measure synchronously here. During YouTube SPA navigation the subscription DOM can
    // still be half-built. The scheduled RAF pass temporarily reveals the relevant shelf, measures
    // the real heading position, restores the hidden state, and only then aligns "Más recientes".
    STATE.relevantHeaderTop = null
    return true
  }

  function scheduleRelevantHeaderAlignment() {
    if (STATE.relevantHeaderAlignmentRaf) cancelAnimationFrame(STATE.relevantHeaderAlignmentRaf)
    const token = ++STATE.relevantHeaderAlignmentToken
    let retries = 0
    let pass = 0
    const align = () => {
      STATE.relevantHeaderAlignmentRaf = 0
      if (
        token !== STATE.relevantHeaderAlignmentToken ||
        !STATE.active ||
        STATE.view !== "list" ||
        !STATE.hideMostRelevant ||
        !isSubsPage()
      ) {
        return
      }

      if (STATE.relevantHeaderTop == null) {
        const captured = captureRelevantHeaderPosition()
        if (!captured) {
          if (retries++ < 12) STATE.relevantHeaderAlignmentRaf = requestAnimationFrame(align)
          return
        }
        processSections()
      }

      const anchors = findListSectionAnchors()
      const chronologicalTop = getAnchorTop(anchors?.chronologicalHeader, anchors?.gridContents)
      const chronologicalSection = anchors?.chronologicalSection
      if (chronologicalTop == null || !chronologicalSection?.isConnected) {
        if (pass++ < 6) STATE.relevantHeaderAlignmentRaf = requestAnimationFrame(align)
        return
      }

      const delta = STATE.relevantHeaderTop - chronologicalTop
      if (!Number.isFinite(delta)) return
      if (STATE.alignedChronologicalSection && STATE.alignedChronologicalSection !== chronologicalSection) {
        restoreAlignedChronologicalSection()
      }
      if (STATE.alignedChronologicalSection !== chronologicalSection) {
        STATE.alignedChronologicalSection = chronologicalSection
        STATE.alignedChronologicalOriginalMarginTop = chronologicalSection.style.getPropertyValue("margin-top")
        STATE.alignedChronologicalOriginalMarginTopPriority = chronologicalSection.style.getPropertyPriority("margin-top")
        const computedMarginTop = Number.parseFloat(getComputedStyle(chronologicalSection).marginTop)
        STATE.alignedChronologicalBaseMarginTop = Number.isFinite(computedMarginTop) ? computedMarginTop : 0
      }
      if (Math.abs(delta) >= 0.01) {
        STATE.alignedChronologicalAppliedOffset += delta
      }
      chronologicalSection.style.setProperty(
        "margin-top",
        `${STATE.alignedChronologicalBaseMarginTop + STATE.alignedChronologicalAppliedOffset}px`,
        "important"
      )

      // Re-check several frames: this is what keeps the two headings pixel-identical even while
      // YouTube finishes fonts/images/layout after an SPA navigation.
      if (pass++ < 6) STATE.relevantHeaderAlignmentRaf = requestAnimationFrame(align)
    }
    STATE.relevantHeaderAlignmentRaf = requestAnimationFrame(align)
  }

  function processSections() {
    if (!STATE.active) return
    const subsBrowse = getActiveSubsBrowse()
    if (!subsBrowse) return

    const shelfSelectors = "ytd-rich-section-renderer, ytd-shelf-renderer, ytd-item-section-renderer, ytd-reel-shelf-renderer"
    const containers = Array.from(subsBrowse.querySelectorAll(shelfSelectors))

    // YouTube builds subscription shelves incrementally during SPA navigation. A container can
    // temporarily expose another shelf's title, so classification classes must never be sticky.
    // Rebuild them from the current DOM on every pass before deciding what should be hidden.
    containers.forEach(el => {
      el.classList.remove(
        "yslv-relevant-shelf",
        "yslv-shorts-shelf",
        "yslv-shorts-hidden",
        "yslv-section-hidden",
        "yslv-header-section"
      )
    })

    const getSectionTitleText = el => {
      const titleEl = el.querySelector("#title, #title-text, .title, h2, h3, yt-formatted-string")
      const headerEl = el.querySelector("#rich-shelf-header, .grid-subheader, #header")
      return (titleEl?.textContent || headerEl?.textContent || "").trim().toLowerCase()
    }

    const isChronologicalContainer = (el, titleTxt = getSectionTitleText(el)) => (
      titleTxt.includes("reciente") || titleTxt.includes("latest") ||
      titleTxt.includes("hoy") || titleTxt.includes("today") ||
      !!el.querySelector("#subscribe-button, ytd-rich-list-header-renderer, #" + CFG.ids.toggle)
    )

    containers.forEach(el => {
      const titleTxt = getSectionTitleText(el)

      const hasShortsContent = el.querySelector("ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model, ytd-reel-item-renderer, [is-shorts]")
      const hasShortsTitle = titleTxt.includes("shorts")
      const hasShortsIcon = el.querySelector('path[d^="M17.7,9.3c0.3-0.2,0.5-0.5,0.6-0.8"], svg[viewBox="0 0 24 24"] g path[d*="M17.77,10.32"]')
      const isShortsShelf = !!(hasShortsContent || hasShortsTitle || hasShortsIcon)
      const isChronological = isChronologicalContainer(el, titleTxt)

      // 1. "Most Relevant". Never allow the chronological header/control container to be
      // classified as relevant, even if YouTube temporarily nests/reuses shelf DOM during SPA.
      const isRelevant = !isChronological &&
        ["most relevant", "más relevantes", "más relevante", "relevantes", "relevancia", "relevance"].some(t => titleTxt.includes(t))

      el.classList.toggle("yslv-relevant-shelf", isRelevant)

      if (isRelevant) {
        const parentSec = el.closest("ytd-rich-section-renderer")
        if (parentSec && parentSec !== el && !isChronologicalContainer(parentSec)) {
          parentSec.classList.add("yslv-relevant-shelf")
          parentSec.classList.toggle("yslv-section-hidden", !!STATE.hideMostRelevant)
        }
      }

      // 2. "Shorts"
      el.classList.toggle("yslv-shorts-shelf", isShortsShelf)
      el.classList.toggle("yslv-shorts-hidden", isShortsShelf && !!STATE.hideShorts)

      // One owner for the generic hidden class prevents a transient classification from leaving
      // Más recientes (including its controls) permanently collapsed after SPA navigation.
      el.classList.toggle(
        "yslv-section-hidden",
        (isRelevant && !!STATE.hideMostRelevant) || (isShortsShelf && !!STATE.hideShorts)
      )

      // 3. Chronological Header ("Más recientes", etc.)
      el.classList.toggle("yslv-header-section", !isRelevant && !isShortsShelf && isChronological)
    })

    // 3. Fallback for individual Shorts items inside subscriptions
    if (STATE.hideShorts) {
      subsBrowse.querySelectorAll("ytd-rich-item-renderer").forEach(item => {
        const isShort = item.querySelector("ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model, ytd-reel-item-renderer") || item.hasAttribute("is-shorts")
        if (isShort) item.classList.add("yslv-shorts-hidden")
      })
    } else {
      subsBrowse.querySelectorAll(".yslv-shorts-hidden").forEach(el => el.classList.remove("yslv-shorts-hidden"))
    }

    // 4. Reorder sections and classify the first visible content after header
    const gridContents = subsBrowse.querySelector("#contents.ytd-rich-grid-renderer")
    if (gridContents) {
      // 4.1 Reorder: Place "Más relevantes" before "Más recientes" header so "Más recientes" sits directly on top of its videos
      const headerSection = Array.from(gridContents.children).find(c =>
        c.classList.contains("yslv-header-section") ||
        c.matches?.("ytd-rich-section-renderer:has(ytd-rich-list-header-renderer)") ||
        c.querySelector?.(".yslv-header-section, #subscribe-button, #" + CFG.ids.toggle)
      )
      const relevantSection = Array.from(gridContents.children).find(c =>
        c.classList.contains("yslv-relevant-shelf") ||
        c.querySelector?.(".yslv-relevant-shelf")
      )

      if (headerSection && relevantSection && headerSection.parentNode === gridContents && relevantSection.parentNode === gridContents) {
        if (STATE.view === "list") {
          if (!STATE.hideMostRelevant && (relevantSection.compareDocumentPosition(headerSection) & Node.DOCUMENT_POSITION_PRECEDING)) {
            gridContents.insertBefore(relevantSection, headerSection)
          }
        } else {
          if (headerSection.compareDocumentPosition(relevantSection) & Node.DOCUMENT_POSITION_PRECEDING) {
            gridContents.insertBefore(headerSection, relevantSection)
          }
        }
      }

      // 4.2 Classify first visible content after header
      const children = Array.from(gridContents.children)
      let foundHeader = false
      let firstContent = null

      for (const child of children) {
        if (child.classList.contains("yslv-section-hidden") || child.classList.contains("yslv-shorts-hidden")) continue

        const isHeaderLike = child.classList.contains("yslv-header-section") ||
          child.matches?.("ytd-rich-section-renderer:has(ytd-rich-list-header-renderer)") ||
          child.querySelector?.(".yslv-header-section, #subscribe-button, #" + CFG.ids.toggle) ||
          (child.querySelector?.("#title-container, .grid-subheader") && !child.matches?.(".yslv-shorts-shelf, .yslv-relevant-shelf, ytd-rich-shelf-renderer, ytd-rich-item-renderer"))

        if (isHeaderLike) {
          foundHeader = true
          child.classList.add("yslv-header-section")
          continue
        }

        if (foundHeader && !firstContent) {
          firstContent = child
          break
        }
      }

      children.forEach(child => {
        const isFirst = (child === firstContent)
        if (child.matches?.(".yslv-shorts-shelf, ytd-rich-section-renderer")) {
          child.classList.toggle("yslv-first-section", isFirst)
        }
        if (child.matches?.("ytd-rich-item-renderer")) {
          child.classList.toggle("yslv-first-video", isFirst)
        }
      })
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
      if (STATE.hideMostRelevant && (STATE.relevantHeaderTop == null || !STATE.alignedChronologicalSection?.isConnected)) {
        scheduleRelevantHeaderAlignment()
      }
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) enqueue(node)
        }
        if (m.type === "characterData" && m.target?.parentNode) {
          const item = m.target.parentNode.closest?.("ytd-rich-item-renderer, ytd-video-renderer")
          if (item) enqueue(item)
        }
      }
    })

    STATE.mo.observe(target, { childList: true, subtree: true, characterData: true })
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
      if (STATE.view === "list" && STATE.hideMostRelevant && (STATE.relevantHeaderTop == null || !STATE.alignedChronologicalSection?.isConnected)) {
        scheduleRelevantHeaderAlignment()
      }
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
    document.querySelectorAll(".yslv-first-video, .yslv-first-section, .yslv-header-section, .yslv-shorts-shelf").forEach(n => {
      n.classList.remove("yslv-first-video", "yslv-first-section", "yslv-header-section", "yslv-shorts-shelf")
    })
    STATE.descQueue.length = 0
    STATE.descQueued.clear()
    STATE.lastQueueSig = ""

    const browse = getActiveSubsBrowse()
    const gridContents = browse?.querySelector("#contents.ytd-rich-grid-renderer")
    if (gridContents) {
      const headerSection = Array.from(gridContents.children).find(c =>
        c.classList.contains("yslv-header-section") ||
        c.matches?.("ytd-rich-section-renderer:has(ytd-rich-list-header-renderer)") ||
        c.querySelector?.("#subscribe-button, #" + CFG.ids.toggle)
      )
      const relevantSection = Array.from(gridContents.children).find(c =>
        c.classList.contains("yslv-relevant-shelf") ||
        c.querySelector?.(".yslv-relevant-shelf")
      )
      if (headerSection && relevantSection && headerSection.parentNode === gridContents && relevantSection.parentNode === gridContents) {
        if (headerSection.compareDocumentPosition(relevantSection) & Node.DOCUMENT_POSITION_PRECEDING) {
          gridContents.insertBefore(headerSection, relevantSection)
        }
      }
    }
  }

  function resetNavState() {
    clearRelevantHeaderAlignment()
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
      const nextHideMostRelevant = result.hideMostRelevant ?? STATE.hideMostRelevant
      const requeueAfterRelevantReveal = STATE.hideMostRelevant && !nextHideMostRelevant
      const alignAfterHide = prepareRelevantHideTransition(nextHideMostRelevant)
      STATE.hideMostRelevant = nextHideMostRelevant
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
      if (requeueAfterRelevantReveal) enqueueAllOnce()
      if (alignAfterHide) scheduleRelevantHeaderAlignment()
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
          if (STATE.hideMostRelevant) scheduleRelevantHeaderAlignment()
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
          let alignAfterHide = false
          let requeueAfterRelevantReveal = false

          keys.forEach(k => {
            if (changes[k] !== undefined) {
              if (k === "hideMostRelevant") {
                requeueAfterRelevantReveal = STATE.hideMostRelevant && !changes[k].newValue
                alignAfterHide = prepareRelevantHideTransition(changes[k].newValue) || alignAfterHide
              }
              STATE[k] = changes[k].newValue
              if (k.startsWith("hide")) {
                needsSectionUpdate = true
                needsDynamicUpdate = true
              } else {
                needsDynamicUpdate = true
              }
            }
          })

          saveSettingsCache(STATE)

          if (needsDynamicUpdate) applyDynamicSettings(STATE)
          if (needsSectionUpdate) {
            processSections()
            if (requeueAfterRelevantReveal) enqueueAllOnce()
          }
          if (alignAfterHide) scheduleRelevantHeaderAlignment()
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
