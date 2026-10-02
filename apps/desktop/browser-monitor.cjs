const { execFile } = require("node:child_process");
const path = require("node:path");

// Serialized into Chromium's isolated world. This function deliberately returns
// only fixed states, never document text, authentication values or an address.
function monitorInspection({ condition, recipe, phase, submit = false }) {
  const norm = (value) =>
    String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();
  const lower = (value) => norm(value).toLocaleLowerCase();
  const body = norm(document.body?.innerText).slice(0, 250000);
  const visible = (element) =>
    element?.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden";
  if (
    document.querySelector(
      'iframe[src*="captcha"],iframe[src*="challenge"],[class*="captcha"],[id*="captcha"],input[autocomplete="one-time-code"]',
    ) ||
    /(?:verify (?:you are|you're) human|checking your browser|security challenge)/i.test(
      body,
    )
  )
    return { outcome: "captcha" };
  if (
    /\b(?:waiting room|you are in (?:the |a )?queue|your (?:place|position) in (?:the )?queue|queue-it)\b/i.test(
      body,
    ) ||
    /queue-it|waitingroom/i.test(location.hostname)
  )
    return { outcome: "queue" };
  if (
    document.querySelector(
      'input[type="password"],input[autocomplete="current-password"],input[autocomplete="new-password"]',
    ) ||
    /\/(?:login|signin|sign-in|oauth|authorize)(?:[/?#]|$)/i.test(location.href)
  )
    return { outcome: "login" };
  if (
    document.querySelector(
      'input[autocomplete^="cc-"],input[name*="card_number"],input[name*="cardNumber"],iframe[src*="payment"],iframe[src*="stripe"]',
    )
  )
    return { outcome: "payment" };
  if (!body) return { outcome: "unknown" };
  if (!recipe) {
    if (condition?.type === "stock") {
      const products = [];
      let count = 0;
      function visit(value, depth = 0) {
        if (!value || depth > 8 || ++count > 1000) return;
        if (Array.isArray(value)) {
          for (const item of value.slice(0, 100)) visit(item, depth + 1);
          return;
        }
        if (typeof value !== "object") return;
        const types = [value["@type"]].flat();
        if (
          types.some(
            (type) =>
              type === "Product" || type === "https://schema.org/Product",
          )
        )
          products.push(value);
        if (value["@graph"]) visit(value["@graph"], depth + 1);
        if (value.mainEntity) visit(value.mainEntity, depth + 1);
      }
      for (const node of [
        ...document.querySelectorAll('script[type="application/ld+json"]'),
      ].slice(0, 20)) {
        if (node.textContent.length > 100000) continue;
        try {
          visit(JSON.parse(node.textContent));
        } catch {
          /* malformed evidence is unknown */
        }
      }
      function samePage(value) {
        try {
          const url = new URL(value, location.href);
          url.hash = "";
          const current = new URL(location.href);
          current.hash = "";
          return url.href === current.href;
        } catch {
          return false;
        }
      }
      const matched = products.filter(
        (product) =>
          ((typeof product.url === "string" && samePage(product.url)) ||
            (typeof product["@id"] === "string" && samePage(product["@id"]))) &&
          (!condition.sku || product.sku === condition.sku),
      );
      if (matched.length !== 1) return { outcome: "unknown" };
      const offers = [matched[0].offers]
        .flat()
        .filter(Boolean)
        .filter(
          (offer) =>
            !condition.sku || !offer.sku || offer.sku === condition.sku,
        );
      if (
        offers.length !== 1 ||
        typeof offers[0].availability !== "string" ||
        offers[0]["@type"] === "AggregateOffer"
      )
        return { outcome: "unknown" };
      const availability = offers[0].availability.replace(
        /^https?:\/\/schema.org\//,
        "",
      );
      return {
        outcome:
          availability === "InStock"
            ? "match"
            : ["OutOfStock", "SoldOut", "Discontinued"].includes(availability)
              ? "no_match"
              : "unknown",
      };
    }
    const positive =
      condition?.contains && lower(body).includes(lower(condition.contains));
    const negative =
      condition?.excludes && lower(body).includes(lower(condition.excludes));
    return {
      outcome:
        positive && !negative
          ? "match"
          : negative && !positive
            ? "no_match"
            : !condition?.excludes && !positive
              ? "no_match"
              : "unknown",
    };
  }
  // Saved-card/payment/order screens always require the user. This heuristic
  // is additional to the native-form action/field allowlist below.
  if (
    /\b(?:saved (?:card|payment)|card ending|place (?:your )?order|pay now|buy now|one.click|complete (?:your )?purchase|confirm (?:your )?order)\b/i.test(
      body,
    )
  )
    return { outcome: "payment" };
  if (phase === "checkout") {
    if (
      !body.includes(norm(recipe.productText)) ||
      !body.includes(norm(recipe.priceText))
    )
      return { outcome: "unknown" };
    const links = [...document.querySelectorAll("a[href]")].filter(
      (link) =>
        visible(link) &&
        norm(link.innerText) === norm(recipe.checkoutLabel) &&
        new URL(link.href).origin === location.origin &&
        new URL(link.href).pathname === recipe.checkoutPath &&
        !new URL(link.href).search &&
        !new URL(link.href).hash,
    );
    return {
      outcome: links.length === 1 ? "native_checkout_ready" : "unsupported",
    };
  }
  if (phase !== "cart") return { outcome: "unsupported" };
  const forms = [...document.forms].filter((form) => {
    const action = new URL(form.action, location.href);
    return (
      form.method.toLowerCase() === "post" &&
      action.origin === location.origin &&
      action.pathname === recipe.cartPath &&
      !action.search &&
      !action.hash &&
      form.target !== "_blank" &&
      norm(form.innerText).includes(norm(recipe.productText)) &&
      norm(form.innerText).includes(norm(recipe.priceText))
    );
  });
  if (forms.length !== 1) return { outcome: "unsupported" };
  const form = forms[0],
    fields = [...form.elements];
  const allowed = new Set([
    recipe.variantField,
    "quantity",
    "qty",
    "form_type",
    "utf8",
    "product_id",
    "authenticity_token",
    "csrf_token",
    "_token",
  ]);
  if (
    fields.some(
      (field) => !field.disabled && field.name && !allowed.has(field.name),
    )
  )
    return { outcome: "unsupported" };
  if (
    fields.some(
      (field) =>
        ["password", "email", "tel", "file"].includes(field.type) ||
        /card|payment|billing|address|order|purchase/i.test(
          `${field.name} ${field.autocomplete}`,
        ),
    )
  )
    return { outcome: "payment" };
  const variants = fields.filter((field) => field.name === recipe.variantField);
  const quantities = fields.filter((field) =>
    ["quantity", "qty"].includes(field.name),
  );
  if (
    variants.length !== 1 ||
    variants[0].value !== recipe.variantValue ||
    quantities.length !== 1 ||
    quantities[0].value !== "1" ||
    variants[0].disabled ||
    quantities[0].disabled
  )
    return { outcome: "unknown" };
  const prices = [...form.querySelectorAll('[itemprop="price"]')],
    currencies = [...form.querySelectorAll('[itemprop="priceCurrency"]')];
  if (prices.length !== 1 || currencies.length !== 1)
    return { outcome: "unsupported" };
  const priceValue = prices[0].getAttribute("content") || prices[0].textContent;
  const price = /^\d+(?:\.\d{1,2})?$/.test(priceValue)
    ? Number(priceValue)
    : NaN;
  const currency =
    currencies[0].getAttribute("content") || norm(currencies[0].textContent);
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    price > recipe.maxPrice ||
    currency !== recipe.currency
  )
    return { outcome: "price_changed" };
  const buttons = fields.filter(
    (button) =>
      ["submit", "image"].includes(button.type) &&
      visible(button) &&
      !button.disabled &&
      norm(button.innerText || button.value) === norm(recipe.addLabel),
  );
  if (
    buttons.length !== 1 ||
    buttons[0].type !== "submit" ||
    buttons[0].hasAttribute("formaction") ||
    buttons[0].hasAttribute("formmethod") ||
    buttons[0].hasAttribute("formtarget") ||
    buttons[0].name
  )
    return { outcome: "unsupported" };
  if (!submit) return { outcome: "native_cart_ready" };
  // Native prototype invocation avoids a page-defined submit property.
  HTMLFormElement.prototype.requestSubmit.call(form, buttons[0]);
  return { outcome: "submitted" };
}

// This bounded same-origin cart read runs only inside the private profile and
// never returns the merchant response, customer fields or identifiers to host.
async function cartInspection({ recipe, empty }) {
  const abort = new AbortController(),
    timer = setTimeout(() => abort.abort(), 5000);
  try {
    const response = await fetch(new URL("/cart.js", location.origin).href, {
      method: "GET",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal: abort.signal,
    });
    if (
      !response.ok ||
      !/application\/json/i.test(response.headers.get("content-type") || "")
    )
      return { outcome: "unsupported" };
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let text = "",
      bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 100000) {
        await reader.cancel();
        return { outcome: "unsupported" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const cart = JSON.parse(text);
    if (
      !Array.isArray(cart.items) ||
      !Number.isInteger(cart.item_count) ||
      cart.currency !== recipe.currency
    )
      return { outcome: "unsupported" };
    if (empty)
      return {
        outcome:
          cart.item_count === 0 && cart.items.length === 0
            ? "empty_cart"
            : "unsupported",
      };
    const item = cart.items[0],
      price = item?.final_price ?? item?.price;
    return {
      outcome:
        cart.item_count === 1 &&
        cart.items.length === 1 &&
        item.quantity === 1 &&
        String(item.variant_id ?? item.id) === recipe.variantValue &&
        Number.isInteger(price) &&
        price > 0 &&
        price <= Math.round(recipe.maxPrice * 100)
          ? "exact_cart"
          : "uncertain",
    };
  } catch {
    return { outcome: "unsupported" };
  } finally {
    clearTimeout(timer);
  }
}

function createMonitoringAdapter({
  browserAdapter,
  platform = process.platform,
  runFile = execFile,
} = {}) {
  return {
    websiteAvailable: Boolean(browserAdapter?.monitorCheck),
    windowsAvailable: platform === "win32",
    checkWebsite: ({ sessionId, tabId, monitor }, guard) =>
      browserAdapter.monitorCheck(sessionId, tabId, monitor, guard),
    prepareCheckout: ({ sessionId, tabId, monitor }, guard) =>
      browserAdapter.monitorPrepare(sessionId, tabId, monitor, guard),
    async checkWindows(monitor, guard = () => {}) {
      if (platform !== "win32") return { outcome: "unavailable" };
      if (
        !/^[A-Za-z0-9][A-Za-z0-9_. -]{0,100}\.exe$/i.test(monitor.processName)
      )
        throw new Error("Choose an exact executable name.");
      guard();
      // Base64 transports data into a fixed script; no shell or source
      // interpolation of process names or user predicates occurs.
      const payload = Buffer.from(
        JSON.stringify({
          name: monitor.processName.slice(0, -4),
          contains: monitor.condition.contains,
          excludes: monitor.condition.excludes || "",
        }),
      ).toString("base64");
      const script = `$ErrorActionPreference='Stop'; $m=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json); $p=@(Get-Process -Name $m.name -ErrorAction SilentlyContinue); $matched=@($p | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle.IndexOf($m.contains,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and (-not $m.excludes -or $_.MainWindowTitle.IndexOf($m.excludes,[StringComparison]::OrdinalIgnoreCase) -lt 0) }); if($matched.Count -gt 0){'match'}elseif($p.Count -eq 0){'no_match'}else{'no_match'}`;
      const executable = path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      const result = await new Promise((resolve, reject) =>
        runFile(
          executable,
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(script, "utf16le").toString("base64"),
          ],
          { windowsHide: true, shell: false, timeout: 10000, maxBuffer: 1024 },
          (error, stdout) =>
            error ? reject(error) : resolve(String(stdout).trim()),
        ),
      );
      guard();
      return {
        outcome: ["match", "no_match"].includes(result)
          ? result
          : "unavailable",
      };
    },
  };
}
module.exports = { monitorInspection, cartInspection, createMonitoringAdapter };
