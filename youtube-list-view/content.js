(function() {
    'use strict';
    
    // Configuración
    const CONFIG = {
        maxConcurrentFetches: 10,
        debounceDelay: 300,
        retryAttempts: 1,
        cacheExpiration: 1000 * 60 * 60 // 1 hora
    };
    
    const descriptionCache = new Map();
    let fetchQueue = [];
    let activeFetches = 0;
    let estaNavegando = false;
    
    function isSubscriptionsPage() {
        return window.location.href.includes('/feed/subscriptions');
    }
    
    function ensurePageAttribute(isEnabled) {
        // SI ESTAMOS NAVEGANDO, NO TOCAMOS NADA.
        if (estaNavegando) return;

        const browse = document.querySelector('ytd-browse');
        if (!browse) return;

        const onSubs = isSubscriptionsPage();
        
        // Lógica estricta: Solo aplicar si está habilitado Y estamos en suscripciones
        if (isEnabled && onSubs) {
            if (browse.getAttribute('page-subtype') !== 'subscriptions') {
                browse.setAttribute('page-subtype', 'subscriptions');
            }
        } else {
            // En cualquier otro caso (deshabilitado O no suscripciones), limpiar atributo
            if (browse.getAttribute('page-subtype') === 'subscriptions') {
                browse.removeAttribute('page-subtype');
            }
        }
    }
    
    function extractDescription(html) {
        try {
            const metaMatch = html.match(/<meta name="description" content="([^"]*)"/);
            if (metaMatch && metaMatch[1]) {
                return metaMatch[1]
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/&nbsp;/g, ' ')
                    .trim();
            }
        } catch (error) {
            console.warn('Error extracting description:', error);
        }
        return null;
    }
    
    async function fetchDescription(url, retries = CONFIG.retryAttempts) {
        const cached = descriptionCache.get(url);
        if (cached && (Date.now() - cached.timestamp < CONFIG.cacheExpiration)) {
            return cached.description;
        }
        
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const html = await response.text();
            const description = extractDescription(html);
            
            descriptionCache.set(url, {
                description,
                timestamp: Date.now()
            });
            
            return description;
        } catch (error) {
            if (retries > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                return fetchDescription(url, retries - 1);
            }
            return null;
        }
    }
    
    async function processFetchQueue() {
        while (fetchQueue.length > 0 && activeFetches < CONFIG.maxConcurrentFetches) {
            const task = fetchQueue.shift();
            if (task) {
                activeFetches++;
                task().finally(() => {
                    activeFetches--;
                    processFetchQueue();
                });
            }
        }
    }
    
        function addChannelHeader(item) {
            if (estaNavegando) return;
            
            // Verificación física: ¿Existe el header?
            const hasHeader = !!item.querySelector('.custom-video-header');
            if (item.dataset.headerProcessed === 'true' && hasHeader) return;
            
            const lockup = item.querySelector('.yt-lockup-view-model');
            const metadataModel = item.querySelector('yt-content-metadata-view-model');
            
            if (!lockup || !metadataModel) return;
    
            let customHeader = item.querySelector('.custom-video-header');
            if (!customHeader) {
                customHeader = document.createElement('div');
                customHeader.className = 'custom-video-header';
                item.insertBefore(customHeader, item.firstChild);
            }
            
            const moveAvatar = () => {
                if (estaNavegando) return;
                const avatarContainer = item.querySelector('.yt-lockup-metadata-view-model__avatar');
                if (avatarContainer && !customHeader.querySelector('.yt-lockup-metadata-view-model__avatar')) {
                    const channelLinkEl = metadataModel.querySelector('a');
                    if (channelLinkEl && !avatarContainer.querySelector('.custom-avatar-link')) {
                        const anchor = document.createElement('a');
                        anchor.href = channelLinkEl.href;
                        anchor.classList.add('custom-avatar-link');
                        while (avatarContainer.firstChild) {
                            anchor.appendChild(avatarContainer.firstChild);
                        }
                        avatarContainer.appendChild(anchor);
                    }
                    customHeader.appendChild(avatarContainer);
                    return true;
                }
                return false;
            };
    
            moveAvatar();
            
            if (!customHeader.querySelector('.cloned-channel-name')) {
                const originalChannelRow = metadataModel.querySelector('.yt-content-metadata-view-model__metadata-row');
                if (originalChannelRow) {
                    const clone = originalChannelRow.cloneNode(true);
                    clone.classList.add('cloned-channel-name');
                    customHeader.appendChild(clone);
                }
            }
            
            item.dataset.headerProcessed = 'true';
        }
    
        function addDescriptionToItem(item, url) {
            return async () => {
                if (estaNavegando) return;
                try {
                    const description = await fetchDescription(url);
                    const descDiv = item.querySelector('.custom-description');
                    
                    if (description && description.trim() !== "" && descDiv) {
                        descDiv.textContent = description;
                    }
                    
                    item.dataset.descAdded = 'true';
                    delete item.dataset.descFetching;
                } catch (error) {
                    item.dataset.descAdded = 'true';
                    delete item.dataset.descFetching;
                }
            };
        }
        
    function getVideoId(url) {
        if (!url) return null;
        try {
            const urlObj = new URL(url);
            return urlObj.searchParams.get('v');
        } catch (e) {
            return null;
        }
    }

    function processItems() {
        if (estaNavegando) return;
        if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
        
        try {
            chrome.storage.local.get(['enabled'], function(result) {
                if (chrome.runtime.lastError) return;
                const isEnabled = result ? result.enabled !== false : true;
                ensurePageAttribute(isEnabled);
                
                if (!isEnabled || !isSubscriptionsPage()) return;
                
                const items = document.querySelectorAll('ytd-rich-item-renderer:not(ytd-rich-section-renderer ytd-rich-item-renderer)');
                
                items.forEach((item) => {
                    const titleLink = item.querySelector('a[href*="/watch"]');
                    const videoUrl = titleLink ? titleLink.href : '';
                    const videoId = getVideoId(videoUrl);
                    
                    // Si no hay ID de video (transición o invalido), no tocamos nada
                    if (!videoId) return;

                    // Sincronización física: Si ya tiene texto, marcamos como añadido
                    const descDiv = item.querySelector('.custom-description');
                    const hasDescriptionText = descDiv && descDiv.textContent.trim().length > 0;
                    if (hasDescriptionText) {
                        item.dataset.descAdded = 'true';
                    }

                    // DETECCIÓN DE CAMBIO ROBUSTA: Comparamos IDs, no URLs completas
                    if (item.dataset.lastVideoId && item.dataset.lastVideoId !== videoId) {
                        delete item.dataset.headerProcessed;
                        delete item.dataset.descAdded;
                        delete item.dataset.descFetching;
                        // MEJORA VISUAL: NO borramos el texto sincrónicamente.
                        // Dejamos el texto anterior hasta que el nuevo llegue y lo sobrescriba.
                        // Esto evita el "parpadeo" (texto -> vacío -> texto).
                        // if (descDiv) descDiv.textContent = ''; 
                    }
                    item.dataset.lastVideoId = videoId;

                    addChannelHeader(item);
                    
                    // Si ya está añadido y tiene texto (y coincide con el ID actual según nuestra lógica de flujo), saltamos
                    if ((item.dataset.descAdded === 'true' && hasDescriptionText) || item.dataset.descFetching === 'true') return;
                    
                    // PRE-INSERCIÓN: Aseguramos que el contenedor existe
                    const metadataRow = item.querySelector('.yt-lockup-metadata-view-model__metadata');
                    if (metadataRow && !descDiv) {
                        const newDescDiv = document.createElement('div');
                        newDescDiv.className = 'custom-description';
                        metadataRow.parentNode.insertBefore(newDescDiv, metadataRow.nextSibling);
                    } else if (descDiv && !hasDescriptionText) {
                        item.dataset.descAdded = 'false';
                    }

                    if (item.dataset.descAdded !== 'true') {
                        item.dataset.descFetching = 'true';
                        fetchQueue.push(addDescriptionToItem(item, videoUrl));
                    }
                });
                
                processFetchQueue();
            });
        } catch (e) {}
    }    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    const debouncedProcess = debounce(processItems, CONFIG.debounceDelay);
    
    let observer = null;
    function setupObserver() {
        if (observer) observer.disconnect();
        observer = new MutationObserver((mutations) => {
            if (estaNavegando) return;
            const hasRelevantChanges = mutations.some(mutation => {
                return Array.from(mutation.addedNodes).some(node => {
                    if (node.nodeType !== 1) return false;
                    return node.tagName === 'YTD-RICH-ITEM-RENDERER' ||
                           node.querySelector?.('ytd-rich-item-renderer');
                });
            });
            if (hasRelevantChanges) debouncedProcess();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    
    function init() {
        if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
        estaNavegando = false; // Confirmamos que ya no estamos navegando
        try {
            chrome.storage.local.get(['enabled'], function(result) {
                if (chrome.runtime.lastError) return;
                const isEnabled = result ? result.enabled !== false : true;
                ensurePageAttribute(isEnabled);
                if (isEnabled && isSubscriptionsPage()) processItems();
                setupObserver();
            });
        } catch (e) {
            console.debug('[YouTube List View] Extension context invalidated.');
        }
    }
    
    // ESCUCHADORES DE EVENTOS DE YOUTUBE
    
    // 1. Al empezar a navegar: LIMPIEZA TOTAL
    document.addEventListener('yt-navigate-start', () => {
        estaNavegando = true; // Bloqueamos cualquier proceso de la extensión
        fetchQueue = []; // Limpiamos la cola para no arrastrar peticiones de la página anterior
        const browse = document.querySelector('ytd-browse');
        if (browse) browse.removeAttribute('page-subtype'); // Quitamos el estilo de lista YA
    });

    // 2. Al terminar de navegar: REINICIO
    document.addEventListener('yt-navigate-finish', init);
    document.addEventListener('yt-page-data-updated', init); // Fallback para cambios de datos en la misma SPA
    
    // Fallback inicial
    init();
    
    // Limpieza de caché
    setInterval(() => {
        const now = Date.now();
        for (const [url, data] of descriptionCache.entries()) {
            if (now - data.timestamp > CONFIG.cacheExpiration) descriptionCache.delete(url);
        }
    }, 1000 * 60 * 10);
    
})();
