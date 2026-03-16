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

function extractPrice(raw) {
  if (!raw || typeof raw !== "object") {
    return "";
  }
  const candidates = [raw.price, raw.currentPrice, raw.productPrice];
  const price = candidates.find((item) => typeof item === "string" && item.trim());
  return price ? price.trim() : "";
}

function extractReviews(raw) {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const pools = [raw.reviews, raw.reviewList, raw.context_reviews, raw.review];
  for (const pool of pools) {
    const arr = toArray(pool).map((item) => String(item).trim()).filter(Boolean);
    if (arr.length) {
      // Keep context compact and stable for PK requests.
      return arr.slice(0, 20);
    }
  }
  return [];
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
      const price = extractPrice(raw);
      const reviews = extractReviews(raw);
      return {
        productName,
        price,
        reviews,
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

function formatChatMarkdown(text) {
  const safe = escapeHtml(text || "");
  return safe
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^\s*[-*]\s+/gm, "• ")
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
              <div class="chat-message ${msg.role === "user" ? "user" : "assistant"}">
                <div class="chat-role">${escapeHtml(msg.role)}</div>
                <div class="chat-text">${
                  msg.role === "assistant"
                    ? formatChatMarkdown(msg.text)
                    : escapeHtml(msg.text)
                }</div>
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

function buildDynamicDimensions(productA, productB) {
  const contextText = [
    productA.productName,
    productA.summary,
    (productA.reviews || []).join(" "),
    productB.productName,
    productB.summary,
    (productB.reviews || []).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  const profiles = [
    {
      keywords: ["drink", "beverage", "soda", "energy", "caffeine", "flavor", "sugar", "calorie"],
      dimensions: ["Price", "Flavor", "Sweetness", "Energy Effect", "Ingredients", "Value"],
    },
    {
      keywords: ["monitor", "display", "refresh", "hz", "resolution", "ips", "hdr", "gaming"],
      dimensions: ["Price", "Resolution", "Refresh Rate", "Color Quality", "Ports & Connectivity", "Value"],
    },
    {
      keywords: ["headphone", "earbud", "noise cancellation", "anc", "audio", "battery", "comfort"],
      dimensions: ["Price", "Sound Quality", "Noise Cancellation", "Battery Life", "Comfort", "Value"],
    },
    {
      keywords: ["shoe", "sneaker", "boot", "bag", "backpack", "fabric", "size", "fit"],
      dimensions: ["Price", "Build Quality", "Comfort/Fit", "Capacity/Storage", "Durability", "Value"],
    },
    {
      keywords: ["cream", "serum", "skincare", "sensitive skin", "moisturizer", "ingredient"],
      dimensions: ["Price", "Ingredients", "Skin Compatibility", "Texture/Absorption", "Irritation Risk", "Value"],
    },
    {
      keywords: ["laptop", "phone", "tablet", "cpu", "gpu", "ram", "storage", "battery"],
      dimensions: ["Price", "Performance", "Battery Life", "Display", "Build Quality", "Value"],
    },
  ];

  let bestMatch = null;
  let bestScore = 0;
  for (const profile of profiles) {
    let score = 0;
    for (const keyword of profile.keywords) {
      if (contextText.includes(keyword)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = profile;
    }
  }

  if (bestMatch && bestScore > 0) {
    return bestMatch.dimensions;
  }

  return ["Price", "Core Features", "Build Quality", "Performance", "User Experience", "Value"];
}

function buildComparePrompt(productA, productB) {
  const chatA = productA.chatHistory.map((m, idx) => `${idx + 1}. [${m.role}] ${m.text}`).join("\n");
  const chatB = productB.chatHistory.map((m, idx) => `${idx + 1}. [${m.role}] ${m.text}`).join("\n");
  const reviewsA = (productA.reviews || []).map((r, idx) => `${idx + 1}. ${r}`).join("\n");
  const reviewsB = (productB.reviews || []).map((r, idx) => `${idx + 1}. ${r}`).join("\n");
  const dimensions = buildDynamicDimensions(productA, productB);
  const diffTemplate = dimensions
    .map((dim) => [dim, "A: ...", "B: ...", ""].join("\n"))
    .join("\n");
  const productAData = [
    `Price: ${productA.price || "Unknown"}`,
    `Summary: ${productA.summary || "No summary stored."}`,
    "Reviews:",
    reviewsA || "- No review snippets.",
    "Conversation:",
    chatA || "- No chat history.",
  ].join("\n");
  const productBData = [
    `Price: ${productB.price || "Unknown"}`,
    `Summary: ${productB.summary || "No summary stored."}`,
    "Reviews:",
    reviewsB || "- No review snippets.",
    "Conversation:",
    chatB || "- No chat history.",
  ].join("\n");

  return [
    "System: You are a senior shopping comparison expert.",
    "Be direct. Minimal words. No long explanations.",
    "",
    "Generate the result in a product comparison card format suitable for a dashboard.",
    "",
    "Rules:",
    "- Keep text minimal.",
    "- Use short phrases instead of sentences.",
    "- Avoid long explanations.",
    "- Make the structure easy to render as cards.",
    "- Focus on visual comparison.",
    "- Use the provided reviews as primary evidence.",
    "- Do NOT output '-' or 'N/A' for Drawbacks and Best For.",
    "- If data is limited, provide a cautious but concrete inference based on available context.",
    "",
    "Input products:",
    `Product A: ${productA.productName}`,
    `A Data: ${productAData}`,
    `Product B: ${productB.productName}`,
    `B Data: ${productBData}`,
    "",
    "Use exactly this structure and headings:",
    "",
    "🏆 AI Verdict",
    "(one short line only)",
    "",
    "⚖️ Key Differences",
    "",
    `Use these dimensions exactly in order: ${dimensions.join(", ")}`,
    "",
    diffTemplate,
    "",
    "⚠️ Drawbacks",
    "",
    "A: ...",
    "B: ...",
    "",
    "👤 Best For",
    "",
    "A: ...",
    "B: ...",
    "",
    "Do not add any extra sections.",
  ].join("\n");
}

function parseABLine(line) {
  const normalized = String(line || "").trim();

  // Support markdown table rows like: | A | text |
  if (normalized.includes("|")) {
    const cells = normalized
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length >= 2) {
      const sideCell = cells[0].toUpperCase().replace(/\s+/g, "");
      if (sideCell === "A" || sideCell === "B") {
        return {
          side: sideCell,
          text: cells.slice(1).join(" | ").trim(),
        };
      }
    }
  }

  // Support "A: ...", "A - ...", "Product A: ...", "产品A：..."
  const match = normalized.match(/^(?:product\s*|产品\s*)?(A|B)\s*[:：\-—]\s*(.+)$/i);
  if (match) {
    return {
      side: match[1].toUpperCase(),
      text: match[2].trim(),
    };
  }
  return null;
}

function normalizeComparisonLine(line) {
  let output = String(line || "").trim();
  output = output.replace(/^#{1,6}\s*/, "");
  output = output.replace(/^[-*]\s+/, "");
  output = output.replace(/^\*\*(.+)\*\*$/, "$1");
  return output.trim();
}

function parseComparisonAnswer(answerText) {
  const rawLines = String(answerText || "")
    .split(/\r?\n/)
    .map(normalizeComparisonLine)
    .filter(Boolean);

  const parsed = {
    verdict: "",
    differences: [],
    drawbacks: { A: "", B: "" },
    bestFor: { A: "", B: "" },
  };

  let mode = "";
  let currentDimension = null;

  for (const line of rawLines) {
    const lower = line.toLowerCase();

    if (line.startsWith("🏆") || lower.includes("ai verdict")) {
      mode = "verdict";
      currentDimension = null;
      continue;
    }
    if (line.startsWith("⚖️") || lower.includes("key differences")) {
      mode = "diff";
      currentDimension = null;
      continue;
    }
    if (
      line.startsWith("⚠️") ||
      line.startsWith("⚠") ||
      lower.includes("drawbacks") ||
      lower.includes("cons") ||
      lower.includes("weakness") ||
      line.includes("缺点")
    ) {
      mode = "drawbacks";
      currentDimension = null;
      continue;
    }
    if (
      line.startsWith("👤") ||
      lower.includes("best for") ||
      lower.includes("ideal for") ||
      lower.includes("who should buy") ||
      lower.includes("recommended for") ||
      line.includes("适合")
    ) {
      mode = "bestfor";
      currentDimension = null;
      continue;
    }

    const ab = parseABLine(line);

    if (mode === "verdict") {
      if (!parsed.verdict && !line.includes("one short line only")) {
        parsed.verdict = line;
      }
      continue;
    }

    if (mode === "diff") {
      if (!ab) {
        currentDimension = {
          name: line,
          A: "",
          B: "",
        };
        parsed.differences.push(currentDimension);
        continue;
      }
      if (currentDimension) {
        currentDimension[ab.side] = ab.text;
      }
      continue;
    }

    if (mode === "drawbacks" && ab) {
      parsed.drawbacks[ab.side] = ab.text;
      continue;
    }

    if (mode === "bestfor" && ab) {
      parsed.bestFor[ab.side] = ab.text;
    }
  }

  if (!parsed.verdict) {
    parsed.verdict = "Close match";
  }

  // Fallback: some models put Drawbacks / Best For inside the differences block.
  const normalizeName = (value) => String(value || "").toLowerCase().replace(/\s+/g, "");
  const drawbackIdx = parsed.differences.findIndex((item) => {
    const n = normalizeName(item.name);
    return n.includes("drawback") || n.includes("weakness") || n.includes("con");
  });
  if (drawbackIdx >= 0) {
    parsed.drawbacks.A = parsed.drawbacks.A || parsed.differences[drawbackIdx].A || "";
    parsed.drawbacks.B = parsed.drawbacks.B || parsed.differences[drawbackIdx].B || "";
    parsed.differences.splice(drawbackIdx, 1);
  }

  const bestForIdx = parsed.differences.findIndex((item) => {
    const n = normalizeName(item.name);
    return (
      n.includes("bestfor") ||
      n.includes("targetuser") ||
      n.includes("idealfor") ||
      n.includes("recommendedfor") ||
      n.includes("whoshouldbuy") ||
      n.includes("who")
    );
  });
  if (bestForIdx >= 0) {
    parsed.bestFor.A = parsed.bestFor.A || parsed.differences[bestForIdx].A || "";
    parsed.bestFor.B = parsed.bestFor.B || parsed.differences[bestForIdx].B || "";
    parsed.differences.splice(bestForIdx, 1);
  }

  // Final fallback: infer a lightweight value from existing difference rows.
  const valueLike = parsed.differences.find((item) => /value|price|budget|performance/i.test(item.name));
  if (valueLike) {
    if (!parsed.bestFor.A || parsed.bestFor.A === "-") {
      parsed.bestFor.A = `Users prioritizing ${valueLike.A || "overall value"}`;
    }
    if (!parsed.bestFor.B || parsed.bestFor.B === "-") {
      parsed.bestFor.B = `Users prioritizing ${valueLike.B || "overall value"}`;
    }
  }
  if (!parsed.drawbacks.A || parsed.drawbacks.A === "-") {
    parsed.drawbacks.A = "Trade-offs depend on usage; check key differences above.";
  }
  if (!parsed.drawbacks.B || parsed.drawbacks.B === "-") {
    parsed.drawbacks.B = "Trade-offs depend on usage; check key differences above.";
  }

  if (!parsed.differences.length) {
    return null;
  }
  return parsed;
}

async function requestComparison(productA, productB) {
  const question = buildComparePrompt(productA, productB);
  const contextReviews = [
    `[${productA.productName}] Price: ${productA.price || "Unknown"}`,
    `[${productA.productName}] Summary: ${productA.summary || "No summary"}`,
    ...((productA.reviews || []).map((r) => `[${productA.productName}] Review: ${r}`)),
    ...productA.chatHistory.map((m) => `[${productA.productName}] ${m.role}: ${m.text}`),
    `[${productB.productName}] Price: ${productB.price || "Unknown"}`,
    `[${productB.productName}] Summary: ${productB.summary || "No summary"}`,
    ...((productB.reviews || []).map((r) => `[${productB.productName}] Review: ${r}`)),
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
  const parsed = parseComparisonAnswer(answerText);
  if (!parsed) {
    mainContentEl.innerHTML = `
      <div class="pk-shell">
        <section class="panel pk-header">
          <h2>AI Product PK</h2>
          <p class="muted">${escapeHtml(productA.productName)} vs ${escapeHtml(productB.productName)}</p>
        </section>
        <section class="panel pk-foot">
          <h3>AI Verdict</h3>
          <div class="markdown">
            <p>${formatMarkdown(answerText)}</p>
          </div>
        </section>
      </div>
    `;
    return;
  }

  const differenceCards = parsed.differences
    .map(
      (item) => `
        <article class="diff-card">
          <h4>${escapeHtml(item.name)}</h4>
          <div class="diff-row">
            <span class="side side-a">A</span>
            <p>${escapeHtml(item.A || "-")}</p>
          </div>
          <div class="diff-row">
            <span class="side side-b">B</span>
            <p>${escapeHtml(item.B || "-")}</p>
          </div>
        </article>
      `,
    )
    .join("");

  const tableRows = [
    ...parsed.differences.map((item) => ({
      dim: item.name,
      A: item.A || "-",
      B: item.B || "-",
    })),
    { dim: "Drawbacks", A: parsed.drawbacks.A || "-", B: parsed.drawbacks.B || "-" },
    { dim: "Best For", A: parsed.bestFor.A || "-", B: parsed.bestFor.B || "-" },
  ]
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.dim)}</td>
          <td>${escapeHtml(row.A)}</td>
          <td>${escapeHtml(row.B)}</td>
        </tr>
      `,
    )
    .join("");

  mainContentEl.innerHTML = `
    <div class="pk-shell pk-shell-v2">
      <section class="panel pk-header">
        <h2>AI Product PK</h2>
        <p class="muted">${escapeHtml(productA.productName)} vs ${escapeHtml(productB.productName)}</p>
      </section>

      <section class="pk-product-tags">
        <div class="pk-tag a">🔴 ${escapeHtml(productA.productName)}</div>
        <div class="pk-tag b">🔵 ${escapeHtml(productB.productName)}</div>
      </section>

      <section class="panel verdict-card">
        <h3>🏆 AI Verdict</h3>
        <p>${escapeHtml(parsed.verdict)}</p>
      </section>

      <section class="panel pk-diff-wrap">
        <h3>⚖️ Key Differences</h3>
        <div class="pk-diff-grid">
          ${differenceCards}
        </div>
      </section>

      <section class="panel pk-table-wrap">
        <h3>📊 Comparison Table</h3>
        <div class="pk-table-scroll">
          <table class="pk-table">
            <thead>
              <tr>
                <th>Dimension</th>
                <th>🔴 ${escapeHtml(productA.productName)}</th>
                <th>🔵 ${escapeHtml(productB.productName)}</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
      </section>

      <section class="pk-bottom-grid">
        <article class="panel mini-card">
          <h3>⚠️ Drawbacks</h3>
          <div class="diff-row">
            <span class="side side-a">A</span>
            <p>${escapeHtml(parsed.drawbacks.A || "-")}</p>
          </div>
          <div class="diff-row">
            <span class="side side-b">B</span>
            <p>${escapeHtml(parsed.drawbacks.B || "-")}</p>
          </div>
        </article>
        <article class="panel mini-card">
          <h3>👤 Best For</h3>
          <div class="diff-row">
            <span class="side side-a">A</span>
            <p>${escapeHtml(parsed.bestFor.A || "-")}</p>
          </div>
          <div class="diff-row">
            <span class="side side-b">B</span>
            <p>${escapeHtml(parsed.bestFor.B || "-")}</p>
          </div>
        </article>
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
