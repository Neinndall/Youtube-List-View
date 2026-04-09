document.addEventListener('DOMContentLoaded', () => {
  const hideMostRelevantCheckbox = document.getElementById('hideMostRelevant');
  const hideMostRecentCheckbox = document.getElementById('hideMostRecent');
  const hideShortsCheckbox = document.getElementById('hideShorts');

  // Load current settings
  chrome.storage.local.get(['hideMostRelevant', 'hideMostRecent', 'hideShorts'], (result) => {
    hideMostRelevantCheckbox.checked = result.hideMostRelevant || false;
    hideMostRecentCheckbox.checked = result.hideMostRecent || false;
    hideShortsCheckbox.checked = result.hideShorts || false;
  });

  // Save settings on change
  hideMostRelevantCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ hideMostRelevant: hideMostRelevantCheckbox.checked });
  });

  hideMostRecentCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ hideMostRecent: hideMostRecentCheckbox.checked });
  });

  hideShortsCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ hideShorts: hideShortsCheckbox.checked });
  });
});
