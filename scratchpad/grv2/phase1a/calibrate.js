// Size-model calibration: a recorded run's own payload through the OLD workflow in the engine, against a world built from the
// rows that run read (items, on-order, PREQ, the stored PO); per-node estimated bytes vs the bytes the run recorded.
// Usage: node calibrate.js <old wf json> <run json>...
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");
const { Engine } = require("./engine.js");
const { World } = require("./world.js");

const OLD = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const one = (x) => (Array.isArray(x) ? x[0] : x);
const rowsOf = (node) => {
  const d = node && node.out && node.out.data;
  const x = d && typeof d === "object" && "data" in d ? d.data : d;
  return Array.isArray(x) ? x : x ? [x] : [];
};

for (const file of process.argv.slice(3)) {
  const run = L.loadRun(file);
  const n = run.nodes;
  const a = run.allData;
  const w = new World({ tenantId: run.meta.tenant_id });
  for (const it of rowsOf(n.search_items)) w.items[String(it.id)] = it;
  for (const r of rowsOf(n.search_onorder)) w.onorder.push(Object.assign({ is_deleted: 0 }, r));
  for (const p of rowsOf(n.search_preq)) w.preq[String(p.id)] = p;
  if (a.page_status === "Edit") {
    const rb = one(rowsOf(n.get_one_po)) || one(rowsOf(n.get_po_full));
    if (rb) {
      const header = Object.assign({}, rb);
      delete header.table_po;
      const po = { header: header, lines: [] };
      w.po[String(rb.id)] = po;
      w.writeLines(po, rb.table_po);
      // keep the stored ids
      const ids = [];
      for (const r of rb.table_po || []) {
        ids.push(String(r.id));
        for (const c of r.children || []) ids.push(String(c.id));
      }
      po.lines.forEach((l, i) => (l.id = ids[i] || l.id));
    }
  }
  if (n.wf_check_approval && (n.wf_check_approval.out.data || {}).needApproval === "Yes") w.approvalConfig = { po_issued: 1, po_document_status: "draft" };
  let res;
  try {
    res = new Engine(OLD, w, {}).run({ allData: a });
  } catch (e) {
    console.log(path.basename(file), "engine error:", e.message.slice(0, 200));
    continue;
  }
  let rec = 0;
  let est = 0;
  const rows = [];
  for (const [nid, x] of Object.entries(n)) {
    const r = x.inBytes + x.outBytes;
    const e = res.sizes[nid] ? res.sizes[nid].in + res.sizes[nid].out : 0;
    rec += r;
    est += e;
    rows.push([nid, r, e]);
  }
  const lines = (a.table_po || []).length;
  console.log(path.basename(file), "lines", lines, "recorded", rec, "estimated", est, "ratio est/rec", (est / rec).toFixed(2), "outcome", JSON.stringify(res.outcome));
  if (process.env.DETAIL)
    for (const [nid, r, e] of rows.sort((p, q) => q[1] - p[1]).slice(0, 14)) console.log("   ", nid.padEnd(26), String(r).padStart(9), String(e).padStart(9));
}
