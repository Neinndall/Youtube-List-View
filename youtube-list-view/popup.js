document.addEventListener('DOMContentLoaded', () => {
  const body = document.getElementById('body');
  const toggleSettingsBtn = document.getElementById('toggleSettings');
  const resetDefaultsBtn = document.getElementById('resetDefaults');

  // Basic Toggles
  const hideMostRelevantCheckbox = document.getElementById('hideMostRelevant');
  const hideShortsCheckbox = document.getElementById('hideShorts');

  // Range Sliders
  const sliders = {
    thumbW: { el: document.getElementById('thumbW'), val: document.getElementById('valThumbW'), unit: 'px' },
    rowPadY: { el: document.getElementById('rowPadY'), val: document.getElementById('valRowPadY'), unit: 'px' },
    containerW: { el: document.getElementById('containerW'), val: document.getElementById('valContainerW'), unit: '%' },
    titleSize: { el: document.getElementById('titleSize'), val: document.getElementById('valTitleSize'), unit: 'px' },
    shortsW: { el: document.getElementById('shortsW'), val: document.getElementById('valShortsW'), unit: 'px' },
    shortsGap: { el: document.getElementById('shortsGap'), val: document.getElementById('valShortsGap'), unit: 'px' }
  };

  const DEFAULTS = {
    hideMostRelevant: false,
    hideShorts: false,
    thumbW: 260,
    rowPadY: 26,
    containerW: 100,
    titleSize: 16,
    shortsW: 170,
    shortsGap: 16
  };

  // Switch View
  toggleSettingsBtn.addEventListener('click', () => {
    body.classList.toggle('settings-active');
    toggleSettingsBtn.textContent = body.classList.contains('settings-active') ? '🏠' : '⚙️';
  });

  // Load Settings
  chrome.storage.local.get(Object.keys(DEFAULTS), (result) => {
    hideMostRelevantCheckbox.checked = result.hideMostRelevant ?? DEFAULTS.hideMostRelevant;
    hideShortsCheckbox.checked = result.hideShorts ?? DEFAULTS.hideShorts;

    Object.keys(sliders).forEach(key => {
      const val = result[key] ?? DEFAULTS[key];
      sliders[key].el.value = val;
      sliders[key].val.textContent = val + sliders[key].unit;
    });
  });

  // Save Toggles
  hideMostRelevantCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ hideMostRelevant: hideMostRelevantCheckbox.checked });
  });

  hideShortsCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ hideShorts: hideShortsCheckbox.checked });
  });

  // Save Ranges
  Object.keys(sliders).forEach(key => {
    sliders[key].el.addEventListener('input', () => {
      const val = sliders[key].el.value;
      sliders[key].val.textContent = val + sliders[key].unit;
      chrome.storage.local.set({ [key]: parseInt(val) });
    });
  });

  // Reset
  resetDefaultsBtn.addEventListener('click', () => {
    chrome.storage.local.set(DEFAULTS, () => {
      // Refresh UI
      hideMostRelevantCheckbox.checked = DEFAULTS.hideMostRelevant;
      hideShortsCheckbox.checked = DEFAULTS.hideShorts;
      Object.keys(sliders).forEach(key => {
        sliders[key].el.value = DEFAULTS[key];
        sliders[key].val.textContent = DEFAULTS[key] + sliders[key].unit;
      });
    });
  });
});
