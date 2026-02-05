// Botón de refrescar página
document.getElementById('refresh').addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    chrome.tabs.reload(tabs[0].id);
    window.close();
  });
});

// Botón para ir a suscripciones
document.getElementById('goToSubs').addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    const currentTab = tabs[0];
    
    // Si ya estamos en YouTube, solo navegar
    if (currentTab.url && currentTab.url.includes('youtube.com')) {
      chrome.tabs.update(currentTab.id, {
        url: 'https://www.youtube.com/feed/subscriptions'
      });
    } else {
      // Si no, crear nueva pestaña
      chrome.tabs.create({
        url: 'https://www.youtube.com/feed/subscriptions'
      });
    }
    
    window.close();
  });
});

// Mostrar información adicional si estamos en la página correcta
chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
  const currentTab = tabs[0];
  
  if (currentTab.url && currentTab.url.includes('/feed/subscriptions')) {
    console.log('Usuario en página de suscripciones');
  }
});
