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
