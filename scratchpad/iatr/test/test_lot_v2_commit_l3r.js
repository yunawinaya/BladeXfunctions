// LOT_V2_COMMIT with L3_RESERVATION (scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 5), on the BUILT workflow:
//   - the entry runs the step in phase B when PREPARE named an RR part, once (L3_RESERVATION DONE), never in phase A
//   - if_LCl3r sits between L3 and L4 and writes only on_reserved_gd, the IA lines and the transfer lines, with the props planned
//   - everything else == the deployed v9 (keys aside: a build's keys depend on the build run, v9's cannot be reproduced)
//   node scratchpad/iatr/test/test_lot_v2_commit_l3r.js      (IATR_COMMIT=<file> checks another build)
const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..", "..", "..");
const H = require(path.join(REPO, "scratchpad", "smv2", "lib", "harness.js"));
const FILE = process.env.IATR_COMMIT || path.join(REPO, "Stock Movement", "Location Transfer", "AsyncV2", "LOT_V2_COMMIT.json");
const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const v9 = JSON.parse(fs.readFileSync(path.join(REPO, "scratchpad", "iatr", "base", "rr_LOT_V2_COMMIT_v9.json"), "utf8"));
const find = (n, id) => {
  if (Array.isArray(n)) {
    for (const v of n) {
      const r = find(v, id);
      if (r) return r;
    }
  } else if (n && typeof n === "object") {
    if (n.id === id) return n;
    for (const v of Object.values(n)) {
      const r = find(v, id);
      if (r) return r;
    }
  }
  return null;
};
const all = (n, out) => {
  if (Array.isArray(n)) n.forEach((v) => all(v, out));
  else if (n && typeof n === "object") {
    if (typeof n.id === "string" && n.type) out.push(n);
    Object.values(n).forEach((v) => all(v, out));
  }
  return out;
};

// ---- the entry
const code = find(doc.nodes, "code_node_LCentry").data.script.code;
const lines = code.split("\n");
const { commitEntry, LOT_BUILT } = new Function("console", lines.slice(0, lines.findIndex((l) => l.includes("{{"))).join("\n") + "\nreturn { commitEntry, LOT_BUILT };")({ log() {} });
const JOB = "9100000000000000002";
const LOT = "9100000000000000001";
const guard = { jobId: JOB, tenantId: "711077", leaseOwner: "PUB|abcd" };
const manifest = (parts) => JSON.stringify({ job_id: JOB, lot_id: LOT, lot_no: "LOT-1", nonce: "n1", lineCount: 2, counts: { itCreates: 1, itUpdates: 0 },
  parts: Object.assign({ ENGINE: ["P|n1|ENGINE|001"], LABELS: ["P|n1|LABELS|001"], IT: ["P|n1|IT|001"], HDR: ["P|n1|HDR|001"], ITEMS: ["P|n1|ITEMS|001"] }, parts) });
const job = { db_now: "2026-10-29 12:00:00", lease_until: "2026-10-29 12:30:00", id: JOB, organization_id: "1123598813738675201", command: "SAVE_LOT", job_status: "COMMITTING_LOT",
  progress_percent: 75, attempt_count: 0, lease_owner: "SPLIT|x", lease_live: 1, due: 1, row_version: 3, is_deleted: 0, correlation_id: "LOT|" + LOT, line_count: 2,
  prev_status: "Requested", req_action: "STAGE", req_save_as: "In Progress", req_nonce: "s1", idempotency_key: "K1", line_fp: "f", incoming_fp: "" };
const lot = [{ lot_id: LOT, stock_movement_status: "Processing", lot_v2_job_id: JOB, lock_ref: "K1" }];
const run = (parts, done) => commitEntry(guard, [job], (done || []).map((n) => ({ step_name: n, step_status: "DONE" })), [{ prepared_payload: manifest(parts) }], lot, []);
H.eq("the build knows the step", LOT_BUILT.indexOf("L3R") >= 0, true);
let e = run({ RR: ["P|n1|RR|001"] }, ["L0_REVALIDATE", "L1_INVENTORY"]);
H.eq("phase B with an RR part -> L3_RESERVATION due (with L3 and L4)", [e.route, e.phase, e.needL3, e.needL3R, e.needL4], ["GO", "B", "YES", "YES", "YES"]);
e = run({ RR: ["P|n1|RR|001"] }, ["L0_REVALIDATE", "L1_INVENTORY", "L3_LEDGER", "L3_RESERVATION"]);
H.eq("  done once -> not again", [e.needL3, e.needL3R, e.needL4], ["NO", "NO", "YES"]);
e = run({}, ["L0_REVALIDATE", "L1_INVENTORY"]);
H.eq("no RR part (every ordinary transfer) -> never", [e.route, e.needL3R], ["GO", "NO"]);
e = run({ RR: ["P|n1|RR|001"] }, []);
H.eq("phase A -> never (the stock has not moved)", [e.phase, e.needL3R], ["A", "NO"]);
e = run({ RR: [] }, ["L0_REVALIDATE", "L1_INVENTORY"]);
H.eq("an RR part named without chunks -> REQUIRES_REVIEW after the stock moved", e.route, "REVIEW");

// ---- the block
const top = doc.nodes.map((n) => n.id);
H.eq("if_LCl3r runs after if_LCl3 and before if_LCl4", [top.indexOf("if_LCl3") < top.indexOf("if_LCl3r"), top.indexOf("if_LCl3r") < top.indexOf("if_LCl4")], [true, true]);
const block = find(doc.nodes, "if_LCl3r");
H.eq("  it runs only when the entry says so; the lookups only when the keys node asks", [block.data.expression.code,
  JSON.stringify(find(block, "cor_LCl3rlook")).indexOf("node.code_node_LCl3rkeys.data.need") >= 0], ["'{{node:code_node_LCentry.data.needL3R}}' == 'YES'", true]);
const writes = all(block, []).filter((n) => /^(add|update)_node_/.test(n.id) && !/job$|done$/.test(n.id));
const src = (n) => JSON.stringify(n.data).match(/"[^"]*:Table:[0-9]+"/) || [""];
H.eq("its writes: on_reserved_gd (cancel, add), the IA lines, the transfer lines, the transfer's log (the bins to count), the IA's link (Task 10)",
  writes.map((n) => [n.id, src(n)[0].replace(/"/g, "")]),
  [["update_node_LCl3rcwrite", "On Reserved Goods Delivery:Table:1935880014687440897"], ["add_node_LCl3rawrite", "On Reserved Goods Delivery:Table:1935880014687440897"],
    ["update_node_LCl3riwrite", "Stock movement(Item Assembly):Table:2098269596661833730"], ["update_node_LCl3rlwrite", "Stock Movement Table(Location Transfer):Table:2013831779991814146"],
    ["update_node_LCl3rgwrite", "Location Transfer:Table:2013791389687349250"], ["update_node_LCl3rkwrite", "Item Assembly:Table:2098256587713404929"]]);
H.eq("  the received request read: the IA's own, Completed, never this transfer; the IA's link read too", (() => {
  const q = JSON.stringify(find(block, "sql_node_LCl3rctx").data);
  return [/'recv', \(SELECT JSON_OBJECT\('id', CAST\(r\.id AS CHAR\), 'no', r\.stock_movement_no\) FROM sm_location_transfer r WHERE r\.tenant_id = /.test(q),
    /r\.stock_movement_status = 'Completed' AND r\.is_deleted = 0 AND r\.id <> \{\{/.test(q), /'link', h\.transfer_request_id\)/.test(q)];
})(), [true, true, true]);
H.eq("  the IA's link: id and the two link columns only", (() => {
  const w = writes.filter((n) => n.id === "update_node_LCl3rkwrite")[0];
  return w ? [...new Set(JSON.stringify(w.data).match(/\{\{node:code_node_LCl3rkslice\.data\.rows\.([a-z_]+)\}\}/g).map((x) => x.replace(/.*rows\.|\}\}/g, "")))] : null;
})(), ["id", "transfer_request_id", "transfer_request_no"]);
H.eq("  the log: id and request_log only (nothing else of the header)", (() => {
  const w = writes.filter((n) => n.id === "update_node_LCl3rgwrite")[0];
  return w ? [...new Set(JSON.stringify(w.data).match(/\{\{node:code_node_LCl3rgslice\.data\.rows\.([a-z_]+)\}\}/g).map((x) => x.replace(/.*rows\.|\}\}/g, "")))] : null;
})(), ["id", "request_log"]);
// the props written (the WHERE names id once more)
const props = (n) => [...new Set(JSON.stringify(n.data).match(/\{\{node:code_node_LCl3r[a-z]+slice\.data\.rows\.([a-z_]+)\}\}/g).map((x) => x.replace(/.*rows\.|\}\}/g, "")))];
H.eq("  cancel: id, status, job_line_key", props(writes[0]), ["id", "status", "job_line_key"]);
H.eq("  add: IA_HOLD's 25 columns", props(writes[1]).length, 25);
H.eq("  IA lines: id, picks, total, summary", props(writes[2]), ["id", "temp_qty_data", "total_quantity", "stock_summary"]);
H.eq("  transfer lines: id, the defects", props(writes[3]), ["id", "defect_qty", "defect_reason", "defect_detail"]);
H.eq("  the DONE row is L3_RESERVATION", JSON.stringify(find(block, "code_node_LCl3rcheck").data.script.code).indexOf('L3_RESERVATION') >= 0, true);
// each built L3R node, run as the platform runs it (placeholders null but the entry): every declared output is returned, and what it
// returns beyond them is only stepEnd's unread END_EMPTY fields (the runtime drops undeclared keys)
const ENTRY = { jobId: JOB, lotId: LOT, attempts: 0, rowVersion: 4, dbNow: "2026-10-29 12:00:00", jsAt: 0, partPrefix: "P|n1|", organizationId: "1123598813738675201" };
const runNode = (id) => new Function("console", find(block, id).data.script.code.replace(/\{\{node:code_node_LCentry\.data\}\}/g, JSON.stringify(ENTRY))
  .replace(/\{\{node:[^}]+\}\}/g, "null"))({ log() {} });
for (const id of ["code_node_LCl3rkeys", "code_node_LCl3rplan", "code_node_LCl3rcheck"]) {
  const declared = find(block, id).data.response_json.map((r) => r.name);
  const got = Object.keys(runNode(id));
  H.eq("  " + id + ": declared = returned (+ END_EMPTY)", [declared.filter((k) => got.indexOf(k) < 0), got.filter((k) => declared.indexOf(k) < 0 && ["stepRows", "needStep", "unlockRows", "needUnlock"].indexOf(k) < 0)],
    [[], []]);
}

// ---- the rest == v9, keys aside
const strip = (n) => {
  if (Array.isArray(n)) return n.map(strip);
  if (n && typeof n === "object") {
    const o = {};
    for (const k of Object.keys(n)) if (k !== "key") o[k] = strip(n[k]);
    return o;
  }
  return n;
};
const mine = strip(JSON.parse(JSON.stringify(doc)));
mine.nodes = mine.nodes.filter((n) => n.id !== "if_LCl3r");
const ent = find(mine.nodes, "code_node_LCentry");
const ent9 = find(strip(v9).nodes, "code_node_LCentry");
ent.data.response_json = ent.data.response_json.filter((r) => r.name !== "needL3R");
const a = ent.data.script.code.split("\n");
const b = ent9.data.script.code.split("\n");
const added = a.filter((l) => b.indexOf(l) < 0);
const removed = b.filter((l) => a.indexOf(l) < 0);
H.eq("the entry's code: only the RR / L3R lines changed", [added.every((l) => /RR|L3R|rrNames|hasRR/.test(l)), removed.every((l) => /needs = |LOT_BUILT = |&& \/\^\[0-9A-Za-z\]|console\.log|needL3: |unlockRows: \[\], needUnlock/.test(l))],
  [true, true]);
ent.data.script.code = ent9.data.script.code;
H.eq("everything else == v9 (keys aside)", JSON.stringify(mine) === JSON.stringify(strip(v9)), true);
H.done();
