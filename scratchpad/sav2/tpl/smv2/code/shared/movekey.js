// SM V2 / Location Transfer - the movement_key message mapper. INVENTORY_BULK_APPLY names the movement it failed on in its
// 400 message - "<failure message> (movement <movement_key>)" (plan.js l.79) or, from its guard, "movements[<i>] <what>"
// (guard.js) - and PREPARE's LABELS part maps each movement_key back to the LOT line it came from:
//   LABELS = { "<movement_key>": { line_index, line_id, item_code, item_name, bin, bin_id, category, side } }
//   (side: "from" for the SUBTRACT M<n>, "to" for the ADD M<n>.2)
// lotMovementKeyOf(message, keys)          -> the movement_key the message names ("" when none); keys = the ENGINE part's
//                                             movement_key list in order (resolves "movements[<i>]")
// lotMapEngineMessage(message, labels, keys) -> the user's text: the engine text without its "(movement ...)" suffix, then
//                                             " - line <n> (<item code>), <from|to> bin <bin> (<category>)"; the engine text
//                                             unchanged when the key or its label is unknown
const lotMovementKeyOf = function lotMovementKeyOf(message, keys) {
  const t = message === undefined || message === null ? "" : String(message);
  const m = t.match(/\(movement ([A-Za-z0-9._-]{1,40})\)\s*$/);
  if (m) return m[1];
  const g = t.match(/^movements\[([0-9]+)\]/);
  if (g && Array.isArray(keys) && keys[Number(g[1])] !== undefined) return String(keys[Number(g[1])]);
  return "";
};
const lotMapEngineMessage = function lotMapEngineMessage(message, labels, keys) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const t = s(message);
  const key = lotMovementKeyOf(t, keys);
  const l = key && labels && typeof labels === "object" ? labels[key] : null;
  if (!l || typeof l !== "object") return t;
  const base = t.replace(/\s*\(movement [A-Za-z0-9._-]{1,40}\)\s*$/, "").replace(/^movements\[[0-9]+\]\s*/, "");
  const item = s(l.item_code) || s(l.item_name);
  const bin = s(l.bin) || s(l.bin_id);
  const where = [s(l.line_index) ? "line " + s(l.line_index) + (item ? " (" + item + ")" : "") : item, bin ? (s(l.side) === "to" ? "to bin " : "from bin ") + bin : "",
    s(l.category) ? "(" + s(l.category) + ")" : ""].filter((x) => x);
  return where.length ? base + " - " + where.join(", ").replace(/, \(/, " (") : base;
};
if (typeof module !== "undefined") module.exports = { lotMovementKeyOf, lotMapEngineMessage };
