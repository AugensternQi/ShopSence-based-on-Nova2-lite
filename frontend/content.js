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

  return {
    title: productTitle,
    price,
    reviews: reviews.join(" "),
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "EXTRACT_PRODUCT_DATA") {
    const data = extractAmazonProductData();
    sendResponse({ success: true, data });
    return true;
  }

  sendResponse({ success: false, error: "Unsupported message type." });
  return true;
});
