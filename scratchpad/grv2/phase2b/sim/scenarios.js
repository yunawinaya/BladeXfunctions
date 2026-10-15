// Synthetic end-to-end scenarios on the built JSON (in-memory DB, SQL mocks = the dev-checked statements' semantics).
const { MeterEngine } = require("./meter");
const { GrDB, mocks } = require("./grdb");

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? "ok   " : "FAIL ") + label + (ok ? "" : "\n      got  " + JSON.stringify(got) + "\n      want " + JSON.stringify(want)));
};
const truthy = (label, v) => eq(label, Boolean(v), true);

const ORG = "1901545950162329602";
const PLANT = "2064224775555371009";
const UOM = "2021056571405717508";
let seq = 7000000000000000000n;
const nid = () => (seq += 1n).toString();

// ------------------------------------------------------------------------------------------------ fixtures
function seedPO(db, lines, opts) {
  const o = Object.assign({ gr_status: null }, opts || {});
  const po = { id: nid(), is_deleted: 0, gr_status: o.gr_status, po_status: "Issued", purchase_order_no: "PO/" + db.t.po.length };
  db.t.po.push(po);
  const out = lines.map((l) => {
    const r = Object.assign({ id: nid(), purchase_order_id: po.id, parent_id: null, is_deleted: 0, quantity: 10, received_qty: 0,
                              created_received_qty: 0, item_bundle_id: null, item_id: null }, l);
    db.t.pol.push(r);
    return r;
  });
  return { po, lines: out };
}
function seedItem(db, tol) {
  const it = { id: nid(), is_deleted: 0 };
  db.t.items.push(it);
  db.t.uom.push({ item_id: it.id, alt_uom_id: UOM, over_receive_tolerance: tol || 0, is_deleted: 0 });
  return it;
}
function grLine(pl, item, qty, extra) {
  return Object.assign({ item_id: item ? item.id : null, item_name: "Item " + pl.id.slice(-3), received_qty: qty, ordered_qty: pl.quantity,
                         ordered_qty_uom: UOM, base_received_qty: qty, to_received_qty: 0, po_line_item_id: pl.id, line_po_id: pl.purchase_order_id,
                         line_po_no: "PO", location_id: "BIN1", inv_category: "Unrestricted", item_batch_no: "-", is_split: "No",
                         parent_or_child: "Parent", unit_price: 1, total_price: qty }, extra || {});
}
function allData(lines, extra) {
  return Object.assign({ id: "", gr_no: "", gr_no_type: "2000000000000000001", gr_date: "2026-10-14", plant_id: PLANT, organization_id: ORG,
                         supplier_name: "2000000000000000009", previous_status: "", gr_status: "", table_gr: lines, purchase_order_number: "PO",
                         dialog_select_item: { item_array: [] } }, extra || {});
}
function storeGR(db, status, lines, gr_no) {
  const g = { id: nid(), is_deleted: 0, gr_status: status, gr_no: gr_no || (status === "Draft" ? "Draft-GR-1" : "GR/0001"), tenant_id: db.tenantId };
  db.t.gr.push(g);
  db.writeGrLines(g.id, lines);
  return g;
}
const run = (db, params, faults) => {
  const e = new MeterEngine({ db, mocks: mocks(), faults });
  const out = e.run("GR_CREATED", Object.assign({ saveAs: "Created", continueZero: "", continueOvercommit: "" }, params));
  return { r: out.returned, e, ctx: out.ctx };
};
const cancel = (db, params) => new MeterEngine({ db, mocks: mocks() }).run("GR_CANCEL_CREATED", params).returned;
const pol = (db, id) => db.t.pol.find((p) => p.id === id);
const created = (db, id) => Number(pol(db, id).created_received_qty);
const poOf = (db, id) => db.t.po.find((p) => p.id === id);
const lineWrites = (db) => db.writes.filter((w) => w.table === "Item Table(Purchase Order)");
const live = (db) => db.t.gr.filter((g) => !g.is_deleted);

// ================================================================================================ GR_CREATED
console.log("--- GR_CREATED");
{
  // 1. Add: 2 lines on one PO -> reserved by id, 8-dp strings, PO Created
  const db = new GrDB();
  const it = seedItem(db);
  const { po, lines } = seedPO(db, [{ quantity: 10 }, { quantity: 5, created_received_qty: 2 }]);
  const { r } = run(db, { allData: allData([grLine(lines[0], it, 4), grLine(lines[1], it, 3)]), pageStatus: "Add" });
  eq("add: 200 + message", [r.code, r.message], ["200", "Goods Receiving saved as Created successfully."]);
  eq("add: reservations", [created(db, lines[0].id), created(db, lines[1].id)], [4, 5]);
  eq("add: written as 8-dp strings, only created_received_qty", lineWrites(db)[0].rows.map((x) => Object.keys(x).sort().join(",") + "=" + x.created_received_qty),
     ["__id,created_received_qty,id=4.00000000", "__id,created_received_qty,id=5.00000000"]);
  eq("add: PO gr_status Created", poOf(db, po.id).gr_status, "Created");
  eq("add: one GR, number issued, status Created", live(db).map((g) => [g.gr_status, /^GR\/SIM/.test(g.gr_no), g.gr_idem_key, "grn_uuid" in g]), [["Created", true, null, false]]);
  eq("add: answer carries the new id", r.id, live(db)[0].id);
  const add = db.writes.find((w) => w.table === "Goods Receiving").rows[0];
  eq("add: no dialog models / no extra columns written", Object.keys(add).filter((k) => /dialog|split_dialog|hu_dialog/.test(k)), []);
}
{
  // 2. idempotency: retry with the same key returns the first GR, writes nothing; another key is a new GR
  const db = new GrDB();
  const it = seedItem(db);
  const { lines } = seedPO(db, [{ quantity: 10 }]);
  const p = { allData: allData([grLine(lines[0], it, 4)]), pageStatus: "Add", idempotency_key: "GRC:" + ORG + ":k1abcdef" };
  const a = run(db, JSON.parse(JSON.stringify(p))).r;
  const nWrites = db.writes.length;
  const b = run(db, JSON.parse(JSON.stringify(p))).r;
  eq("key: first 200, answer id = the add-node's exact id", [a.code, a.id], ["200", live(db)[0].id]);
  eq("key: retry 200 duplicate, same id", [b.code, b.duplicate, b.id], ["200", "YES", a.id]);
  eq("key: retry message", b.message, "Goods Receiving " + live(db)[0].gr_no + " was already saved as Created.");
  eq("key: retry wrote nothing", db.writes.length, nWrites);
  eq("key: one GR, reserved once", [live(db).length, created(db, lines[0].id)], [1, 4]);
  eq("key: stored on gr_idem_key as key#<run uuid>; grn_uuid untouched", [live(db)[0].gr_idem_key.startsWith(p.idempotency_key + "#") && live(db)[0].gr_idem_key.length > p.idempotency_key.length + 1, "grn_uuid" in live(db)[0]], [true, false]);
  const c = run(db, Object.assign(JSON.parse(JSON.stringify(p)), { idempotency_key: "GRC:" + ORG + ":k2abcdef" })).r;
  eq("key: a new key is a new GR", [c.code, live(db).length, created(db, lines[0].id)], ["200", 2, 8]);
  const d = run(db, Object.assign(JSON.parse(JSON.stringify(p)), { idempotency_key: "bad key'; --", continueOvercommit: "Yes" })).r;
  eq("key: a malformed key is ignored (no lookup, gr_idem_key null)", [d.code, live(db).length, live(db)[2].gr_idem_key], ["200", 3, null]);
  // a twin that started before the first one wrote: its lookup saw nothing, it adds, then finds the older GR and removes itself
  const db2 = new GrDB();
  const it2 = seedItem(db2);
  const s2 = seedPO(db2, [{ quantity: 10 }]);
  const p2 = { allData: allData([grLine(s2.lines[0], it2, 4)]), pageStatus: "Add", idempotency_key: "GRC:twin:000000001" };
  const first = run(db2, JSON.parse(JSON.stringify(p2))).r;
  const m = mocks();
  m.sql.sql_node_GcKeyHit = () => []; // the twin's pre-check ran before the first add committed
  const twin = new MeterEngine({ db: db2, mocks: m }).run("GR_CREATED", Object.assign({ saveAs: "Created", continueZero: "", continueOvercommit: "" },
    JSON.parse(JSON.stringify(p2)))).returned;
  eq("twin: answered with the first GR", [twin.code, twin.duplicate, twin.id], ["200", "YES", first.id]);
  eq("twin: its own GR soft-deleted, reservation once", [live(db2).length, db2.t.gr.length, created(db2, s2.lines[0].id)], [1, 2, 4]);
}
{
  // 2b. if the add-node hands back the new id as a NUMBER (19 digits do not survive that), the answer never carries a
  // wrong id: no key -> no id; with a key -> the exact id read back by the key mark
  const db = new GrDB();
  const it = seedItem(db);
  const { lines } = seedPO(db, [{ quantity: 10 }]);
  const ins = db.insert.bind(db);
  db.insert = (table, rows) => ins(table, rows).map((r) => Object.assign({}, r, { id: Number(r.id) }));
  const a = run(db, { allData: allData([grLine(lines[0], it, 1)]), pageStatus: "Add" }).r;
  eq("numeric add id, no key: answer id left empty", [a.code, a.id], ["200", ""]);
  const b = run(db, { allData: allData([grLine(lines[0], it, 1)]), pageStatus: "Add", idempotency_key: "GRC:num:00000001" }).r;
  eq("numeric add id, with key: exact id from the read-back", [b.code, b.id], ["200", live(db)[1].id]);
  eq("numeric add id: nothing removed, both reserved", [live(db).length, created(db, lines[0].id)], [2, 2]);
}
{
  // 3. Edit of a stored Draft: reserves the whole quantity (the old code subtracted the Draft's own lines: nothing reserved)
  const db = new GrDB();
  const it = seedItem(db);
  const { po, lines } = seedPO(db, [{ quantity: 10, created_received_qty: 3 }]);
  const draft = storeGR(db, "Draft", [grLine(lines[0], it, 4)]);
  const { r } = run(db, { allData: allData([grLine(lines[0], it, 4)], { id: draft.id, gr_no: "Draft-GR-1", previous_status: "Created" }), pageStatus: "Edit" });
  eq("draft->created: 200", r.code, "200");
  eq("draft->created: reserves 4 on top of the 3 others hold", created(db, lines[0].id), 7);
  eq("draft->created: rule number issued from the STORED Draft (client said Created)", /^GR\/SIM/.test(db.t.gr[0].gr_no), true);
  eq("draft->created: status Created, PO Created", [db.t.gr[0].gr_status, poOf(db, po.id).gr_status], ["Created", "Created"]);
  // the over-commit check counts what OTHER GRs hold (the old one subtracted the Draft's own qty from it)
  const db2 = new GrDB();
  const it2 = seedItem(db2);
  const s2 = seedPO(db2, [{ quantity: 10, created_received_qty: 8 }]);
  const d2 = storeGR(db2, "Draft", [grLine(s2.lines[0], it2, 4)]);
  const r2 = run(db2, { allData: allData([grLine(s2.lines[0], it2, 4)], { id: d2.id, previous_status: "Draft" }), pageStatus: "Edit" }).r;
  eq("draft->created over-commit: 402 (8 held by others + 4 > 10)", [r2.code, /committed total 12 would exceed PO max 10/.test(r2.message)], ["402", true]);
  const r3 = run(db2, { allData: allData([grLine(s2.lines[0], it2, 4)], { id: d2.id, previous_status: "Draft" }), pageStatus: "Edit", continueOvercommit: "Yes" }).r;
  eq("draft->created over-commit confirmed: 200, 12 reserved", [r3.code, created(db2, s2.lines[0].id)], ["200", 12]);
}
{
  // 4. Edit of a stored Created GR: qty changed, a line added, a whole PO dropped (its reservation released, status recomputed)
  const db = new GrDB();
  const it = seedItem(db);
  const A = seedPO(db, [{ quantity: 10, created_received_qty: 10 }, { quantity: 10 }]);
  const B = seedPO(db, [{ quantity: 5, received_qty: 5, created_received_qty: 0 }, { quantity: 5, created_received_qty: 2 }], { gr_status: "Created" });
  const g = storeGR(db, "Created", [grLine(A.lines[0], it, 10), grLine(B.lines[1], it, 2)], "GR/0100");
  const { r } = run(db, { allData: allData([grLine(A.lines[0], it, 7), grLine(A.lines[1], it, 1)], { id: g.id, gr_no: "GR/0100", previous_status: "Created" }),
                          pageStatus: "Edit" });
  eq("edit created: 200", r.code, "200");
  eq("edit created: 10->7, +1 new line, dropped PO line released 2->0",
     [created(db, A.lines[0].id), created(db, A.lines[1].id), created(db, B.lines[1].id)], [7, 1, 0]);
  eq("edit created: kept PO Created, dropped PO recomputed (line 1 fully received, line 2 untouched)",
     [poOf(db, A.po.id).gr_status, poOf(db, B.po.id).gr_status], ["Created", "Partially Received"]);
  eq("edit created: keeps its number", db.t.gr[0].gr_no, "GR/0100");
  // the same save again (lost answer, user clicks again): nothing moves twice
  run(db, { allData: allData([grLine(A.lines[0], it, 7), grLine(A.lines[1], it, 1)], { id: g.id, gr_no: "GR/0100", previous_status: "Created" }), pageStatus: "Edit" });
  eq("edit created: a repeated save reserves nothing twice", [created(db, A.lines[0].id), created(db, A.lines[1].id)], [7, 1]);
  // a stale form: it still says previous_status Draft and shows the Draft number - the stored number is kept, no re-issue
  const before = created(db, A.lines[0].id);
  run(db, { allData: allData([grLine(A.lines[0], it, 7), grLine(A.lines[1], it, 1)], { id: g.id, gr_no: "Draft-GR-9", previous_status: "Draft" }), pageStatus: "Edit" });
  eq("stale Draft form on a Created GR: stored number kept, no double reservation", [db.t.gr[0].gr_no, created(db, A.lines[0].id)], ["GR/0100", before]);
}
{
  // 5. refusals on the stored status / identity
  const db = new GrDB();
  const it = seedItem(db);
  const { lines } = seedPO(db, [{ quantity: 10 }]);
  const mk = (st) => storeGR(db, st, [grLine(lines[0], it, 1)], "GR/X" + st);
  const ed = (g) => run(db, { allData: allData([grLine(lines[0], it, 1)], { id: g ? g.id : "123", previous_status: "Created" }), pageStatus: "Edit" }).r;
  eq("refuse: Processing (Phase 0 text)", [ed(mk("Processing")).code, ed(mk("Processing")).message],
     ["400", "This Goods Receiving is being processed in the background - please wait for it to finish."]);
  eq("refuse: Received", ed(mk("Received")).message, "Goods Receiving GR/XReceived cannot be saved as Created: it is Received now.");
  eq("refuse: Completed", ed(mk("Completed")).code, "400");
  eq("refuse: Cancelled", ed(mk("Cancelled")).code, "400");
  eq("refuse: not found", ed(null).message, "Goods Receiving not found - it may already have been deleted.");
  const g = mk("Created");
  g.is_deleted = 1;
  eq("refuse: deleted", ed(g).code, "400");
  eq("refuse: nothing reserved by any refusal", created(db, lines[0].id), 0);
  const bad = run(db, { allData: allData([grLine(lines[0], it, 1)], { id: "12; DROP" }), pageStatus: "Edit" }).r;
  eq("refuse: an Edit with a malformed id", [bad.code, bad.message], ["400", "Goods Receiving not found - it may already have been deleted."]);
}
{
  // 6. the gates keep their codes and texts
  const db = new GrDB();
  const it = seedItem(db);
  const it30 = seedItem(db, 30);
  const { lines } = seedPO(db, [{ quantity: 10 }, { quantity: 10 }, { quantity: 10 }]);
  const z = run(db, { allData: allData([grLine(lines[0], it, 0), grLine(lines[1], it, 2), grLine(lines[2], it, 0)]), pageStatus: "Add" }).r;
  eq("zero: 401 + text", [z.code, z.message], ["401", "Lines #1, #3 have a zero received quantity.\nIf you proceed, those rows will be removed.\nWould you like to proceed?"]);
  const z2 = run(db, { allData: allData([grLine(lines[0], it, 0), grLine(lines[1], it, 2)]), pageStatus: "Add", continueZero: "Yes" }).r;
  eq("zero confirmed: 200, zero row dropped", [z2.code, live(db).length, created(db, lines[1].id), created(db, lines[0].id)], ["200", 1, 2, 0]);
  const inv = run(db, { allData: allData([grLine(lines[0], it, 0)]), pageStatus: "Add", continueZero: "Yes" }).r;
  eq("all zero: 400 text", [inv.code, inv.message], ["400", "All Received Quantity must not be 0. Please add at least one item with received quantity > 0."]);
  const v = run(db, { allData: allData([grLine(lines[0], it, 1, { location_id: "", item_batch_no: "" })], { gr_date: "" }), pageStatus: "Add" }).r;
  eq("required: 400 text", [v.code, v.message], ["400", "Received Date is required.\nTarget Location is required for item #1.\nBatch Number is required for item #1."]);
  const q = run(db, { allData: allData([grLine(lines[0], it, 11)]), pageStatus: "Add" }).r;
  eq("over-receive: 400 text", [q.code, q.message],
     ["400", "Cannot save - quantity exceeds purchase order:\nItem " + lines[0].id.slice(-3) + ": receiving 11 exceeds remaining receivable 10 (Ordered 10, Already received 0)."]);
  const t = run(db, { allData: allData([grLine(lines[2], it30, 12)]), pageStatus: "Add" }).r;
  eq("over-receive within the item's 30% tolerance: 200", t.code, "200");
  const nothing = created(db, lines[0].id);
  eq("no reservation by any refused gate", nothing, 0);
}
{
  // 7. size cap 2,000 (bundle items counted), and 2,000 lines saved with slices of 250
  const db = new GrDB();
  const it = seedItem(db);
  const { lines } = seedPO(db, Array.from({ length: 2000 }, () => ({ quantity: 10 })));
  const big = run(db, { allData: allData(lines.map((l) => grLine(l, it, 1))), pageStatus: "Add" });
  eq("2000 lines: 200", big.r.code, "200");
  eq("2000 lines: 8 slices of <= 250", lineWrites(db).map((w) => w.rows.length), [250, 250, 250, 250, 250, 250, 250, 250]);
  eq("2000 lines: every line reserved", lines.every((l) => created(db, l.id) === 1), true);
  const tooMany = seedPO(db, Array.from({ length: 2001 }, () => ({ quantity: 10 }))).lines;
  const r1 = run(db, { allData: allData(tooMany.map((l) => grLine(l, it, 1))), pageStatus: "Add" }).r;
  eq("2001 lines: 400 text", [r1.code, r1.message],
     ["400", "This Goods Receiving has 2001 lines. A save of more than 2000 lines is not supported here - please split it into smaller receipts."]);
  const rows = tooMany.slice(0, 1999).map((l) => grLine(l, it, 1));
  rows[0].children = [grLine(tooMany[1999], it, 1), grLine(tooMany[2000], it, 1)];
  eq("1999 rows + 2 bundle items = 2001: refused", run(db, { allData: allData(rows), pageStatus: "Add" }).r.code, "400");
}
{
  // 8. bundles + splits: the bundle row and its items reserve on their own PO lines; a hierarchy split parent is not counted
  const db = new GrDB();
  const it = seedItem(db);
  const s = seedPO(db, [{ quantity: 2, item_bundle_id: "2085651083336548353" }, { quantity: 4, item_bundle_id: "2085651083336548353", item_id: it.id }, { quantity: 6, item_bundle_id: "2085651083336548353", item_id: it.id },
                        { quantity: 10 }]);
  const bundle = grLine(s.lines[0], null, 2, { item_bundle_id: "2085651083336548353", item_id: null, location_id: "", inv_category: "", item_batch_no: "" });
  bundle.children = [grLine(s.lines[1], it, 4, { item_bundle_id: "2085651083336548353" }), grLine(s.lines[2], it, 0, { item_bundle_id: "2085651083336548353" })];
  const parent = grLine(s.lines[3], it, 5, { is_split: "Yes", parent_or_child: "Parent" });
  const kids = [grLine(s.lines[3], it, 3, { parent_or_child: "Child" }), grLine(s.lines[3], it, 2, { parent_or_child: "Child" })];
  const r = run(db, { allData: allData([bundle, parent, ...kids]), pageStatus: "Add", continueZero: "Yes" }).r;
  eq("bundle/split: 200", r.code, "200");
  eq("bundle/split: bundle 2, item 4, zero item none, split total 5 (parent not counted)",
     s.lines.map((l) => created(db, l.id)), [2, 4, 0, 5]);
  const g = db.t.gr.find((x) => !x.is_deleted);
  eq("bundle/split: the zero bundle item dropped, the bundle kept", db.t.grl.filter((l) => l.goods_receiving_id === g.id && !l.is_deleted).length, 5);
}
{
  // 9. many distinct items: every item's tolerance is read by the one SQL (no per-item read)
  const db = new GrDB();
  const items = Array.from({ length: 150 }, () => seedItem(db, 30));
  const { lines } = seedPO(db, items.map(() => ({ quantity: 10 })));
  const r = run(db, { allData: allData(lines.map((l, i) => grLine(l, items[i], i === 149 ? 12 : 1))), pageStatus: "Add" }).r;
  eq("150 distinct items: the 150th gets its own 30 % (12 of 10 allowed)", r.code, "200");
}
{
  // 10. 8 dp: 0.12345678 reserved as is (3 dp before), client float residue normalised
  const db = new GrDB();
  const it = seedItem(db);
  const { lines } = seedPO(db, [{ quantity: 10, created_received_qty: 0.1 }]);
  const r = run(db, { allData: allData([grLine(lines[0], it, 0.12345678, { to_received_qty: "2032.3799999999997", unit_price: 0.7504999999999999 })]), pageStatus: "Add" }).r;
  eq("8dp: reserved 0.22345678", lineWrites(db)[0].rows[0].created_received_qty, "0.22345678");
  const add = db.writes.find((w) => w.table === "Goods Receiving").rows[0].table_gr[0];
  eq("decimals normalised (q8)", [add.to_received_qty, add.unit_price, add.received_qty], [2032.38, 0.7505, 0.12345678]);
  eq("8dp: 200", r.code, "200");
}
{
  // 11. a GR line whose PO line is gone: no reservation, no error (as before)
  const db = new GrDB();
  const it = seedItem(db);
  const { lines } = seedPO(db, [{ quantity: 10 }]);
  lines[0].is_deleted = 1;
  const r = run(db, { allData: allData([grLine(lines[0], it, 1)]), pageStatus: "Add" }).r;
  eq("deleted PO line: 200, nothing written on PO", [r.code, lineWrites(db).length, db.writes.filter((w) => w.table === "Purchase Order").length], ["200", 0, 0]);
}

// ================================================================================================ GR_CANCEL_CREATED
console.log("--- GR_CANCEL_CREATED");
{
  // 1. cancel: release by id from the STORED lines, stamp the STORED number, PO status rule
  const db = new GrDB();
  const it = seedItem(db);
  const A = seedPO(db, [{ quantity: 10, received_qty: 10, created_received_qty: 0 }, { quantity: 10, created_received_qty: 4 }], { gr_status: "Created" });
  const B = seedPO(db, [{ quantity: 5, created_received_qty: 5 }], { gr_status: "Created" });
  const C = seedPO(db, [{ quantity: 8, created_received_qty: 6 }], { gr_status: "Created" });
  const g = storeGR(db, "Created", [grLine(A.lines[1], it, 4), grLine(B.lines[0], it, 5), grLine(C.lines[0], it, 3)], "GR/0200");
  const r = cancel(db, { action: "cancel", gr_id: g.id, gr_no: "", po_id: [] });
  eq("cancel: 200 Cancelled", [r.code, r.message], ["200", "Cancelled"]);
  eq("cancel: released by id", [created(db, A.lines[1].id), created(db, B.lines[0].id), created(db, C.lines[0].id)], [0, 0, 3]);
  eq("cancel: only created_received_qty written", lineWrites(db)[0].rows.map((x) => Object.keys(x).sort().join(",")), ["__id,created_received_qty,id", "__id,created_received_qty,id", "__id,created_received_qty,id"]);
  eq("cancel: GR Cancelled with the stored number suffixed (request gr_no / po_id empty)", [db.t.gr[0].gr_status, db.t.gr[0].gr_no], ["Cancelled", "GR/0200-Cancelled"]);
  eq("cancel: PO status - fully received line + untouched line -> Partially Received (was Cancelled); nothing -> Cancelled; other GR -> Created",
     [poOf(db, A.po.id).gr_status, poOf(db, B.po.id).gr_status, poOf(db, C.po.id).gr_status], ["Partially Received", "Cancelled", "Created"]);
  eq("cancel: the GR stamp is written before the PO lines", db.writes.map((w) => w.table)[0], "Goods Receiving");
  // a repeat is refused by the stored status: nothing released twice
  const again = cancel(db, { action: "cancel", gr_id: g.id, gr_no: "GR/0200", po_id: [] });
  eq("cancel again: 400, nothing moved", [again.code, created(db, C.lines[0].id)], ["400", 3]);
}
{
  // 2. all lines received -> Fully Received; bundle items + split parent; clamp at 0
  const db = new GrDB();
  const it = seedItem(db);
  const s = seedPO(db, [{ quantity: 2, received_qty: 2, item_bundle_id: "2085651083336548354", created_received_qty: 2 }, { quantity: 4, received_qty: 0, item_bundle_id: "2085651083336548354", item_id: it.id, created_received_qty: 4 },
                        { quantity: 5, received_qty: 5, created_received_qty: 1 }]);
  const bundle = grLine(s.lines[0], null, 2, { item_bundle_id: "2085651083336548354", item_id: null });
  bundle.children = [grLine(s.lines[1], it, 4, { item_bundle_id: "2085651083336548354" })];
  const split = [grLine(s.lines[2], it, 3, { is_split: "Yes", parent_or_child: "Parent" }), grLine(s.lines[2], it, 3, { parent_or_child: "Child" })];
  const g = storeGR(db, "Created", [bundle, ...split]);
  const r = cancel(db, { action: "cancel", gr_id: g.id, gr_no: g.gr_no, po_id: [s.po.id] });
  eq("cancel bundle/split: 200", r.code, "200");
  eq("cancel bundle/split: bundle 2->0, item 4->0, split counted once (3, clamped 1->0)", s.lines.map((l) => created(db, l.id)), [0, 0, 0]);
  eq("cancel: bundle items are not counted for the status (bundle line received in full)", poOf(db, s.po.id).gr_status, "Fully Received");
}
{
  // 3. refusals (Phase 0 gate) and delete
  const db = new GrDB();
  const g1 = storeGR(db, "Draft", []);
  const g2 = storeGR(db, "Created", []);
  const g3 = storeGR(db, "Processing", []);
  eq("delete Draft: 200, soft delete", [cancel(db, { action: "delete", gr_id: g1.id }).code, db.t.gr[0].is_deleted], ["200", 1]);
  eq("delete Created: refused", cancel(db, { action: "delete", gr_id: g2.id }).code, "400");
  eq("cancel Processing: refused", cancel(db, { action: "cancel", gr_id: g3.id }).message,
     "Goods Receiving " + g3.gr_no + " is being processed in the background - please wait for it to finish.");
  eq("cancel deleted GR: refused", cancel(db, { action: "cancel", gr_id: g1.id }).code, "400");
}
{
  // 4. 2,000 lines: 8 slices
  const db = new GrDB();
  const it = seedItem(db);
  const { lines } = seedPO(db, Array.from({ length: 2000 }, () => ({ quantity: 10, created_received_qty: 1 })));
  const g = storeGR(db, "Created", lines.map((l) => grLine(l, it, 1)));
  const r = cancel(db, { action: "cancel", gr_id: g.id, gr_no: g.gr_no });
  eq("cancel 2000: 200, 8 slices, all released", [r.code, lineWrites(db).map((w) => w.rows.length).join(","), lines.every((l) => created(db, l.id) === 0)],
     ["200", "250,250,250,250,250,250,250,250", true]);
}
console.log("\nfailures:", fails);
process.exit(fails ? 1 : 0);
