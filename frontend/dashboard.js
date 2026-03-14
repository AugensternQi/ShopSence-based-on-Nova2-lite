const BACKEND_BASE_URL = "http://localhost:8000";

const historyListEl = document.getElementById("historyList");
const mainContentEl = document.getElementById("mainContent");
const compareBtn = document.getElementById("compareBtn");
const compareHintEl = document.getElementById("compareHint");
const clearAllBtn = document.getElementById("clearAllBtn");
const refreshBtn = document.getElementById("refreshBtn");
const historyCountBadge = document.getElementById("historyCountBadge");
const welcomeTemplate = document.getElementById("welcomeTemplate");

let productRecords = [];
let activeProductName = "";
let selectedProducts = new Set();

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return String(text ?? "").replace(/[&<>"']/g, (char) => map[char]);
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

function extractSummary(raw) {
  if (!raw) {
    return "";
  }
  const candidates = [
    raw.summary,
    raw.aiSummary,
    raw.analysis,
    raw.result,
    raw.latestSummary,
    raw.summaryText,
  ];
  const summary = candidates.find((item) => typeof item === "string" && item.trim());
  return summary ? summary.trim() : "";
}

function parseChatMessage(item) {
  if (!item) {
    return null;
  }
  if (typeof item === "string") {
    return { role: "assistant", text: item.trim() };
  }
  if (typeof item !== "object") {
    return null;
  }

  const roleRaw = String(item.role || item.sender || item.type || "assistant").toLowerCase();
  const role = roleRaw.includes("user") ? "user" : "assistant";
  const text =
    item.text ||
    item.message ||
    item.content ||
    item.answer ||
    item.question ||
    item.prompt ||
    "";
  if (!String(text).trim()) {
    return null;
  }
  return {
    role,
    text: String(text).trim(),
  };
}

function extractChatHistory(raw) {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const pools = [
    raw.chatHistory,
    raw.chat,
    raw.history,
    raw.messages,
    raw.conversation,
    raw.qaPairs,
  ];

  for (const pool of pools) {
    const arr = toArray(pool);
    if (!arr.length) {
      continue;
    }
    const parsed = arr.map(parseChatMessage).filter(Boolean);
    if (parsed.length) {
      return parsed;
    }
  }

  return [];
}

function looksLikeProductRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const summary = extractSummary(value);
  const chat = extractChatHistory(value);
  const hasReviewLikeData = Boolean(
    value.reviews || value.review || value.reviewList || value.context_reviews || value.price,
  );
  return Boolean(summary || chat.length || hasReviewLikeData);
}

function normalizeStorageRecords(allData) {
  return Object.entries(allData)
    .filter(([key, value]) => key && looksLikeProductRecord(value))
    .map(([productName, raw]) => {
      const summary = extractSummary(raw);
      const chatHistory = extractChatHistory(raw);
      return {
        productName,
        summary,
        chatHistory,
        raw,
      };
    })
    .sort((a, b) => a.productName.localeCompare(b.productName));
}

function formatMarkdown(text) {
  const safe = escapeHtml(text || "No content.");
  return safe
    .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
    .replace(/^####\s+(.+)$/gm, "<h4>$1</h4>")
    .replace(/^\-\s+(.+)$/gm, "<li>$1</li>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br/>");
}

function setCompareButtonState() {
  const count = selectedProducts.size;
  compareBtn.disabled = count !== 2;

  if (count === 2) {
    compareHintEl.textContent = "Ready to PK. Click to generate AI comparison.";
    return;
  }
  if (count > 2) {
    compareHintEl.textContent = "Please keep only 2 selected products.";
    return;
  }
  compareHintEl.textContent = "Select exactly 2 products to unlock PK.";
}

function renderHistoryList() {
  historyCountBadge.textContent = String(productRecords.length);

  if (!productRecords.length) {
    historyListEl.innerHTML = `<div class="history-empty">No history yet. Summarize products first, then come back for the cockpit view.</div>`;
    return;
  }

  const html = productRecords
    .map((item) => {
      const isActive = item.productName === activeProductName;
      const isChecked = selectedProducts.has(item.productName);
      const summaryState = item.summary ? "Summary Ready" : "No Summary";
      const chatCount = item.chatHistory.length;

      return `
        <label class="history-item ${isActive ? "active" : ""}" data-product-row="${escapeHtml(item.productName)}">
          <input
            type="checkbox"
            data-compare-check="${escapeHtml(item.productName)}"
            ${isChecked ? "checked" : ""}
            aria-label="Select ${escapeHtml(item.productName)} for comparison"
          />
          <div class="history-item-content">
            <div class="history-item-title">${escapeHtml(item.productName)}</div>
            <div class="history-item-meta">${summaryState} · ${chatCount} dialog</div>
          </div>
        </label>
      `;
    })
    .join("");

  historyListEl.innerHTML = html;

  historyListEl.querySelectorAll("[data-product-row]").forEach((rowEl) => {
    rowEl.addEventListener("click", (event) => {
      if (event.target instanceof HTMLInputElement) {
        return;
      }
      const productName = rowEl.getAttribute("data-product-row");
      if (!productName) {
        return;
      }
      activeProductName = productName;
      renderHistoryList();
      renderProductDetail(productName);
    });
  });

  historyListEl.querySelectorAll("[data-compare-check]").forEach((checkboxEl) => {
    checkboxEl.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    checkboxEl.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) {
        return;
      }
      const productName = input.getAttribute("data-compare-check");
      if (!productName) {
        return;
      }

      if (input.checked) {
        selectedProducts.add(productName);
      } else {
        selectedProducts.delete(productName);
      }
      setCompareButtonState();
    });
  });
}

function getDashboardStats() {
  const products = productRecords.length;
  const summaries = productRecords.filter((item) => item.summary).length;
  const messages = productRecords.reduce((acc, item) => acc + item.chatHistory.length, 0);
  const withChat = productRecords.filter((item) => item.chatHistory.length > 0).length;
  return { products, summaries, messages, withChat };
}

function renderWelcome() {
  mainContentEl.innerHTML = "";
  const clone = welcomeTemplate.content.cloneNode(true);
  mainContentEl.appendChild(clone);

  const stats = getDashboardStats();
  mainContentEl.querySelector('[data-stat="products"]').textContent = String(stats.products);
  mainContentEl.querySelector('[data-stat="summaries"]').textContent = String(stats.summaries);
  mainContentEl.querySelector('[data-stat="messages"]').textContent = String(stats.messages);
  mainContentEl.querySelector('[data-stat="withChat"]').textContent = String(stats.withChat);
}

function renderProductDetail(productName) {
  const record = productRecords.find((item) => item.productName === productName);
  if (!record) {
    renderWelcome();
    return;
  }

  const summaryHtml = record.summary
    ? `<div class="markdown"><p>${formatMarkdown(record.summary)}</p></div>`
    : `<p class="empty-note">No summary stored for this product.</p>`;

  const chatHtml = record.chatHistory.length
    ? `<div class="chat-log">
        ${record.chatHistory
          .map(
            (msg) => `
              <div class="chat-message">
                <div class="chat-role">${escapeHtml(msg.role)}</div>
                <div class="chat-text">${escapeHtml(msg.text)}</div>
              </div>
            `,
          )
          .join("")}
      </div>`
    : `<p class="empty-note">No conversation history stored for this product.</p>`;

  mainContentEl.innerHTML = `
    <div class="product-view">
      <section class="panel product-head">
        <h2>${escapeHtml(record.productName)}</h2>
        <div class="product-tags">
          <span class="tag">${record.summary ? "Summary Ready" : "Summary Missing"}</span>
          <span class="tag">${record.chatHistory.length} dialog messages</span>
        </div>
      </section>

      <section class="content-grid">
        <article class="panel block">
          <h3>AI Summary</h3>
          ${summaryHtml}
        </article>
        <article class="panel block">
          <h3>Conversation History</h3>
          ${chatHtml}
        </article>
      </section>
    </div>
  `;
}

function renderCompareLoading() {
  mainContentEl.innerHTML = `
    <section class="loading">
      <div class="panel loading-shell">
        <div class="loader"></div>
        <h3>AI Product PK is running...</h3>
        <p class="muted">Crunching summaries and dialog context from your selected products.</p>
      </div>
    </section>
  `;
}

function buildComparePrompt(productA, productB) {
  const chatA = productA.chatHistory.map((m, idx) => `${idx + 1}. [${m.role}] ${m.text}`).join("\n");
  const chatB = productB.chatHistory.map((m, idx) => `${idx + 1}. [${m.role}] ${m.text}`).join("\n");

  return [
    "Please compare these two products based on the provided summary and conversation context.",
    "",
    `Product A: ${productA.productName}`,
    `A Summary: ${productA.summary || "No summary stored."}`,
    `A Conversation:`,
    chatA || "- No chat history.",
    "",
    `Product B: ${productB.productName}`,
    `B Summary: ${productB.summary || "No summary stored."}`,
    `B Conversation:`,
    chatB || "- No chat history.",
    "",
    "Output requirement:",
    "1) Product A - strengths and weaknesses",
    "2) Product B - strengths and weaknesses",
    "3) Side-by-side recommendation by user type",
    "4) Final winner and why",
  ].join("\n");
}

async function requestComparison(productA, productB) {
  const question = buildComparePrompt(productA, productB);
  const contextReviews = [
    `[${productA.productName}] Summary: ${productA.summary || "No summary"}`,
    ...productA.chatHistory.map((m) => `[${productA.productName}] ${m.role}: ${m.text}`),
    `[${productB.productName}] Summary: ${productB.summary || "No summary"}`,
    ...productB.chatHistory.map((m) => `[${productB.productName}] ${m.role}: ${m.text}`),
  ];

  const response = await fetch(`${BACKEND_BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      context_reviews: contextReviews,
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = payload?.detail ? `: ${payload.detail}` : "";
    } catch (_err) {
      // keep empty detail
    }
    throw new Error(`PK request failed (${response.status})${detail}`);
  }

  const data = await response.json();
  return data.answer || "No comparison answer returned.";
}

function renderCompareResult(productA, productB, answerText) {
  mainContentEl.innerHTML = `
    <div class="pk-shell">
      <section class="panel pk-header">
        <h2>AI Product PK</h2>
        <p class="muted">${escapeHtml(productA.productName)} vs ${escapeHtml(productB.productName)}</p>
      </section>

      <section class="pk-grid">
        <article class="panel pk-col">
          <h3>${escapeHtml(productA.productName)}</h3>
          <div class="markdown">
            <p>${formatMarkdown(productA.summary || "No summary available for this product.")}</p>
          </div>
        </article>
        <article class="panel pk-col">
          <h3>${escapeHtml(productB.productName)}</h3>
          <div class="markdown">
            <p>${formatMarkdown(productB.summary || "No summary available for this product.")}</p>
          </div>
        </article>
      </section>

      <section class="panel pk-foot">
        <h3>AI Verdict</h3>
        <div class="markdown">
          <p>${formatMarkdown(answerText)}</p>
        </div>
      </section>
    </div>
  `;
}

function renderCompareError(errorMessage) {
  mainContentEl.innerHTML = `
    <section class="panel hero">
      <h2>Product PK failed</h2>
      <p class="muted">${escapeHtml(errorMessage || "Unknown error")}</p>
    </section>
  `;
}

async function compareSelectedProducts() {
  if (selectedProducts.size !== 2) {
    return;
  }

  const [nameA, nameB] = Array.from(selectedProducts);
  const productA = productRecords.find((item) => item.productName === nameA);
  const productB = productRecords.find((item) => item.productName === nameB);
  if (!productA || !productB) {
    renderCompareError("Selected product data is missing.");
    return;
  }

  renderCompareLoading();
  compareBtn.disabled = true;

  try {
    const answer = await requestComparison(productA, productB);
    renderCompareResult(productA, productB, answer);
  } catch (error) {
    renderCompareError(error.message || "Failed to generate comparison.");
  } finally {
    setCompareButtonState();
  }
}

async function loadHistoryFromStorage() {
  const storageData = await chrome.storage.local.get(null);
  productRecords = normalizeStorageRecords(storageData);

  const allNames = new Set(productRecords.map((item) => item.productName));
  selectedProducts = new Set(Array.from(selectedProducts).filter((name) => allNames.has(name)));
  if (!allNames.has(activeProductName)) {
    activeProductName = "";
  }

  renderHistoryList();
  setCompareButtonState();

  if (activeProductName) {
    renderProductDetail(activeProductName);
  } else {
    renderWelcome();
  }
}

async function clearAllHistory() {
  const ok = window.confirm("Clear all product history in local storage? This cannot be undone.");
  if (!ok) {
    return;
  }

  await chrome.storage.local.clear();
  activeProductName = "";
  selectedProducts = new Set();
  await loadHistoryFromStorage();
}

compareBtn.addEventListener("click", compareSelectedProducts);
clearAllBtn.addEventListener("click", clearAllHistory);
refreshBtn.addEventListener("click", loadHistoryFromStorage);

document.addEventListener("DOMContentLoaded", loadHistoryFromStorage);
