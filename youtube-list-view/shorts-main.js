;(() => {
  "use strict"

  if (window.__yslvShortsMainLoaded) return
  window.__yslvShortsMainLoaded = true

  const BASE_COUNT = 9
  let scheduled = false
  const hookedShelves = new WeakSet()

  function isListSubscriptions() {
    return (
      location.pathname === "/feed/subscriptions" &&
      document.documentElement.getAttribute("data-yslv-subs-view") === "list"
    )
  }

  function isShortsShelf(shelf) {
    if (!shelf) return false
    if (shelf.querySelector("ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model")) return true
    const title = shelf.querySelector("#title, #title-text, h2, h3")?.textContent || ""
    return title.trim().toLocaleLowerCase() === "shorts"
  }

  function setDisplayedContents(shelf, contents) {
    const firstRow = contents.slice(0, BASE_COUNT)
    if (typeof shelf.set === "function") shelf.set("displayedContents", firstRow)
    else shelf.displayedContents = firstRow
  }

  function restoreCollapsedShelf(shelf) {
    if (!shelf?.isConnected) return
    enforceShelf(shelf)
  }

  function hookNativeCollapse(shelf) {
    if (hookedShelves.has(shelf) || typeof shelf.collapseShelf !== "function") return
    const nativeCollapse = shelf.collapseShelf

    shelf.collapseShelf = function (...args) {
      const result = nativeCollapse.apply(this, args)
      queueMicrotask(() => restoreCollapsedShelf(this))
      requestAnimationFrame(() => restoreCollapsedShelf(this))
      setTimeout(() => restoreCollapsedShelf(this), 120)
      return result
    }
    hookedShelves.add(shelf)
  }

  function enforceShelf(shelf) {
    if (!isShortsShelf(shelf)) return
    hookNativeCollapse(shelf)
    if (shelf.isExpanded || shelf.data?.isExpanded) return

    const contents = Array.isArray(shelf.contents)
      ? shelf.contents
      : Array.isArray(shelf.data?.contents)
        ? shelf.data.contents
        : []
    if (contents.length < BASE_COUNT) return

    shelf.elementsPerRow = BASE_COUNT
    shelf.currentElementsPerRow = BASE_COUNT
    shelf.slimItemsPerRow = BASE_COUNT

    if (!Array.isArray(shelf.displayedContents) || shelf.displayedContents.length !== BASE_COUNT) {
      setDisplayedContents(shelf, contents)
      requestAnimationFrame(() => {
        if (!shelf.isConnected || shelf.isExpanded || shelf.data?.isExpanded) return
        shelf.elementsPerRow = BASE_COUNT
        shelf.currentElementsPerRow = BASE_COUNT
        shelf.slimItemsPerRow = BASE_COUNT
        try {
          shelf.updateItemVisibility?.()
          shelf.setHeightToSingleRow?.()
        } catch {}
      })
    }
  }

  function enforceAll() {
    scheduled = false
    if (!isListSubscriptions()) return
    document.querySelectorAll("ytd-rich-shelf-renderer").forEach(enforceShelf)
  }

  function schedule() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(enforceAll)
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-yslv-subs-view"],
    childList: true,
    subtree: true,
  })

  window.addEventListener("yt-navigate-finish", schedule, { passive: true })
  window.addEventListener("yt-page-data-updated", schedule, { passive: true })
  window.addEventListener("resize", schedule, { passive: true })
  schedule()
})()
