;(() => {
  "use strict"

  if (window.__yslvShortsMainLoaded) return
  window.__yslvShortsMainLoaded = true

  const BASE_COUNT = 9
  let scheduled = false
  const hookedShelves = new WeakSet()
  let expandedByUser = new WeakSet()
  let collapsedForNavigation = new WeakSet()

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
      expandedByUser.delete(this)
      queueMicrotask(() => restoreCollapsedShelf(this))
      requestAnimationFrame(() => restoreCollapsedShelf(this))
      setTimeout(() => restoreCollapsedShelf(this), 120)
      return result
    }
    hookedShelves.add(shelf)
  }

  function enforceShelf(shelf) {
    if (!isShortsShelf(shelf)) {
      // Polymer can reuse the element for an unrelated shelf on SPA navigation.
      shelf.removeAttribute("data-yslv-shorts-collapsed")
      expandedByUser.delete(shelf)
      collapsedForNavigation.delete(shelf)
      return
    }
    hookNativeCollapse(shelf)
    if (expandedByUser.has(shelf)) {
      shelf.removeAttribute("data-yslv-shorts-collapsed")
      return
    }

    // YouTube can preserve an expanded Polymer shelf across a navigation to the
    // same URL. Only an explicit "Mostrar más" click should expand it here.
    shelf.setAttribute("data-yslv-shorts-collapsed", "")
    if (!shelf.isExpanded && !shelf.data?.isExpanded) collapsedForNavigation.delete(shelf)
    if ((shelf.isExpanded || shelf.data?.isExpanded) && !collapsedForNavigation.has(shelf)) {
      collapsedForNavigation.add(shelf)
      try {
        if (typeof shelf.collapseShelf === "function") {
          shelf.collapseShelf()
        } else if (typeof shelf.set === "function") {
          shelf.set("isExpanded", false)
        } else {
          shelf.isExpanded = false
        }
      } catch {
        // The native shelf might not be ready yet; the CSS row limit still applies.
      }
    }

    const contents = Array.isArray(shelf.contents)
      ? shelf.contents
      : Array.isArray(shelf.data?.contents)
        ? shelf.data.contents
        : []
    if (contents.length < BASE_COUNT) return

    shelf.elementsPerRow = BASE_COUNT
    shelf.currentElementsPerRow = BASE_COUNT
    shelf.slimItemsPerRow = BASE_COUNT

    if (!Array.isArray(shelf.displayedContents) ||
        shelf.displayedContents.length !== BASE_COUNT ||
        shelf.displayedContents.some((item, index) => item !== contents[index])) {
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

  document.addEventListener("click", event => {
    if (!isListSubscriptions()) return
    const button = event.target?.closest?.("#show-more-button, #show-less-button")
    const shelf = button?.closest("ytd-rich-shelf-renderer")
    if (!isShortsShelf(shelf)) return

    if (button.id === "show-more-button") {
      expandedByUser.add(shelf)
      shelf.removeAttribute("data-yslv-shorts-collapsed")
    } else {
      expandedByUser.delete(shelf)
      schedule()
    }
  }, true)

  function resetForNavigation() {
    expandedByUser = new WeakSet()
    collapsedForNavigation = new WeakSet()
    schedule()
  }

  window.addEventListener("yt-navigate-start", resetForNavigation, { passive: true })
  window.addEventListener("yt-navigate-finish", resetForNavigation, { passive: true })
  window.addEventListener("yt-page-data-updated", schedule, { passive: true })
  window.addEventListener("resize", schedule, { passive: true })
  schedule()
})()
