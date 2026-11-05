// Optional integration check: node tests/avatars.browser.cjs [path-to-chrome]
// Uses a fresh headless profile, never the user's open Chrome session.
const { spawn } = require("node:child_process")
const { readFileSync, mkdtempSync } = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const assert = require("node:assert/strict")

async function main() {
  const source = readFileSync(path.join(__dirname, "../youtube-list-view/content.js"), "utf8")
  const css = readFileSync(path.join(__dirname, "../youtube-list-view/styles.css"), "utf8")
  const code = source.slice(source.indexOf("  function moveAvatarToHeaderOnce("), source.indexOf("  function ensureRowHeader("))
  const restore = source.slice(source.indexOf("  function restoreMovedAvatars("), source.indexOf("  function restoreMovedNodes("))
  const chrome = spawn(process.argv[2] || "C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "yslv-avatar-test-"))}`,
    "about:blank",
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] })
  let socket
  const deadline = setTimeout(() => { chrome.kill(); throw new Error("Browser check timed out") }, 30000)
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = ""
      chrome.once("error", reject)
      chrome.stderr.on("data", chunk => {
        output += chunk
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
        if (match) resolve(match[1])
      })
    })
    socket = new WebSocket(endpoint)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    let id = 0
    const pending = new Map()
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const pair = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) pair.reject(new Error(JSON.stringify(message.error)))
        else pair.resolve(message.result)
      }
    }
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
    const { targetId } = await send("Target.createTarget", { url: "about:blank" })
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true })
    const result = await send("Runtime.evaluate", {
      awaitPromise: true, returnByValue: true,
      expression: `(async () => {
        document.documentElement.setAttribute('data-yslv-subs-view', 'list');
        const style = document.createElement('style');
        style.textContent = ${JSON.stringify(css)};
        document.head.append(style);
        document.body.innerHTML = '<ytd-browse page-subtype="subscriptions"><ytd-rich-item-renderer style="display:block;margin-top:2400px"><div class="yslv-subs-rowhead"><a>Channel</a></div><yt-lockup-view-model><div class="ytLockupMetadataViewModelAvatar"><img width="40" height="40"></div></yt-lockup-view-model></ytd-rich-item-renderer></ytd-browse>';
        const item = document.querySelector('ytd-rich-item-renderer');
        const head = item.firstElementChild;
        const lockup = item.querySelector('yt-lockup-view-model');
        const avatar = lockup.firstElementChild;
        const image = avatar.firstElementChild;
        const STATE = { active: true, view: 'list', movedAvatars: new WeakMap() };
        const CFG = { cls: { rowHead: 'yslv-subs-rowhead' } };
        const isSubscriptionsCard = node => !!node.closest('ytd-browse[page-subtype="subscriptions"]');
        let scheduled = false;
        const enqueue = () => {
          if (scheduled) return;
          scheduled = true;
          requestAnimationFrame(() => { scheduled = false; moveAvatarToHeaderOnce(item, lockup, head) });
        };
        ${code}
        ${restore}
        document.addEventListener('load', onAvatarImageLoad, true);
        const measurable = avatar.getBoundingClientRect().height > 0 && getComputedStyle(avatar).display !== 'none';
        moveAvatarToHeaderOnce(item, lockup, head);
        const deferred = avatar.parentNode === lockup;
        const observer = new IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) {
            observer.disconnect();
            image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="20" fill="red"/></svg>');
          }
        });
        observer.observe(avatar);
        item.scrollIntoView();
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('lazy avatar never loaded/moved')), 5000);
          const check = () => {
            if (avatar.parentNode === head && image.naturalWidth > 0) { clearTimeout(timeout); resolve() }
            else requestAnimationFrame(check);
          };
          check();
        });
        const visible = getComputedStyle(avatar).opacity === '1' && getComputedStyle(avatar).display !== 'none';
        restoreMovedAvatars();
        return { measurable, deferred, visible, restored: avatar.parentNode === lockup };
      })()`,
    }, sessionId)
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    assert.deepEqual(result.result.value, { measurable: true, deferred: true, visible: true, restored: true })
    console.log("PASS: Chrome lazy avatar loads after scrolling, moves visibly to the header, and restores to grid.")
    await send("Browser.close")
  } finally {
    clearTimeout(deadline)
    socket?.close()
    chrome.kill()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
