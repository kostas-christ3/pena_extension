// background.js

const DEFAULT_API_BASE_URL = "https://blinko-brain.onrender.com";
const DEFAULT_WEB_APP_BASE_URL = "https://pena-frontend.vercel.app";

function getConfig(callback) {
  chrome.storage.sync.get(
    {
      apiBaseUrl: DEFAULT_API_BASE_URL,
      webBaseUrl: DEFAULT_WEB_APP_BASE_URL,
    },
    (items) => callback(items)
  );
}

// Map UI actions to backend TransformationType enum values
function mapActionToTransformationType(action) {
  switch (action) {
    case "fix":
      return "improve";
    case "translate":
      return "translate_greek";
    case "shorten":
      return "shorten";
    case "lengthen":
      return "lengthen";
    case "professional":          // NEW
      return "professional";      // NEW transformation type
    default:
      return "improve";
  }
}

// Create context menu on install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "llm-transform-text",
    title: "Pena AI – Improve text ✍️",
    contexts: ["selection"],
  });
});

// When user clicks the context menu on selected text
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "llm-transform-text" || tab.id == null) return;

  chrome.tabs.sendMessage(
    tab.id,
    { type: "GET_SELECTED_TEXT" },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error sending message to content script:", chrome.runtime.lastError);
        return;
      }

      const selectedText = response && response.text;
      if (!selectedText || selectedText.trim().length === 0) {
        console.log("No text selected.");
        return;
      }

      // Ask content script to show the small popup with the 4 options
      chrome.tabs.sendMessage(tab.id, {
        type: "SHOW_POPUP_MENU",
        selectedText,
      });
    }
  );
});

// Handle messages from content script (action chosen)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type !== "PERFORM_ACTION") return;

  const { action, text } = request;
  const tabId = sender && sender.tab && sender.tab.id;
  if (!tabId) {
    console.error("No tab ID in sender for PERFORM_ACTION.");
    sendResponse && sendResponse({ success: false });
    return; // no async work
  }

  getConfig((config) => {
    const apiBaseUrl = config.apiBaseUrl || DEFAULT_API_BASE_URL;
    const webBaseUrl = config.webBaseUrl || DEFAULT_WEB_APP_BASE_URL;

    callTransformApiWithType(apiBaseUrl, text, action, (err, suggestions) => {
      if (err) {
        if (err.isAuthError) {
          chrome.tabs.create({ url: `${webBaseUrl}/login` });
          sendResponse && sendResponse({ success: false });
          return;
        }

        // Out of credits → show in-place popup instead of global error
        if (err.isNoCredits) {
          chrome.tabs.sendMessage(tabId, {
            type: "SHOW_NO_CREDITS",
            dashboardUrl: `${webBaseUrl}/dashboard`, // dashboard where user can buy more credits
          });
          sendResponse && sendResponse({ success: false });
          return;
        }

        chrome.tabs.sendMessage(tabId, {
          type: "SHOW_ERROR",
          message: err.message || "API error",
        });
        sendResponse && sendResponse({ success: false });
        return;
      }

      chrome.tabs.sendMessage(tabId, {
        type: "SHOW_SUGGESTIONS",
        suggestions,
        originalText: text,
      });

      sendResponse && sendResponse({ success: true });
    });
  });

  // Asynchronous response
  return true;
});

// Call FastAPI /v1/transform endpoint
function callTransformApiWithType(apiBaseUrl, text, uiAction, callback) {
  const url = `${apiBaseUrl}/v1/transform`; // assuming router mounted under /v1

  const transformationType = mapActionToTransformationType(uiAction);

  fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      transformation_type: transformationType,
    }),
  })
    .then(async (res) => {
      if (!res.ok) {
        let errorMessage = `API error ${res.status}`;
        let isAuthError = false;
        let isNoCredits = false;

        if (res.status === 401 || res.status === 403) {
          isAuthError = true;
          errorMessage = "Authentication required. Please log in.";
        }

        if (res.status === 402) {
          isNoCredits = true;
          errorMessage = "You’ve run out of Pena AI credits.";
        }

        try {
          const data = await res.json();
          if (data.detail) errorMessage = data.detail;
        } catch (_) {
          // ignore JSON parse error
        }

        const error = new Error(errorMessage);
        error.isAuthError = isAuthError;
        error.isNoCredits = isNoCredits;
        throw error;
      }
      return res.json();
    })
    .then((data) => {
      // { variants: [...], transformation_type: "improve" | "translate_greek" | ... }
      const suggestions = Array.isArray(data.variants)
        ? data.variants.filter(
            (v) => typeof v === "string" && v.trim().length > 0
          )
        : [];

      if (!suggestions.length) {
        callback(new Error("API returned no variants"));
        return;
      }

      callback(null, suggestions);
    })
    .catch((err) => {
      console.error("Error calling /v1/transform:", err);
      callback({
        message: err.message || "Unknown error",
        isAuthError: err.isAuthError || false,
        isNoCredits: err.isNoCredits || false,
      });
    });
}
