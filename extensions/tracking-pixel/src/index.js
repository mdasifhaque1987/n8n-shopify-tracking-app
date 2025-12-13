// DH Tracking Pixel - Multi-platform tracking pixel injection
// This runs on the storefront and injects tracking pixels based on shop settings

analytics.subscribe("page_viewed", async (event) => {
  try {
    // Fetch shop settings from your app API endpoint
    const shopDomain = window.Shopify?.shop || '';
    const response = await fetch(`https://dh-tracking-app-new.fly.dev/api/pixel-config?shop=${shopDomain}`);
    const config = await response.json();
    
    if (!config || !config.pixels) {
      return;
    }

    // Initialize pixels only if IDs are configured
    if (config.pixels.ga4Id) loadGA4(config.pixels.ga4Id);
    if (config.pixels.googleAdsId) loadGoogleAds(config.pixels.googleAdsId);
    if (config.pixels.facebookPixelId) loadFacebookPixel(config.pixels.facebookPixelId);
    if (config.pixels.tiktokPixelId) loadTikTokPixel(config.pixels.tiktokPixelId);
    if (config.pixels.pinterestTagId) loadPinterestTag(config.pixels.pinterestTagId);
    if (config.pixels.linkedinPid) loadLinkedInTag(config.pixels.linkedinPid);
    if (config.pixels.bingUetTagId) loadBingUET(config.pixels.bingUetTagId);
  } catch (error) {
    console.error('[DH Tracking] Error:', error);
  }
});

// Track product views
analytics.subscribe("product_viewed", async (event) => {
  const { productVariant } = event.data;
  trackEvent('ViewContent', {
    content_ids: [productVariant.product.id],
    value: productVariant.price.amount,
    currency: productVariant.price.currencyCode,
  });
});

// Track add to cart
analytics.subscribe("product_added_to_cart", async (event) => {
  const { cartLine } = event.data;
  trackEvent('AddToCart', {
    content_ids: [cartLine.merchandise.product.id],
    value: cartLine.cost.totalAmount.amount,
    currency: cartLine.cost.totalAmount.currencyCode,
  });
});

// Track purchase
analytics.subscribe("checkout_completed", async (event) => {
  const { checkout } = event.data;
  trackEvent('Purchase', {
    transaction_id: checkout.order.id,
    value: checkout.totalPrice.amount,
    currency: checkout.currencyCode,
  });
});

function loadGA4(id) {
  const script = document.createElement('script');
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(script);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function() { dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', id);
}

function loadGoogleAds(id) {
  if (window.gtag) gtag('config', id);
}

function loadFacebookPixel(id) {
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', id);
  fbq('track', 'PageView');
}

function loadTikTokPixel(id) {
  !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src="https://analytics.tiktok.com/i18n/pixel/events.js?sdkid="+e;var o=document.getElementsByTagName("script")[0];o.parentNode.insertBefore(n,o)}}(window,document,'ttq');
  ttq.load(id);
  ttq.page();
}

function loadPinterestTag(id) {
  !function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version="3.0";var t=document.createElement("script");t.async=!0,t.src=e;var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");
  pintrk('load', id);
  pintrk('page');
}

function loadLinkedInTag(id) {
  window._linkedin_partner_id = id;
  window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
  window._linkedin_data_partner_ids.push(id);
  (function(){var s=document.getElementsByTagName("script")[0];var b=document.createElement("script");b.type="text/javascript";b.async=true;b.src="https://snap.licdn.com/li.lms-analytics/insight.min.js";s.parentNode.insertBefore(b,s);})();
}

function loadBingUET(id) {
  window.uetq = window.uetq || [];
  (function(w,d,t,r,u){var f,n,i;w[u]=w[u]||[],f=function(){var o={ti:id};o.q=w[u],w[u]=new UET(o),w[u].push("pageLoad")},n=d.createElement(t),n.src=r,n.async=1,i=d.getElementsByTagName(t)[0],i.parentNode.insertBefore(n,i)})(window,document,"script","//bat.bing.com/bat.js","uetq");
}

function trackEvent(name, data) {
  if (window.gtag) gtag('event', name, data);
  if (window.fbq) fbq('track', name, data);
  if (window.ttq) ttq.track(name, data);
  if (window.pintrk) pintrk('track', name, data);
  if (window.uetq) uetq.push('event', name, data);
}
