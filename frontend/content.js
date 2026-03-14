const BACKEND_BASE_URL = "http://localhost:8000";
const STYLE_ID = "shopsense-widget-style";
const ROOT_ID = "shopsense-widget-root";

let widgetRootEl = null;
let cachedProductData = null;
let dragState = null;

function getStorageByKey(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([key], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result[key] || null);
    });
  });
}

function setStorageByKey(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function upsertProductHistory(productData, patch) {
  if (!productData?.title) {
    return;
  }

  const productName = String(productData.title).trim();
  if (!productName) {
    return;
  }

  const existing = (await getStorageByKey(productName)) || {};
  const nextRecord = {
    ...existing,
    productName,
    price: productData.price || existing.price || "",
    reviews: Array.isArray(productData.reviewsList) ? productData.reviewsList : existing.reviews || [],
    ...patch,
    updatedAt: Date.now(),
  };

  await setStorageByKey(productName, nextRecord);
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} {
      position: fixed;
      top: 90px;
      left: 20px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
    }
    #${ROOT_ID}.ss-hidden {
      display: none;
    }
    #${ROOT_ID} * {
      box-sizing: border-box;
    }
    .ss-panel {
      width: 360px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 14px;
      box-shadow: 0 20px 40px rgba(15, 23, 42, 0.18);
      overflow: hidden;
    }
    .ss-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      background: #eef2ff;
      border-bottom: 1px solid #c7d2fe;
      cursor: grab;
      user-select: none;
    }
    .ss-header:active {
      cursor: grabbing;
    }
    .ss-close {
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 999px;
      background: #e2e8f0;
      color: #0f172a;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      flex-shrink: 0;
    }
    .ss-title {
      font-size: 14px;
      font-weight: 700;
      color: #3730a3;
    }
    .ss-body {
      padding: 12px;
    }
    .ss-subtitle {
      margin: 0 0 10px;
      color: #64748b;
      font-size: 12px;
    }
    .ss-btn {
      width: 100%;
      border: none;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    .ss-btn:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
    .ss-btn-primary {
      background: #4f46e5;
      color: #fff;
    }
    .ss-btn-secondary {
      margin-top: 8px;
      background: #111827;
      color: #fff;
    }
    .ss-summary {
      margin-top: 10px;
      min-height: 56px;
      max-height: 170px;
      overflow-y: auto;
      border: 1px solid #dbeafe;
      border-radius: 10px;
      background: #ffffff;
      padding: 10px;
      font-size: 13px;
      line-height: 1.5;
      color: #334155;
    }
    .ss-result-card {
      border: 1px solid;
      border-radius: 9px;
      padding: 8px;
    }
    .ss-result-card.success {
      border-color: #c7d2fe;
      background: #eef2ff;
    }
    .ss-result-card.error {
      border-color: #fecaca;
      background: #fef2f2;
      color: #b91c1c;
    }
    .ss-result-label {
      margin: 0 0 6px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: #4338ca;
    }
    .ss-status-text {
      margin: 0;
      color: #64748b;
    }
    .ss-md h3,
    .ss-md h4 {
      margin: 8px 0 6px;
      color: #0f172a;
    }
    .ss-md h3 { font-size: 14px; }
    .ss-md h4 { font-size: 13px; }
    .ss-md p { margin: 0 0 6px; }
    .ss-md ul,
    .ss-md ol {
      margin: 4px 0 8px 16px;
      padding: 0;
    }
    .ss-md li { margin: 3px 0; }
    .ss-md hr {
      border: none;
      border-top: 1px solid #cbd5e1;
      margin: 8px 0;
    }
    .ss-chat-shell {
      margin-top: 10px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #fff;
      padding: 8px;
    }
    .ss-chat-title {
      margin: 0 0 6px;
      font-size: 12px;
      color: #64748b;
    }
    .ss-chat-history {
      min-height: 100px;
      max-height: 180px;
      overflow-y: auto;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
      padding: 8px;
    }
    .ss-bubble {
      max-width: 90%;
      border-radius: 10px;
      padding: 8px 10px;
      margin-bottom: 8px;
      font-size: 13px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .ss-bubble.user {
      margin-left: auto;
      background: #4f46e5;
      color: #fff;
      border-bottom-right-radius: 4px;
    }
    .ss-bubble.assistant {
      margin-right: auto;
      background: #eef2ff;
      color: #1e1b4b;
      border-bottom-left-radius: 4px;
    }
    .ss-bubble.error {
      background: #fef2f2;
      color: #b91c1c;
      border: 1px solid #fecaca;
    }
    .ss-chat-input-row {
      margin-top: 8px;
      display: flex;
      gap: 8px;
    }
    .ss-chat-input {
      flex: 1;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 13px;
      outline: none;
    }
    .ss-chat-input:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
    }
    .ss-send-btn {
      border: none;
      border-radius: 8px;
      background: #111827;
      color: #fff;
      padding: 0 12px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    .ss-send-btn:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
  `;

  document.head.appendChild(style);
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
  const htmlParts = ['<div class="ss-md">'];
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
      if (!state.inOl) {
        if (state.inUl) {
          htmlParts.push("</ul>");
          state.inUl = false;
        }
        htmlParts.push("<ol>");
        state.inOl = true;
      }
      htmlParts.push(`<li>${olMatch[1]}</li>`);
      continue;
    }

    const ulMatch = safe.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      if (!state.inUl) {
        if (state.inOl) {
          htmlParts.push("</ol>");
          state.inOl = false;
        }
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

function extractAmazonProductData() {
  const titleEl = document.getElementById("productTitle");
  const priceWholeEl = document.querySelector(
    "#corePriceDisplay_desktop_feature_div .a-price .a-price-whole, .a-price .a-price-whole",
  );
  const priceFractionEl = document.querySelector(
    "#corePriceDisplay_desktop_feature_div .a-price .a-price-fraction, .a-price .a-price-fraction",
  );
  const reviewEls = document.querySelectorAll(".review-text-content");

  const productTitle = titleEl ? titleEl.textContent.trim() : "";
  const whole = priceWholeEl ? priceWholeEl.textContent.trim() : "";
  const fraction = priceFractionEl ? priceFractionEl.textContent.trim() : "";
  const price = whole ? `$${whole}${fraction ? `.${fraction}` : ""}` : "";
  const reviews = Array.from(reviewEls)
    .map((el) => el.textContent.trim())
    .filter(Boolean);

  return { title: productTitle, price, reviews };
}

function normalizeProductData(payload) {
  if (!payload || !payload.title) {
    throw new Error("Could not find product title on this page.");
  }
  const reviewsList = Array.isArray(payload.reviews) ? payload.reviews : [];
  if (reviewsList.length === 0) {
    throw new Error("Could not find review text on this page.");
  }

  return {
    title: payload.title,
    price: payload.price || "",
    reviewsList,
    reviewsText: reviewsList.join(" "),
  };
}

function getWidgetRef(name) {
  return widgetRootEl?.querySelector(`[data-ss="${name}"]`);
}

function setSummaryStatus(message) {
  const resultEl = getWidgetRef("result");
  if (resultEl) {
    resultEl.innerHTML = `<p class="ss-status-text">${escapeHtml(message)}</p>`;
  }
}

function setSummaryLoading(isLoading) {
  const btn = getWidgetRef("summarize-btn");
  if (!btn) {
    return;
  }
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "Summarizing..." : "Summarize Current Product";
}

function setSendLoading(isLoading) {
  const btn = getWidgetRef("send-btn");
  if (!btn) {
    return;
  }
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "Sending..." : "Send";
}

function appendChatBubble(role, text, isError = false) {
  const historyEl = getWidgetRef("chat-history");
  if (!historyEl) {
    return;
  }

  const bubble = document.createElement("div");
  bubble.classList.add("ss-bubble");
  bubble.classList.add(role === "user" ? "user" : "assistant");
  if (isError) {
    bubble.classList.add("error");
  }

  if (role === "assistant" && !isError) {
    bubble.innerHTML = formatResult(text);
  } else {
    bubble.textContent = text;
  }

  historyEl.appendChild(bubble);
  historyEl.scrollTop = historyEl.scrollHeight;
}

function resetChatHistory() {
  const historyEl = getWidgetRef("chat-history");
  if (!historyEl) {
    return;
  }
  historyEl.innerHTML = "";
}

function renderSummaryResultSuccess(text) {
  const resultEl = getWidgetRef("result");
  if (!resultEl) {
    return;
  }
  resultEl.innerHTML = `
    <div class="ss-result-card success">
      <p class="ss-result-label">AI Summary</p>
      ${formatResult(text)}
    </div>
  `;
}

function renderSummaryResultError(errorMessage) {
  const resultEl = getWidgetRef("result");
  if (!resultEl) {
    return;
  }
  resultEl.innerHTML = `
    <div class="ss-result-card error">
      <p><strong>Could not fetch summary</strong></p>
      <p>${escapeHtml(errorMessage)}</p>
    </div>
  `;
}

async function summarizeCurrentProduct() {
  setSummaryLoading(true);
  setSummaryStatus("Reading product data from the current page...");

  try {
    cachedProductData = normalizeProductData(extractAmazonProductData());
    setSummaryStatus("Waiting for AI response...");

    const response = await fetch(`${BACKEND_BASE_URL}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: cachedProductData.title,
        price: cachedProductData.price,
        reviews: cachedProductData.reviewsText,
      }),
    });

    if (!response.ok) {
      let detailText = "";
      try {
        const errorPayload = await response.json();
        detailText = errorPayload?.detail ? `: ${errorPayload.detail}` : "";
      } catch (_err) {
        // Keep default detail text.
      }
      throw new Error(`Request failed with status ${response.status}${detailText}`);
    }

    const payload = await response.json();
    const summaryText = payload.result || "No summary returned.";
    await upsertProductHistory(cachedProductData, {
      summary: summaryText,
    });
    renderSummaryResultSuccess(summaryText);
  } catch (error) {
    renderSummaryResultError(error.message || "Unknown error");
  } finally {
    setSummaryLoading(false);
  }
}

async function chatWithReviews() {
  const inputEl = getWidgetRef("chat-input");
  if (!inputEl) {
    return;
  }

  const question = inputEl.value.trim();
  if (!question) {
    appendChatBubble("assistant", "Please enter a question first.", true);
    return;
  }

  // Keep each ask/answer as a fresh single-turn result.
  resetChatHistory();
  appendChatBubble("user", question);
  inputEl.value = "";
  setSendLoading(true);

  try {
    if (!cachedProductData) {
      cachedProductData = normalizeProductData(extractAmazonProductData());
    }

    const response = await fetch(`${BACKEND_BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        context_reviews: cachedProductData.reviewsList,
      }),
    });

    if (!response.ok) {
      let detailText = "";
      try {
        const errorPayload = await response.json();
        detailText = errorPayload?.detail ? `: ${errorPayload.detail}` : "";
      } catch (_err) {
        // Keep default detail text.
      }
      throw new Error(`Request failed with status ${response.status}${detailText}`);
    }

    const payload = await response.json();
    const answerText = payload.answer || "No answer returned.";
    appendChatBubble("assistant", answerText);

    await upsertProductHistory(cachedProductData, {
      chatHistory: [
        ...((await getStorageByKey(cachedProductData.title))?.chatHistory || []),
        { role: "user", text: question, timestamp: Date.now() },
        { role: "assistant", text: answerText, timestamp: Date.now() },
      ],
    });
  } catch (error) {
    appendChatBubble("assistant", `Network error: ${error.message || "Unknown error"}`, true);
  } finally {
    setSendLoading(false);
  }
}

function openDashboardPage() {
  chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD_PAGE" }, (response) => {
    if (chrome.runtime.lastError || !response?.success) {
      // Fallback in case the background worker is unavailable.
      window.open(chrome.runtime.getURL("dashboard.html"), "_blank");
    }
  });
}

function onDragStart(event) {
  if (!widgetRootEl || event.target.closest("[data-ss='close-btn']")) {
    return;
  }
  const rect = widgetRootEl.getBoundingClientRect();
  dragState = {
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
  };
  event.preventDefault();
}

function onDragMove(event) {
  if (!widgetRootEl || !dragState) {
    return;
  }
  const newLeft = Math.max(8, Math.min(window.innerWidth - 260, event.clientX - dragState.offsetX));
  const newTop = Math.max(8, Math.min(window.innerHeight - 120, event.clientY - dragState.offsetY));
  widgetRootEl.style.left = `${newLeft}px`;
  widgetRootEl.style.top = `${newTop}px`;
}

function onDragEnd() {
  dragState = null;
}

function buildWidget() {
  ensureStyles();

  if (widgetRootEl && document.body.contains(widgetRootEl)) {
    return widgetRootEl;
  }

  widgetRootEl = document.createElement("div");
  widgetRootEl.id = ROOT_ID;
  widgetRootEl.classList.add("ss-hidden");
  widgetRootEl.innerHTML = `
    <div class="ss-panel">
      <div class="ss-header" data-ss="header">
        <button class="ss-close" data-ss="close-btn" title="Close">×</button>
        <span class="ss-title">ShopSense AI</span>
      </div>
      <div class="ss-body">
        <p class="ss-subtitle">Drag this window and chat with product reviews.</p>
        <button class="ss-btn ss-btn-primary" data-ss="summarize-btn">Summarize Current Product</button>
        <button class="ss-btn ss-btn-secondary" data-ss="dashboard-btn">Open Dashboard</button>
        <div class="ss-summary" data-ss="result">
          <p class="ss-status-text">Click summarize to analyze this product.</p>
        </div>

        <div class="ss-chat-shell">
          <p class="ss-chat-title">Chat with Reviews</p>
          <div class="ss-chat-history" data-ss="chat-history">
            <div class="ss-bubble assistant">Ask a question like "How durable is this for daily use?"</div>
          </div>
          <div class="ss-chat-input-row">
            <input class="ss-chat-input" data-ss="chat-input" type="text" autocomplete="off" placeholder="Ask about quality, fit, durability..." />
            <button class="ss-send-btn" data-ss="send-btn">Send</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(widgetRootEl);

  const headerEl = getWidgetRef("header");
  const closeBtnEl = getWidgetRef("close-btn");
  const summarizeBtnEl = getWidgetRef("summarize-btn");
  const dashboardBtnEl = getWidgetRef("dashboard-btn");
  const sendBtnEl = getWidgetRef("send-btn");
  const chatInputEl = getWidgetRef("chat-input");

  headerEl?.addEventListener("mousedown", onDragStart);
  closeBtnEl?.addEventListener("click", () => {
    widgetRootEl.classList.add("ss-hidden");
  });
  summarizeBtnEl?.addEventListener("click", summarizeCurrentProduct);
  dashboardBtnEl?.addEventListener("click", openDashboardPage);
  sendBtnEl?.addEventListener("click", chatWithReviews);
  chatInputEl?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      chatWithReviews();
    }
  });

  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragEnd);

  return widgetRootEl;
}

function toggleWidget() {
  const rootEl = buildWidget();
  rootEl.classList.toggle("ss-hidden");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    sendResponse({ success: false, error: "Empty message." });
    return true;
  }

  if (message.type === "TOGGLE_SHOPSENSE_WIDGET") {
    toggleWidget();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "EXTRACT_PRODUCT_DATA") {
    sendResponse({ success: true, data: extractAmazonProductData() });
    return true;
  }

  sendResponse({ success: false, error: "Unsupported message type." });
  return true;
});
