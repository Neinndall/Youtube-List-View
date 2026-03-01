document.addEventListener('DOMContentLoaded', () => {
  const hideMostRelevantCheckbox = document.getElementById('hideMostRelevant');
  const hideShortsCheckbox = document.getElementById('hideShorts');

  // Load current settings
  chrome.storage.local.get(['hideMostRelevant', 'hideShorts'], (result) => {
    hideMostRelevantCheckbox.checked = result.hideMostRelevant || false;
    hideShortsCheckbox.checked = result.hideShorts || false;
  });

  // Save settings on change
  hideMostRelevantCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ hideMostRelevant: hideMostRelevantCheckbox.checked });
  });

  hideShortsCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ hideShorts: hideShortsCheckbox.checked });
  });
});
