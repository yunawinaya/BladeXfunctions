// GR Completion V2 - SQL rows (prepare/sql.py) -> the exact shapes GOODS_RECEIVING's get / search nodes handed its code
// nodes (checked against recorded runs by test/adapter_vs_recorded.js): ids as exact digit strings (16+ digit numbers are
// read as text BEFORE JSON.parse, so a short bigint like gr_no_type -9999 stays a number, as the platform's serializer
// leaves it), decimals as numbers, JSON columns parsed; a column holding null or "" is absent, while inside a JSON
// column only nulls go (a recorded predefined_data kept its ""); top-level rows keep their system columns, nested
// subform rows drop them and their parent key; children nested under their parent_id, rows in id order; a get-node
// answers its first row ({count:1,data:{...}}) or {count:0,data:{}}; a search-node {total,count,data:[...]}.
const grParse = (t) =>
  JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const grStripNull = (v) => {
  if (Array.isArray(v)) return v.map(grStripNull);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) if (v[k] !== null && v[k] !== undefined) o[k] = grStripNull(v[k]);
    return o;
  }
  return v;
};
// one row: its columns without null / "", JSON column values without nulls
const grStrip = (row) => {
  const o = {};
  for (const k of Object.keys(row || {})) {
    const v = row[k];
    if (v === null || v === undefined || v === "") continue;
    o[k] = typeof v === "object" ? grStripNull(v) : v;
  }
  return o;
};
const grRows = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((r) => r && r.j !== undefined && r.j !== null);
const grObj = (r) => grStrip(typeof r.j === "string" ? grParse(r.j) : r.j);
const GR_NESTED_DROP = ["create_user", "create_dept", "create_time", "update_user", "update_time", "tenant_id", "is_deleted", "sub_tenant_id", "sub_tenant_id_d_am5ft"];
const grNestedRow = (o, fk) => {
  const r = Object.assign({}, o);
  for (const k of GR_NESTED_DROP.concat([fk])) delete r[k];
  return r;
};
// flat subform rows (parent_id) -> top-level rows carrying `children`, in id order
const grTree = (rows, fk) => {
  const top = [];
  const byId = {};
  for (const o of rows) byId[o.id] = grNestedRow(o, fk);
  for (const o of rows) {
    const r = byId[o.id];
    const p = o.parent_id ? byId[o.parent_id] : null;
    if (p) (p.children = p.children || []).push(r);
    else top.push(r);
  }
  return top;
};
const grGet = (row) => (row ? { count: 1, data: row } : { count: 0, data: {} });
const grSearch = (rows) => ({ total: rows.length, count: rows.length, data: rows });
const grS = (v) => (v === undefined || v === null ? "" : String(v));
// a search-node's default order: update_time (to the second) newest first, then id
const grSearchOrder = (rows) =>
  rows.slice().sort((a, b) => {
    const ta = grS(a.update_time).slice(0, 19);
    const tb = grS(b.update_time).slice(0, 19);
    if (ta !== tb) return ta < tb ? 1 : -1;
    return grS(a.id).length - grS(b.id).length || (grS(a.id) < grS(b.id) ? -1 : grS(a.id) > grS(b.id) ? 1 : 0);
  });

const grAdapt = function grAdapt(S) {
  const hdr = grRows(S.hdr).map(grObj)[0] || null;
  const lines = grRows(S.lines).map(grObj);
  // the GR as get_node_UeM3HpzR / search_origGRMain / get_node_ITgrLines read it (table_sn_records: serial receipts are
  // not V2-eligible, so its subform is empty)
  if (hdr) {
    hdr.table_gr = grTree(lines, "goods_receiving_id");
    hdr.table_sn_records = [];
  }
  const items = grRows(S.items).map(grObj);
  const poLines = grRows(S.pol).map(grObj);
  const poHdrs = grRows(S.poh).map(grObj);
  // search_node_nkWkBdXY / XqqoMDRs: each PO with its lines nested (table_po), lines in id order
  const poDocs = poHdrs.map((h) => {
    const d = Object.assign({}, h);
    d.table_po = grTree(poLines.filter((l) => l.purchase_order_id === h.id), "purchase_order_id");
    return d;
  });
  const setup = { PS: [], LB: [], TO: [] };
  for (const r of grRows(S.setup)) (setup[r.k] = setup[r.k] || []).push(grObj(r));
  const lockRow = (Array.isArray(S.lock) ? S.lock : S.lock ? [S.lock] : []).filter((r) => r && r.step_name)[0] || null;
  return {
    gr: grGet(hdr),
    lines: lines,
    items: grSearch(items),
    poDocs: grSearch(poDocs),
    poLines: poLines,
    poHeaders: poHdrs,
    onOrder: grRows(S.oo).map(grObj),
    putawaySetup: grGet(setup.PS[0] || null),
    loadingBay: grGet(setup.LB[0] || null),
    putawayRule: grGet(setup.TO[0] || null),
    // batchnum.js takes the config and item rows as the SQL gives them
    bncRows: grRows(S.bnc),
    bnItems: items.map((i) => ({ id: i.id, item_category: i.item_category, item_group_id: i.item_group_id })),
    batches: grSearchOrder(grRows(S.batches).map(grObj)),
    lock: lockRow,
  };
};
