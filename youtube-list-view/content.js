(function() {
    'use strict';
    
    // Configuración
    const CONFIG = {
        maxConcurrentFetches: 3,
        debounceDelay: 300,
        retryAttempts: 2,
        cacheExpiration: 1000 * 60 * 30
    };
    
    const descriptionCache = new Map();
    let fetchQueue = [];
    let activeFetches = 0;
    
    function isSubscriptionsPage() {
        return window.location.href.includes('/feed/subscriptions');
    }
    
    function ensurePageAttribute() {
        const browse = document.querySelector('ytd-browse');
        if (!browse) return;

        if (isSubscriptionsPage()) {
            if (browse.getAttribute('page-subtype') !== 'subscriptions') {
                browse.setAttribute('page-subtype', 'subscriptions');
            }
        } else {
            // Si salimos de suscripciones, quitamos el atributo para que el CSS no aplique
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
            
            const jsonMatch = html.match(/var ytInitialData = ({.*?});/);
            if (jsonMatch) {
                try {
                    const data = JSON.parse(jsonMatch[1]);
                    const description = data?.engagementPanels?.[0]?.engagementPanelSectionListRenderer
                        ?.content?.structuredDescriptionContentRenderer?.items?.[1]
                        ?.videoDescriptionHeaderRenderer?.description?.simpleText;
                    if (description) return description.trim();
                } catch (e) {
                    console.warn('Error parsing ytInitialData:', e);
                }
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
            console.error(`Failed to fetch description for ${url}:`, error);
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
    
    /**
     * MOVER AVATAR Y NOMBRE DEL CANAL AL HEADER
     */
    function addChannelHeader(item) {
        if (item.dataset.headerProcessed === 'true') {
            return;
        }
        
        const lockup = item.querySelector('.yt-lockup-view-model');
        const metadataModel = item.querySelector('yt-content-metadata-view-model');
        
        if (!lockup || !metadataModel) {
            return;
        }

        // Crear contenedor del header si no existe
        let customHeader = item.querySelector('.custom-video-header');
        if (!customHeader) {
            customHeader = document.createElement('div');
            customHeader.className = 'custom-video-header';
            item.insertBefore(customHeader, item.firstChild);
        }
        
        // 1. MOVER EL AVATAR AL HEADER
        const moveAvatar = () => {
            const avatarContainer = item.querySelector('.yt-lockup-metadata-view-model__avatar');
            if (avatarContainer && !customHeader.querySelector('.yt-lockup-metadata-view-model__avatar')) {
                // Hacer clickable el avatar
                const channelLinkEl = metadataModel.querySelector('a');
                if (channelLinkEl && !avatarContainer.querySelector('.custom-avatar-link')) {
                    const channelUrl = channelLinkEl.href;
                    const anchor = document.createElement('a');
                    anchor.href = channelUrl;
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

        if (!moveAvatar()) {
            setTimeout(moveAvatar, 100);
            setTimeout(moveAvatar, 500);
        }
        
        // 2. CLONAR NOMBRE DEL CANAL AL HEADER
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
            try {
                const description = await fetchDescription(url);
                
                if (description && description.trim() !== "") {
                    // Buscar el contenedor principal de metadata
                    const metadataContainer = item.querySelector('yt-lockup-metadata-view-model');
                    
                    // Buscar la row de metadata (canal • vistas • fecha)
                    const metadataRow = item.querySelector('.yt-lockup-metadata-view-model__metadata');
                    
                    if (metadataContainer && metadataRow && !item.querySelector('.custom-description')) {
                        const descDiv = document.createElement('div');
                        descDiv.className = 'custom-description';
                        descDiv.textContent = description;
                        
                        // Insertar después de la metadata row
                        metadataRow.parentNode.insertBefore(descDiv, metadataRow.nextSibling);
                    }
                }
                
                item.dataset.descAdded = 'true';
                delete item.dataset.descFetching;
            } catch (error) {
                console.error('Error adding description:', error);
                item.dataset.descAdded = 'true';
                delete item.dataset.descFetching;
            }
        };
    }
    
    function injectDescriptions() {
        chrome.storage.local.get(['enabled', 'showDescriptions'], function(result) {
            if (result.enabled === false) return;
            if (!isSubscriptionsPage()) return;
            
            ensurePageAttribute();
            
            const items = document.querySelectorAll('ytd-rich-item-renderer:not(ytd-rich-section-renderer ytd-rich-item-renderer)');
            
            items.forEach((item) => {
                // 1. Header del canal
                addChannelHeader(item);
                
                // 2. Descripción (solo si está habilitado)
                if (result.showDescriptions === false) return;
                
                if (item.dataset.descAdded === 'true' || item.dataset.descFetching === 'true') {
                    return;
                }
                
                const titleLink = item.querySelector('a[href*="/watch"]');
                if (!titleLink || !titleLink.href) return;
                
                item.dataset.descFetching = 'true';
                fetchQueue.push(addDescriptionToItem(item, titleLink.href));
            });
            
            processFetchQueue();
        });
    }
    
    function debounce(func, wait) {
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
    
    const debouncedInject = debounce(injectDescriptions, CONFIG.debounceDelay);
    
    function setupObserver() {
        const targetNode = document.querySelector('ytd-browse') || document.body;
        
        const observer = new MutationObserver((mutations) => {
            const hasRelevantChanges = mutations.some(mutation => {
                return Array.from(mutation.addedNodes).some(node => {
                    if (node.nodeType !== 1) return false;
                    if (node.closest && node.closest('ytd-rich-section-renderer')) {
                        return false;
                    }
                    return node.tagName === 'YTD-RICH-ITEM-RENDERER' ||
                           node.querySelector?.('ytd-rich-item-renderer');
                });
            });
            
            if (hasRelevantChanges) {
                debouncedInject();
            }
        });
        
        observer.observe(targetNode, {
            childList: true,
            subtree: true
        });
        
        return observer;
    }
    
    function cleanupCache() {
        const now = Date.now();
        for (const [url, data] of descriptionCache.entries()) {
            if (now - data.timestamp > CONFIG.cacheExpiration) {
                descriptionCache.delete(url);
            }
        }
    }
    
    function init() {
        chrome.storage.local.get(['enabled'], function(result) {
            if (result.enabled === false) {
                console.log('❌ YouTube List View: Desactivado por el usuario');
                return;
            }

            if (!isSubscriptionsPage()) return;
            
            console.log('🚀 YouTube List View: Inicializando...');
            
            ensurePageAttribute();
            injectDescriptions();
            setupObserver();
            
            setInterval(cleanupCache, 1000 * 60 * 10);
            
            console.log('✅ YouTube List View: Activo');
        });
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    let lastUrl = location.href;
    new MutationObserver(() => {
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            if (isSubscriptionsPage()) {
                setTimeout(init, 500);
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
    
})();
