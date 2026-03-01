document.addEventListener('DOMContentLoaded', () => {
  const hideMostRelevantCheckbox = document.getElementById('hideMostRelevant');

  // Load current setting
  chrome.storage.local.get(['hideMostRelevant'], (result) => {
    hideMostRelevantCheckbox.checked = result.hideMostRelevant || false;
  });

  // Save setting on change
  hideMostRelevantCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ hideMostRelevant: hideMostRelevantCheckbox.checked });
  });
});
