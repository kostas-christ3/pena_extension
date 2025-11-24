// options.js

const DEFAULT_API_BASE_URL = "https://blinko-brain.onrender.com"; 

document.addEventListener("DOMContentLoaded", () => {
  const apiBaseUrlInput = document.getElementById("apiBaseUrl");
  const saveButton = document.getElementById("save");
  const statusEl = document.getElementById("status");

  // Load saved value
  chrome.storage.sync.get(
    {
      apiBaseUrl: DEFAULT_API_BASE_URL,
    },
    (items) => {
      apiBaseUrlInput.value = items.apiBaseUrl || DEFAULT_API_BASE_URL;
    }
  );

  saveButton.addEventListener("click", () => {
    const apiBaseUrl = apiBaseUrlInput.value.trim();
    chrome.storage.sync.set({ apiBaseUrl }, () => {
      statusEl.textContent = "Options saved.";
      setTimeout(() => {
        statusEl.textContent = "";
      }, 2000);
    });
  });
});
