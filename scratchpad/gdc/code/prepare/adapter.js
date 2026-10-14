// GD Completion V2 - SQL rows -> the exact shapes the deployed get/search/sql nodes hand on (verified against recorded
// dev runs): ids exact strings, numbers as numbers, JSON columns parsed, null and "" keys absent; top-level rows keep their
// system columns, nested subform rows drop them; rows in id order; get-node empty = {count:0,data:{}}.
const gcParse = (t) =>
  JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const gcStrip = (v) => {
  if (Array.isArray(v)) return v.map(gcStrip);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) if (v[k] !== null && v[k] !== undefined && v[k] !== "") o[k] = gcStrip(v[k]);
    return o;
  }
  return v;
};
// sql-node rows keep "" (only null is dropped)
const gcStripNull = (v) => {
  if (Array.isArray(v)) return v.map(gcStripNull);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) if (v[k] !== null && v[k] !== undefined) o[k] = gcStripNull(v[k]);
    return o;
  }
  return v;
};
const gcRows = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((r) => r && r.j);
const gcObj = (r) => gcStrip(gcParse(r.j));
const GC_NESTED_DROP = ["create_user", "create_dept", "create_time", "update_user", "update_time", "tenant_id", "is_deleted", "sub_tenant_id"];
const gcNestedRow = (o, fk) => {
  const r = Object.assign({}, o);
  for (const k of GC_NESTED_DROP.concat([fk])) delete r[k];
  return r;
};
// flat subform rows (with parent_id) -> top-level rows carrying `children`, in id order
const gcTree = (rows, fk) => {
  const top = [];
  const byId = {};
  for (const o of rows) byId[o.id] = gcNestedRow(o, fk);
  for (const o of rows) {
    const r = byId[o.id];
    const p = o.parent_id ? byId[o.parent_id] : null;
    if (p) (p.children = p.children || []).push(r);
    else top.push(r);
  }
  return top;
};
const gcGet = (row) => (row ? { count: 1, data: row } : { count: 0, data: {} });
const gcSearch = (rows) => ({ total: rows.length, count: rows.length, data: rows });

const gcAdapt = function gcAdapt(S) {
  const hdr = gcRows(S.hdr).map(gcObj)[0] || null;
  const lines = gcRows(S.lines).map(gcObj);
  if (hdr) {
    hdr.table_gd = gcTree(lines, "goods_delivery_id");
    hdr.table_insufficient = [];
    hdr.table_item_balance = [];
  }
  const setup = { PICK: [], PACK: [] };
  for (const r of gcRows(S.setup)) (setup[r.k] = setup[r.k] || []).push(gcObj(r));
  const items = gcRows(S.items).map((r) => gcParse(r.j));
  const flags = items
    .filter((i) => String(i.organization_id) === String(S.organizationId))
    .map((i) => gcStripNull({ id: i.id, material_code: i.material_code, stock_control: i.stock_control, show_delivery: i.show_delivery, uom_conversion_json: i.uom_flags }));
  // sql_node_ItemDatas joins from the material list in first-appearance order (code_node_SSWylCan walks the flat rows)
  const firstSeen = {};
  lines.forEach((l, n) => {
    if (l.material_id && firstSeen[l.material_id] === undefined) firstSeen[l.material_id] = n;
  });
  const byAppearance = items.slice().sort((a, b) => (firstSeen[a.id] ?? 1e9) - (firstSeen[b.id] ?? 1e9));
  const datas = byAppearance.map((i) =>
    gcStripNull({
      id: i.id,
      material_code: i.material_code,
      material_name: i.material_name,
      material_desc: i.material_desc,
      item_batch_management: i.item_batch_management,
      stock_control: i.stock_control,
      based_uom: i.based_uom,
      material_costing_method: i.material_costing_method,
      purchase_unit_price: i.purchase_unit_price,
      uom_conversion_json: i.uom_datas,
    }),
  );
  // SO lines come projected to the columns the SO nodes read (prepare/sql.py): the search shape is the GD's lines' rows,
  // table_so every line of each header
  const soHdrs = gcRows(S.soh).map(gcObj);
  const soHdrLines = gcRows(S.sohl).map(gcObj);
  for (const h of soHdrs) h.table_so = gcTree(soHdrLines.filter((l) => l.sales_order_id === h.id), "sales_order_id");
  const gdSoLines = {};
  for (const l of lines) if (l.so_line_item_id) gdSoLines[l.so_line_item_id] = true;
  const pickings = gcRows(S.top).map(gcObj);
  const records = gcRows(S.topr).map(gcObj);
  for (const p of pickings) p.table_picking_records = records.filter((r) => r.transfer_order_id === p.id).map((r) => gcNestedRow(r, "transfer_order_id"));
  return {
    gd: gcGet(hdr),
    pickingSetup: gcGet(setup.PICK[0] || null),
    packingSetup: gcGet(setup.PACK[0] || null),
    linkage: gcSearch(gcRows(S.link).map(gcObj)),
    itemFlags: flags,
    serialItems: items.filter((i) => Number(i.serial_number_management) === 1).map((i) => String(i.id)),
    itemDatas: datas,
    soLines: gcSearch(soHdrLines.filter((l) => gdSoLines[l.id])),
    soHeaders: gcSearch(soHdrs),
    allocated: gcSearch(gcRows(S.alloc).map(gcObj)),
    pending: gcSearch(gcRows(S.pend).map(gcObj)),
    pickings: gcSearch(pickings),
  };
};
