// SM_PLANT_TRANSFER duplicate guard (prod-hotfix/2026-10-23-pt-duplicate-guard): helpers shared by its code nodes.
// pt_uuid (the form's hidden "UUID" field, unused until now) holds <key>|<fingerprint>|<SAVING|SAVED>, "-" = none.
const s = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const isDigits = (v) => /^\d{1,20}$/.test(s(v));
const num8 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 1e8) / 1e8) : s(v);
};
const parseList = (v) => {
  if (Array.isArray(v)) return v;
  try {
    const x = JSON.parse(v || "[]");
    return Array.isArray(x) ? x : [];
  } catch (e) {
    return [];
  }
};
const hex8 = (h) => ("00000000" + (h >>> 0).toString(16)).slice(-8);
const fnv1a = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return hex8(h);
};
const djb2 = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 33) + str.charCodeAt(i)) | 0;
  return hex8(h);
};
// sql_node_PTdupFind / PTdupTwin* rows, oldest first; a key match beats a fingerprint match
const dupRows = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => r && isDigits(r.id));
const dupPool = (rows) => {
  const byKey = rows.filter((r) => s(r.match_by) === "KEY");
  return byKey.length ? byKey : rows;
};
// what a repeat of a save that already reached the table is told
const dupAnswer = (row) => {
  const no = s(row.stock_movement_no) || "the earlier transfer";
  const out = { id: s(row.id), stock_movement_no: s(row.stock_movement_no), stock_movement_status: s(row.stock_movement_status), replayed: "0" };
  if (s(row.save_state) === "SAVED") {
    return Object.assign(out, { route: "REPLAY", code: "200", result_code: "PT_ALREADY_SAVED", message: "Plant Transfer already saved as " + no, replayed: "1" });
  }
  const age = row.age_s === null || row.age_s === undefined || row.age_s === "" ? NaN : Number(row.age_s);
  if (!Number.isFinite(age) || age < 1800) {
    return Object.assign(out, { route: "WAIT", code: "400", result_code: "PT_SAVE_IN_PROGRESS",
      message: "This transfer is still being saved as " + no + ". Wait a moment, then check the Plant Transfer list." });
  }
  return Object.assign(out, { route: "STOP", code: "400", result_code: "PT_SAVE_INCOMPLETE",
    message: no + " did not finish saving. Check it on the web before trying again." });
};
if (typeof module !== "undefined") module.exports = { s, isDigits, num8, parseList, fnv1a, djb2, dupRows, dupPool, dupAnswer };
