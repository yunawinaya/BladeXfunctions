// the engine's "<message> (movement <key>)" / "movements[<i>] ..." text -> the source pick or recovery line it came from (LABELS part,
// CONTRACT.md section 5); self-contained
const idaMovementKeyOf = function idaMovementKeyOf(message, keys) {
  const t = message === undefined || message === null ? "" : String(message);
  const m = t.match(/\(movement ([A-Za-z0-9._-]{1,40})\)\s*$/);
  if (m) return m[1];
  const g = t.match(/^movements\[([0-9]+)\]/);
  if (g && Array.isArray(keys) && keys[Number(g[1])] !== undefined) return String(keys[Number(g[1])]);
  return "";
};
const idaMapEngineMessage = function idaMapEngineMessage(message, labels, keys) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const t = s(message);
  const key = idaMovementKeyOf(t, keys);
  const l = key && labels && typeof labels === "object" ? labels[key] : null;
  if (!l || typeof l !== "object") return t;
  const base = t.replace(/\s*\(movement [A-Za-z0-9._-]{1,40}\)\s*$/, "").replace(/^movements\[[0-9]+\]\s*/, "");
  const item = s(l.item_code) || s(l.item_name);
  const bin = s(l.bin) || s(l.bin_id);
  const what = s(l.pick) ? "source pick " + s(l.pick) : s(l.line_index) ? "line " + s(l.line_index) : "";
  const where = [what ? what + (item ? " (" + item + ")" : "") : item, bin ? (s(l.side) === "in" ? "into bin " : "bin ") + bin : "",
    s(l.category) ? "(" + s(l.category) + ")" : ""].filter((x) => x);
  return where.length ? base + " - " + where.join(", ").replace(/, \(/, " (") : base;
};
if (typeof module !== "undefined") module.exports = { idaMovementKeyOf, idaMapEngineMessage };
