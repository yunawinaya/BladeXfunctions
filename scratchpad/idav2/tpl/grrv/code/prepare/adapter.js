// GR Revert Completed V2 - SQL rows (prepare/sql.py) -> the shapes GR_REVERT_COMPLETED's reads handed grRvPrep / grRvBuild
// (checked against recorded runs by test/adapter_vs_recorded.js). Ids are exact digit strings (16+ digit numbers are read as
// text BEFORE JSON.parse; a short bigint like gr_no_type -9999 stays a number, as the platform's serializer leaves it).
// get / search-node rows: a column holding null or "" is absent, inside a JSON column only nulls go; nested subform rows drop
// the system columns and their parent key, children nest under their parent_id, rows in id order; a get-node answers
// {count:1,data:{...}} or {count:0,data:{}}, a search-node {total,count,data:[...]}. sql-node rows (movs / later / fifo / wa /
// costcounts): the classic's select list, null columns absent.
const rvParse = (t) =>
  JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const rvS = (v) => (v === undefined || v === null ? "" : String(v));
const rvList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const rvDigits = (v) => /^[0-9]{1,20}$/.test(rvS(v));
const rvNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const rvQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const rvCmpId = (a, b) => {
  a = rvS(a);
  b = rvS(b);
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
};
const rvStripNull = (v) => {
  if (Array.isArray(v)) return v.map(rvStripNull);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) if (v[k] !== null && v[k] !== undefined) o[k] = rvStripNull(v[k]);
    return o;
  }
  return v;
};
const rvStrip = (row) => {
  const o = {};
  for (const k of Object.keys(row || {})) {
    const v = row[k];
    if (v === null || v === undefined || v === "") continue;
    o[k] = typeof v === "object" ? rvStripNull(v) : v;
  }
  return o;
};
const rvSqlRow = (row) => {
  const o = {};
  for (const k of Object.keys(row || {})) if (row[k] !== null && row[k] !== undefined) o[k] = row[k];
  return o;
};
const rvRows = (v) => rvList(v).filter((r) => r && r.j !== undefined && r.j !== null);
const rvJ = (r) => (typeof r.j === "string" ? rvParse(r.j) : r.j);
const rvObj = (r) => rvStrip(rvJ(r));
const rvSql = (v) => rvRows(v).map((r) => rvSqlRow(rvJ(r)));
const RV_NESTED_DROP = ["create_user", "create_dept", "create_time", "update_user", "update_time", "tenant_id", "is_deleted", "sub_tenant_id", "sub_tenant_id_d_am5ft"];
// flat subform rows of one parent (id order) -> top-level rows carrying `children`
const rvTree = (rows, fk) => {
  const top = [];
  const byId = {};
  for (const o of rows) {
    const r = Object.assign({}, o);
    for (const k of RV_NESTED_DROP.concat([fk])) delete r[k];
    byId[o.id] = r;
  }
  for (const o of rows) {
    const p = o.parent_id ? byId[o.parent_id] : null;
    if (p) (p.children = p.children || []).push(byId[o.id]);
    else top.push(byId[o.id]);
  }
  return top;
};
// (k, j) rows -> { <k>: [row, ...] }; children grouped under their parent's id
const rvKinds = (v) => {
  const out = {};
  for (const r of rvList(v)) if (r && r.k && r.j !== undefined && r.j !== null) (out[r.k] = out[r.k] || []).push(rvObj(r));
  return out;
};
const rvGroup = (rows, fk) => {
  const out = {};
  for (const r of rows || []) (out[rvS(r[fk])] = out[rvS(r[fk])] || []).push(r);
  return out;
};
const rvNest = (parents, children, fk, as) => {
  const by = rvGroup(children, fk);
  return (parents || []).map((p) => Object.assign({}, p, { [as]: rvTree(by[rvS(p.id)] || [], fk) }));
};
// a handling unit in the receipt's chain (grRvPrep's live rows / packaging deductions): those receipts stay with the classic
const rvHasHu = (prep) => rvList(prep.liveRows).some((r) => rvS(r.handling_unit_id) !== "") || rvList(prep.huOutRows).length > 0;
const rvGet = (row) => (row ? { count: 1, data: row } : { count: 0, data: {} });
const rvSearch = (rows) => ({ total: rows.length, count: rows.length, data: rows });

// round 1 / SUBMIT: the receipt as get_node_grRvGr reads it (its lines nested in table_gr; serial receipts are not V2's, so
// table_sn_records is empty), its movements (sql_node_grRvMovs), its putaways with their lines and records, inspection
// lots, in-transit rows, batches (the search nodes), its latest lock; serialLines = lines whose item is serial-managed
const rvAdapt1 = function rvAdapt1(S) {
  const hdr = rvRows(S.hdr).map(rvObj)[0] || null;
  const lineRows = rvRows(S.lines);
  const lines = lineRows.map(rvObj);
  if (hdr) {
    hdr.table_gr = rvTree(lines, "goods_receiving_id");
    hdr.table_sn_records = [];
  }
  const to = rvKinds(S.putaway);
  const putaway = rvNest(rvNest(to.TO, to.TOL, "transfer_order_putaway_id", "table_putaway_item"), to.TOR, "transfer_order_putaway_id", "table_putaway_records");
  const lock = rvList(S.lock).filter((r) => r && r.step_name)[0] || null;
  return {
    gr: rvGet(hdr), hdr: hdr, lines: lines, serialLines: lineRows.filter((r) => Number(r.sn) === 1).length, movs: rvSql(S.movs),
    putaway: rvSearch(putaway), qi: rvSearch(rvRows(S.qi).map(rvObj)), transit: rvSearch(rvRows(S.transit).map(rvObj)),
    batches: rvSearch(rvRows(S.batches).map(rvObj)), lock: lock,
  };
};

// round 2: grRvBuild's reads - the classic's sql-nodes (later, fifo, wa, costcounts) and search nodes (invoices, balances,
// handling units with table_hu_items, purchase orders with table_po, on-order rows, items with table_uom_conversion)
const rvAdapt2 = function rvAdapt2(S) {
  const hu = rvKinds(S.hu);
  const po = rvKinds(S.po);
  const it = rvKinds(S.items);
  return {
    later: rvSql(S.later), fifo: rvSql(S.fifo), wa: rvSql(S.wa), costcounts: rvSql(S.costcounts),
    pi: rvSearch(rvRows(S.pi).map(rvObj)), bbal: rvSearch(rvRows(S.bbal).map(rvObj)), ibal: rvSearch(rvRows(S.ibal).map(rvObj)),
    hu: rvSearch(rvNest(hu.HU, hu.HUI, "handling_unit_id", "table_hu_items")), po: rvSearch(rvNest(po.PO, po.POL, "purchase_order_id", "table_po")),
    oo: rvSearch(rvRows(S.oo).map(rvObj)), items: rvSearch(rvNest(it.I, it.U, "Item_id", "table_uom_conversion")),
  };
};
