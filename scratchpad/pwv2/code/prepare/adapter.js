// Putaway Completion V2 - SQL rows (prepare/sql.py) -> the exact shapes PUTAWAY's nodes handed its code nodes (checked
// against recorded runs by test/adapter_vs_recorded.js): get_node_C64LC1sr (the stored TO, its lines and records nested,
// bundle items under `children`), get_node_ca2032Ub (putaway_setup), code_node_PwItems / code_node_PwTransit (the Phase 0
// bridges' rows), search_node_SVMdNd3K / search_node_T5BGLPpK (the columns code_node_ds7jurnq reads). Ids are exact digit
// strings (16+ digit numbers read as text BEFORE JSON.parse), decimals numbers, JSON columns parsed; a column holding null
// or "" is absent, while inside a JSON column only nulls go; a get-node answers {count:1,data:{...}} or {count:0,data:{}};
// a search-node {total,count,data:[...]}.
const pwParse = (t) =>
  JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const pwStripNull = (v) => {
  if (Array.isArray(v)) return v.map(pwStripNull);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) if (v[k] !== null && v[k] !== undefined) o[k] = pwStripNull(v[k]);
    return o;
  }
  return v;
};
const pwStrip = (row) => {
  const o = {};
  for (const k of Object.keys(row || {})) {
    const v = row[k];
    if (v === null || v === undefined || v === "") continue;
    o[k] = typeof v === "object" ? pwStripNull(v) : v;
  }
  return o;
};
const pwRows = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((r) => r && r.j !== undefined && r.j !== null);
const pwObj = (r) => pwStrip(typeof r.j === "string" ? pwParse(r.j) : r.j);
const pwS = (v) => (v === undefined || v === null ? "" : String(v));
// flat sub-table rows (parent_id) -> top-level rows carrying `children`, in id order (rows come id-ordered from the SQL)
const pwTree = (rows) => {
  const top = [];
  const byId = {};
  for (const o of rows) byId[o.id] = Object.assign({}, o);
  for (const o of rows) {
    const r = byId[o.id];
    const p = o.parent_id ? byId[o.parent_id] : null;
    if (p) (p.children = p.children || []).push(r);
    else top.push(r);
  }
  return top;
};
const pwGet = (row) => (row ? { count: 1, data: row } : { count: 0, data: {} });
const pwSearch = (rows) => ({ total: rows.length, count: rows.length, data: rows });
// code_node_PwItems: the Item fields code_node_M7XzDZ48 reads; the eligibility flags are kept apart
const PW_ITEM_FLAGS = ["serial_number_management", "stock_control", "material_code"];
const pwItems = (rowsIn) => {
  const items = [];
  const flags = {};
  for (const r of pwRows(rowsIn)) {
    const o = typeof r.j === "string" ? pwParse(r.j) : r.j;
    if (!o || !o.id) continue;
    const f = {};
    for (const k of PW_ITEM_FLAGS) {
      f[k] = o[k] === undefined ? null : o[k];
      delete o[k];
    }
    flags[pwS(o.id)] = f;
    const conv = Array.isArray(o.table_uom_conversion) ? o.table_uom_conversion : [];
    o.table_uom_conversion = conv.map((c) => ({
      alt_uom_id: c.alt_uom_id === null || c.alt_uom_id === undefined ? c.alt_uom_id : String(c.alt_uom_id),
      base_qty: c.base_qty === null || c.base_qty === undefined ? c.base_qty : Number(c.base_qty),
    }));
    if (o.item_batch_management !== null && o.item_batch_management !== undefined) o.item_batch_management = Number(o.item_batch_management);
    for (const k of Object.keys(o)) if (o[k] === null || o[k] === "") delete o[k];
    items.push(pwStripNull(o));
  }
  return { items: items, flags: flags };
};
// code_node_PwTransit: decimals and line_no as numbers, NULL / "" left out
const pwTransit = (rowsIn) => {
  const rows = [];
  for (const r of pwRows(rowsIn)) {
    const o = typeof r.j === "string" ? pwParse(r.j) : r.j;
    if (!o || !o.id) continue;
    for (const k of Object.keys(o)) if (o[k] === null || o[k] === "") delete o[k];
    for (const k of ["transit_qty", "received_qty", "open_qty", "line_no"]) if (o[k] !== undefined) o[k] = Number(o[k]);
    rows.push(o);
  }
  return rows;
};
const pwBbalKey = (material, location, batch) => pwS(material) + "|" + pwS(location) + "|" + pwS(batch);

const pwAdapt = function pwAdapt(S) {
  const hdr = pwRows(S.hdr).map(pwObj)[0] || null;
  const lines = pwRows(S.lines).map(pwObj);
  const records = pwRows(S.records).map(pwObj);
  // the TO as get_node_C64LC1sr reads it: header columns, then its two subforms (trees)
  let to = null;
  if (hdr) {
    to = Object.assign({}, hdr);
    to.table_putaway_item = pwTree(lines);
    to.table_putaway_records = pwTree(records);
  }
  const it = pwItems(S.items);
  const setup = pwRows(S.setup).map(pwObj)[0] || null;
  const bbal = {};
  // SUBTRACT_INVENTORY's get_node_GjRiq3dT answers the first row of a key (lowest id)
  for (const b of pwRows(S.bbal).map(pwObj)) {
    const k = pwBbalKey(b.material_id, b.location_id, b.batch_id);
    if (!bbal[k]) bbal[k] = b;
  }
  const lockRow = (Array.isArray(S.lock) ? S.lock : S.lock ? [S.lock] : []).filter((r) => r && r.step_name)[0] || null;
  const costRows = pwRows(S.cost).map(pwObj);
  const hrow = (Array.isArray(S.hdr) ? S.hdr : S.hdr ? [S.hdr] : [])[0] || {};
  return {
    to: pwGet(to),
    hdr: hdr,
    lines: lines,
    records: records,
    items: it.items,
    itemFlags: it.flags,
    transit: pwTransit(S.transit),
    setup: pwGet(setup),
    others: pwSearch(pwRows(S.others).map(pwObj)),
    qi: pwSearch(pwRows(S.qi).map(pwObj)),
    gr: pwRows(S.gr).map(pwObj)[0] || null,
    bbal: bbal,
    lock: lockRow,
    // SUBMIT_SQL only: the costing-migration pairs, the classic lock's age, the GR's status
    cost: costRows,
    lockAgeSec: hrow.lock_age_sec === undefined || hrow.lock_age_sec === null ? null : Number(hrow.lock_age_sec),
    grStatus: pwS(hrow.gr_status),
  };
};
