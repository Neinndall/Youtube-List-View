(function() {
    'use strict';
    
    const CONFIG = {
        maxConcurrentFetches: 15,
        debounceDelay: 100,
        retryAttempts: 1,
        cacheExpiration: 1000 * 60 * 60
    };
    
    // Almacén central de datos: videoId -> { description, channelName, avatarUrl }
    const videoDataMap = new Map();
    const cache = new Map();
    const processedItems = new WeakSet();
    let fetchQueue = [];
    let activeFetches = 0;
    let estaNavegando = false;
    
    function isSubscriptionsPage() {
        return window.location.href.includes('/feed/subscriptions');
    }
    
    function getVideoId(url) {
        if (!url) return null;
        try { return new URL(url).searchParams.get('v'); } catch (e) { return null; }
    }

    // --- CAPA 1: DATOS NATIVOS (ytInitialData) ---
    let lastParsedJson = null;
    function updateNativeDataMap() {
        try {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                if (script.textContent.includes('var ytInitialData =')) {
                    const scriptContent = script.textContent;
                    if (scriptContent === lastParsedJson) return; 
                    
                    lastParsedJson = scriptContent;
                    const jsonStr = scriptContent.split('var ytInitialData =')[1].split('};')[0] + '}';
                    const data = JSON.parse(jsonStr);
                    
                    // Búsqueda dirigida en lugar de recursividad total
                    // La ruta suele ser: contents.twoColumnBrowseResultsRenderer.tabs[0].content.richGridRenderer.contents
                    const items = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.content?.richGridRenderer?.contents || [];
                    
                    items.forEach(item => {
                        const v = item.richItemRenderer?.content?.videoRenderer;
                        if (v && v.videoId) {
                            const vidId = v.videoId;
                            const desc = v.descriptionSnippet?.runs?.[0]?.text;
                            const name = v.ownerText?.runs?.[0]?.text;
                            const avatar = v.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail?.thumbnails?.[0]?.url;
                            
                            if (desc || name || avatar) {
                                const existing = videoDataMap.get(vidId) || {};
                                videoDataMap.set(vidId, {
                                    description: desc || existing.description,
                                    channelName: name || existing.channelName,
                                    avatarUrl: avatar || existing.avatarUrl
                                });
                            }
                        }
                    });
                    break;
                }
            }
        } catch (e) {}
    }

    // --- CAPA 3: EXTRACCIÓN REMOTA (Desde la página del video) ---
    async function fetchVideoDetails(url, retries = CONFIG.retryAttempts) {
        // Verificar caché
        const cached = cache.get(url);
        if (cached && (Date.now() - cached.timestamp < CONFIG.cacheExpiration)) return cached.data;
        
        try {
            const response = await fetch(url);
            const html = await response.text();
            
            // 1. Descripción (Meta tag)
            const metaMatch = html.match(/<meta name="description" content="([^"]*)"/);
            const description = metaMatch ? metaMatch[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : null;

            // 2. Avatar del CANAL (Buscamos específicamente el renderer del dueño, NO el user avatar)
            // Buscamos "videoOwnerRenderer" o "channelThumbnailWithLinkRenderer" para asegurar que es el creador
            let avatarUrl = null;
            const ownerAvatarMatch = html.match(/"channelThumbnailWithLinkRenderer":\{"thumbnail":\{"thumbnails":\[\{"url":"([^"]+)"/);
            if (ownerAvatarMatch) {
                avatarUrl = ownerAvatarMatch[1];
            } else {
                // Fallback: buscar cerca de owner
                const alternateMatch = html.match(/"owner":\{.*?"thumbnails":\[\{"url":"([^"]+)"/);
                if (alternateMatch) avatarUrl = alternateMatch[1];
            }

            // 3. Nombre del Canal
            let channelName = null;
            const nameMatch = html.match(/"owner":{"videoOwnerRenderer":.*?"title":{"runs":\[{"text":"([^"]+)"/);
            if (nameMatch) channelName = nameMatch[1];

            const result = { description, channelName, avatarUrl };
            cache.set(url, { data: result, timestamp: Date.now() });
            return result;
        } catch (error) {
            if (retries > 0) return fetchVideoDetails(url, retries - 1);
            return null;
        }
    }
    
    function ensurePageAttribute(isEnabled) {
        const browse = document.querySelector('ytd-browse');
        if (!browse) return;

        const onSubs = isSubscriptionsPage();
        if (isEnabled && onSubs) {
            if (browse.getAttribute('page-subtype') !== 'subscriptions') {
                browse.setAttribute('page-subtype', 'subscriptions');
            }
        } else if (!onSubs) {
            if (browse.getAttribute('page-subtype') === 'subscriptions') {
                browse.removeAttribute('page-subtype');
            }
        }
    }
    
    async function processFetchQueue() {
        while (fetchQueue.length > 0 && activeFetches < CONFIG.maxConcurrentFetches) {
            const task = fetchQueue.shift();
            if (task) {
                activeFetches++;
                task().finally(() => { activeFetches--; processFetchQueue(); });
            }
        }
    }
    
    // CONSTRUCTOR DE UI
    function updateItemUI(item, data) {
        if (!data) return;

        // --- HEADER (Avatar + Nombre) ---
        let customHeader = item.querySelector('.custom-video-header');
        if (!customHeader) {
            customHeader = document.createElement('div');
            customHeader.className = 'custom-video-header';
            item.insertBefore(customHeader, item.firstChild);
        }

        // Avatar
        if (data.avatarUrl) {
            let wrapper = customHeader.querySelector('.custom-avatar-wrapper');
            if (!wrapper) {
                wrapper = document.createElement('div');
                wrapper.className = 'custom-avatar-wrapper';
                const img = document.createElement('img');
                img.src = data.avatarUrl;
                wrapper.appendChild(img);
                customHeader.appendChild(wrapper);
            } else {
                // Si ya existe, nos aseguramos que la URL sea la correcta (la del JSON, no la del DOM viejo)
                const img = wrapper.querySelector('img');
                if (img && img.src !== data.avatarUrl) img.src = data.avatarUrl;
            }
        }

        // Nombre
        if (data.channelName) {
            let nameDiv = customHeader.querySelector('.cloned-channel-name');
            if (!nameDiv) {
                nameDiv = document.createElement('div');
                nameDiv.className = 'cloned-channel-name';
                const span = document.createElement('span'); 
                span.textContent = data.channelName;
                span.style.color = '#fff';
                span.style.fontWeight = 'bold';
                nameDiv.appendChild(span);
                customHeader.appendChild(nameDiv);
            } else {
                 const span = nameDiv.querySelector('span') || nameDiv.querySelector('a');
                 if (span && span.textContent !== data.channelName) span.textContent = data.channelName;
            }
        }

        // --- DESCRIPCIÓN ---
        let descDiv = item.querySelector('.custom-description');
        if (!descDiv) {
            const metadataArea = item.querySelector('#metadata, .yt-lockup-view-model__metadata');
            if (metadataArea) {
                descDiv = document.createElement('div');
                descDiv.className = 'custom-description';
                metadataArea.appendChild(descDiv);
            }
        }
        
        if (descDiv && data.description && !descDiv.textContent) {
            descDiv.textContent = data.description;
        }
    }

    function processItems() {
        if (estaNavegando) return;
        if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
        
        // Usar caché rápida si existe, si no, consultar storage (pero no bloquear)
        if (isEnabledCache !== null) {
            runProcess(isEnabledCache);
        } else {
            chrome.storage.local.get(['enabled'], function(result) {
                if (chrome.runtime.lastError) return;
                isEnabledCache = result.enabled !== false;
                runProcess(isEnabledCache);
            });
        }
    }

    function runProcess(isEnabled) {
        ensurePageAttribute(isEnabled);
        if (!isEnabled || !isSubscriptionsPage()) return;
        
        // Solo actualizamos el mapa de datos si no tenemos nada o si es una carga fresca
        if (videoDataMap.size === 0) updateNativeDataMap();

        const items = document.querySelectorAll('ytd-rich-item-renderer:not(ytd-rich-section-renderer ytd-rich-item-renderer)');
        items.forEach(item => {
            if (!processedItems.has(item)) {
                processSingleItem(item);
            }
        });
        processFetchQueue();
    }

    function processSingleItem(item) {
        if (!item) return;
        
        const titleLink = item.querySelector('a[href*="/watch"]');
        const videoUrl = titleLink ? titleLink.href : '';
        const videoId = getVideoId(videoUrl);
        
        if (!videoId) return;

        // Reset si el video ha cambiado en este slot (YouTube reutiliza elementos al hacer scroll)
        if (item.dataset.lastVideoId && item.dataset.lastVideoId !== videoId) {
            item.querySelectorAll('.custom-video-header, .custom-description').forEach(el => el.remove());
            delete item.dataset.processed;
            delete item.dataset.fetching;
            // Si ha cambiado el video, permitimos que se vuelva a procesar
            processedItems.delete(item);
            processedItems.add(item); 
        }
        item.dataset.lastVideoId = videoId;
        processedItems.add(item);

        // --- PRIORIDAD 1: DATOS EN MEMORIA (Instantáneo) ---
        const cachedData = videoDataMap.get(videoId);
        if (cachedData) {
            updateItemUI(item, cachedData);
        }

        // --- PRIORIDAD 2: DOM FALLBACK (Instantáneo) ---
        // Intentamos capturar del DOM de YouTube antes de que se oculte o cambie
        const domAvatar = item.querySelector('#avatar-link img, ytd-channel-name + a #img, .yt-lockup-metadata-view-model__avatar img');
        const domName = item.querySelector('ytd-channel-name #text, .yt-lockup-metadata-view-model__title-container + div #text');
        
        if (domAvatar && domAvatar.src && !item.querySelector('.custom-avatar-wrapper')) {
             updateItemUI(item, { avatarUrl: domAvatar.src });
        }
        if (domName && domName.textContent && !item.querySelector('.cloned-channel-name')) {
             updateItemUI(item, { channelName: domName.textContent.trim() });
        }

        // --- PRIORIDAD 3: FETCH REMOTO (Debounced/Queue) ---
        const hasDesc = !!item.querySelector('.custom-description')?.textContent;
        const hasAvatar = !!item.querySelector('.custom-avatar-wrapper');

        if (hasDesc && hasAvatar) {
            item.dataset.processed = 'true';
        } else if (item.dataset.fetching !== 'true') {
            item.dataset.fetching = 'true';
            fetchQueue.push(async () => {
                const remoteData = await fetchVideoDetails(videoUrl);
                if (remoteData) {
                    updateItemUI(item, remoteData);
                    // Guardar en el mapa global para futuros usos (scroll back)
                    if (remoteData.avatarUrl || remoteData.channelName) {
                        const existing = videoDataMap.get(videoId) || {};
                        videoDataMap.set(videoId, { ...existing, ...remoteData });
                    }
                }
                item.dataset.processed = 'true';
                delete item.dataset.fetching;
            });
        }
    }
    
    let isEnabledCache = null;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(['enabled'], (res) => {
            isEnabledCache = res.enabled !== false;
        });
    }

    const debouncedProcess = (function(f, w) {
        let t; return function(...a) { clearTimeout(t); t = setTimeout(() => f(...a), w); };
    })(processItems, CONFIG.debounceDelay);
    
    function init() {
        if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
        estaNavegando = false;
        
        const onSubs = isSubscriptionsPage();
        if (isEnabledCache && onSubs) {
            ensurePageAttribute(true);
            processItems();
        } else {
            ensurePageAttribute(false);
        }

        if (!observer) {
            observer = new MutationObserver((mutations) => { 
                if (estaNavegando) return;
                
                let shouldDebounce = false;
                for (const mutation of mutations) {
                    if (mutation.addedNodes.length) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === 1) {
                                // Si es un item de video, procesarlo AL INSTANTE (sin debounce)
                                if (node.tagName === 'YTD-RICH-ITEM-RENDERER') {
                                    const isEnabled = isEnabledCache !== false; // Optimista: true si es null
                                    if (isEnabled && isSubscriptionsPage()) processSingleItem(node);
                                } else {
                                    // Para otros cambios, usar debounce normal
                                    shouldDebounce = true;
                                }
                            }
                        }
                    }
                }
                if (shouldDebounce) debouncedProcess(); 
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }
    
    let observer = null;
    document.addEventListener('yt-navigate-start', (event) => {
        estaNavegando = true; 
        fetchQueue = [];
        
        // LIMPIEZA TOTAL: Al navegar, sea a donde sea, quitamos el estilo de lista.
        // Esto garantiza que la página que estamos dejando (ej. Inicio) NO se rompa.
        const browse = document.querySelector('ytd-browse');
        if (browse) {
            browse.removeAttribute('page-subtype');
        }
    });
    document.addEventListener('yt-navigate-finish', () => {
        updateNativeDataMap();
        init();
    });
    document.addEventListener('yt-page-data-updated', () => {
        updateNativeDataMap();
        debouncedProcess();
    });
    init();
})();