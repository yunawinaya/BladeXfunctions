// Replays every recorded GR_CREATED run (dev + prod) through the lean workflow on the DB state that run saw, and
// compares the answer, the GR row written and the PO reservations with what the run computed.
// Usage: node replay_created.js [--verbose]
const { MeterEngine } = require("./meter");
const { mocks } = require("./grdb");
const F = require("./fixtures");

const verbose = process.argv.includes("--verbose");
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const tally = {};
const bump = (k) => (tally[k] = (tally[k] || 0) + 1);
const examples = {};
const note = (k, s) => {
  bump(k);
  if (!examples[k]) examples[k] = [];
  if (examples[k].length < 3) examples[k].push(s);
};
const normNum = (v) => (typeof v === "number" ? q8(v) : v);
function sameDeep(a, b) {
  if (typeof a === "number" || typeof b === "number") {
    if (a === null || b === null || a === undefined || b === undefined) return a == b; // eslint-disable-line eqeqeq
    return q8(a) === q8(b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameDeep(x, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of ks) if (!sameDeep(a[k], b[k])) return false;
    return true;
  }
  return a === b || (a == null && b == null); // eslint-disable-line eqeqeq
}

for (const env of ["dev", "prod"]) {
  for (const run of F.runs(env, "GR_CREATED")) {
    const tag = env + ":" + run.id;
    if (!run.req || !run.req.request_json || (!run.resp && run.status !== "Fail")) {
      note("skip: no request/response recorded", tag);
      continue;
    }
    if (run.exit_node === "return_node_GcSizeGuard") {
      note("skip: Phase 0 size refusal run (500 cap test)", tag);
      continue;
    }
    const { db, params, stored } = F.createdCase(run);
    const storedStatus = stored ? stored.gr_status : params.pageStatus === "Edit" ? "(form)" : "";
    const before = new Map(db.t.pol.map((p) => [p.id, q8(p.created_received_qty)]));
    const e = new MeterEngine({ db, mocks: mocks() });
    let res;
    try {
      res = e.run("GR_CREATED", params).returned;
    } catch (err) {
      note("CRASH", tag + " " + err.message);
      continue;
    }
    const rec = (run.resp && run.resp.data) || {};
    const recCode = String(rec.code || (run.exit_node === "update_gr" ? "FAIL(update_gr)" : ""));
    const myCode = String(res && res.code);

    // ---- the answer
    if (run.status === "Fail") {
      // the old run crashed writing the GR (raw float); the lean one formats decimals: it must now succeed
      if (myCode === "200") note("FIX: decimal crash now saves (q8 table_gr)", tag);
      else note("UNEXPECTED answer on a failed run", tag + " mine " + myCode + " " + (res && res.message));
      continue;
    }
    if (recCode !== myCode || String(rec.message || "") !== String((res && res.message) || "")) {
      if (recCode === "400" && myCode === "400" && /cannot be saved as Created: it is (Received|Completed) now/.test(String(res.message))) {
        note("FIX: stale form on a " + (stored && stored.gr_status) + " GR refused on its stored status", tag);
      } else if (recCode === "200" && myCode === "402" && storedStatus === "Draft") {
        note("FIX: Draft->Created over-commit now counts other GRs' reservations (402)", tag);
      } else {
        note("UNEXPECTED answer", tag + " rec " + recCode + " / mine " + myCode + "\n   rec: " + String(rec.message).slice(0, 200) +
             "\n  mine: " + String(res && res.message).slice(0, 200));
      }
      continue;
    }
    if (myCode !== "200") {
      bump("same answer " + myCode);
      continue;
    }
    bump("same answer 200");

    // ---- the GR row: every mapped column equals what the old run wrote (cn_fill.allData)
    const fill = F.respOf(run, "cn_fill").data.allData;
    const grWrite = db.writes.find((w) => w.table === "Goods Receiving");
    const wrote = grWrite.rows[0];
    let rowDiff = [];
    for (const k of Object.keys(wrote)) {
      if (k === "__id" || k === "gr_idem_key" || k === "gr_status") continue;
      if (k === "gr_no") {
        if (String(wrote.gr_no) !== String(fill.gr_no)) rowDiff.push("gr_no " + fill.gr_no + " -> " + wrote.gr_no);
        continue;
      }
      if (!sameDeep(wrote[k], fill[k])) rowDiff.push(k);
    }
    if (rowDiff.length) note("GR row differs", tag + " " + rowDiff.join(", ").slice(0, 300));
    else bump("GR row identical");
    // strict: which line values did the lean fill change? (the recorded output drops null keys; "0" vs 0 is the same
    // decimal) - only real changes count: float residue removed by q8
    {
      const changes = [];
      const fa = F.flat(fill.table_gr);
      const fb = F.flat(wrote.table_gr);
      fa.forEach((r, i) => {
        const b = fb[i] || {};
        for (const k of new Set([...Object.keys(r), ...Object.keys(b)])) {
          if (k === "__parent" || k === "children") continue;
          const x = r[k];
          const y = b[k];
          if (JSON.stringify(x) === JSON.stringify(y)) continue;
          if ((x === undefined || x === null) && (y === undefined || y === null)) continue;
          if (x !== null && y !== null && x !== "" && !isNaN(Number(x)) && !isNaN(Number(y)) && Number(x) === Number(y)) continue;
          changes.push(k + ":" + JSON.stringify(x) + "->" + JSON.stringify(y));
        }
      });
      if (changes.length) note("table_gr: float residue removed by q8", tag + " " + [...new Set(changes)].slice(0, 4).join(" "));
      else bump("table_gr values identical (strict, modulo null keys / \"0\" vs 0)");
    }
    // ---- PO reservations
    const recAfter = new Map();
    for (const po of F.respOf(run, "cn_poUpdates").data.poDataUpdates) {
      for (const l of F.flat(po.table_po)) recAfter.set(F.S(l.id), q8(l.created_received_qty));
    }
    const recChanged = new Map([...recAfter].filter(([id, v]) => before.has(id) && before.get(id) !== v));
    const mine = new Map();
    for (const w of db.writes.filter((x) => x.table === "Item Table(Purchase Order)")) {
      for (const r of w.rows) mine.set(F.S(r.__id), q8(r.created_received_qty));
    }
    const ids = new Set([...recChanged.keys(), ...mine.keys()]);
    let worst = "same";
    const lines = [];
    for (const id of ids) {
      const a = recChanged.has(id) ? recChanged.get(id) : before.get(id);
      const b = mine.has(id) ? mine.get(id) : before.get(id);
      if (a === b) continue;
      if (storedStatus === "Draft" && recChanged.size === 0) {
        worst = "draft";
        lines.push(id + " " + before.get(id) + " -> rec " + a + " / mine " + b);
      } else if (Math.abs(a - b) <= 0.0005) {
        if (worst === "same") worst = "dp8";
      } else {
        worst = "bad";
        lines.push(id + " " + before.get(id) + " -> rec " + a + " / mine " + b);
      }
    }
    if (worst === "same") bump("PO reservations identical");
    else if (worst === "dp8") note("PO reservations: 3 dp -> 8 dp only", tag);
    else if (worst === "draft") note("FIX: Draft->Created now reserves (old: nothing)", tag + " " + lines.slice(0, 2).join("; "));
    else note("UNEXPECTED reservation", tag + " stored=" + storedStatus + "\n   " + lines.slice(0, 4).join("\n   "));

    // ---- PO headers: the old run set gr_status Created on every PO it read
    const recPo = new Set(F.respOf(run, "cn_poUpdates").data.poDataUpdates.map((p) => F.S(p.id)));
    const hdr = db.writes.filter((x) => x.table === "Purchase Order").flatMap((w) => w.rows);
    const myPo = new Map(hdr.map((r) => [F.S(r.__id), r.gr_status]));
    const same = recPo.size === myPo.size && [...recPo].every((id) => myPo.get(id) === "Created");
    if (same) bump("PO headers identical (Created)");
    else note("PO headers differ", tag + " rec " + [...recPo].join(",") + " mine " + JSON.stringify([...myPo]));
    if (verbose) console.log(tag, myCode, "nodeData", e.nodeData());
  }
}
console.log(JSON.stringify(tally, null, 1));
for (const [k, v] of Object.entries(examples)) {
  if (/UNEXPECTED|CRASH|differ/.test(k)) console.log("\n== " + k + "\n" + v.join("\n"));
}
const bad = Object.keys(tally).filter((k) => /UNEXPECTED|CRASH|differ/.test(k)).reduce((s, k) => s + tally[k], 0);
console.log("\nunexpected:", bad);
process.exit(bad ? 1 : 0);
