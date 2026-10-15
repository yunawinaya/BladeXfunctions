// Replays every recorded GR_CANCEL_CREATED run (dev + prod) through the lean workflow on the DB state that run read,
// and compares the answer, the GR stamp, the PO line releases and the PO gr_status with what the run computed.
const { MeterEngine } = require("./meter");
const { mocks } = require("./grdb");
const F = require("./fixtures");

const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const tally = {};
const examples = {};
const note = (k, s) => {
  tally[k] = (tally[k] || 0) + 1;
  if (!examples[k]) examples[k] = [];
  if (examples[k].length < 4) examples[k].push(s);
};

for (const env of ["dev", "prod"]) {
  for (const run of F.runs(env, "GR_CANCEL_CREATED")) {
    const tag = env + ":" + run.id;
    if (run.exit_node === "return_node_CcGuard") {
      note("skip: Phase 0 refusal test run", tag);
      continue;
    }
    const { db, params } = F.cancelCase(run);
    if (params.action === "cancel") {
      // the old workflow never checked: the list only offers Created GRs, so the stored status was Created
      for (const g of db.t.gr) g.gr_status = "Created";
    }
    const before = new Map(db.t.pol.map((p) => [p.id, q8(p.created_received_qty)]));
    const e = new MeterEngine({ db, mocks: mocks() });
    let res;
    try {
      res = e.run("GR_CANCEL_CREATED", params).returned;
    } catch (err) {
      note("CRASH", tag + " " + err.message);
      continue;
    }
    const rec = (run.resp && run.resp.data) || {};
    if (String(rec.code) !== String(res.code) || String(rec.message) !== String(res.message)) {
      note("UNEXPECTED answer", tag + " rec " + JSON.stringify(rec) + " mine " + JSON.stringify(res));
      continue;
    }
    note("same answer " + params.action + " " + res.code, tag);
    if (params.action !== "cancel") {
      const del = db.writes.find((w) => w.table === "Goods Receiving");
      if (del && del.rows.every((r) => r.is_deleted === 1)) note("delete: header soft-deleted", tag);
      else note("UNEXPECTED delete write", tag + JSON.stringify(db.writes));
      continue;
    }
    const rv = F.respOf(run, "code_reversals").data;
    // GR stamp
    const stamp = db.writes.find((w) => w.table === "Goods Receiving").rows;
    const myNo = stamp.map((r) => r.gr_no);
    if (stamp.length === 1 && myNo[0] === rv.cancelledGrNo && stamp[0].gr_status === "Cancelled") note("GR stamp identical", tag);
    else note("GR stamp differs", tag + " rec " + rv.cancelledGrNo + " mine " + JSON.stringify(stamp));
    // PO line releases
    const recAfter = new Map();
    for (const po of rv.poUpdates) for (const l of F.flat(po.table_po)) recAfter.set(F.S(l.id), q8(l.created_received_qty));
    const recChanged = new Map([...recAfter].filter(([id, v]) => before.get(id) !== v));
    const mine = new Map();
    for (const w of db.writes.filter((x) => x.table === "Item Table(Purchase Order)")) for (const r of w.rows) mine.set(F.S(r.__id), q8(r.created_received_qty));
    const ids = new Set([...recChanged.keys(), ...mine.keys()]);
    const off = [...ids].filter((id) => (recChanged.has(id) ? recChanged.get(id) : before.get(id)) !== (mine.has(id) ? mine.get(id) : before.get(id)));
    if (off.length === 0) note("PO line releases identical", tag);
    else note("UNEXPECTED release", tag + " " + off.map((id) => id + " " + before.get(id) + " rec " + recChanged.get(id) + " mine " + mine.get(id)).join("; "));
    // PO gr_status
    const recSt = new Map(rv.poUpdates.map((p) => [F.S(p.po_id), p.gr_status]));
    const mySt = new Map(db.writes.filter((x) => x.table === "Purchase Order").flatMap((w) => w.rows).map((r) => [F.S(r.__id), r.gr_status]));
    const keys = new Set([...recSt.keys(), ...mySt.keys()]);
    for (const k of keys) {
      const a = recSt.get(k);
      const b = mySt.get(k);
      if (a === b) note("PO gr_status identical", tag);
      else if (a === "Cancelled" && b === "Partially Received") {
        const lines = db.t.pol.filter((p) => p.purchase_order_id === k);
        const some = lines.some((p) => q8(p.received_qty) > 0 && q8(p.received_qty) >= q8(p.quantity));
        note(some ? "FIX: PO with lines fully received + untouched: Partially Received (was Cancelled)" : "UNEXPECTED gr_status", tag + " " + k);
      } else note("UNEXPECTED gr_status", tag + " " + k + " rec " + a + " mine " + b);
    }
  }
}
console.log(JSON.stringify(tally, null, 1));
for (const [k, v] of Object.entries(examples)) if (/UNEXPECTED|CRASH|differs/.test(k)) console.log("\n== " + k + "\n" + v.join("\n"));
const bad = Object.keys(tally).filter((k) => /UNEXPECTED|CRASH|differs/.test(k)).reduce((s, k) => s + tally[k], 0);
console.log("\nunexpected:", bad);
process.exit(bad ? 1 : 0);
