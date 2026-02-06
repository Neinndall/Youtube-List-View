document.addEventListener('DOMContentLoaded', function() {
    const toggleEnabled = document.getElementById('toggle-enabled');
    const statusEnabled = document.getElementById('status-enabled');
    const refreshBtn = document.getElementById('refresh');
    const goToSubsBtn = document.getElementById('goToSubs');

    // Cargar estados guardados
    chrome.storage.local.get(['enabled'], function(result) {
        const isEnabled = result.enabled !== false;
        
        toggleEnabled.checked = isEnabled;
        statusEnabled.textContent = isEnabled ? 'Activado' : 'Desactivado';
    });

    // Manejar cambio de interruptor de habilitación
    toggleEnabled.addEventListener('change', function() {
        const isEnabled = toggleEnabled.checked;
        statusEnabled.textContent = isEnabled ? 'Activado' : 'Desactivado';
        chrome.storage.local.set({ enabled: isEnabled }, function() {
            reloadCurrentTab();
        });
    });

    function reloadCurrentTab() {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs[0] && tabs[0].url.includes('youtube.com')) {
                chrome.tabs.reload(tabs[0].id);
            }
        });
    }

    refreshBtn.addEventListener('click', reloadCurrentTab);

    goToSubsBtn.addEventListener('click', function() {
        chrome.tabs.create({ url: 'https://www.youtube.com/feed/subscriptions' });
    });
});
