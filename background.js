// background.js

const DEFAULT_API_BASE_URL = "https://blinko-brain.onrender.com"; 
const DEFAULT_WEB_APP_BASE_URL = "https://pena-frontend.vercel.app"; // Removed trailing slash for consistency

// Helper to get config from storage
function getConfig(callback) {
  chrome.storage.sync.get(
    {
      apiBaseUrl: DEFAULT_API_BASE_URL,
      webBaseUrl: DEFAULT_WEB_APP_BASE_URL,
    },
    (items) => {
      callback(items);
    }
  );
}

// Called when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "llm-transform-text",
    title: "Transform text with Pena AI",
    contexts: ["selection"],
  });
});

// Handle right-click on selection
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "llm-transform-text" && tab.id != null) {
    // Ask content script for the exact selection text and context
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

        // Get API base URL from storage
        getConfig((config) => {
          const apiBaseUrl = config.apiBaseUrl || DEFAULT_API_BASE_URL;
          const webBaseUrl = config.webBaseUrl || DEFAULT_WEB_APP_BASE_URL;
          callTransformApi(apiBaseUrl, selectedText, (err, transformedText) => {
            if (err) {
              // Check if it's an authentication error
              if (err.isAuthError) {
                // Open login page in new tab using the web app URL
                chrome.tabs.create({
                  url: `${webBaseUrl}/login`,
                });
                return;
              }
              
              chrome.tabs.sendMessage(tab.id, {
                type: "SHOW_ERROR",
                message: err.message || err,
              });
              return;
            }

            // Send transformed text back to content script for replacement
            chrome.tabs.sendMessage(tab.id, {
              type: "REPLACE_SELECTED_TEXT",
              text: transformedText,
            });
          });
        });
      }
    );
  }
});

// Call your FastAPI /transform endpoint
function callTransformApi(apiBaseUrl, text, callback) {
  fetch(`${apiBaseUrl}/v1/transform`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  })
    .then(async (res) => {
      if (!res.ok) {
        let errorMessage = `API error ${res.status}`;
        let isAuthError = false;
        
        // Check for authentication errors (401 Unauthorized or 403 Forbidden)
        if (res.status === 401 || res.status === 403) {
          isAuthError = true;
          errorMessage = "Authentication required. Please log in.";
        }
        
        try {
          const data = await res.json();
          if (data.detail) {
            errorMessage = data.detail;
          }
        } catch (e) {
          // ignore JSON parse error
        }
        
        const error = new Error(errorMessage);
        error.isAuthError = isAuthError;
        throw error;
      }
      return res.json();
    })
    .then((data) => {
      const transformedText = data.transformed_text;
      callback(null, transformedText);
    })
    .catch((err) => {
      console.error("Error calling /transform:", err);
      callback({
        message: err.message || "Unknown error",
        isAuthError: err.isAuthError || false
      });
    });
}