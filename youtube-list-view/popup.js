document.addEventListener('DOMContentLoaded', function() {
    const toggle = document.getElementById('toggle-enabled');
    const statusLabel = document.getElementById('status-label');

    function updateStatus(isEnabled) {
        statusLabel.textContent = isEnabled ? 'Activado' : 'Desactivado';
        // El color y el punto se manejan vía CSS basado en el checkbox :checked
    }

    // 1. Cargar estado inicial
    chrome.storage.local.get(['enabled'], function(result) {
        // Por defecto true si no existe
        const isEnabled = result.enabled !== false;
        toggle.checked = isEnabled;
        updateStatus(isEnabled);
    });

    // 2. Manejar cambios
    toggle.addEventListener('change', function() {
        const isEnabled = toggle.checked;
        updateStatus(isEnabled);

        // Guardar estado
        chrome.storage.local.set({ enabled: isEnabled }, function() {
            // RECARGAR PESTAÑA AUTOMÁTICAMENTE
            // Esto es crucial para revertir limpiamente los cambios en el DOM
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (tabs[0] && tabs[0].url.includes('youtube.com')) {
                    chrome.tabs.reload(tabs[0].id);
                }
            });
        });
    });
});