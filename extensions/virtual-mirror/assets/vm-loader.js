/*
 * Virtual Mirror loader. Tiny and dependency-free: it only listens for clicks.
 * The widget bundle (camera, face tracking, 3D) is fetched on the first click,
 * so product pages pay nothing for shoppers who never open the mirror.
 */
(function () {
  if (window.__vmLoader) return;
  window.__vmLoader = true;
  var loading = null;

  function loadWidget(src) {
    if (window.VirtualMirror) return Promise.resolve(window.VirtualMirror);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () {
        window.VirtualMirror ? resolve(window.VirtualMirror) : reject(new Error("widget missing"));
      };
      s.onerror = function () {
        loading = null;
        reject(new Error("widget failed to load"));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  function currentVariantId(button) {
    // The theme's product form is the source of truth for the selected variant.
    var input = document.querySelector('form[action*="/cart/add"] [name="id"]');
    return (input && input.value) || button.getAttribute("data-variant-id") || null;
  }

  document.addEventListener("click", function (event) {
    var button = event.target && event.target.closest && event.target.closest("[data-vm-open]");
    if (!button) return;
    event.preventDefault();
    var manifestEl = button.parentElement && button.parentElement.querySelector("[data-vm-manifest]");
    var manifest = manifestEl ? manifestEl.textContent : null;
    var label = button.textContent;
    button.setAttribute("aria-busy", "true");
    button.disabled = true;
    loadWidget(button.getAttribute("data-widget-src"))
      .then(function (vm) {
        vm.open({
          manifest: manifest,
          productTitle: button.getAttribute("data-product-title") || "",
          variantId: currentVariantId(button),
          cartAddUrl: button.getAttribute("data-cart-add-url") || "/cart/add.js",
          cartUrl: button.getAttribute("data-cart-url") || "/cart",
          accentColor: button.getAttribute("data-accent") || undefined,
          accentTextColor: button.getAttribute("data-accent-text") || undefined,
          debug: /[?&]vm_debug=1\b/.test(location.search),
          returnFocusTo: button,
        });
      })
      .catch(function (err) {
        console.error("[VirtualMirror]", err);
      })
      .then(function () {
        button.removeAttribute("aria-busy");
        button.disabled = false;
        button.textContent = label;
      });
  });
})();
