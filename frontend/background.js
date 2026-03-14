async function sendToggleMessage(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "TOGGLE_SHOPSENSE_WIDGET" });
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) {
    return;
  }

  try {
    await sendToggleMessage(tab.id);
  } catch (_err) {
    try {
      await injectContentScript(tab.id);
      await sendToggleMessage(tab.id);
    } catch (finalErr) {
      // Keep a minimal log for debugging in service worker console.
      console.error("ShopSense toggle failed:", finalErr);
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "OPEN_DASHBOARD_PAGE") {
    return false;
  }

  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }, () => {
    if (chrome.runtime.lastError) {
      sendResponse({ success: false, error: chrome.runtime.lastError.message });
      return;
    }
    sendResponse({ success: true });
  });

  return true;
});
