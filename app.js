/* My Little Shop — Phase 2.5
   Front-end only: HTML + CSS + JavaScript + localStorage.
   No database, server, API, or backend required.

   Data model goals:
   - Validated/normalized localStorage data
   - FIFO inventory costing
   - Historical sale snapshots
   - Stock movement/audit history
   - Sale reversal instead of destructive deletion
   - Local business dates (not UTC dates)
   - Export/import backup
*/

(() => {
  "use strict";

  const STORAGE_KEY = "myLittleShopData_v4";
  const LEGACY_KEYS = ["myLittleShopData_v3"];
  const DATA_VERSION = 5;
  const CURRENCY_OPTIONS = {
    GHS: { code: "GHS", symbol: "GH₵", label: "Ghanaian Cedi" },
    USD: { code: "USD", symbol: "$", label: "US Dollar" },
    NGN: { code: "NGN", symbol: "₦", label: "Nigerian Naira" },
    GBP: { code: "GBP", symbol: "£", label: "British Pound" },
    EUR: { code: "EUR", symbol: "€", label: "Euro" }
  };

  const EMPTY_DATA = {
    version: DATA_VERSION,
    products: [],
    sales: [],
    expenses: [],
    dailyClosings: [],
    drawings: [],
    stockMovements: [],
    auditLog: [],
    settings: {
      currency: "GHS",
      shopName: "My Little Shop"
    }
  };

  let state = loadData();
  let modalReturnFocus = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function uid(prefix = "id") {
    if (window.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function number(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function moneyValue(value) {
    return Math.round((number(value) + Number.EPSILON) * 100) / 100;
  }

  function localDateISO(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function localDateTime(date = new Date()) {
    return date.toISOString();
  }

  function formatDate(value, includeTime = false) {
    if (!value) return "—";
    const d = new Date(value.includes?.("T") ? value : `${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      ...(includeTime ? { timeStyle: "short" } : {})
    }).format(d);
  }

  function currencyInfo() {
    return CURRENCY_OPTIONS[state.settings?.currency] || CURRENCY_OPTIONS.GHS;
  }

  function money(value) {
    const c = currencyInfo();
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: c.code,
        maximumFractionDigits: 2
      }).format(number(value));
    } catch {
      return `${c.symbol}${moneyValue(value).toFixed(2)}`;
    }
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function validPayment(value) {
    return ["Cash", "Mobile Money", "Card", "Credit"].includes(value);
  }

  function validDrawingStatus(value) {
    return ["Scheduled", "Completed", "Cancelled"].includes(value);
  }

  function normalizeProduct(p) {
    if (!p || typeof p !== "object") return null;
    const qty = Math.max(0, Math.floor(number(p.quantity)));
    const cost = Math.max(0, moneyValue(p.cost ?? p.costPrice));
    const price = Math.max(0, moneyValue(p.price ?? p.sellingPrice));
    return {
      id: String(p.id || uid("prod")),
      name: String(p.name || "Unnamed Product").trim() || "Unnamed Product",
      quantity: qty,
      cost,
      price,
      reorderLevel: Math.max(0, Math.floor(number(p.reorderLevel, 5))),
      costLayers: Array.isArray(p.costLayers)
        ? p.costLayers
            .map(layer => ({
              id: String(layer.id || uid("layer")),
              quantity: Math.max(0, Math.floor(number(layer.quantity))),
              unitCost: Math.max(0, moneyValue(layer.unitCost)),
              createdAt: layer.createdAt || localDateTime()
            }))
            .filter(layer => layer.quantity > 0)
        : (qty > 0 ? [{
            id: uid("layer"),
            quantity: qty,
            unitCost: cost,
            createdAt: p.createdAt || localDateTime()
          }] : []),
      createdAt: p.createdAt || localDateTime(),
      updatedAt: p.updatedAt || localDateTime()
    };
  }

  function normalizeSale(s) {
    if (!s || typeof s !== "object") return null;
    const qty = Math.max(1, Math.floor(number(s.quantity ?? s.qty, 1)));
    const amount = moneyValue(s.amount ?? (number(s.price) * qty));
    const costTotal = moneyValue(s.costTotal ?? (number(s.cost) * qty));
    return {
      id: String(s.id || uid("sale")),
      productId: s.productId ? String(s.productId) : "",
      productName: String(s.productName || ""),
      quantity: qty,
      unitPrice: moneyValue(s.unitPrice ?? s.price ?? (amount / qty)),
      amount,
      unitCost: moneyValue(s.unitCost ?? s.cost ?? (costTotal / qty)),
      costTotal,
      profit: moneyValue(s.profit ?? (amount - costTotal)),
      payment: validPayment(s.payment) ? s.payment : "Cash",
      status: s.status === "Voided" ? "Voided" : "Completed",
      businessDate: s.businessDate || localDateISO(new Date(s.timestamp || Date.now())),
      timestamp: s.timestamp || localDateTime(),
      voidedAt: s.voidedAt || null,
      voidReason: s.voidReason || null
    };
  }

  function normalizeDrawing(d) {
    if (!d || typeof d !== "object") return null;
    return {
      id: String(d.id || uid("draw")),
      date: d.date || localDateISO(),
      winner: String(d.winner || "").trim(),
      prize: Math.max(0, moneyValue(d.prize)),
      entryCount: Math.max(0, Math.floor(number(d.entryCount))),
      status: validDrawingStatus(d.status) ? d.status : "Completed",
      notes: String(d.notes || "").trim(),
      createdAt: d.createdAt || localDateTime()
    };
  }

  function normalizeMovement(m) {
    if (!m || typeof m !== "object") return null;
    return {
      id: String(m.id || uid("move")),
      productId: String(m.productId || ""),
      productName: String(m.productName || ""),
      type: String(m.type || "Adjustment"),
      quantity: number(m.quantity),
      unitCost: Math.max(0, moneyValue(m.unitCost)),
      stockBefore: Math.max(0, Math.floor(number(m.stockBefore))),
      stockAfter: Math.max(0, Math.floor(number(m.stockAfter))),
      referenceId: m.referenceId ? String(m.referenceId) : null,
      businessDate: m.businessDate || localDateISO(),
      timestamp: m.timestamp || localDateTime(),
      note: String(m.note || "")
    };
  }

  function normalizeAudit(a) {
    if (!a || typeof a !== "object") return null;
    return {
      id: String(a.id || uid("audit")),
      action: String(a.action || "Unknown"),
      referenceId: a.referenceId ? String(a.referenceId) : null,
      detail: String(a.detail || ""),
      timestamp: a.timestamp || localDateTime()
    };
  }

  function normalizeExpense(e) {
    if (!e || typeof e !== "object") return null;
    const amount = Math.max(0, moneyValue(e.amount));
    return {
      id: String(e.id || uid("expense")),
      date: e.date || localDateISO(),
      category: String(e.category || "Other").trim() || "Other",
      description: String(e.description || "").trim(),
      amount,
      payment: validPayment(e.payment) ? e.payment : "Cash",
      createdAt: e.createdAt || localDateTime()
    };
  }

  function normalizeDailyClosing(c) {
    if (!c || typeof c !== "object") return null;
    return {
      id: String(c.id || uid("close")),
      date: c.date || localDateISO(),
      countedCash: Math.max(0, moneyValue(c.countedCash)),
      expectedCash: Math.max(0, moneyValue(c.expectedCash)),
      difference: moneyValue(c.difference),
      note: String(c.note || "").trim(),
      createdAt: c.createdAt || localDateTime()
    };
  }

  function normalizeData(raw) {
    const d = raw && typeof raw === "object" ? raw : {};
    const products = Array.isArray(d.products) ? d.products.map(normalizeProduct).filter(Boolean) : [];
    const sales = Array.isArray(d.sales) ? d.sales.map(normalizeSale).filter(Boolean) : [];
    const expenses = Array.isArray(d.expenses) ? d.expenses.map(normalizeExpense).filter(Boolean) : [];
    const dailyClosings = Array.isArray(d.dailyClosings) ? d.dailyClosings.map(normalizeDailyClosing).filter(Boolean) : [];
    const drawings = Array.isArray(d.drawings) ? d.drawings.map(normalizeDrawing).filter(Boolean) : [];
    const stockMovements = Array.isArray(d.stockMovements)
      ? d.stockMovements.map(normalizeMovement).filter(Boolean)
      : [];
    const auditLog = Array.isArray(d.auditLog) ? d.auditLog.map(normalizeAudit).filter(Boolean) : [];

    const settings = {
      ...EMPTY_DATA.settings,
      ...(d.settings && typeof d.settings === "object" ? d.settings : {})
    };
    if (!CURRENCY_OPTIONS[settings.currency]) settings.currency = "GHS";
    settings.shopName = String(settings.shopName || "My Little Shop").trim() || "My Little Shop";

    return {
      version: DATA_VERSION,
      products,
      sales,
      expenses,
      dailyClosings,
      drawings,
      stockMovements,
      auditLog,
      settings
    };
  }

  function migrateLegacy(raw) {
    const d = normalizeData(raw);
    const now = localDateTime();

    // Legacy sales did not necessarily contain historical snapshots.
    // If a product still exists, use its current values only as a migration fallback.
    d.sales = d.sales.map(s => {
      const p = d.products.find(x => x.id === s.productId);
      return {
        ...s,
        productName: s.productName || p?.name || "Unknown Product",
        unitPrice: s.unitPrice || moneyValue(s.amount / Math.max(1, s.quantity)),
        unitCost: s.unitCost || moneyValue(s.costTotal / Math.max(1, s.quantity))
      };
    });

    d.auditLog.push({
      id: uid("audit"),
      action: "DataMigrated",
      referenceId: null,
      detail: "Legacy localStorage data migrated to Phase 2.5 schema.",
      timestamp: now
    });

    return d;
  }

  function loadData() {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) {
      try {
        return normalizeData(JSON.parse(current));
      } catch {
        // Fall through to legacy/empty recovery.
      }
    }

    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (!legacy) continue;
      try {
        const migrated = migrateLegacy(JSON.parse(legacy));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      } catch {
        // Continue searching.
      }
    }

    return clone(EMPTY_DATA);
  }

  function persist(nextState, auditAction = null) {
    const next = normalizeData(nextState);
    if (auditAction) {
      next.auditLog.push({
        id: uid("audit"),
        action: auditAction.action,
        referenceId: auditAction.referenceId || null,
        detail: auditAction.detail || "",
        timestamp: localDateTime()
      });
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    state = next;
  }

  function commit(mutator, auditAction = null) {
    const next = clone(state);
    mutator(next);
    persist(next, auditAction);
    renderAll();
  }

  function findProduct(id) {
    return state.products.find(p => p.id === id);
  }

  // Inventory is now tracked as cost layers and sold FIFO (first-in, first-out).
  // This means an older batch is sold before a newer batch. Each sale snapshots
  // the actual cost of the units consumed, so profit is historically accurate.
  function ensureCostLayers(product) {
    if (!Array.isArray(product.costLayers)) product.costLayers = [];
    product.costLayers = product.costLayers
      .map(layer => ({
        id: String(layer.id || uid("layer")),
        quantity: Math.max(0, Math.floor(number(layer.quantity))),
        unitCost: Math.max(0, moneyValue(layer.unitCost)),
        createdAt: layer.createdAt || localDateTime()
      }))
      .filter(layer => layer.quantity > 0);
    return product.costLayers;
  }

  function syncProductCost(product) {
    const layers = ensureCostLayers(product);
    const qty = layers.reduce((sum, layer) => sum + layer.quantity, 0);
    product.quantity = qty;
    product.cost = qty
      ? moneyValue(layers.reduce((sum, layer) => sum + layer.quantity * layer.unitCost, 0) / qty)
      : 0;
  }

  function consumeFIFOLayers(product, quantity) {
    const layers = ensureCostLayers(product);
    let remaining = quantity;
    let costTotal = 0;
    const consumed = [];

    while (remaining > 0 && layers.length) {
      const layer = layers[0];
      const used = Math.min(remaining, layer.quantity);
      costTotal += used * layer.unitCost;
      consumed.push({
        layerId: layer.id,
        quantity: used,
        unitCost: layer.unitCost
      });
      layer.quantity -= used;
      remaining -= used;
      if (layer.quantity === 0) layers.shift();
    }

    if (remaining > 0) {
      throw new Error("Not enough stock in cost layers.");
    }

    syncProductCost(product);
    return {
      costTotal: moneyValue(costTotal),
      unitCost: moneyValue(costTotal / quantity),
      consumed
    };
  }

  function todaySales() {
    const today = localDateISO();
    return state.sales.filter(s => s.businessDate === today && s.status === "Completed");
  }

  function completedSales() {
    return state.sales.filter(s => s.status === "Completed");
  }

  function totalRevenue(sales = completedSales()) {
    return moneyValue(sales.reduce((sum, s) => sum + number(s.amount), 0));
  }

  function totalProfit(sales = completedSales()) {
    return moneyValue(sales.reduce((sum, s) => sum + number(s.profit), 0));
  }

  function startOfWeek(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function getPeriodRange(period) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (period === "last-week") {
      const start = startOfWeek(now);
      start.setDate(start.getDate() - 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return { start, end, label: "Last week" };
    }
    if (period === "this-month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start, end, label: "This month" };
    }
    if (period === "last-month") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start, end, label: "Last month" };
    }
    const start = startOfWeek(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start, end, label: "This week" };
  }

  function getPeriodHistory(period = "this-week") {
    const range = getPeriodRange(period);
    const rows = [];
    for (const d = new Date(range.start); d <= range.end; d.setDate(d.getDate() + 1)) {
      const date = localDateISO(d);
      const sales = completedSales().filter(s => s.businessDate === date);
      rows.push({ date, sales: sales.length, revenue: totalRevenue(sales), profit: totalProfit(sales) });
    }
    return { ...range, rows };
  }

  function getLast7Days() {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const date = localDateISO(d);
      const sales = completedSales().filter(s => s.businessDate === date);
      days.push({
        date,
        label: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d),
        revenue: totalRevenue(sales),
        profit: totalProfit(sales)
      });
    }
    return days;
  }

  function showToast(message, type = "success") {
    let host = $("#toastHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "toastHost";
      host.className = "toast-host";
      document.body.appendChild(host);
    }
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", "status");
    toast.textContent = message;
    host.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  function openModal(content, title = "Dialog") {
    closeModal();
    modalReturnFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="modal-header">
          <h2 id="modalTitle">${escapeHTML(title)}</h2>
          <button type="button" class="icon-btn" data-close-modal aria-label="Close dialog">×</button>
        </div>
        <div class="modal-body">${content}</div>
      </section>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", e => {
      if (e.target === overlay || e.target.closest("[data-close-modal]")) closeModal();
    });
    overlay.addEventListener("keydown", trapFocus);
    overlay.tabIndex = -1;
    overlay.focus();
    return overlay;
  }

  function trapFocus(e) {
    if (e.key !== "Tab") return;
    const focusable = $$('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])', e.currentTarget)
      .filter(el => !el.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function closeModal() {
    const modal = $(".modal-overlay");
    if (modal) modal.remove();
    if (modalReturnFocus?.focus) modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  function productForm(product = null, mode = "add") {
    const isEdit = mode === "edit";
    const isRestock = mode === "restock";
    const titleNote = isEdit
      ? "Edit product details. Stock history and FIFO cost batches are preserved."
      : isRestock
        ? "Add a new FIFO batch to this product."
        : "Create a product with its opening stock batch.";

    return `
      <form id="productForm" class="form-grid" data-mode="${mode}" data-product-id="${escapeHTML(product?.id || "")}">
        <p class="help-text" style="grid-column:1/-1">${titleNote}</p>
        <label>Product name
          <input name="name" required maxlength="80" value="${escapeHTML(product?.name || "")}" />
        </label>
        ${isRestock || !isEdit ? `<label>${isRestock ? "Restock quantity" : "Opening quantity"}
          <input name="quantity" type="number" min="1" step="1" required value="${isRestock ? "1" : ""}" />
          <small>${isRestock ? "This becomes a new FIFO batch." : "Initial stock quantity."}</small>
        </label>
        <label>Unit cost
          <input name="cost" type="number" min="0" step="0.01" required value="${isEdit ? "" : (product ? product.cost : "")}" />
          <small>${isRestock ? "Cost paid for this new batch." : "Cost paid per unit."}</small>
        </label>` : ""}
        <label>Selling price
          <input name="price" type="number" min="0" step="0.01" required value="${product ? product.price : ""}" />
        </label>
        <label>Reorder level
          <input name="reorderLevel" type="number" min="0" step="1" value="${product?.reorderLevel ?? 5}" />
        </label>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" data-close-modal>Cancel</button>
          <button class="btn btn-primary" type="submit">${isEdit ? "Save changes" : isRestock ? "Restock product" : "Add product"}</button>
        </div>
      </form>`;
  }

  function saleForm() {
    const products = state.products.filter(p => p.quantity > 0);
    return `
      <form id="saleForm" class="form-grid">
        <label>Product
          <select name="productId" required>
            <option value="">Select a product</option>
            ${products.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} — ${p.quantity} in stock — ${money(p.price)}</option>`).join("")}
          </select>
        </label>
        <label>Quantity
          <input name="quantity" type="number" min="1" step="1" required value="1" />
        </label>
        <label>Payment method
          <select name="payment">
            ${["Cash", "Mobile Money", "Card", "Credit"].map(x => `<option>${x}</option>`).join("")}
          </select>
        </label>
        <div class="sale-preview" id="salePreview">Select a product to see the total.</div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" data-close-modal>Cancel</button>
          <button class="btn btn-primary" type="submit">Record sale</button>
        </div>
      </form>`;
  }

  function expenseForm() {
    return `
      <form id="expenseForm" class="form-grid">
        <label>Date<input name="date" type="date" required value="${localDateISO()}" /></label>
        <label>Category<select name="category" required>
          ${["Rent", "Utilities", "Transport", "Wages", "Packaging", "Repairs", "Prize", "Other"].map(x => `<option>${x}</option>`).join("")}
        </select></label>
        <label>Description<input name="description" maxlength="160" placeholder="e.g. Transport to supplier" required /></label>
        <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
        <label>Paid with<select name="payment">${["Cash", "Mobile Money", "Card", "Credit"].map(x => `<option>${x}</option>`).join("")}</select></label>
        <div class="form-actions"><button type="button" class="btn btn-secondary" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Save expense</button></div>
      </form>`;
  }

  function dailyClosingForm() {
    const date = localDateISO();
    const expected = moneyValue(todaySales().filter(s => s.payment === "Cash").reduce((n,s) => n+s.amount, 0) - state.expenses.filter(x => x.date === date && x.payment === "Cash").reduce((n,x) => n+x.amount, 0));
    return `<form id="dailyClosingForm" class="form-grid">
      <p class="help-text">Expected cash is calculated from today's cash sales minus cash expenses recorded today. Confirm the actual cash counted in the drawer.</p>
      <label>Business date<input name="date" type="date" required value="${date}" /></label>
      <div class="sale-preview">Expected cash: ${money(expected)}</div>
      <label>Actual cash counted<input name="countedCash" type="number" min="0" step="0.01" required /></label>
      <label>Note (optional)<textarea name="note" maxlength="300" rows="2" placeholder="Explain any difference"></textarea></label>
      <div class="form-actions"><button type="button" class="btn btn-secondary" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Save closing</button></div>
    </form>`;
  }

  function drawingForm() {
    return `
      <form id="drawingForm" class="form-grid">
        <label>Date
          <input name="date" type="date" required value="${localDateISO()}" />
        </label>
        <label>Winner
          <input name="winner" maxlength="100" required />
        </label>
        <label>Prize value
          <input name="prize" type="number" min="0" step="0.01" required value="0" />
        </label>
        <label>Entries
          <input name="entryCount" type="number" min="0" step="1" required value="0" />
        </label>
        <label>Status
          <select name="status">
            ${["Scheduled", "Completed", "Cancelled"].map(x => `<option>${x}</option>`).join("")}
          </select>
        </label>
        <label>Notes
          <textarea name="notes" maxlength="500" rows="3"></textarea>
        </label>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" data-close-modal>Cancel</button>
          <button class="btn btn-primary" type="submit">Save drawing</button>
        </div>
      </form>`;
  }

  function bindModalForm() {
    const productFormEl = $("#productForm");
    if (productFormEl) {
      productFormEl.addEventListener("submit", e => {
        e.preventDefault();
        const fd = new FormData(productFormEl);
        const mode = productFormEl.dataset.mode || "add";
        const productId = productFormEl.dataset.productId || "";
        const name = String(fd.get("name") || "").trim();
        const qty = Math.floor(number(fd.get("quantity")));
        const newCost = moneyValue(fd.get("cost"));
        const price = moneyValue(fd.get("price"));
        const reorderLevel = Math.floor(number(fd.get("reorderLevel"), 5));
        const existing = productId ? findProduct(productId) : state.products.find(p => p.name.toLowerCase() === name.toLowerCase());

        if (!name || price < 0 || reorderLevel < 0 || ((mode !== "edit") && (qty < 1 || newCost < 0))) {
          showToast("Enter valid product details.", "error");
          return;
        }

        if (mode === "edit") {
          if (!existing) return showToast("Product not found.", "error");
          const duplicate = state.products.find(p => p.id !== existing.id && p.name.toLowerCase() === name.toLowerCase());
          if (duplicate) return showToast("Another product already has that name.", "error");
          const oldName = existing.name;
          existing.name = name;
          existing.price = price;
          existing.reorderLevel = reorderLevel;
          existing.updatedAt = localDateTime();
          state.stockMovements.forEach(move => {
            if (move.productId === existing.id) move.productName = name;
          });
          persist(state, {
            action: "EditProduct",
            referenceId: existing.id,
            detail: `Edited product ${oldName} to ${name}.`
          });
          closeModal();
          renderAll();
          showToast(`${name} updated.`);
          return;
        }

        if (mode === "restock") {
          if (!existing) return showToast("Product not found.", "error");
          ensureCostLayers(existing);
          const oldQty = existing.quantity;
          existing.costLayers.push({
            id: uid("layer"),
            quantity: qty,
            unitCost: newCost,
            createdAt: localDateTime()
          });
          existing.price = price;
          existing.reorderLevel = reorderLevel;
          syncProductCost(existing);
          existing.updatedAt = localDateTime();

          state.stockMovements.push({
            id: uid("move"),
            productId: existing.id,
            productName: existing.name,
            type: "Restock",
            quantity: qty,
            unitCost: newCost,
            stockBefore: oldQty,
            stockAfter: existing.quantity,
            referenceId: null,
            businessDate: localDateISO(),
            timestamp: localDateTime(),
            note: `Restock batch added at ${money(newCost)} per unit. FIFO will sell older stock first.`
          });
          persist(state, {
            action: "RestockProduct",
            referenceId: existing.id,
            detail: `Restocked ${qty} units of ${existing.name}.`
          });
          closeModal();
          renderAll();
          showToast(`${existing.name} restocked.`);
          return;
        }

        if (existing) return showToast("A product with that name already exists. Use Edit or Restock instead.", "error");

        const product = {
          id: uid("prod"),
          name,
          quantity: qty,
          cost: newCost,
          price,
          reorderLevel,
          costLayers: [{
            id: uid("layer"),
            quantity: qty,
            unitCost: newCost,
            createdAt: localDateTime()
          }],
          createdAt: localDateTime(),
          updatedAt: localDateTime()
        };
        state.products.push(product);
        state.stockMovements.push({
          id: uid("move"),
          productId: product.id,
          productName: product.name,
          type: "Opening Stock",
          quantity: qty,
          unitCost: newCost,
          stockBefore: 0,
          stockAfter: qty,
          referenceId: null,
          businessDate: localDateISO(),
          timestamp: localDateTime(),
          note: "Product created."
        });
        persist(state, {
          action: "CreateProduct",
          referenceId: product.id,
          detail: `Created ${product.name} with ${qty} units.`
        });
        closeModal();
        renderAll();
        showToast(`${product.name} added.`);
      });
    }

    const saleFormEl = $("#saleForm");
    if (saleFormEl) {
      const productSelect = $('[name="productId"]', saleFormEl);
      const qtyInput = $('[name="quantity"]', saleFormEl);
      const preview = $("#salePreview");

      const updatePreview = () => {
        const p = findProduct(productSelect.value);
        const qty = Math.floor(number(qtyInput.value));
        preview.textContent = p && qty > 0
          ? `Total: ${money(p.price * qty)} · Expected profit: ${money((p.price - p.cost) * qty)}`
          : "Select a product to see the total.";
      };
      productSelect.addEventListener("change", updatePreview);
      qtyInput.addEventListener("input", updatePreview);

      saleFormEl.addEventListener("submit", e => {
        e.preventDefault();
        const fd = new FormData(saleFormEl);
        const product = findProduct(fd.get("productId"));
        const qty = Math.floor(number(fd.get("quantity")));
        const payment = String(fd.get("payment") || "Cash");

        if (!product) return showToast("Select a valid product.", "error");
        if (qty < 1) return showToast("Quantity must be a whole number greater than zero.", "error");
        if (qty > product.quantity) return showToast(`Only ${product.quantity} units are available.`, "error");
        if (!validPayment(payment)) return showToast("Invalid payment method.", "error");

        const stockBefore = product.quantity;
        let fifo;
        try {
          fifo = consumeFIFOLayers(product, qty);
        } catch {
          showToast("The product's stock layers are inconsistent. Please review the product before selling.", "error");
          return;
        }

        const sale = {
          id: uid("sale"),
          productId: product.id,
          productName: product.name,
          quantity: qty,
          unitPrice: product.price,
          amount: moneyValue(product.price * qty),
          unitCost: fifo.unitCost,
          costTotal: fifo.costTotal,
          profit: moneyValue((product.price * qty) - fifo.costTotal),
          costLayersConsumed: fifo.consumed,
          payment,
          status: "Completed",
          businessDate: localDateISO(),
          timestamp: localDateTime(),
          voidedAt: null,
          voidReason: null
        };

        product.updatedAt = localDateTime();

        state.sales.push(sale);
        state.stockMovements.push({
          id: uid("move"),
          productId: product.id,
          productName: product.name,
          type: "Sale",
          quantity: -qty,
          unitCost: product.cost,
          stockBefore,
          stockAfter: product.quantity,
          referenceId: sale.id,
          businessDate: sale.businessDate,
          timestamp: sale.timestamp,
          note: `Sold ${qty} unit${qty === 1 ? "" : "s"} using FIFO cost layers. Cost recognized: ${money(sale.costTotal)}.`
        });

        persist(state, {
          action: "RecordSale",
          referenceId: sale.id,
          detail: `Recorded ${qty} × ${sale.productName} for ${money(sale.amount)}.`
        });
        closeModal();
        renderAll();
        showToast("Sale recorded.");
      });
    }

    const expenseFormEl = $("#expenseForm");
    if (expenseFormEl) {
      expenseFormEl.addEventListener("submit", e => {
        e.preventDefault();
        const fd = new FormData(expenseFormEl);
        const amount = moneyValue(fd.get("amount"));
        const description = String(fd.get("description") || "").trim();
        if (!description || amount <= 0) return showToast("Enter an expense description and amount greater than zero.", "error");
        const expense = { id: uid("expense"), date: String(fd.get("date") || localDateISO()), category: String(fd.get("category") || "Other"), description, amount, payment: validPayment(String(fd.get("payment"))) ? String(fd.get("payment")) : "Cash", createdAt: localDateTime() };
        state.expenses.push(expense);
        persist(state, { action: "RecordExpense", referenceId: expense.id, detail: `Recorded ${expense.category} expense of ${money(amount)}.` });
        closeModal(); renderAll(); showToast("Expense recorded.");
      });
    }

    const closingFormEl = $("#dailyClosingForm");
    if (closingFormEl) {
      closingFormEl.addEventListener("submit", e => {
        e.preventDefault();
        const fd = new FormData(closingFormEl);
        const date = String(fd.get("date") || localDateISO());
        const countedCash = moneyValue(fd.get("countedCash"));
        const expectedCash = moneyValue(state.sales.filter(s => s.businessDate === date && s.status === "Completed" && s.payment === "Cash").reduce((n,s) => n+s.amount, 0) - state.expenses.filter(x => x.date === date && x.payment === "Cash").reduce((n,x) => n+x.amount, 0));
        const closing = { id: uid("close"), date, countedCash, expectedCash, difference: moneyValue(countedCash - expectedCash), note: String(fd.get("note") || "").trim(), createdAt: localDateTime() };
        state.dailyClosings = state.dailyClosings.filter(c => c.date !== date);
        state.dailyClosings.push(closing);
        persist(state, { action: "CloseBusinessDay", referenceId: closing.id, detail: `Closed ${date}; cash difference ${money(closing.difference)}.` });
        closeModal(); renderAll(); showToast(`Daily closing saved. Difference: ${money(closing.difference)}.`);
      });
    }

    const drawingFormEl = $("#drawingForm");
    if (drawingFormEl) {
      drawingFormEl.addEventListener("submit", e => {
        e.preventDefault();
        const fd = new FormData(drawingFormEl);
        const drawing = {
          id: uid("draw"),
          date: String(fd.get("date") || localDateISO()),
          winner: String(fd.get("winner") || "").trim(),
          prize: moneyValue(fd.get("prize")),
          entryCount: Math.floor(number(fd.get("entryCount"))),
          status: validDrawingStatus(fd.get("status")) ? fd.get("status") : "Completed",
          notes: String(fd.get("notes") || "").trim(),
          createdAt: localDateTime()
        };
        if (!drawing.winner || drawing.entryCount < 0 || drawing.prize < 0) {
          showToast("Enter valid drawing details.", "error");
          return;
        }
        state.drawings.push(drawing);
        persist(state, {
          action: "CreateDrawing",
          referenceId: drawing.id,
          detail: `Created drawing for ${drawing.date}.`
        });
        closeModal();
        renderAll();
        showToast("Drawing saved.");
      });
    }
  }

  function bindGlobalActions() {
    document.addEventListener("click", e => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (!action) return;

      if (action === "add-product") {
        const overlay = openModal(productForm(null, "add"), "Add Product");
        bindModalForm();
        $("#productForm [name='name']", overlay)?.focus();
      }

      if (action === "new-sale") {
        if (!state.products.some(p => p.quantity > 0)) {
          showToast("Add stock before recording a sale.", "error");
          return;
        }
        openModal(saleForm(), "Record Sale");
        bindModalForm();
        $("#saleForm [name='productId']")?.focus();
      }

      if (action === "new-expense") {
        openModal(expenseForm(), "Record Expense"); bindModalForm(); $("#expenseForm [name='description']")?.focus();
      }
      if (action === "daily-closing") {
        openModal(dailyClosingForm(), "Daily Cash Closing"); bindModalForm(); $("#dailyClosingForm [name='countedCash']")?.focus();
      }
      if (action === "export-sales-csv") exportCSV("sales");
      if (action === "export-stock-csv") exportCSV("stock");
      if (action === "export-expenses-csv") exportCSV("expenses");
      if (action === "print-report") window.print();

      if (action === "new-drawing") {
        openModal(drawingForm(), "New Drawing");
        bindModalForm();
        $("#drawingForm [name='winner']")?.focus();
      }

      if (action === "edit-product") {
        const p = findProduct(e.target.closest("[data-product-id]")?.dataset.productId);
        if (!p) return;
        openModal(productForm(p, "restock"), "Restock Product");
        bindModalForm();
        $("#productForm [name='quantity']")?.focus();
      }

      if (action === "edit-product-details") {
        const p = findProduct(e.target.closest("[data-product-id]")?.dataset.productId);
        if (!p) return;
        openModal(productForm(p, "edit"), "Edit Product");
        bindModalForm();
        $("#productForm [name='name']")?.focus();
      }

      if (action === "delete-product") {
        deleteProduct(e.target.closest("[data-product-id]")?.dataset.productId);
      }

      if (action === "void-sale") {
        voidSale(e.target.closest("[data-sale-id]")?.dataset.saleId);
      }
    });

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") closeModal();
    });

    const search = $("#salesSearch");
    if (search) {
      search.addEventListener("input", renderSales);
      $("#paymentFilter")?.addEventListener("change", renderSales);
      $("#statusFilter")?.addEventListener("change", renderSales);
    }

    $("#stockSearch")?.addEventListener("input", renderStock);
    $("#stockStatusFilter")?.addEventListener("change", renderStock);
    $("#expenseSearch")?.addEventListener("input", renderExpenses);
    $("#expenseCategoryFilter")?.addEventListener("change", renderExpenses);

    const settingsForm = $("#settingsForm");
    if (settingsForm) {
      settingsForm.addEventListener("submit", e => {
        e.preventDefault();
        const fd = new FormData(settingsForm);
        const currency = String(fd.get("currency"));
        const shopName = String(fd.get("shopName") || "").trim() || "My Little Shop";
        if (!CURRENCY_OPTIONS[currency]) {
          showToast("Choose a supported currency.", "error");
          return;
        }
        commit(next => {
          next.settings.currency = currency;
          next.settings.shopName = shopName;
        }, {
          action: "UpdateSettings",
          detail: `Updated shop settings.`
        });
        showToast("Settings saved.");
      });
    }

    const exportBtn = $("#exportData");
    exportBtn?.addEventListener("click", exportBackup);

    const importInput = $("#importData");
    importInput?.addEventListener("change", importBackup);

    $("#resetShopData")?.addEventListener("click", () => {
      const confirmed = window.confirm(
        "Reset My Little Shop to zero? This will permanently remove all products, sales, drawings, stock history and audit history from this browser. Export a backup first. Continue?"
      );
      if (!confirmed) return;
      const resetState = clone(EMPTY_DATA);
      resetState.settings = clone(state.settings);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(resetState));
      state = resetState;
      renderAll();
      showToast("Shop reset. All figures are back to zero.", "success");
    });

    $("#clearLocalData")?.addEventListener("click", () => {
      const confirmed = window.confirm(
        "This will remove the shop data from this browser. Export a backup first. Continue?"
      );
      if (!confirmed) return;
      localStorage.removeItem(STORAGE_KEY);
      state = clone(EMPTY_DATA);
      renderAll();
      showToast("Local shop data cleared.", "success");
    });
  }

  function deleteProduct(productId) {
    const product = findProduct(productId);
    if (!product) return;

    // Any sale record (including a voided sale) must remain reportable, so those
    // products cannot be hard-deleted. A newly-created product normally has one
    // "Opening Stock" movement; allow that product to be removed before it has
    // ever been sold, and remove its opening-stock movement with it.
    const hasSales = state.sales.some(sale => sale.productId === productId);
    if (hasSales) {
      showToast("This product has sales history and cannot be deleted. Keep it for reporting.", "error");
      return;
    }

    const productMovements = state.stockMovements.filter(move => move.productId === productId);
    const hasNonOpeningMovement = productMovements.some(move => move.type !== "Opening Stock");
    if (hasNonOpeningMovement) {
      showToast("This product has restock or adjustment history. Keep it for accurate stock reporting.", "error");
      return;
    }

    const confirmed = window.confirm(
      `Delete "${product.name}"? It has no sales history. Its current stock and opening-stock record will also be removed.`
    );
    if (!confirmed) return;

    state.products = state.products.filter(p => p.id !== productId);
    state.stockMovements = state.stockMovements.filter(move => move.productId !== productId);
    persist(state, {
      action: "DeleteProduct",
      referenceId: productId,
      detail: `Deleted product ${product.name} before any sales. Removed ${productMovements.length} opening-stock movement(s).`
    });
    renderAll();
    showToast("Product deleted.", "success");
  }

  function voidSale(saleId) {
    const sale = state.sales.find(s => s.id === saleId);
    if (!sale || sale.status === "Voided") return;

    const reason = window.prompt("Reason for voiding this sale:", "Customer return / correction");
    if (reason === null) return;
    const trimmed = reason.trim();
    if (!trimmed) return showToast("A reason is required.", "error");

    const product = findProduct(sale.productId);
    if (!product) {
      showToast("Original product is no longer available; sale was not voided.", "error");
      return;
    }

    const stockBefore = product.quantity;
    ensureCostLayers(product);

    if (Array.isArray(sale.costLayersConsumed) && sale.costLayersConsumed.length) {
      // Reinsert each consumed batch at the front in reverse consumption order,
      // restoring the pre-sale FIFO state as closely as possible.
      for (let i = sale.costLayersConsumed.length - 1; i >= 0; i--) {
        const consumed = sale.costLayersConsumed[i];
        product.costLayers.unshift({
          id: uid("layer"),
          quantity: consumed.quantity,
          unitCost: consumed.unitCost,
          createdAt: localDateTime()
        });
      }
      syncProductCost(product);
    } else {
      // Legacy sales did not have layer snapshots; use their historical unit cost.
      product.costLayers.unshift({
        id: uid("layer"),
        quantity: sale.quantity,
        unitCost: sale.unitCost,
        createdAt: localDateTime()
      });
      syncProductCost(product);
    }

    product.updatedAt = localDateTime();
    sale.status = "Voided";
    sale.voidedAt = localDateTime();
    sale.voidReason = trimmed;

    state.stockMovements.push({
      id: uid("move"),
      productId: product.id,
      productName: product.name,
      type: "Sale Reversal",
      quantity: sale.quantity,
      unitCost: sale.unitCost,
      stockBefore,
      stockAfter: product.quantity,
      referenceId: sale.id,
      businessDate: localDateISO(),
      timestamp: localDateTime(),
      note: `Reversed sale: ${trimmed}`
    });

    persist(state, {
      action: "VoidSale",
      referenceId: sale.id,
      detail: `Voided sale for ${sale.productName}: ${trimmed}`
    });
    renderAll();
    showToast("Sale voided and stock restored.");
  }

  function renderLayout() {
    const page = document.body.dataset.page;
    $$(".nav-link").forEach(link => {
      if (link.dataset.page === page) link.classList.add("active");
    });
    $$("[data-shop-name]").forEach(el => el.textContent = state.settings.shopName);
    $$("[data-currency-code]").forEach(el => el.textContent = currencyInfo().code);
    // Keep the browser title synchronized with the saved shop name on every page.
    const pageTitle = document.title.split(" — ")[0] || "Shop";
    document.title = `${pageTitle} — ${state.settings.shopName}`;
  }

  function setText(selector, value) {
    const el = $(selector);
    if (el) el.textContent = value;
  }

  function renderHome() {
    if (document.body.dataset.page !== "home") return;
    const salesToday = todaySales();
    setText("#statRevenueToday", money(totalRevenue(salesToday)));
    setText("#statSalesToday", String(salesToday.length));
    setText("#statProfitToday", money(totalProfit(salesToday)));
    setText("#statProducts", String(state.products.length));
    setText("#statLowStock", String(state.products.filter(p => p.quantity <= p.reorderLevel).length));
    setText("#statStockValue", money(state.products.reduce((sum,p) => sum + p.costLayers.reduce((n,l) => n + l.quantity*l.unitCost, 0), 0)));
    setText("#statExpensesToday", money(state.expenses.filter(x => x.date === localDateISO()).reduce((sum,x) => sum + x.amount, 0)));
    const lowBody = $("#homeLowStockBody");
    if (lowBody) {
      const lowItems = state.products.filter(p => p.quantity <= p.reorderLevel).sort((a,b) => a.quantity-b.quantity).slice(0,8);
      lowBody.innerHTML = lowItems.length ? lowItems.map(p => `<tr><td>${escapeHTML(p.name)}</td><td>${p.quantity}</td><td>${p.reorderLevel}</td><td><span class="status status-warning">Reorder</span></td><td><button class="btn btn-small" data-action="edit-product" data-product-id="${escapeHTML(p.id)}">Restock</button></td></tr>`).join("") : `<tr><td colspan="5" class="empty-state">No low-stock products. Stock levels look good.</td></tr>`;
    }
    const productPerformance = new Map();
    completedSales().forEach(s => {
      const key = s.productId || s.productName;
      const row = productPerformance.get(key) || { name: s.productName, quantity: 0, revenue: 0, profit: 0 };
      row.quantity += s.quantity; row.revenue += s.amount; row.profit += s.profit;
      productPerformance.set(key, row);
    });
    const bestBody = $("#homeBestSellersBody");
    if (bestBody) {
      const ranked = [...productPerformance.values()].sort((a,b) => b.quantity-a.quantity).slice(0,5);
      bestBody.innerHTML = ranked.length ? ranked.map(x => `<tr><td>${escapeHTML(x.name)}</td><td>${x.quantity}</td><td>${money(x.revenue)}</td><td>${money(x.profit)}</td></tr>`).join("") : `<tr><td colspan="4" class="empty-state">Best sellers will appear after completed sales are recorded.</td></tr>`;
    }

    const closeToday = state.dailyClosings.find(c => c.date === localDateISO());
    setText("#todayClosingStatus", closeToday ? `Closed · difference ${money(closeToday.difference)}` : "Not closed yet");
    const closeEl = $("#todayClosingStatus");
    if (closeEl) closeEl.className = `status ${closeToday ? (Math.abs(closeToday.difference) < 0.01 ? "status-ok" : "status-warning") : "status-muted"}`;

    const periodSelect = $("#homeRevenuePeriod");
    const period = periodSelect?.value || "this-week";
    const history = getPeriodHistory(period);
    setText("#homeRevenuePeriodLabel", `Revenue — ${history.label}`);
    setText("#homeHistoryRevenue", money(totalRevenue(completedSales().filter(s => s.businessDate >= localDateISO(history.start) && s.businessDate <= localDateISO(history.end)))));
    setText("#homeHistoryProfit", money(totalProfit(completedSales().filter(s => s.businessDate >= localDateISO(history.start) && s.businessDate <= localDateISO(history.end)))));
    setText("#homeHistorySales", String(history.rows.reduce((sum, r) => sum + r.sales, 0)));
    const historyBody = $("#homeRevenueHistoryBody");
    if (historyBody) {
      const hasActivity = history.rows.some(r => r.sales);
      historyBody.innerHTML = hasActivity
        ? history.rows.filter(r => r.sales).map(r => `<tr><td>${formatDate(r.date)}</td><td>${r.sales}</td><td>${money(r.revenue)}</td><td>${money(r.profit)}</td></tr>`).join("")
        : `<tr><td colspan="4" class="empty-state">No completed sales in this period.</td></tr>`;
    }

    const recent = [...completedSales()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 5);
    const body = $("#recentSalesBody");
    if (body) {
      body.innerHTML = recent.length
        ? recent.map(s => `
          <tr>
            <td>${escapeHTML(s.productName)}</td>
            <td>${s.quantity}</td>
            <td>${money(s.amount)}</td>
            <td>${escapeHTML(s.payment)}</td>
            <td>${formatDate(s.timestamp, true)}</td>
          </tr>`).join("")
        : `<tr><td colspan="5" class="empty-state">No sales recorded yet.</td></tr>`;
    }
  }

  function renderStock() {
    if (document.body.dataset.page !== "stock") return;
    const body = $("#stockBody");
    if (!body) return;
    const q = ( $("#stockSearch")?.value || "").trim().toLowerCase();
    const statusFilter = $("#stockStatusFilter")?.value || "All";
    const filteredProducts = state.products.filter(p => {
      const low = p.quantity <= p.reorderLevel;
      return (!q || p.name.toLowerCase().includes(q)) && (statusFilter === "All" || (statusFilter === "Low" ? low : !low));
    });
    setText("#stockInventoryValue", money(state.products.reduce((sum,p) => sum + p.costLayers.reduce((n,l) => n + l.quantity*l.unitCost, 0), 0)));
    setText("#stockLowCount", String(state.products.filter(p => p.quantity <= p.reorderLevel).length));
    body.innerHTML = filteredProducts.length
      ? filteredProducts.map(p => {
        const low = p.quantity <= p.reorderLevel;
        return `<tr data-product-id="${escapeHTML(p.id)}">
          <td><strong>${escapeHTML(p.name)}</strong></td>
          <td>${p.quantity}</td>
          <td>${money(p.cost)}</td>
          <td>${money(p.price)}</td>
          <td>${money(p.price - p.cost)}</td>
          <td><span class="status ${low ? "status-warning" : "status-ok"}">${low ? "Low stock" : "In stock"}</span></td>
          <td>
            <div class="actions">
              <button class="btn btn-small" data-action="edit-product-details" data-product-id="${escapeHTML(p.id)}">Edit</button>
              <button class="btn btn-small" data-action="edit-product" data-product-id="${escapeHTML(p.id)}">Restock</button>
              <button class="btn btn-small btn-danger" data-action="delete-product" data-product-id="${escapeHTML(p.id)}">Delete</button>
            </div>
          </td>
        </tr>`;
      }).join("")
      : `<tr><td colspan="7" class="empty-state">${state.products.length ? "No products match your filters." : "No products yet. Add your first product."}</td></tr>`;
    const movementBody = $("#stockMovementsBody");
    if (movementBody) {
      const moves = [...state.stockMovements].sort((a,b) => b.timestamp.localeCompare(a.timestamp)).slice(0,12);
      movementBody.innerHTML = moves.length ? moves.map(m => `<tr><td>${formatDate(m.timestamp, true)}</td><td>${escapeHTML(m.productName)}</td><td>${escapeHTML(m.type)}</td><td>${m.quantity > 0 ? "+" : ""}${m.quantity}</td><td>${m.stockAfter}</td><td>${escapeHTML(m.note || "—")}</td></tr>`).join("") : `<tr><td colspan="6" class="empty-state">Stock movements will appear when stock changes.</td></tr>`;
    }
  }

  function renderSales() {
    if (document.body.dataset.page !== "sales") return;
    const body = $("#salesBody");
    if (!body) return;
    const q = ($("#salesSearch")?.value || "").trim().toLowerCase();
    const payment = $("#paymentFilter")?.value || "All";
    const status = $("#statusFilter")?.value || "All";

    const filtered = [...state.sales]
      .filter(s => {
        const text = `${s.productName} ${s.payment} ${s.businessDate}`.toLowerCase();
        return (!q || text.includes(q))
          && (payment === "All" || s.payment === payment)
          && (status === "All" || s.status === status);
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    body.innerHTML = filtered.length
      ? filtered.map(s => `
        <tr class="${s.status === "Voided" ? "row-voided" : ""}" data-sale-id="${escapeHTML(s.id)}">
          <td>${escapeHTML(s.productName)}</td>
          <td>${s.quantity}</td>
          <td>${money(s.unitPrice)}</td>
          <td>${money(s.amount)}</td>
          <td>${escapeHTML(s.payment)}</td>
          <td>${formatDate(s.timestamp, true)}</td>
          <td><span class="status ${s.status === "Completed" ? "status-ok" : "status-muted"}">${s.status}</span></td>
          <td>${s.status === "Completed" ? `<button class="btn btn-small btn-danger" data-action="void-sale" data-sale-id="${escapeHTML(s.id)}">Void</button>` : "—"}</td>
        </tr>`).join("")
      : `<tr><td colspan="8" class="empty-state">No matching sales.</td></tr>`;

    setText("#salesResultCount", `${filtered.length} record${filtered.length === 1 ? "" : "s"}`);
  }

  function renderExpenses() {
    if (document.body.dataset.page !== "expenses") return;
    const q = ( $("#expenseSearch")?.value || "").trim().toLowerCase();
    const category = $("#expenseCategoryFilter")?.value || "All";
    const rows = [...state.expenses].filter(x => (!q || `${x.description} ${x.category} ${x.date} ${x.payment}`.toLowerCase().includes(q)) && (category === "All" || x.category === category)).sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const body = $("#expensesBody");
    if (body) body.innerHTML = rows.length ? rows.map(x => `<tr><td>${formatDate(x.date)}</td><td>${escapeHTML(x.category)}</td><td>${escapeHTML(x.description)}</td><td>${escapeHTML(x.payment)}</td><td>${money(x.amount)}</td></tr>`).join("") : `<tr><td colspan="5" class="empty-state">No expenses recorded yet.</td></tr>`;
    setText("#expenseTotal", money(rows.reduce((sum,x) => sum+x.amount, 0)));
    setText("#expenseCount", String(rows.length));
    setText("#expenseMonthTotal", money(state.expenses.filter(x => x.date.slice(0,7) === localDateISO().slice(0,7)).reduce((sum,x) => sum+x.amount, 0)));
  }

  function exportCSV(kind) {
    let rows = [], filename = kind;
    if (kind === "sales") {
      rows = [["Date","Product","Quantity","Unit Price","Revenue","Cost","Gross Profit","Payment","Status"], ...state.sales.map(s => [s.businessDate,s.productName,s.quantity,s.unitPrice,s.amount,s.costTotal,s.profit,s.payment,s.status])];
    } else if (kind === "stock") {
      rows = [["Product","Quantity","Average Cost","Selling Price","Unit Margin","Reorder Level","Stock Value"], ...state.products.map(p => [p.name,p.quantity,p.cost,p.price,moneyValue(p.price-p.cost),p.reorderLevel,moneyValue(p.costLayers.reduce((n,l)=>n+l.quantity*l.unitCost,0))])];
    } else {
      rows = [["Date","Category","Description","Payment","Amount"], ...state.expenses.map(x => [x.date,x.category,x.description,x.payment,x.amount])];
    }
    const csv = rows.map(row => row.map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff" + csv], {type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href=url; a.download=`my-little-shop-${filename}-${localDateISO()}.csv`; a.click(); URL.revokeObjectURL(url);
    showToast(`${kind[0].toUpperCase()+kind.slice(1)} CSV exported.`);
  }

  function renderDrawings() {
    if (document.body.dataset.page !== "drawings") return;
    const completed = state.drawings.filter(d => d.status === "Completed");
    setText("#drawingCount", String(state.drawings.length));
    setText("#entriesToday", String(state.drawings.filter(d => d.date === localDateISO()).reduce((sum, d) => sum + d.entryCount, 0)));
    setText("#prizesAwarded", money(completed.reduce((sum, d) => sum + d.prize, 0)));

    const body = $("#drawingsBody");
    if (!body) return;
    const rows = [...state.drawings].sort((a, b) => b.date.localeCompare(a.date));
    body.innerHTML = rows.length
      ? rows.map(d => `<tr>
          <td>${formatDate(d.date)}</td>
          <td>${escapeHTML(d.winner)}</td>
          <td>${d.entryCount}</td>
          <td>${money(d.prize)}</td>
          <td><span class="status status-${d.status.toLowerCase()}">${d.status}</span></td>
          <td>${escapeHTML(d.notes || "—")}</td>
        </tr>`).join("")
      : `<tr><td colspan="6" class="empty-state">No drawings recorded yet.</td></tr>`;
  }

  function renderIncome() {
    if (document.body.dataset.page !== "income") return;
    const all = completedSales();
    setText("#incomeRevenue", money(totalRevenue(all)));
    setText("#incomeProfit", money(totalProfit(all)));
    setText("#incomeSales", String(all.length));
    const expenseTotal = state.expenses.reduce((sum,x) => sum+x.amount, 0);
    setText("#incomeExpenses", money(expenseTotal));
    setText("#incomeNetProfit", money(totalProfit(all)-expenseTotal));

    const days = getLast7Days();
    const max = Math.max(...days.map(d => d.revenue), 1);
    const chart = $("#incomeChart");
    if (chart) {
      chart.innerHTML = days.map(d => {
        const height = Math.max(4, Math.round((d.revenue / max) * 100));
        return `<div class="chart-column">
          <div class="chart-value">${money(d.revenue)}</div>
          <div class="chart-bar" style="height:${height}%;" title="${escapeHTML(d.date)}: ${money(d.revenue)}"></div>
          <div class="chart-label">${escapeHTML(d.label)}</div>
        </div>`;
      }).join("");
    }
  }

  function renderSettings() {
    if (document.body.dataset.page !== "settings") return;
    const currency = $("#currency");
    if (currency) currency.value = state.settings.currency;
    const shopName = $("#shopName");
    if (shopName) shopName.value = state.settings.shopName;
  }

  function renderAll() {
    renderLayout();
    renderHome();
    renderStock();
    renderSales();
    renderExpenses();
    renderDrawings();
    renderIncome();
    renderSettings();
  }

  function exportBackup() {
    const payload = {
      app: "My Little Shop",
      version: DATA_VERSION,
      exportedAt: localDateTime(),
      data: state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `my-little-shop-backup-${localDateISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Backup exported.");
  }

  function importBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const incoming = parsed.data || parsed;
        const normalized = normalizeData(incoming);
        if (!Array.isArray(normalized.products) || !Array.isArray(normalized.sales)) {
          throw new Error("Invalid backup structure");
        }
        const confirmed = window.confirm(
          "Importing will replace the current browser data. Export the current data first if needed. Continue?"
        );
        if (!confirmed) return;
        persist(normalized, {
          action: "ImportBackup",
          detail: "Imported a local JSON backup."
        });
        renderAll();
        showToast("Backup imported.");
      } catch {
        showToast("The selected file is not a valid My Little Shop backup.", "error");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  // Re-render when another tab changes this app's localStorage.
  window.addEventListener("storage", e => {
    if (e.key === STORAGE_KEY) {
      state = loadData();
      renderAll();
    }
  });

  bindGlobalActions();
  renderAll();

  // Keep the home revenue history in sync when its period changes.
  const homeRevenuePeriod = $("#homeRevenuePeriod");
  if (homeRevenuePeriod) {
    homeRevenuePeriod.addEventListener("change", renderHome);
  }
})();


document.addEventListener("DOMContentLoaded", () => {
  const PREVIEW_COUNT = 5;

  function makeExpandableTable(tableSelector, toggleId, emptyRowSelector) {
    const table = document.querySelector(tableSelector);
    const toggle = document.getElementById(toggleId);
    if (!table || !toggle) return;

    const tbody = table.querySelector("tbody");
    if (!tbody) return;

    let expanded = false;

    const refresh = () => {
      const rows = Array.from(tbody.querySelectorAll("tr")).filter(row => {
        return !row.matches(emptyRowSelector || ".empty-row");
      });

      if (rows.length <= PREVIEW_COUNT) {
        toggle.hidden = true;
        return;
      }

      rows.forEach((row, i) => {
        row.hidden = !expanded && i >= PREVIEW_COUNT;
      });

      toggle.hidden = false;
      toggle.textContent = expanded
        ? "Show less"
        : `More (${rows.length - PREVIEW_COUNT})`;
      toggle.setAttribute("aria-expanded", String(expanded));
    };

    toggle.addEventListener("click", () => {
      expanded = !expanded;
      refresh();
    });

    // Rendering elsewhere in the app may replace tbody.innerHTML. Observe those changes
    // so the preview remains active after searches, filters, sales, restocks, etc.
    const observer = new MutationObserver(() => refresh());
    observer.observe(tbody, { childList: true });

    refresh();
  }

  makeExpandableTable("#stockTable", "stockListToggle", ".empty-row");
  makeExpandableTable("#salesTable", "salesListToggle", ".empty-row");

});


document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.querySelector(".sidebar");
  const main = document.querySelector(".main");
  if (!main || document.querySelector(".mobile-nav")) return;

  const links = sidebar ? Array.from(sidebar.querySelectorAll(".nav a")) : [];
  if (!links.length) return;

  const current = links.find(a => a.classList.contains("active")) || links[0];

  const nav = document.createElement("div");
  nav.className = "mobile-nav";
  nav.innerHTML = `
    <div class="mobile-nav-bar">
      <div class="mobile-nav-brand">
        <div class="mobile-nav-brand-mark">⌂</div>
        <div class="mobile-nav-title" data-shop-name>My Little Shop</div>
      </div>
      <button class="mobile-menu-button" type="button"
              aria-expanded="false" aria-controls="mobileNavPanel">☰</button>
    </div>
    <nav id="mobileNavPanel" class="mobile-nav-panel" hidden aria-label="Mobile navigation">
      ${links.map(a => `
        <a href="${a.getAttribute("href")}" class="${a.classList.contains("active") ? "active" : ""}">
          ${a.innerHTML}
        </a>`).join("")}
    </nav>
  `;

  main.parentNode.insertBefore(nav, main);

  const button = nav.querySelector(".mobile-menu-button");
  const panel = nav.querySelector("#mobileNavPanel");

  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!open));
    panel.hidden = open;
  });

  panel.addEventListener("click", event => {
    if (event.target.closest("a")) {
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  });
});
