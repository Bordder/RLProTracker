// Copy-link button on a player card.
//
// Its own file rather than an inline handler because the site's CSP is
// script-src 'self': an inline <script> on the card would be blocked, and
// widening the policy to hash or nonce the card's script would mean the header
// changes every time the markup does.
(function () {
  var btn = document.getElementById("copy");
  if (!btn) return;
  var label = btn.textContent;
  var timer = null;

  var say = function (msg) {
    btn.textContent = msg;
    clearTimeout(timer);
    timer = setTimeout(function () { btn.textContent = label; }, 1600);
  };

  btn.addEventListener("click", function () {
    var url = btn.getAttribute("data-url") || location.href;
    // clipboard.writeText needs a secure context and can still be refused by
    // permissions policy, so fall back to a selection copy rather than leaving
    // the button silently dead.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { say("Copied"); }, function () { fallback(url); });
    } else {
      fallback(url);
    }
  });

  function fallback(url) {
    var ta = document.createElement("textarea");
    ta.value = url;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-label", "Link to this player");
    ta.rows = 1;
    // Off-screen while execCommand is tried, then brought into the page if that
    // fails too. Telling someone to press Ctrl+C is only useful if there is
    // something selected for them to copy.
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    if (ok) {
      document.body.removeChild(ta);
      say("Copied");
      return;
    }
    ta.style.cssText =
      "width:100%;margin-top:10px;padding:9px 12px;border-radius:7px;resize:none;" +
      "background:#14171F;color:#F2EFE6;border:1px solid #FF5A1F;font:inherit;font-size:13px";
    btn.parentNode.appendChild(ta);
    ta.select();
    say("Press Ctrl+C");
  }
})();
