// GD Created V2 fit: a new delivery GD_BULK_PREPARE (v17) refuses where the classic save copes is saved the classic way
// instead of failing after the dialog closed. Copied verbatim into GD_ASYNC_SUBMIT (fit plan, fit decision) and SO_AUTO_GD
// (V2 plan). Mirrors PREPARE: code_node_FniXEIuQ (flat walk, auto lines), code_node_kyHUfWS3 (handling units, Auto mode
// only), code_node_J5T1G2s9 (item master, handling-unit allocations, pending reservations).
const gdV2FitLines = function gdV2FitLines(payload) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const ID = /^[0-9]{1,19}$/;
  const positive = (v) => {
    const m = String(v).match(/^([0-9]+)(?:\.([0-9]{1,8}))?$/);
    return !!m && /[1-9]/.test(m[1] + (m[2] || ""));
  };
  const allocsOf = (l) => {
    let a = l.temp_qty_data;
    if (typeof a === "string" && a.trim()) {
      try {
        a = JSON.parse(a);
      } catch (e) {
        a = [];
      }
    }
    return Array.isArray(a) ? a : [];
  };
  const rows = [];
  const materials = {};
  const auto = {};
  const soLines = {};
  // one row per flat line: [label, material, sales order line, auto-allocated 0/1, an allocation from a handling unit 0/1]
  const add = (l, label, bundle) => {
    const material = ID.test(s(l.material_id)) ? s(l.material_id) : "";
    const soLine = ID.test(s(l.so_line_item_id)) ? s(l.so_line_item_id) : "";
    const allocs = bundle ? [] : allocsOf(l);
    const isAuto = !bundle && material && !allocs.length && positive(s(l.gd_qty) === "" ? "0" : s(l.gd_qty)) ? 1 : 0;
    const huAlloc = allocs.some((a) => a && typeof a === "object" && (s(a.handling_unit_id) || s(a.hu_id))) ? 1 : 0;
    if (material && !bundle) materials[material] = true;
    if (isAuto) auto[material] = true;
    if (soLine) soLines[soLine] = true;
    rows.push([label, bundle ? "" : material, soLine, isAuto, huAlloc]);
  };
  (Array.isArray((payload || {}).lines) ? payload.lines : []).forEach((raw, i) => {
    const l = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const kids = Array.isArray(l.children) ? l.children : [];
    const bundle = kids.length > 0 || (s(l.item_bundle_id) !== "" && s(l.material_id) === "");
    add(l, String(i + 1), bundle);
    if (bundle) kids.forEach((k, j) => add(k && typeof k === "object" && !Array.isArray(k) ? k : {}, i + 1 + "/" + (j + 1), false));
  });
  return { rows: rows, materialIds: Object.keys(materials), autoMaterialIds: Object.keys(auto), soLineIds: Object.keys(soLines) };
};
// facts: rows of the fit read - SETUP (f1 picking_mode), ITEM (f1 stock_control or NS, f2 costing method, f3 batch, f4 serial,
// f5 purchase price), HU (a material in an unpacked handling unit of the plant), PEND (a sales order line with a Pending
// reservation). Returns the first reason the classic save must take the delivery, or "".
const gdV2Fit = function gdV2Fit(rows, facts) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  const METHOD = { "Fixed Cost": true, "First In First Out": true, "Weighted Average": true };
  const price = (v) => {
    const m = s(v).match(/^(-)?([0-9]+)(?:\.([0-9]+))?$/);
    if (!m) return false;
    const f = m[3] || "";
    if (f.length > 8 && /[1-9]/.test(f.slice(8))) return false;
    return !m[1] || !/[1-9]/.test(m[2] + f);
  };
  let setup = null;
  const item = {};
  const hu = {};
  const pend = {};
  for (const f of list(facts)) {
    if (!f || typeof f !== "object") continue;
    const kind = s(f.kind);
    if (kind === "SETUP" && !setup) setup = f;
    else if (kind === "ITEM") item[s(f.id)] = f;
    else if (kind === "HU") hu[s(f.id)] = true;
    else if (kind === "PEND") pend[s(f.id)] = true;
  }
  // PREPARE allocates (and refuses handling-unit stock) only in Auto picking mode; no setup row = the defaults (Auto)
  const mode = setup ? (setup.f1 === undefined || setup.f1 === null || setup.f1 === "" ? "Manual" : String(setup.f1)) : "Auto";
  for (const r of list(rows)) {
    const at = "line " + s(r[0]);
    const material = s(r[1]);
    const it = item[material];
    // a non-stock item (NS: stock_control 0, show_delivery 0): GD_BULK_PREPARE delivers it as a description-only line, as the
    // old save does (2026-10-23); no stock check applies. Switch GD_V2_NONSTOCK_ENABLED, on unless a caller sets it false
    const nonStock = !!it && s(it.f1) === "NS" && (typeof GD_V2_NONSTOCK_ENABLED === "undefined" || GD_V2_NONSTOCK_ENABLED === true);
    if (it && !nonStock) {
      const what = at + ": material " + material + " ";
      if (s(it.f1) !== "1") return what + "is not stock-controlled";
      if (!METHOD[s(it.f2)]) return what + "has costing method '" + s(it.f2) + "'";
      if (["0", "1"].indexOf(s(it.f3)) < 0) return what + "has batch management '" + s(it.f3) + "'";
      if (s(it.f4) !== "0") return what + "has serial number management '" + s(it.f4) + "'";
      if (s(it.f2) === "Fixed Cost" && !price(it.f5)) return what + "is Fixed Cost without a usable purchase price";
    }
    if (String(r[4]) === "1") return at + ": stock picked from a handling unit";
    if (String(r[3]) === "1" && mode === "Auto" && hu[material]) return at + ": handling units in this plant hold material " + material;
    if (s(r[2]) && pend[s(r[2])]) return at + ": sales order line " + s(r[2]) + " carries a pending reservation";
  }
  return "";
};
