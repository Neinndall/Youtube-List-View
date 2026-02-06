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
    function updateNativeDataMap() {
        try {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                if (script.textContent.includes('var ytInitialData =')) {
                    const jsonStr = script.textContent.split('var ytInitialData =')[1].split('};')[0] + '}';
                    const data = JSON.parse(jsonStr);
                    const processObj = (obj) => {
                        if (!obj || typeof obj !== 'object') return;
                        if (obj.videoRenderer) {
                            const v = obj.videoRenderer;
                            const vidId = v.videoId;
                            if (vidId) {
                                // Extraer todo lo posible
                                const desc = v.descriptionSnippet?.runs?.[0]?.text;
                                const name = v.ownerText?.runs?.[0]?.text;
                                const avatar = v.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail?.thumbnails?.[0]?.url;
                                
                                // Guardar en el mapa si tenemos ALGO
                                if (desc || name || avatar) {
                                    videoDataMap.set(vidId, {
                                        description: desc,
                                        channelName: name,
                                        avatarUrl: avatar
                                    });
                                }
                            }
                        }
                        Object.values(obj).forEach(processObj);
                    };
                    processObj(data);
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
        if (estaNavegando) return;
        const browse = document.querySelector('ytd-browse');
        if (!browse) return;
        const onSubs = isSubscriptionsPage();
        if (isEnabled && onSubs) {
            if (browse.getAttribute('page-subtype') !== 'subscriptions') {
                browse.setAttribute('page-subtype', 'subscriptions');
            }
        } else {
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
        
        chrome.storage.local.get(['enabled'], function(result) {
            if (chrome.runtime.lastError) return;
            const isEnabled = result.enabled !== false;
            ensurePageAttribute(isEnabled);
            if (!isEnabled || !isSubscriptionsPage()) return;
            
            updateNativeDataMap();

            const items = document.querySelectorAll('ytd-rich-item-renderer:not(ytd-rich-section-renderer ytd-rich-item-renderer)');
            
            items.forEach((item) => {
                const titleLink = item.querySelector('a[href*="/watch"]');
                const videoUrl = titleLink ? titleLink.href : '';
                const videoId = getVideoId(videoUrl);
                
                if (!videoId) return;

                if (item.dataset.lastVideoId && item.dataset.lastVideoId !== videoId) {
                    item.querySelectorAll('.custom-video-header, .custom-description').forEach(el => el.remove());
                    delete item.dataset.processed;
                    delete item.dataset.fetching;
                }
                item.dataset.lastVideoId = videoId;

                // 1. Intentar datos nativos (Capa 1)
                const nativeData = videoDataMap.get(videoId);
                if (nativeData) updateItemUI(item, nativeData);

                // 2. DOM Fallback (Limitado): SOLO si no tenemos nada
                if (!nativeData) {
                    const domAvatar = item.querySelector('#avatar-link img, ytd-channel-name + a #img');
                    const domName = item.querySelector('ytd-channel-name #text');
                    
                    if (domAvatar && domAvatar.src && !item.querySelector('.custom-avatar-wrapper')) {
                         updateItemUI(item, { avatarUrl: domAvatar.src });
                    }
                    if (domName && domName.textContent && !item.querySelector('.cloned-channel-name')) {
                         updateItemUI(item, { channelName: domName.textContent.trim() });
                    }
                }

                // 3. Extracción Remota (Capa 3)
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
                            if (remoteData.avatarUrl && remoteData.channelName) {
                                videoDataMap.set(videoId, remoteData);
                            }
                        }
                        item.dataset.processed = 'true';
                        delete item.dataset.fetching;
                    });
                }
            });
            processFetchQueue();
        });
    }
    
    const debouncedProcess = (function(f, w) {
        let t; return function(...a) { clearTimeout(t); t = setTimeout(() => f(...a), w); };
    })(processItems, CONFIG.debounceDelay);
    
    function init() {
        if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
        estaNavegando = false;
        chrome.storage.local.get(['enabled'], (res) => {
            const en = res.enabled !== false;
            ensurePageAttribute(en);
            if (en && isSubscriptionsPage()) processItems();
            if (!observer) {
                observer = new MutationObserver(() => { if (!estaNavegando) debouncedProcess(); });
                observer.observe(document.body, { childList: true, subtree: true });
            }
        });
    }
    
    let observer = null;
    document.addEventListener('yt-navigate-start', () => {
        estaNavegando = true; fetchQueue = [];
        const browse = document.querySelector('ytd-browse');
        if (browse) browse.removeAttribute('page-subtype');
    });
    document.addEventListener('yt-navigate-finish', init);
    document.addEventListener('yt-page-data-updated', init);
    init();
})();