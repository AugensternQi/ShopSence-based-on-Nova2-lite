const summarizeBtn = document.getElementById("summarizeBtn");
const loadingSpinner = document.getElementById("loadingSpinner");
const resultEl = document.getElementById("result");

function setLoading(isLoading) {
  loadingSpinner.classList.toggle("hidden", !isLoading);
  loadingSpinner.classList.toggle("flex", isLoading);
  summarizeBtn.disabled = isLoading;
  summarizeBtn.classList.toggle("opacity-60", isLoading);
  summarizeBtn.classList.toggle("cursor-not-allowed", isLoading);
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return String(text).replace(/[&<>"']/g, (char) => map[char]);
}

function formatInlineMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function closeList(htmlParts, state) {
  if (state.inUl) {
    htmlParts.push("</ul>");
    state.inUl = false;
  }
  if (state.inOl) {
    htmlParts.push("</ol>");
    state.inOl = false;
  }
}

function formatResult(text) {
  const lines = String(text || "No response returned.").split(/\r?\n/);
  const htmlParts = ['<div class="ai-markdown">'];
  const state = { inUl: false, inOl: false };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const safe = formatInlineMarkdown(escapeHtml(trimmed));

    if (!trimmed) {
      closeList(htmlParts, state);
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      closeList(htmlParts, state);
      htmlParts.push("<hr />");
      continue;
    }

    const h3Match = safe.match(/^###\s+(.+)$/);
    if (h3Match) {
      closeList(htmlParts, state);
      htmlParts.push(`<h3>${h3Match[1]}</h3>`);
      continue;
    }

    const h4Match = safe.match(/^####\s+(.+)$/);
    if (h4Match) {
      closeList(htmlParts, state);
      htmlParts.push(`<h4>${h4Match[1]}</h4>`);
      continue;
    }

    const olMatch = safe.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (state.inUl) {
        htmlParts.push("</ul>");
        state.inUl = false;
      }
      if (!state.inOl) {
        htmlParts.push("<ol>");
        state.inOl = true;
      }
      htmlParts.push(`<li>${olMatch[1]}</li>`);
      continue;
    }

    const ulMatch = safe.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      if (state.inOl) {
        htmlParts.push("</ol>");
        state.inOl = false;
      }
      if (!state.inUl) {
        htmlParts.push("<ul>");
        state.inUl = true;
      }
      htmlParts.push(`<li>${ulMatch[1]}</li>`);
      continue;
    }

    closeList(htmlParts, state);
    htmlParts.push(`<p>${safe}</p>`);
  }

  closeList(htmlParts, state);
  htmlParts.push("</div>");
  return htmlParts.join("");
}

async function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!tabs || tabs.length === 0 || !tabs[0].id) {
        reject(new Error("No active tab found."));
        return;
      }
      resolve(tabs[0]);
    });
  });
}

function sendExtractMessage(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PRODUCT_DATA" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || !response.success) {
        reject(new Error(response?.error || "Product data extraction failed."));
        return;
      }
      resolve(response.data);
    });
  });
}

function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function isAmazonProductPage(url) {
  return /^https:\/\/(www\.)?amazon\.(com|ca|co\.uk|de|fr|it|es|co\.jp|com\.au|in)\//.test(url);
}

async function extractProductDataFromTab(tab) {
  if (!isAmazonProductPage(tab.url || "")) {
    throw new Error("Please open a supported Amazon product page first.");
  }

  try {
    return await sendExtractMessage(tab.id);
  } catch (_err) {
    // The listener may be missing when extension was reloaded after the page loaded.
    await injectContentScript(tab.id);
    return sendExtractMessage(tab.id);
  }
}

function validateProductData(payload) {
  if (!payload || !payload.title) {
    throw new Error("Could not find product title on this page.");
  }
  if (!payload.reviews) {
    throw new Error("Could not find review text on this page.");
  }
}

async function summarizeCurrentProduct() {
  setLoading(true);
  resultEl.innerHTML = '<p class="text-slate-500">Reading product data from the current tab...</p>';

  try {
    const activeTab = await getActiveTab();
    const productData = await extractProductDataFromTab(activeTab);
    validateProductData(productData);

    resultEl.innerHTML = '<p class="text-slate-500">Waiting for AI response...</p>';

    const response = await fetch("http://localhost:8000/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(productData),
    });

    if (!response.ok) {
      let detailText = "";
      try {
        const errorPayload = await response.json();
        detailText = errorPayload?.detail ? `: ${errorPayload.detail}` : "";
      } catch (_err) {
        // Keep default detailText when response is not JSON.
      }
      throw new Error(`Request failed with status ${response.status}${detailText}`);
    }

    const payload = await response.json();
    resultEl.innerHTML = `
      <div class="result-card success">
        <p class="result-label">AI Summary</p>
        ${formatResult(payload.result)}
      </div>
    `;
  } catch (error) {
    resultEl.innerHTML = `
      <div class="result-card error">
        <p><strong>Could not fetch summary</strong></p>
        <p>${escapeHtml(error.message || "Unknown error")}</p>
      </div>
    `;
  } finally {
    setLoading(false);
  }
}

summarizeBtn.addEventListener("click", summarizeCurrentProduct);
