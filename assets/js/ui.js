// Shared UI helpers. Session 23 (Phase 0): the modal, the dropdown and the markup helpers now live
// in the UI kit (assets/js/kit.js); these names are kept so existing pages do not change.
// kit.js must be loaded first (it is, on every shell page).
function openModal(spec) { return HIS.kit.modal(spec); }
function opts(list, sel) { return list.map(o => '<option' + (o === sel ? ' selected' : '') + '>' + o + '</option>').join(''); }
// A name can be missing on a damaged or legacy record; an avatar is not worth throwing the page for,
// so an unreadable name degrades to "?" instead of a TypeError inside a row map.
function initialsOf(n) {
  var s = (n === null || n === undefined) ? '' : String(n);
  var out = s.split(' ').filter(w => /^[A-Za-z]/.test(w)).slice(0, 3).map(w => w[0]).join('').toUpperCase();
  return out || '?';
}
// Custom dropdown that looks like the Figma dropdown frames. el must be an empty positioned element.
function makeDropdown(el, spec) { return HIS.kit.dropdown(el, spec); }