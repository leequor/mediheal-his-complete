// Viewport helpers (v4 — responsive, replacing the v3 CSS-zoom scaling).
//
// WHY THIS CHANGED
// v3 scaled the fixed 1440px stage with CSS `zoom = width / 1440`. At 390px that is 0.2708, so a
// 16px label painted at 4.3px and the smallest text on the site measured 2.6px. A scaled desktop
// canvas is not a mobile layout. v4 removes zoom entirely; layout is now handled by
// assets/css/responsive.css with real breakpoints, and text keeps its declared size at every width.
//
// What remains here:
//   - the sign-in panel height, so the blue panel fills the window instead of ending at 1024px
//   - the mobile menu button (the header burger is hidden below 900px)
//   - a `data-viewport` attribute on <html> so CSS can react without repeating media queries
// `?fit=0` is no longer meaningful and is ignored.
(function () {
  var MOBILE_BP = 900;

  function apply() {
    var de = document.documentElement;
    var w = de.clientWidth || window.innerWidth;
    var h = window.innerHeight;

    de.setAttribute('data-viewport', w < 480 ? 'phone' : w < MOBILE_BP ? 'mobile' : w < 1200 ? 'tablet' : 'desktop');

    // Sign in: the panel is 100% of the frame height; the frame fills the window down to a 780px
    // floor so the feature list never collides with the demo-accounts button.
    var si = document.querySelector('body > .si');
    if (si) si.style.height = Math.round(Math.max(780, h)) + 'px';

    // The header burger is now in normal flow and sized for touch by responsive.css, so no separate
    // floating button is needed. Any stale one from an older cached fit.js is removed.
    var old = document.querySelector('.fit-burger');
    if (old) old.remove();
  }

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  window.addEventListener('load', function () { apply(); setTimeout(apply, 300); });
  document.addEventListener('DOMContentLoaded', apply);
})();
