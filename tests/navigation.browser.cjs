// Full content-script integration against a local SPA fixture in a fresh Chrome profile.
const { spawn } = require('node:child_process')
const { readFileSync, mkdtempSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const assert = require('node:assert/strict')

async function main() {
  const server = http.createServer((_, response) => response.end('<!doctype html><html><head></head><body></body></html>'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let socket, chrome
  const deadline = setTimeout(() => { chrome?.kill(); throw new Error('Navigation browser test timed out') }, 30000)
  try {
    chrome = spawn(process.argv[2] || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
      '--user-data-dir=' + mkdtempSync(path.join(os.tmpdir(), 'yslv-navigation-')), 'about:blank',
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    const endpoint = await new Promise((resolve, reject) => {
      let output = ''
      chrome.once('error', reject)
      chrome.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]) })
    })
    socket = new WebSocket(endpoint)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    let id = 0
    const pending = new Map()
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (!message.id) return
      const pair = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) pair.reject(new Error(JSON.stringify(message.error)))
      else pair.resolve(message.result)
    }
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }, sessionId)
    let source = readFileSync(path.join(__dirname, '../youtube-list-view/content.js'), 'utf8')
    source = source.replace(/  init\(\)\r?\n/, `
      const counts = { scans: 0, patches: 0 };
      const scan = processSections, patch = patchItem;
      processSections = (...args) => { counts.scans++; return scan(...args) };
      patchItem = (...args) => { counts.patches++; return patch(...args) };
      window.__yslvTest = { STATE, counts };
      init();\n`)
    const css = readFileSync(path.join(__dirname, '../youtube-list-view/styles.css'), 'utf8')
    const shorts = readFileSync(path.join(__dirname, '../youtube-list-view/shorts-main.js'), 'utf8')
    const result = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true,
      expression: `(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const check = (condition, message) => { if (!condition) throw new Error(message) };
        const icon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>');
        document.body.innerHTML = '<ytd-page-manager><ytd-browse page-subtype="home"><ytd-rich-item-renderer id="home-card">Native Home</ytd-rich-item-renderer></ytd-browse><ytd-browse page-subtype="subscriptions" hidden><ytd-rich-grid-renderer><div id="contents" class="ytd-rich-grid-renderer"><ytd-rich-section-renderer><div id="title-container"><h2 id="title">Más recientes</h2><button id="subscribe-button">Todas las suscripciones</button></div></ytd-rich-section-renderer><ytd-rich-item-renderer id="sub-card"><yt-lockup-view-model><div><a id="thumbnail" href="/watch?v=abcdefghijk"><img width="260" height="146"></a><div class="yt-lockup-view-model__metadata"><div class="ytLockupMetadataViewModelAvatar"><a href="/@channel"><img width="40" height="40"></a></div><div class="yt-lockup-metadata-view-model__text-container"><h3><a href="/watch?v=abcdefghijk">Video title</a></h3><yt-content-metadata-view-model><div class="yt-content-metadata-view-model__metadata-row"><a href="/@channel">Channel</a></div><div class="yt-content-metadata-view-model__metadata-row">100 views</div></yt-content-metadata-view-model></div></div></div></yt-lockup-view-model></ytd-rich-item-renderer></div></ytd-rich-grid-renderer></ytd-browse></ytd-page-manager>';
        document.querySelectorAll('img').forEach(img => img.src = icon);
        await Promise.all([...document.images].map(img => img.decode()));
        const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
        localStorage.setItem('yslv', 'list');
        const settings = { hideMostRelevant: false, hideShorts: false, channelVideoGap: 0 };
        window.chrome = { runtime: { id: 'test' }, storage: {
          local: { get: (keys, callback) => setTimeout(() => callback(keys.includes('yslv_desc_cache_v1') ? {} : settings), 5), set() {} },
          onChanged: { addListener() {} }
        } };
        window.fetch = async () => ({ ok: true, text: async () => 'ytInitialPlayerResponse = {"videoDetails":{"shortDescription":"Test description."}};' });
        let resizes = 0; window.addEventListener('resize', () => resizes++);
        const home = document.querySelector('[page-subtype="home"]'), subs = document.querySelector('[page-subtype="subscriptions"]');
        document.body.insertAdjacentHTML('afterbegin', '<ytd-masthead style="position:fixed">Native header</ytd-masthead>');
        home.insertAdjacentHTML('beforeend', '<span id="title-text">Native title</span>');
        const shelfMarkup = '<ytd-rich-shelf-renderer><h2 id="title">Shorts</h2><ytm-shorts-lockup-view-model></ytm-shorts-lockup-view-model></ytd-rich-shelf-renderer>';
        home.insertAdjacentHTML('beforeend', shelfMarkup);
        subs.querySelector('#contents').insertAdjacentHTML('beforeend', '<ytd-rich-section-renderer>' + shelfMarkup + '</ytd-rich-section-renderer>');
        document.querySelectorAll('ytd-rich-shelf-renderer').forEach(shelf => {
          shelf.contents = Array.from({ length: 18 }, (_, id) => ({ id }));
          shelf.displayedContents = shelf.contents.slice();
          shelf.isExpanded = false;
        });
        const homeHtml = home.innerHTML;
        const thumbnail = document.querySelector('#thumbnail img');
        let thumbnailChanges = 0;
        new MutationObserver(m => thumbnailChanges += m.length).observe(thumbnail, { attributes: true, attributeFilter: ['src', 'srcset'] });
        (0, eval)(${JSON.stringify(source)});
        (0, eval)(${JSON.stringify(shorts)});
        const navigate = path => {
          window.dispatchEvent(new Event('yt-navigate-start'));
          history.pushState({}, '', path);
          home.hidden = path !== '/'; subs.hidden = path === '/';
          window.dispatchEvent(new Event('yt-page-data-updated'));
          window.dispatchEvent(new Event('yt-navigate-finish'));
        };
        for (let i = 0; i < 3; i++) {
          navigate('/feed/subscriptions'); await wait(150);
          const { STATE, counts } = window.__yslvTest;
          check(STATE.active && STATE.view === 'list', 'list activation');
          check(subs.querySelectorAll('.yslv-subs-rowhead').length === 1, 'one channel header');
          check(subs.querySelectorAll('#yslv-subs-toggle').length === 1, 'one view toggle');
          check(subs.querySelector('.yslv-subs-rowhead img')?.naturalWidth > 0, 'avatar loaded');
          check(subs.querySelector('ytd-rich-shelf-renderer').displayedContents.length === 9, 'subscription Shorts limit');
          check(home.querySelector('ytd-rich-shelf-renderer').displayedContents.length === 18, 'Home Shorts untouched');
          check(document.querySelector('#thumbnail img') === thumbnail && thumbnail.naturalWidth > 0, 'same loaded thumbnail');
          check(getComputedStyle(document.documentElement).getPropertyValue('--yslv-channel-video-gap') === '0px', 'zero gap');
          const scans = counts.scans, patches = counts.patches;
          await wait(450);
          check(counts.scans === scans && counts.patches === patches, 'observers settled without feedback');
          navigate('/'); await wait(50);
          check(!STATE.active && !STATE.mo && !STATE.descTimer && !STATE.toggleTimer, 'Home has no active feed work');
          check(home.innerHTML === homeHtml, 'Home markup unchanged');
          check(getComputedStyle(document.querySelector('ytd-masthead')).position === 'fixed', 'Home masthead keeps native position');
          check(getComputedStyle(home.querySelector('#title-text')).position === 'static', 'Home title keeps native styles');
        }
        check(resizes === 0, 'no synthetic navigation resize');
        check(thumbnailChanges === 0, 'no thumbnail source rewrites');
        navigate('/feed/subscriptions'); await wait(150);
        subs.querySelector('button[data-mode="grid"]').click(); await wait(150);
        check(!subs.querySelector('.yslv-subs-rowhead'), 'grid restores native header');
        check(subs.querySelector('.ytLockupMetadataViewModelAvatar img')?.naturalWidth > 0, 'grid restores loaded avatar');
        subs.querySelector('button[data-mode="list"]').click(); await wait(150);
        check(subs.querySelectorAll('.yslv-subs-rowhead').length === 1, 'list header restored once');
        check(document.querySelector('#thumbnail img') === thumbnail && thumbnail.naturalWidth > 0, 'toggle preserves thumbnail');
        check(resizes === 0, 'view toggles need no global resize');
        return { cycles: 3, resizes, thumbnailChanges, settled: true, homePreserved: true };
      })()`,
    }, sessionId)
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    assert.deepEqual(result.result.value, { cycles: 3, resizes: 0, thumbnailChanges: 0, settled: true, homePreserved: true })
    console.log('PASS: complete content script survives 3 Home/subscriptions cycles; observers settle, thumbnails persist, Home stays unchanged.')
    await send('Browser.close')
  } finally {
    clearTimeout(deadline)
    socket?.close()
    chrome?.kill()
    server.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
