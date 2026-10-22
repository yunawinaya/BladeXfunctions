// RES-01 MIN-06 (BA 10-22): a live unsaved-changes marker. A Created IA's reservation row says "Unsaved changes: not reserved until
// saved." while the form's reservation inputs (each line's id, item, unit, picks; the plant) differ from what it opened with, and drops it
// when they match again. onFormChange checks 400 ms after the newest change; display-only fields never count; a Draft has no marker.
//   node scratchpad/iasc/client/test/test_res_dirty.js
const H = require("./harness");
const F = require("./fixture");
const { check, same } = H;

const SHIPPED = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const ON = H.resVariant(SHIPPED, true);
const MARK = " · Unsaved changes: not reserved until saved.";
const pk = (qty, o) => Object.assign({ location_id: "L0", batch_id: null, sm_quantity: qty, category: "Unrestricted" }, o || {});
const ln = (id, item, picks) => ({ id: id, item_selection: item, item_name: item, quantity_uom: F.EA, requested_qty: 6, required_qty: 6,
  total_quantity: picks.reduce((s, p) => s + p.sm_quantity, 0), temp_qty_data: JSON.stringify(picks), temp_hu_data: "" });
const ia = (status, o) => F.header(Object.assign({ id: "4001", page_status: "Edit", item_assembly_status: status, material_hold_status: "FULL",
  material_hold_at: "2026-10-22 15:00:00", stock_movement: [ln("5001", "C2", [pk(6)]), ln("5002", "C1", [pk(4)])] }, o || {}));
const open = async (values, flags) => {
  const w = H.world({ db: H.tableDb(Object.assign(F.tables(), { on_reserved_gd: [] })) });
  w.so = F.so();
  const self = H.makeThis(w, ON, Object.assign({ values: H.clone(values), stateful: true, answer: F.answer(w, H.SC_TEST_IDS, () => ({ data: { code: "200", message: "ok" } })) },
    flags || { isEdit: true }));
  const e = H.byName(ON, "mounted");
  H.compile(w, H.sourceOf(e), e.type === "rule").call(self);
  await H.drain(w);
  return { w: w, self: self };
};
const change = async (o, edit) => {
  if (edit) edit(o.self.values);
  const e = H.byName(ON, "onFormChange");
  H.compile(o.w, e.func, false).call(o.self);
  await H.drain(o.w);
};
const row = (o) => o.self.values.res_summary || "";
const rowWrites = (o) => o.w.trace.filter((t) => /setData$/.test(t[0]) && t[1] && t[1].res_summary !== undefined).length;

(async () => {
  {
    const e = H.byName(ON, "onFormChange");
    check("onFormChange is the marker's js handler", !!e && e.type === "js" && /res_fp/.test(e.func), e && e.type);
  }
  {
    const o = await open(ia("Created"));
    const base = row(o);
    check("Created IA opened: the row has no marker", !!base && base.indexOf(MARK) < 0, base);
    await change(o);
    check("a change event with nothing changed: no marker", row(o) === base, row(o));
    await change(o, (v) => (v.stock_movement[1].temp_qty_data = JSON.stringify([pk(4, { location_id: "L1" })])));
    check("a pick moved to another bin (not saved): the row as it was + Unsaved changes", row(o) === base + MARK, row(o));
    await change(o, (v) => (v.stock_movement[1].temp_qty_data = JSON.stringify([pk(4)])));
    check("changed back: the row as it was", row(o) === base, row(o));
    await change(o, (v) => (v.stock_movement[0].res_reserved = "99"));
    check("a display-only column changed: no marker", row(o).indexOf(MARK) < 0, row(o));
    await change(o, (v) => v.stock_movement.push(ln("5003", "C3", [pk(1)])));
    check("a line added: the marker", row(o).endsWith(MARK), row(o));
    await change(o, (v) => v.stock_movement.pop());
    await change(o, (v) => (v.issuing_operation_faci = "9999"));
    check("the plant changed: the marker", row(o).endsWith(MARK), row(o));
  }
  {
    // a burst of changes: only the newest one's check writes the row
    const o = await open(ia("Created"));
    const before = rowWrites(o);
    const reads0 = o.w.trace.filter((t) => /getValues$/.test(t[0])).length;
    const e = H.byName(ON, "onFormChange");
    for (let i = 0; i < 5; i++) {
      o.self.values.stock_movement[0].temp_qty_data = JSON.stringify([pk(6 - i)]);
      H.compile(o.w, e.func, false).call(o.self);
    }
    await H.drain(o.w);
    const reads = o.w.trace.filter((t) => /getValues$/.test(t[0])).length - reads0;
    check("five changes in a row (an auto-allocation): one check (one form read), the row written once, with the marker",
      reads === 1 && rowWrites(o) - before === 1 && row(o).endsWith(MARK), [reads, rowWrites(o) - before, row(o)]);
  }
  {
    // the row rendered again while the form is dirty (a Reserving IA's run answers late): the marker stays, on the new row
    const until = async (w, ms) => {
      const end = w.now + ms;
      for (let i = 0; i < 20000; i++) {
        for (let k = 0; k < 8; k++) await new Promise((r) => setImmediate(r));
        w.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
        if (!w.queue.length || w.queue[0].at > end) break;
        const next = w.queue.shift();
        w.now = Math.max(w.now, next.at);
        next.fn();
      }
      w.now = Math.max(w.now, end);
    };
    const w = H.world({ db: H.tableDb(Object.assign(F.tables(), { on_reserved_gd: [] })) });
    w.so = F.so();
    const late = { __delay: 3000, data: { code: "200", message: "All materials are reserved.", result_json: JSON.stringify({ status: "FULL", checkedAt: "2026-10-22 15:05:00", lines: [] }) } };
    const self = H.makeThis(w, ON, { values: H.clone(ia("Created", { material_hold_status: "RESERVING" })), stateful: true, isEdit: true,
      answer: F.answer(w, H.SC_TEST_IDS, (id) => (id === H.SC_TEST_IDS.IA_HOLD ? late : { data: { code: "200", message: "ok" } })) });
    const e = H.byName(ON, "mounted");
    H.compile(w, H.sourceOf(e), e.type === "rule").call(self);
    await until(w, 1000);
    const o = { w: w, self: self };
    const pendingRow = row(o);
    check("(a Reserving IA, its run not answered yet: the Pending row)", /Pending/.test(pendingRow) && pendingRow.indexOf(MARK) < 0, pendingRow);
    o.self.values.stock_movement[0].temp_qty_data = JSON.stringify([pk(2)]);
    H.compile(w, H.byName(ON, "onFormChange").func, false).call(self);
    await until(w, 600);
    check("changed while Reserving: the Pending row + the marker", row(o) === pendingRow + MARK, row(o));
    await H.drain(w);
    check("the run answers (the row rendered again): the Fully reserved row, the marker kept", /^Raw material reservation: Fully reserved · checked 2026-10-22 15:05:00/.test(row(o)) &&
      row(o).endsWith(MARK), row(o));
  }
  {
    const o = await open(ia("Draft", { material_hold_status: "" }));
    const was = row(o);
    await change(o, (v) => (v.stock_movement[0].temp_qty_data = JSON.stringify([pk(1)])));
    check("a Draft: no marker (it reserves nothing)", row(o) === was && row(o).indexOf(MARK) < 0, row(o));
  }
  H.done("test_res_dirty");
})();
