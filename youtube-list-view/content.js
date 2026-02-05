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
        if (browse && !browse.getAttribute('page-subtype')) {
            browse.setAttribute('page-subtype', 'subscriptions');
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
     * CORREGIDA CON SELECTORES EXACTOS del HTML real
     */
    function addChannelHeader(item) {
        if (item.querySelector('.custom-channel-header')) {
            return;
        }
        
        let channelName = null;
        let channelUrl = null;
        let avatarUrl = null;
        
        // SELECTOR EXACTO basado en tu HTML:
        // <a class="yt-core-attributed-string__link..." href="/@MARTIIE">MARTIIE</a>
        const channelLink = item.querySelector('a.yt-core-attributed-string__link[href*="/@"]') ||
                           item.querySelector('a.yt-core-attributed-string__link[href*="/channel/"]') ||
                           item.querySelector('a[href*="/@"]:not([href*="/watch"])') ||
                           item.querySelector('yt-content-metadata-view-model a');
        
        if (channelLink) {
            channelName = channelLink.textContent.trim();
            channelUrl = channelLink.href;
        }
        
        // AVATAR: Buscar en yt-spec-avatar-shape__image
        const avatarImg = item.querySelector('.yt-spec-avatar-shape__image') ||
                         item.querySelector('yt-avatar-shape img') ||
                         item.querySelector('.yt-lockup-metadata-view-model__avatar img');
        
        if (avatarImg) {
            // El src puede estar vacío, intentar obtenerlo de varios atributos
            avatarUrl = avatarImg.src || avatarImg.getAttribute('src') || '';
            
            // Si sigue vacío, esperar a que se cargue
            if (!avatarUrl && avatarImg.loading === 'lazy') {
                // Forzar carga de imagen lazy
                avatarImg.loading = 'eager';
                setTimeout(() => {
                    if (avatarImg.src) {
                        const header = item.querySelector('.custom-channel-header img');
                        if (header) header.src = avatarImg.src;
                    }
                }, 100);
            }
        }
        
        if (!channelName || !channelUrl) {
            console.warn('❌ No se pudo extraer canal de:', item);
            console.log('channelLink encontrado:', channelLink);
            return;
        }
        
        // Crear header
        const header = document.createElement('div');
        header.className = 'custom-channel-header';
        
        const avatarHTML = avatarUrl ? 
            `<img src="${avatarUrl}" class="custom-channel-header__avatar" alt="${channelName}" onerror="this.style.display='none'">` : 
            `<div class="custom-channel-header__avatar-placeholder">📺</div>`;
        
        header.innerHTML = `
            <a href="${channelUrl}" class="custom-channel-header__link">
                ${avatarHTML}
                <span class="custom-channel-header__name">${channelName}</span>
            </a>
        `;
        
        item.insertBefore(header, item.firstChild);
        
        console.log('✅ Header creado:', channelName);
    }
    
    function addDescriptionToItem(item, url) {
        return async () => {
            try {
                const description = await fetchDescription(url);
                
                if (description && description.trim() !== "") {
                    // Buscar contenedor de metadata
                    const metadataContainer = item.querySelector('yt-lockup-metadata-view-model') ||
                                            item.querySelector('.yt-lockup-view-model__metadata');
                    
                    if (metadataContainer && !item.querySelector('.custom-description')) {
                        const descDiv = document.createElement('div');
                        descDiv.className = 'custom-description';
                        descDiv.textContent = description;
                        metadataContainer.appendChild(descDiv);
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
        if (!isSubscriptionsPage()) return;
        
        ensurePageAttribute();
        
        console.log('🔍 Buscando videos...');
        
        const items = document.querySelectorAll('ytd-rich-item-renderer:not(ytd-rich-section-renderer ytd-rich-item-renderer)');
        
        console.log(`📦 Encontrados ${items.length} videos`);
        
        items.forEach((item, index) => {
            // 1. Header del canal
            addChannelHeader(item);
            
            // 2. Descripción
            if (item.dataset.descAdded === 'true' || item.dataset.descFetching === 'true') {
                return;
            }
            
            const titleLink = item.querySelector('a[href*="/watch"]');
            
            if (!titleLink || !titleLink.href) {
                return;
            }
            
            item.dataset.descFetching = 'true';
            fetchQueue.push(addDescriptionToItem(item, titleLink.href));
        });
        
        processFetchQueue();
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
        if (!isSubscriptionsPage()) return;
        
        console.log('🚀 YouTube List View: Inicializando...');
        
        ensurePageAttribute();
        injectDescriptions();
        setupObserver();
        
        setInterval(cleanupCache, 1000 * 60 * 10);
        
        console.log('✅ YouTube List View: Activo');
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
