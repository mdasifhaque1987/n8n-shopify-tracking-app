(function () {
  var STORAGE_KEY = "dh_tracking_attribution";
  var APP_SCRIPT_ATTR = "data-dh-tracking-app";

  var CLICK_ID_KEYS = [
    "gclid",
    "gbraid",
    "wbraid",
    "msclkid",
    "fbclid",
    "ttclid",
    "epik"
  ];

  function now() {
    return Date.now();
  }

  function getParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return match ? decodeURIComponent(match[2]) : null;
  }

  function setCookie(name, value, days) {
    try {
      var expires = new Date(Date.now() + days * 864e5).toUTCString();
      document.cookie =
        name + "=" + encodeURIComponent(value) +
        "; expires=" + expires +
        "; path=/; SameSite=Lax";
    } catch (e) {}
  }

  function readStorage() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function writeStorage(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function getAttributionValue(key) {
    var fromUrl = getParam(key);
    if (fromUrl) return fromUrl;

    var fromCookie = getCookie("dh_" + key) || getCookie(key);
    if (fromCookie) return fromCookie;

    var stored = readStorage();
    if (stored && stored.click_ids && stored.click_ids[key]) {
      return stored.click_ids[key];
    }

    return null;
  }

  function captureClickIds() {
    var stored = readStorage();
    stored.click_ids = stored.click_ids || {};
    stored.page = stored.page || {};

    var changed = false;

    CLICK_ID_KEYS.forEach(function (key) {
      var value = getParam(key);

      if (value) {
        stored.click_ids[key] = value;
        setCookie("dh_" + key, value, 90);
        changed = true;
      } else {
        var fallback = getAttributionValue(key);
        if (fallback && !stored.click_ids[key]) {
          stored.click_ids[key] = fallback;
          changed = true;
        }
      }
    });

    stored.page.landing_page = stored.page.landing_page || window.location.href;
    stored.page.page_location = window.location.href;
    stored.page.page_title = document.title || "";
    stored.page.page_referrer = document.referrer || "";
    stored.updated_at = now();

    if (changed || !localStorage.getItem(STORAGE_KEY)) {
      writeStorage(stored);
    }

    return stored;
  }

  function isAppOwnedScript(script) {
    return script && script.getAttribute && script.getAttribute(APP_SCRIPT_ATTR) === "true";
  }

  function findScriptById(id) {
    if (!id) return null;

    var scripts = document.querySelectorAll("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute("src") || "";
      var text = scripts[i].textContent || "";

      if (src.indexOf(id) !== -1 || text.indexOf(id) !== -1) {
        return {
          found: true,
          appOwned: isAppOwnedScript(scripts[i]),
          src: src || null
        };
      }
    }

    return {
      found: false,
      appOwned: false,
      src: null
    };
  }

  function detectGoogleTag(id) {
    return findScriptById(id);
  }

  window.DHTrackingHelper = window.DHTrackingHelper || {};
  window.DHTrackingHelper.STORAGE_KEY = STORAGE_KEY;
  window.DHTrackingHelper.captureClickIds = captureClickIds;
  window.DHTrackingHelper.getAttributionValue = getAttributionValue;
  window.DHTrackingHelper.detectGoogleTag = detectGoogleTag;
  window.DHTrackingHelper.isAppOwnedScript = isAppOwnedScript;

  captureClickIds();
})();
