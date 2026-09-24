// The top bar's Players menu (Compare and Ratings). It is a <details>, so it
// opens and closes with no script at all; this only adds what a menu is
// expected to do beyond that: close on a click outside it, on Escape, and
// once one of its items has been chosen (the board's Ratings is a tab, not a
// link, so choosing it does not leave the page).
(function () {
  var menus = document.querySelectorAll(".navdd details");
  if (!menus.length) return;
  var closeAll = function (except) {
    for (var i = 0; i < menus.length; i++) if (menus[i] !== except) menus[i].open = false;
  };
  document.addEventListener("click", function (e) {
    var inside = e.target.closest && e.target.closest(".navdd details");
    if (!inside) closeAll(null);
    else if (e.target.closest(".ddmenu a, .ddmenu button")) inside.open = false;
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    for (var i = 0; i < menus.length; i++) {
      if (menus[i].open) { menus[i].open = false; menus[i].querySelector("summary").focus(); }
    }
  });
})();
