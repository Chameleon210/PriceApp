"use strict";

const STORAGE_KEY = "smartcart-state-v1";
const SHIPPING_THRESHOLD = 1500;
const STANDARD_SHIPPING = 80;

const PRODUCT_DATA = [
  { id: "EC-01", name: "無線藍牙耳機", originalPrice: 1200, price: 999, category: "電子產品", icon: "🎧", color: "#e8e4ff", stock: 18, badge: "人氣熱銷" },
  { id: "EC-02", name: "電競滑鼠", originalPrice: 800, price: 699, category: "電子產品", icon: "🖱️", color: "#e5edff", stock: 12, badge: "限時優惠" },
  { id: "AC-01", name: "機械鍵盤", originalPrice: 1800, price: 1499, category: "周邊配件", icon: "⌨️", color: "#eee7ff", stock: 9, badge: "熱銷推薦", bogoEligible: true },
  { id: "AC-02", name: "USB 集線器", originalPrice: 350, price: 299, category: "周邊配件", icon: "🔌", color: "#e6f1ff", stock: 24, badge: "超值入手", bogoEligible: true },
  { id: "HM-01", name: "暖光閱讀檯燈", originalPrice: 990, price: 799, category: "生活用品", icon: "💡", color: "#fff1dc", stock: 14, badge: "居家必備" },
  { id: "HM-02", name: "隨行保溫杯", originalPrice: 650, price: 499, category: "生活用品", icon: "🥤", color: "#e1f5ed", stock: 20, badge: "環保日常" },
  { id: "AC-03", name: "輕巧無線充電盤", originalPrice: 990, price: 799, category: "周邊配件", icon: "🔋", color: "#e8f0ff", stock: 16, badge: "桌面好物" },
  { id: "HM-03", name: "雲感記憶枕", originalPrice: 1280, price: 999, category: "生活用品", icon: "☁️", color: "#f1ebff", stock: 8, badge: "舒眠推薦" }
];

const COUPONS = Object.freeze({
  SAVE50: { type: "fixed", amount: 50, minimum: 500, label: "滿NT$500折NT$50", stacks: true },
  SAVE100: { type: "fixed", amount: 100, minimum: 1000, label: "滿NT$1,000折NT$100", stacks: true },
  SAVE10: { type: "percent", rate: 0.1, minimum: 0, label: "符合條件全單9折", stacks: false },
  FREESHIP: { type: "shipping", minimum: 1000, label: "滿NT$1,000免運", stacks: true }
});

const PERCENT_OPTIONS = [
  { rate: 0.95, label: "95折" },
  { rate: 0.9, label: "9折" },
  { rate: 0.85, label: "85折" },
  { rate: 0.8, label: "8折" }
];
const THRESHOLD_OPTIONS = [
  { minimum: 1000, amount: 50, label: "滿1,000折50" },
  { minimum: 2000, amount: 150, label: "滿2,000折150" },
  { minimum: 3000, amount: 300, label: "滿3,000折300" }
];

const money = amount => `NT$${Math.round(amount).toLocaleString("zh-TW")}`;
const productById = new Map(PRODUCT_DATA.map(product => [product.id, product]));

class ProductManager {
  constructor(products) {
    this.products = products;
  }

  all() {
    return this.products;
  }

  find(id) {
    return productById.get(id) || null;
  }

  byCategory(category) {
    return category === "全部" ? this.products : this.products.filter(product => product.category === category);
  }

  bogoEligible() {
    return this.products.filter(product => product.bogoEligible);
  }
}

class CartManager {
  constructor(products, savedItems = []) {
    this.products = products;
    this.quantities = new Map();
    savedItems.forEach(item => {
      const product = this.products.find(candidate => candidate.id === item.id);
      if (product && Number.isSafeInteger(item.quantity) && item.quantity > 0) {
        this.quantities.set(item.id, Math.min(item.quantity, product.stock));
      }
    });
  }

  add(productId, quantity = 1) {
    const product = this.products.find(item => item.id === productId);
    if (!product) throw new Error(`找不到商品：${productId}`);
    const current = this.quantities.get(productId) || 0;
    if (current + quantity > product.stock) return false;
    this.quantities.set(productId, current + quantity);
    return true;
  }

  setQuantity(productId, quantity) {
    const product = this.products.find(item => item.id === productId);
    if (!product) throw new Error(`找不到商品：${productId}`);
    if (quantity <= 0) {
      this.remove(productId);
      return;
    }
    this.quantities.set(productId, Math.min(quantity, product.stock));
  }

  remove(productId) {
    this.quantities.delete(productId);
  }

  clear() {
    this.quantities.clear();
  }

  quantity(productId) {
    return this.quantities.get(productId) || 0;
  }

  entries() {
    return [...this.quantities.entries()]
      .map(([id, quantity]) => ({ product: this.products.find(item => item.id === id), quantity }))
      .filter(entry => entry.product);
  }

  count() {
    return [...this.quantities.values()].reduce((sum, quantity) => sum + quantity, 0);
  }

  snapshot() {
    return [...this.quantities.entries()].map(([id, quantity]) => ({ id, quantity }));
  }
}

class PromotionEngine {
  applyCampaign(subtotal, cart, campaign) {
    if (!subtotal || !campaign || campaign.type === "none") {
      return { eligible: false, discount: 0, label: "未套用結帳促銷", after: subtotal, reason: "未選擇促銷活動" };
    }

    if (campaign.type === "percent") {
      const option = PERCENT_OPTIONS.find(item => item.rate === campaign.rate);
      if (!option) return { eligible: false, discount: 0, label: "全場折扣", after: subtotal, reason: "折扣設定無效" };
      const discount = Math.min(subtotal, Math.round(subtotal * (1 - campaign.rate)));
      return { eligible: true, discount, label: `全場${option.label}`, after: subtotal - discount, reason: `商品特價小計${money(subtotal)} × ${option.label}` };
    }

    if (campaign.type === "threshold") {
      const discount = subtotal >= campaign.minimum ? Math.min(campaign.amount, subtotal) : 0;
      return {
        eligible: discount > 0,
        discount,
        label: `滿額折抵${money(campaign.amount)}`,
        after: subtotal - discount,
        reason: discount ? `達到${money(campaign.minimum)}門檻，折抵${money(discount)}` : `還差${money(campaign.minimum - subtotal)}達到滿額門檻`
      };
    }

    if (campaign.type === "bogo") {
      const product = productById.get(campaign.productId);
      const quantity = cart.quantity(campaign.productId);
      if (!product || !product.bogoEligible) {
        return { eligible: false, discount: 0, label: "買一送一", after: subtotal, reason: "請選擇適用商品" };
      }
      const freeQuantity = Math.floor(quantity / 2);
      const discount = Math.min(subtotal, freeQuantity * product.price);
      return {
        eligible: discount > 0,
        discount,
        label: `${product.name}買一送一`,
        after: subtotal - discount,
        reason: freeQuantity
          ? `${product.name} ${quantity} 件，贈送 ${freeQuantity} 件`
          : `再加入 1 件${product.name}即可享買一送一`
      };
    }

    return { eligible: false, discount: 0, label: "未套用結帳促銷", after: subtotal, reason: "未選擇促銷活動" };
  }

  evaluateCoupon(code, amount) {
    const coupon = code ? COUPONS[code] : null;
    if (!coupon) return { valid: false, eligible: false, discount: 0, reason: "優惠碼無效，請確認代碼後再試一次。" };
    if (amount < coupon.minimum) {
      return {
        valid: true,
        eligible: false,
        discount: 0,
        reason: `還差${money(coupon.minimum - amount)}即可使用 ${code}。`
      };
    }
    return { valid: true, eligible: true, discount: 0, reason: coupon.label };
  }
}

class ShippingCalculator {
  calculate(qualifyingSubtotal, couponCode) {
    if (qualifyingSubtotal <= 0) {
      return {
        cost: 0,
        savings: 0,
        thresholdReached: false,
        freeShipCoupon: false,
        qualifyingSubtotal: 0,
        remaining: SHIPPING_THRESHOLD
      };
    }
    const freeShipCoupon = couponCode === "FREESHIP"
      && qualifyingSubtotal >= COUPONS.FREESHIP.minimum;
    const thresholdReached = qualifyingSubtotal >= SHIPPING_THRESHOLD;
    const free = freeShipCoupon || thresholdReached;
    return {
      cost: free ? 0 : STANDARD_SHIPPING,
      savings: free ? STANDARD_SHIPPING : 0,
      thresholdReached,
      freeShipCoupon,
      qualifyingSubtotal,
      remaining: Math.max(0, SHIPPING_THRESHOLD - qualifyingSubtotal)
    };
  }
}

class CheckoutCalculator {
  constructor(promotionEngine, shippingCalculator) {
    this.promotionEngine = promotionEngine;
    this.shippingCalculator = shippingCalculator;
  }

  calculate(cart, campaign, couponCode) {
    const entries = cart.entries();
    const originalSubtotal = entries.reduce((sum, { product, quantity }) => sum + product.originalPrice * quantity, 0);
    const subtotal = entries.reduce((sum, { product, quantity }) => sum + product.price * quantity, 0);
    const productSavings = originalSubtotal - subtotal;
    const exclusiveCoupon = couponCode === "SAVE10";
    const effectiveCampaign = exclusiveCoupon ? { type: "none" } : campaign;
    const campaignResult = this.promotionEngine.applyCampaign(subtotal, cart, effectiveCampaign);
    const couponBase = campaignResult.after;
    const couponAmountForEligibility = couponCode === "FREESHIP" ? subtotal : couponBase;
    const couponStatus = this.promotionEngine.evaluateCoupon(couponCode, couponAmountForEligibility);
    let couponDiscount = 0;
    let freeShip = false;

    if (couponStatus.valid && couponStatus.eligible) {
      const coupon = COUPONS[couponCode];
      if (coupon.type === "fixed") couponDiscount = Math.min(coupon.amount, couponBase);
      if (coupon.type === "percent") couponDiscount = Math.min(couponBase, Math.round(couponBase * coupon.rate));
      if (coupon.type === "shipping") freeShip = true;
    }

    const afterCoupon = couponBase - couponDiscount;
    const shipping = this.shippingCalculator.calculate(subtotal, freeShip && couponStatus.eligible ? couponCode : null);
    const total = afterCoupon + shipping.cost;
    const totalSavings = productSavings + campaignResult.discount + couponDiscount + shipping.savings;

    return {
      entries,
      originalSubtotal,
      subtotal,
      productSavings,
      campaign: campaignResult,
      effectiveCampaign,
      exclusiveCoupon,
      coupon: couponCode ? { ...couponStatus, code: couponCode, discount: couponDiscount } : null,
      couponBase,
      couponDiscount,
      afterCoupon,
      shipping,
      total,
      totalSavings
    };
  }
}

class UIController {
  constructor() {
    this.products = new ProductManager(PRODUCT_DATA);
    this.storageWarningShown = false;
    this.feedback = { message: "", type: "" };
    this.selectedCategory = "全部";
    this.detailsExpanded = false;
    this.currentOrder = null;
    this.lastFocusedElement = null;
    this.loadResult = this.loadState();
    this.cart = new CartManager(this.products.all(), this.loadResult.state.cart);
    this.campaign = this.loadResult.state.campaign;
    this.couponCode = this.loadResult.state.couponCode;
    this.promotionTab = this.campaign.type === "threshold" || this.campaign.type === "bogo"
      ? this.campaign.type
      : this.campaign.type === "none" && this.couponCode
        ? "coupon"
        : "percent";
    this.engine = new PromotionEngine();
    this.shippingCalculator = new ShippingCalculator();
    this.calculator = new CheckoutCalculator(this.engine, this.shippingCalculator);
    this.cacheElements();
    this.bindEvents();
    this.renderAll();
    if (this.loadResult.error) this.showToast(this.loadResult.error, "error");
  }

  cacheElements() {
    const ids = [
      "product-grid", "product-count", "cart-items", "cart-count", "cart-unique-count", "nav-cart-count",
      "clear-cart", "promotion-options", "coupon-form", "coupon-input", "coupon-feedback", "applied-coupon",
      "subtotal-original", "product-discount", "campaign-line-label", "campaign-discount",
      "coupon-line-label", "coupon-discount", "shipping-cost", "grand-total", "savings-message",
      "checkout-button", "shipping-progress", "shipping-message", "shipping-progress-fill",
      "shipping-progress-label", "shipping-percentage", "shipping-threshold-value", "comparison-body", "comparison-note",
      "best-plan-indicator", "calculation-steps", "calculation-details", "toggle-details",
      "checkout-dialog", "dialog-content", "dialog-close", "toast-region"
    ];
    this.elements = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  }

  loadState() {
    const fallback = {
      cart: [],
      campaign: { type: "percent", rate: 0.95 },
      couponCode: ""
    };
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return { state: fallback, error: "" };
      const parsed = JSON.parse(saved);
      const cart = Array.isArray(parsed.cart)
        ? parsed.cart.filter(item => item && typeof item.id === "string" && Number.isSafeInteger(item.quantity) && item.quantity > 0)
        : [];
      const campaign = this.validCampaign(parsed.campaign) ? parsed.campaign : fallback.campaign;
      const couponCode = typeof parsed.couponCode === "string" && Object.hasOwn(COUPONS, parsed.couponCode)
        ? parsed.couponCode
        : "";
      return { state: { cart, campaign, couponCode }, error: "" };
    } catch {
      return { state: fallback, error: "無法讀取已儲存的購物車，本次已使用新的購物車。" };
    }
  }

  validCampaign(campaign) {
    if (!campaign || typeof campaign !== "object") return false;
    if (campaign.type === "none") return true;
    if (campaign.type === "percent") return PERCENT_OPTIONS.some(item => item.rate === campaign.rate);
    if (campaign.type === "threshold") return THRESHOLD_OPTIONS.some(item => item.minimum === campaign.minimum && item.amount === campaign.amount);
    return campaign.type === "bogo" && this.products.bogoEligible().some(item => item.id === campaign.productId);
  }

  persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        cart: this.cart.snapshot(),
        campaign: this.campaign,
        couponCode: this.couponCode
      }));
    } catch {
      if (!this.storageWarningShown) {
        this.storageWarningShown = true;
        this.showToast("瀏覽器無法儲存資料；本次瀏覽中的購物車仍可正常使用。", "error");
      }
    }
  }

  bindEvents() {
    document.querySelectorAll(".category-tab").forEach(button => {
      button.addEventListener("click", () => {
        this.selectedCategory = button.dataset.category;
        document.querySelectorAll(".category-tab").forEach(tab => {
          const active = tab === button;
          tab.classList.toggle("is-active", active);
          tab.setAttribute("aria-pressed", String(active));
        });
        this.renderProducts();
      });
    });

    this.elements["product-grid"].addEventListener("click", event => {
      const button = event.target.closest("[data-add-product]");
      if (!button) return;
      const product = this.products.find(button.dataset.addProduct);
      if (!product) throw new Error(`無法加入未知商品：${button.dataset.addProduct}`);
      if (!this.cart.add(product.id)) {
        this.showToast(`${product.name}庫存不足，目前最多可加入 ${product.stock} 件。`, "error");
        return;
      }
      this.persist();
      this.renderAll();
      this.showToast(`${product.name}已加入購物車`, "success");
    });

    this.elements["cart-items"].addEventListener("click", event => {
      const quantityButton = event.target.closest("[data-quantity-action]");
      if (quantityButton) {
        const productId = quantityButton.dataset.productId;
        const quantity = this.cart.quantity(productId);
        const next = quantityButton.dataset.quantityAction === "increase" ? quantity + 1 : quantity - 1;
        const product = this.products.find(productId);
        if (!product) throw new Error(`找不到商品：${productId}`);
        if (next > product.stock) {
          this.showToast(`${product.name}最多可購買 ${product.stock} 件。`, "error");
          return;
        }
        if (next === 0) this.showToast(`${product.name}已從購物車移除。`, "success");
        this.cart.setQuantity(productId, next);
        this.persist();
        this.renderAll();
        return;
      }
      const removeButton = event.target.closest("[data-remove-product]");
      if (removeButton) {
        const product = this.products.find(removeButton.dataset.removeProduct);
        if (!product) throw new Error(`找不到商品：${removeButton.dataset.removeProduct}`);
        this.cart.remove(product.id);
        this.persist();
        this.renderAll();
        this.showToast(`${product.name}已移除`, "success");
      }
    });

    this.elements["clear-cart"].addEventListener("click", () => {
      if (this.cart.count() === 0) return;
      this.cart.clear();
      this.persist();
      this.renderAll();
      this.showToast("購物車已清空", "success");
    });

    document.querySelectorAll(".promotion-tab").forEach(button => {
      button.addEventListener("click", () => {
        this.promotionTab = button.dataset.promotion;
        if (this.promotionTab === "percent" && this.campaign.type !== "percent" && this.campaign.type !== "none") {
          this.campaign = { type: "percent", rate: 0.95 };
        } else if (this.promotionTab === "threshold" && this.campaign.type !== "threshold") {
          this.campaign = { type: "threshold", minimum: THRESHOLD_OPTIONS[0].minimum, amount: THRESHOLD_OPTIONS[0].amount };
        } else if (this.promotionTab === "bogo" && this.campaign.type !== "bogo") {
          this.campaign = { type: "bogo", productId: this.products.bogoEligible()[0].id };
        }
        document.querySelectorAll(".promotion-tab").forEach(tab => {
          const selected = tab === button;
          tab.classList.toggle("is-active", selected);
          tab.setAttribute("aria-selected", String(selected));
        });
        this.persist();
        this.currentCalculation = this.calculator.calculate(this.cart, this.campaign, this.couponCode);
        this.renderPromotionOptions();
        this.renderTotals();
        this.renderShippingProgress();
        this.renderComparison();
        this.renderCalculationSteps();
        if (this.promotionTab === "coupon") {
          this.elements["coupon-input"].focus({ preventScroll: true });
        }
      });
    });

    this.elements["promotion-options"].addEventListener("click", event => {
      const button = event.target.closest("[data-campaign-option]");
      if (!button || button.disabled) return;
      const { campaignOption, campaignValue } = button.dataset;
      if (campaignOption === "percent") this.campaign = campaignValue === "none" ? { type: "none" } : { type: "percent", rate: Number(campaignValue) };
      if (campaignOption === "threshold") {
        const [minimum, amount] = campaignValue.split(":").map(Number);
        this.campaign = { type: "threshold", minimum, amount };
      }
      if (campaignOption === "bogo") this.campaign = { type: "bogo", productId: campaignValue };
      this.persist();
      this.renderAll();
      this.showToast(`已更新促銷方案：${this.campaignLabel(this.campaign)}`, "success");
    });

    this.elements["promotion-options"].addEventListener("change", event => {
      if (event.target.matches("[data-bogo-select]")) {
        const applyButton = this.elements["promotion-options"].querySelector("[data-campaign-option='bogo']");
        if (applyButton) applyButton.dataset.campaignValue = event.target.value;
        if (this.campaign.type === "bogo") {
          this.campaign = { type: "bogo", productId: event.target.value };
          this.persist();
          this.renderAll();
        }
      }
    });

    this.elements["coupon-form"].addEventListener("submit", event => {
      event.preventDefault();
      const code = this.elements["coupon-input"].value.trim().toUpperCase();
      if (!Object.hasOwn(COUPONS, code)) {
        this.setCouponFeedback("優惠碼無效，請確認代碼後再試一次。", "error");
        return;
      }
      if (this.cart.count() === 0) {
        this.setCouponFeedback("請先將商品加入購物車，再套用優惠碼。", "error");
        return;
      }
      const preview = this.calculator.calculate(this.cart, this.campaign, code);
      if (!preview.coupon.eligible) {
        this.setCouponFeedback(preview.coupon.reason, "error");
        return;
      }
      this.couponCode = code;
      this.promotionTab = "coupon";
      this.elements["coupon-input"].value = "";
      this.setCouponFeedback(`${code} 已成功套用：${this.couponDescription(code, preview)}`, "success");
      this.persist();
      this.renderAll();
      this.showToast(`優惠碼 ${code} 已套用`, "success");
    });

    this.elements["applied-coupon"].addEventListener("click", event => {
      if (!event.target.closest("[data-remove-coupon]")) return;
      this.couponCode = "";
      this.persist();
      this.renderAll();
      this.showToast("優惠碼已移除", "success");
    });

    this.elements["toggle-details"].addEventListener("click", () => {
      this.detailsExpanded = !this.detailsExpanded;
      this.elements["toggle-details"].setAttribute("aria-expanded", String(this.detailsExpanded));
      this.elements["toggle-details"].innerHTML = this.detailsExpanded
        ? '收合詳細資訊 <span aria-hidden="true">⌃</span>'
        : '查看詳細資訊 <span aria-hidden="true">⌄</span>';
      this.renderCalculationSteps();
    });

    this.elements["checkout-button"].addEventListener("click", () => this.openCheckoutDialog());
    this.elements["dialog-close"].addEventListener("click", () => this.closeDialog());
    this.elements["checkout-dialog"].addEventListener("click", event => {
      if (event.target === this.elements["checkout-dialog"]) this.closeDialog();
    });
    this.elements["checkout-dialog"].addEventListener("close", () => {
      if (this.lastFocusedElement && document.contains(this.lastFocusedElement)) this.lastFocusedElement.focus();
    });

    document.querySelectorAll(".nav-link").forEach(link => {
      link.addEventListener("click", () => {
        document.querySelectorAll(".nav-link").forEach(item => item.classList.toggle("is-current", item === link));
      });
    });
    document.querySelector(".nav-cart").addEventListener("click", () => {
      document.querySelectorAll(".nav-link").forEach(item => item.classList.toggle("is-current", item.getAttribute("href") === "#products"));
    });

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (!visible.length) return;
        const target = `#${visible[0].target.id}`;
        document.querySelectorAll(".nav-link").forEach(link => {
          link.classList.toggle("is-current", link.getAttribute("href") === target);
        });
      }, { rootMargin: "-110px 0px -68% 0px", threshold: 0 });
      ["products", "promotion-analysis", "how-it-works"].forEach(id => observer.observe(document.getElementById(id)));
    }
  }

  renderAll() {
    this.currentCalculation = this.calculator.calculate(this.cart, this.campaign, this.couponCode);
    document.querySelectorAll(".promotion-tab").forEach(tab => {
      const selected = tab.dataset.promotion === this.promotionTab;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    this.renderProducts();
    this.renderCart();
    this.renderPromotionOptions();
    this.renderCoupon();
    this.renderTotals();
    this.renderShippingProgress();
    this.renderComparison();
    this.renderCalculationSteps();
  }

  renderProducts() {
    const products = this.products.byCategory(this.selectedCategory);
    const grid = this.elements["product-grid"];
    grid.replaceChildren();
    this.elements["product-count"].textContent = `共 ${products.length} 項商品`;
    products.forEach(product => {
      const card = document.createElement("article");
      card.className = "product-card";
      const imageWrap = document.createElement("div");
      imageWrap.className = "product-image-wrap";
      const image = document.createElement("img");
      image.className = "product-image";
      image.src = this.productImage(product);
      image.alt = `${product.name}商品示意圖`;
      image.loading = "lazy";
      imageWrap.append(image);
      const sale = document.createElement("span");
      sale.className = "sale-badge";
      sale.textContent = product.badge;
      imageWrap.append(sale);
      const stock = document.createElement("span");
      stock.className = `stock-badge${product.stock <= 9 ? " low-stock" : ""}`;
      stock.textContent = product.stock <= 9 ? `剩 ${product.stock} 件` : "現貨供應";
      imageWrap.append(stock);

      const info = document.createElement("div");
      info.className = "product-info";
      const category = document.createElement("span");
      category.className = "product-category";
      category.textContent = product.category;
      const name = document.createElement("h3");
      name.className = "product-name";
      name.textContent = product.name;
      const prices = document.createElement("div");
      prices.className = "product-prices";
      const originalPrice = document.createElement("span");
      originalPrice.className = "product-original-price";
      originalPrice.textContent = money(product.originalPrice);
      const salePrice = document.createElement("strong");
      salePrice.className = "product-sale-price";
      salePrice.textContent = money(product.price);
      prices.append(originalPrice, salePrice);
      const savings = document.createElement("p");
      savings.className = "product-save";
      savings.textContent = `省下 ${money(product.originalPrice - product.price)}`;
      const add = document.createElement("button");
      add.className = "add-product-button";
      add.type = "button";
      add.dataset.addProduct = product.id;
      add.disabled = this.cart.quantity(product.id) >= product.stock;
      add.innerHTML = add.disabled ? "已達購買上限" : '<span aria-hidden="true">＋</span> 加入購物車';
      info.append(category, name, prices, savings, add);
      card.append(imageWrap, info);
      grid.append(card);
    });
  }

  renderCart() {
    const container = this.elements["cart-items"];
    const entries = this.cart.entries();
    container.replaceChildren();
    this.elements["cart-count"].textContent = `${this.cart.count()} 件商品`;
    this.elements["cart-unique-count"].textContent = `${entries.length} 種品項`;
    this.elements["nav-cart-count"].textContent = String(this.cart.count());
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cart-empty";
      empty.innerHTML = '<span class="cart-empty-icon" aria-hidden="true">🛒</span><strong>購物車還是空的</strong><p>挑幾件喜歡的商品，優惠馬上為你試算。</p><button class="start-shopping" type="button">去逛逛商品 →</button>';
      empty.querySelector(".start-shopping").addEventListener("click", () => {
        document.getElementById("products").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      container.append(empty);
      return;
    }

    entries.forEach(({ product, quantity }) => {
      const item = document.createElement("article");
      item.className = "cart-item";
      const main = document.createElement("div");
      main.className = "cart-item-main";
      const thumb = document.createElement("span");
      thumb.className = "cart-item-thumb";
      const image = document.createElement("img");
      image.src = this.productImage(product);
      image.alt = "";
      image.loading = "lazy";
      thumb.append(image);
      const copy = document.createElement("div");
      copy.className = "cart-item-copy";
      const name = document.createElement("h3");
      name.className = "cart-item-name";
      name.textContent = product.name;
      const price = document.createElement("div");
      price.className = "cart-item-price";
      price.textContent = `${money(product.price)} / 件`;
      copy.append(name, price);
      const remove = document.createElement("button");
      remove.className = "remove-item";
      remove.type = "button";
      remove.dataset.removeProduct = product.id;
      remove.setAttribute("aria-label", `移除${product.name}`);
      remove.textContent = "×";
      main.append(thumb, copy, remove);

      const bottom = document.createElement("div");
      bottom.className = "cart-item-bottom";
      const control = document.createElement("div");
      control.className = "quantity-control";
      const decrease = document.createElement("button");
      decrease.className = "quantity-button";
      decrease.type = "button";
      decrease.dataset.quantityAction = "decrease";
      decrease.dataset.productId = product.id;
      decrease.setAttribute("aria-label", `減少${product.name}數量`);
      decrease.textContent = "−";
      const value = document.createElement("span");
      value.className = "quantity-value";
      value.textContent = String(quantity);
      const increase = document.createElement("button");
      increase.className = "quantity-button";
      increase.type = "button";
      increase.dataset.quantityAction = "increase";
      increase.dataset.productId = product.id;
      increase.disabled = quantity >= product.stock;
      increase.setAttribute("aria-label", `增加${product.name}數量`);
      increase.textContent = "+";
      control.append(decrease, value, increase);
      const lineTotal = document.createElement("strong");
      lineTotal.className = "cart-line-total";
      lineTotal.textContent = money(product.price * quantity);
      bottom.append(control, lineTotal);
      item.append(main, bottom);
      container.append(item);
    });
  }

  renderPromotionOptions() {
    const container = this.elements["promotion-options"];
    container.replaceChildren();
    const caption = document.createElement("p");
    caption.className = "option-caption";
    const chips = document.createElement("div");
    chips.className = "option-chips";

    if (this.promotionTab === "percent") {
      caption.textContent = "選擇一種全場折扣；無法與 SAVE10 同時使用。";
      const options = [{ rate: "none", label: "不使用" }, ...PERCENT_OPTIONS.map(item => ({ rate: String(item.rate), label: item.label }))];
      options.forEach(option => {
        const button = this.createOptionButton(option.label, "percent", option.rate);
        const selected = option.rate === "none" ? this.campaign.type === "none" : this.campaign.type === "percent" && this.campaign.rate === Number(option.rate);
        button.classList.toggle("is-selected", selected);
        chips.append(button);
      });
      container.append(caption, chips);
      if (this.couponCode === "SAVE10") this.addEligibilityNote(container, "SAVE10 與全場促銷不可疊加；目前以優惠券取代此促銷。");
      return;
    }

    if (this.promotionTab === "threshold") {
      caption.textContent = "消費達到門檻即可折抵，折扣以整數元計。";
      THRESHOLD_OPTIONS.forEach(option => {
        const button = this.createOptionButton(option.label, "threshold", `${option.minimum}:${option.amount}`);
        button.classList.toggle("is-selected", this.campaign.type === "threshold" && this.campaign.minimum === option.minimum);
        chips.append(button);
      });
      container.append(caption, chips);
      if (this.couponCode === "SAVE10") this.addEligibilityNote(container, "SAVE10 為單獨折扣；目前結帳不會再套用此滿額促銷。");
      return;
    }

    if (this.promotionTab === "bogo") {
      const eligibleProducts = this.products.bogoEligible();
      caption.textContent = "指定周邊配件買 1 件，第二件免費（同款成對計算）。";
      const select = document.createElement("select");
      select.className = "option-select";
      select.dataset.bogoSelect = "true";
      select.setAttribute("aria-label", "選擇買一送一適用商品");
      eligibleProducts.forEach(product => {
        const option = document.createElement("option");
        option.value = product.id;
        option.textContent = `${product.name}（${money(product.price)}）`;
        select.append(option);
      });
      if (this.campaign.type === "bogo" && eligibleProducts.some(product => product.id === this.campaign.productId)) {
        select.value = this.campaign.productId;
      } else {
        select.value = eligibleProducts[0].id;
      }
      const button = this.createOptionButton("套用買一送一", "bogo", select.value);
      button.classList.toggle("is-selected", this.campaign.type === "bogo" && this.campaign.productId === select.value);
      container.append(caption, select, button);
      if (this.couponCode === "SAVE10") this.addEligibilityNote(container, "SAVE10 為單獨折扣；目前結帳不會再套用買一送一促銷。");
      return;
    }

    caption.textContent = "在下方輸入優惠碼；部分優惠碼可與促銷疊加。";
    const sample = document.createElement("p");
    sample.className = "eligibility-note";
    sample.textContent = "可試用 SAVE50、SAVE100、SAVE10、FREESHIP";
    container.append(caption, sample);
  }

  createOptionButton(label, optionType, value) {
    const button = document.createElement("button");
    button.className = "option-chip";
    button.type = "button";
    button.dataset.campaignOption = optionType;
    button.dataset.campaignValue = value;
    button.disabled = this.cart.count() === 0;
    button.textContent = label;
    return button;
  }

  addEligibilityNote(container, message) {
    const note = document.createElement("p");
    note.className = "eligibility-note";
    note.textContent = message;
    container.append(note);
  }

  renderCoupon() {
    const feedback = this.elements["coupon-feedback"];
    feedback.textContent = this.feedback.message;
    feedback.className = `coupon-feedback${this.feedback.type ? ` ${this.feedback.type}` : ""}`;
    const applied = this.elements["applied-coupon"];
    applied.replaceChildren();
    applied.hidden = !this.couponCode;
    if (!this.couponCode) return;
    const calculation = this.currentCalculation;
    const coupon = document.createElement("span");
    coupon.textContent = `✓ ${this.couponCode} ・ ${calculation.coupon && calculation.coupon.eligible
      ? this.couponDescription(this.couponCode, calculation)
      : calculation.coupon?.reason || COUPONS[this.couponCode].label}`;
    const remove = document.createElement("button");
    remove.className = "remove-coupon";
    remove.type = "button";
    remove.dataset.removeCoupon = "true";
    remove.textContent = "移除";
    applied.append(coupon, remove);
  }

  renderTotals() {
    const calculation = this.currentCalculation;
    this.elements["subtotal-original"].textContent = money(calculation.originalSubtotal);
    this.elements["product-discount"].textContent = `− ${money(calculation.productSavings)}`;
    this.elements["campaign-line-label"].textContent = calculation.campaign.label;
    this.elements["campaign-discount"].textContent = `− ${money(calculation.campaign.discount)}`;
    this.elements["coupon-line-label"].textContent = this.couponCode ? `優惠券 ${this.couponCode}` : "優惠券折抵";
    this.elements["coupon-discount"].textContent = `− ${money(calculation.couponDiscount)}`;
    this.elements["shipping-cost"].textContent = calculation.subtotal === 0
      ? money(0)
      : calculation.shipping.cost ? money(calculation.shipping.cost) : "免運";
    this.elements["grand-total"].textContent = money(calculation.total);
    this.elements["savings-message"].textContent = calculation.totalSavings
      ? `本次購物已節省 ${money(calculation.totalSavings)}！`
      : this.cart.count() ? "目前沒有額外折抵，試試其他促銷方案。" : "加入商品，開始計算你的專屬優惠。";
    this.elements["checkout-button"].disabled = this.cart.count() === 0;
  }

  renderShippingProgress() {
    const calculation = this.currentCalculation;
    const qualified = calculation.shipping.cost === 0;
    const progressThreshold = calculation.shipping.freeShipCoupon ? COUPONS.FREESHIP.minimum : SHIPPING_THRESHOLD;
    const displayedProgress = Math.min(100, Math.round(calculation.subtotal / progressThreshold * 100));
    this.elements["shipping-progress"].classList.toggle("is-qualified", qualified);
    this.elements["shipping-progress-fill"].style.width = `${displayedProgress}%`;
    this.elements["shipping-threshold-value"].textContent = money(progressThreshold);
    this.elements["shipping-progress-label"].textContent = `${money(calculation.subtotal)} / ${money(progressThreshold)}`;
    this.elements["shipping-percentage"].textContent = `${displayedProgress}%`;
    this.elements["shipping-progress-fill"].parentElement.setAttribute("aria-valuenow", String(displayedProgress));
    this.elements["shipping-message"].textContent = calculation.shipping.freeShipCoupon
      ? "恭喜！FREESHIP 優惠碼已生效，這筆訂單免運。"
      : qualified
        ? "恭喜！已達成免運門檻！"
        : calculation.subtotal
          ? `再購買 ${money(calculation.shipping.remaining)}，即可享有免運優惠！`
          : `商品特價小計滿 ${money(SHIPPING_THRESHOLD)}，即可享有免運優惠。`;
  }

  renderComparison() {
    const scenarios = [
      { key: "85", label: "全場85折", campaign: { type: "percent", rate: 0.85 } },
      { key: "90", label: "全場9折", campaign: { type: "percent", rate: 0.9 } },
      { key: "2000", label: "滿NT$2,000折NT$250", campaign: { type: "threshold", minimum: 2000, amount: 250 } }
    ];
    const comparisonBody = this.elements["comparison-body"];
    comparisonBody.replaceChildren();
    const results = scenarios.map(scenario => {
      const result = this.calculator.calculate(this.cart, scenario.campaign, this.couponCode === "SAVE10" ? "" : this.couponCode);
      const eligible = this.cart.count() > 0 && (scenario.campaign.type !== "threshold" || result.subtotal >= scenario.campaign.minimum);
      return { ...scenario, result, eligible };
    });
    const eligibleResults = results.filter(result => result.eligible);
    const best = eligibleResults.reduce((winner, candidate) => !winner || candidate.result.total < winner.result.total ? candidate : winner, null);
    this.elements["best-plan-indicator"].textContent = best ? `目前最划算：${best.label}` : "等待商品";
    this.elements["best-plan-indicator"].classList.toggle("is-empty", !best);

    results.forEach(scenario => {
      const row = document.createElement("tr");
      const isBest = best === scenario;
      row.classList.toggle("is-best", isBest);
      const plan = document.createElement("td");
      plan.textContent = scenario.label;
      const discount = document.createElement("td");
      discount.textContent = scenario.eligible ? `− ${money(scenario.result.campaign.discount + scenario.result.couponDiscount)}` : "—";
      const after = document.createElement("td");
      after.textContent = scenario.eligible ? money(scenario.result.afterCoupon) : "—";
      const status = document.createElement("td");
      if (isBest) {
        status.className = "best-row-label";
        status.textContent = "✦ 目前最划算";
      } else if (!scenario.eligible && this.cart.count()) {
        status.className = "status-ineligible";
        status.textContent = "未達門檻";
      } else if (scenario.eligible) {
        status.textContent = "可使用";
      } else {
        status.className = "status-ineligible";
        status.textContent = "加入商品";
      }
      row.append(plan, discount, after, status);
      comparisonBody.append(row);
    });

    const ninety = results.find(result => result.key === "90");
    const savings = best && ninety && ninety.eligible ? ninety.result.total - best.result.total : 0;
    const note = best
      ? savings > 0
        ? `與全場9折相比，${best.label}還能再省 ${money(savings)}。`
        : savings === 0 && best.key === "90"
          ? "全場9折目前就是最划算的符合條件方案。"
          : `目前最佳方案為「${best.label}」，計入運費後比較更準確。`
      : this.cart.count()
        ? "目前購物車金額未達比較方案的使用門檻。"
        : "加入商品後，即時比較符合資格的促銷方案。";
    this.elements["comparison-note"].textContent = this.couponCode === "SAVE10"
      ? `${note} 方案比較會以結帳促銷取代不能疊加的 SAVE10。`
      : note;
  }

  renderCalculationSteps() {
    const calculation = this.currentCalculation;
    const couponName = this.couponCode ? `優惠券 ${this.couponCode}` : "未使用優惠券";
    const steps = [
      {
        title: "計算商品原價總額",
        description: `${calculation.entries.map(({ product, quantity }) => `${product.name} ${money(product.originalPrice)} × ${quantity}`).join(" + ") || "購物車尚無商品"}`,
        value: money(calculation.originalSubtotal)
      },
      {
        title: "套用商品促銷價",
        description: `特價小計 ${money(calculation.subtotal)}，商品本身省下 ${money(calculation.productSavings)}`,
        value: `− ${money(calculation.productSavings)}`
      },
      {
        title: "套用結帳促銷",
        description: calculation.exclusiveCoupon
          ? `SAVE10 不與結帳促銷疊加；${this.campaignLabel(this.campaign)}暫不套用`
          : `${calculation.campaign.label}：${calculation.campaign.reason}`,
        value: `− ${money(calculation.campaign.discount)}`
      },
      {
        title: "套用優惠券",
        description: calculation.coupon
          ? `${couponName}：${calculation.coupon.eligible ? this.couponDescription(this.couponCode, calculation) : calculation.coupon.reason}`
          : "未輸入優惠券；各折扣按規則依序計算",
        value: this.couponCode === "FREESHIP" && calculation.coupon?.eligible
          ? "免運資格"
          : `− ${money(calculation.couponDiscount)}`
      },
      {
        title: "計算運費",
        description: calculation.shipping.freeShipCoupon
          ? `FREESHIP 條件達成，運費 NT$${STANDARD_SHIPPING} 折抵`
          : calculation.shipping.thresholdReached
            ? `商品特價小計達 ${money(SHIPPING_THRESHOLD)}，符合免運`
            : `特價商品小計 ${money(calculation.subtotal)}，距免運門檻 ${money(calculation.shipping.remaining)}`,
        value: calculation.shipping.cost ? money(calculation.shipping.cost) : "免運"
      },
      {
        title: "最終應付金額",
        description: `${money(calculation.afterCoupon)} 商品金額 + ${money(calculation.shipping.cost)} 運費`,
        value: money(calculation.total)
      }
    ];
    const list = this.elements["calculation-steps"];
    list.replaceChildren();
    steps.forEach((step, index) => {
      const item = document.createElement("li");
      item.className = "calculation-step";
      const number = document.createElement("span");
      number.className = "step-number";
      number.textContent = String(index + 1);
      const copy = document.createElement("span");
      copy.className = "step-copy";
      const title = document.createElement("span");
      title.className = "step-title";
      title.textContent = step.title;
      const description = document.createElement("span");
      description.className = "step-description";
      description.textContent = step.description;
      copy.append(title, description);
      const value = document.createElement("strong");
      value.className = "step-value";
      value.textContent = step.value;
      item.append(number, copy, value);
      list.append(item);
    });
    const details = this.elements["calculation-details"];
    details.hidden = !this.detailsExpanded;
    details.replaceChildren();
    if (this.detailsExpanded) {
      const detailLines = [
        ["商品金額取整", "商品、促銷、折價券與運費均以整數元計算；百分比折扣於每一計算階段四捨五入至整數元。"],
        ["促銷順序", "先計商品售價，再套用一種結帳促銷，接著套用可疊加優惠券，最後判斷運費。"],
        ["本次結帳促銷", `${calculation.campaign.label}：${calculation.campaign.reason}；實際折抵 ${money(calculation.campaign.discount)}。`],
        ["優惠券疊加", "SAVE50、SAVE100 可與結帳促銷疊加；SAVE10 不可疊加且會取代結帳促銷；FREESHIP 僅折抵運費。"],
        ["免運判定", `一般免運以商品特價小計 ${money(SHIPPING_THRESHOLD)} 判定（結帳促銷及折價券折抵前）；FREESHIP 以商品特價小計 ${money(COUPONS.FREESHIP.minimum)} 判定；未達門檻運費 ${money(STANDARD_SHIPPING)}。`],
        ["總節省", `商品售價折扣 ${money(calculation.productSavings)} + 結帳促銷 ${money(calculation.campaign.discount)} + 優惠券 ${money(calculation.couponDiscount)} + 運費折抵 ${money(calculation.shipping.savings)} = ${money(calculation.totalSavings)}。`]
      ];
      detailLines.forEach(([label, text]) => {
        const line = document.createElement("p");
        const strong = document.createElement("strong");
        strong.textContent = `${label}：`;
        line.append(strong, document.createTextNode(text));
        details.append(line);
      });
    }
  }

  setCouponFeedback(message, type) {
    this.feedback = { message, type };
    this.renderCoupon();
  }

  couponDescription(code, calculation) {
    if (code === "FREESHIP") return "免運";
    if (code === "SAVE10") return `折抵 ${money(calculation.couponDiscount)}`;
    return `折抵 ${money(calculation.couponDiscount)}`;
  }

  campaignLabel(campaign) {
    if (!campaign || campaign.type === "none") return "不使用促銷";
    if (campaign.type === "percent") return `全場${PERCENT_OPTIONS.find(item => item.rate === campaign.rate)?.label || "折扣"}`;
    if (campaign.type === "threshold") return `滿${campaign.minimum.toLocaleString("zh-TW")}折${campaign.amount.toLocaleString("zh-TW")}`;
    if (campaign.type === "bogo") return `${productById.get(campaign.productId)?.name || "指定商品"}買一送一`;
    return "促銷活動";
  }

  productImage(product) {
    const icon = product.icon;
    const color = product.color;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 276"><rect width="400" height="276" rx="24" fill="${color}"/><circle cx="327" cy="57" r="51" fill="#fff" fill-opacity=".35"/><circle cx="67" cy="225" r="76" fill="#fff" fill-opacity=".28"/><path d="M45 220c49-32 91-39 140-18 42 18 105 18 169-15v89H45z" fill="#fff" fill-opacity=".23"/><text x="200" y="162" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI, Noto Color Emoji, sans-serif" font-size="111">${icon}</text><text x="200" y="244" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="12" font-weight="700" letter-spacing="3" fill="#504c70">SMARTCART PICK</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  openCheckoutDialog() {
    if (this.cart.count() === 0) return;
    this.lastFocusedElement = document.activeElement;
    this.currentOrder = {
      calculation: this.currentCalculation,
      items: this.currentCalculation.entries.map(({ product, quantity }) => ({ product, quantity })),
      createdAt: Date.now()
    };
    this.renderOrderConfirmation();
    this.elements["checkout-dialog"].showModal();
    this.elements["dialog-content"].querySelector("[data-confirm-order]")?.focus();
  }

  renderOrderConfirmation() {
    const calculation = this.currentOrder.calculation;
    const content = this.elements["dialog-content"];
    content.replaceChildren();
    const kicker = document.createElement("span");
    kicker.className = "dialog-kicker";
    kicker.textContent = "ORDER SUMMARY";
    const title = document.createElement("h2");
    title.id = "dialog-title";
    title.textContent = "確認你的模擬訂單";
    const intro = document.createElement("p");
    intro.className = "dialog-intro";
    intro.textContent = "請確認商品與優惠明細。這是前端模擬，不會產生真實付款。";
    const items = document.createElement("ul");
    items.className = "order-items";
    this.currentOrder.items.forEach(({ product, quantity }) => {
      const item = document.createElement("li");
      item.className = "order-item";
      const name = document.createElement("span");
      name.textContent = `${product.name} × ${quantity}`;
      const total = document.createElement("strong");
      total.textContent = money(product.price * quantity);
      item.append(name, total);
      items.append(item);
    });
    const breakdown = document.createElement("div");
    breakdown.className = "order-breakdown";
    const rows = [
      ["商品原價總額", money(calculation.originalSubtotal)],
      ["商品促銷折扣", `− ${money(calculation.productSavings)}`],
      [calculation.campaign.label, `− ${money(calculation.campaign.discount)}`],
      [this.couponCode ? `優惠券 ${this.couponCode}` : "優惠券折抵", `− ${money(calculation.couponDiscount)}`],
      ["運費", calculation.shipping.cost ? money(calculation.shipping.cost) : "免運"]
    ];
    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "total-row";
      const name = document.createElement("span");
      name.textContent = label;
      const amount = document.createElement("strong");
      amount.textContent = value;
      row.append(name, amount);
      breakdown.append(row);
    });
    const total = document.createElement("div");
    total.className = "order-total";
    const totalLabel = document.createElement("span");
    totalLabel.textContent = "最終應付金額";
    const totalAmount = document.createElement("strong");
    totalAmount.textContent = money(calculation.total);
    total.append(totalLabel, totalAmount);
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.className = "dialog-action";
    cancel.type = "button";
    cancel.dataset.cancelOrder = "true";
    cancel.textContent = "返回修改";
    cancel.addEventListener("click", () => this.closeDialog());
    const confirm = document.createElement("button");
    confirm.className = "dialog-action primary";
    confirm.type = "button";
    confirm.dataset.confirmOrder = "true";
    confirm.textContent = "確認模擬結帳";
    confirm.addEventListener("click", () => this.completeOrder());
    actions.append(cancel, confirm);
    breakdown.append(total);
    content.append(kicker, title, intro, items, breakdown, actions);
  }

  completeOrder() {
    if (!this.currentOrder) return;
    const orderId = `SC${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(this.currentOrder.createdAt).slice(-4)}`;
    const content = this.elements["dialog-content"];
    content.replaceChildren();
    const state = document.createElement("div");
    state.className = "success-state";
    const mark = document.createElement("div");
    mark.className = "success-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "✓";
    const kicker = document.createElement("span");
    kicker.className = "dialog-kicker";
    kicker.textContent = "SIMULATED CHECKOUT COMPLETE";
    const title = document.createElement("h2");
    title.id = "dialog-title";
    title.textContent = "模擬結帳成功！";
    const intro = document.createElement("p");
    intro.className = "dialog-intro";
    intro.textContent = `訂單 ${orderId} 已建立。這筆訂單為試算展示，不會向你收取費用。`;
    const number = document.createElement("span");
    number.className = "order-number";
    number.textContent = `訂單金額 ${money(this.currentOrder.calculation.total)}`;
    const close = document.createElement("button");
    close.className = "dialog-action primary";
    close.type = "button";
    close.style.width = "100%";
    close.style.marginTop = "18px";
    close.textContent = "完成";
    close.addEventListener("click", () => this.closeDialog());
    state.append(mark, kicker, title, intro, number, close);
    content.append(state);
    this.cart.clear();
    this.couponCode = "";
    this.feedback = { message: "", type: "" };
    this.persist();
    this.renderAll();
    close.focus();
  }

  closeDialog() {
    if (this.elements["checkout-dialog"].open) this.elements["checkout-dialog"].close();
    this.currentOrder = null;
  }

  showToast(message, type = "") {
    const toast = document.createElement("div");
    toast.className = `toast${type ? ` ${type}` : ""}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.textContent = message;
    this.elements["toast-region"].append(toast);
    window.setTimeout(() => toast.remove(), 3300);
  }
}

new UIController();
