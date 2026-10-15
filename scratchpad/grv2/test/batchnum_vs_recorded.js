// Harness (d): code/shared/batchnum.js against recorded GENERATE_BATCH runs. Run with TZ=Asia/Kuala_Lumpur (the
// platform's JS runs in UTC+8).
// usage: TZ=Asia/Kuala_Lumpur node batchnum_vs_recorded.js --single <gen.jsonl> [...] --seq <gr_runs.jsonl> [...]
//   --single: every recorded call on its own: the config rows its get-nodes read, its item row, its request, its clock
//             (the instant "Document Created Date" took), its duplicate answer -> number, config after-state, errors.
//   --seq:    every GR completion that numbered >1 row: the first call's config rows, all its requests in order, one
//             bnNumber call -> each number equal to the recorded sequence (state carried call to call, resets included).
const fs = require("fs");
const path = require("path");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
const bnNumber = new Function(fs.readFileSync(path.join(__dirname, "..", "code", "shared", "batchnum.js"), "utf8") + "\nreturn bnNumber;")();
const mode = { single: [], seq: [] };
let cur = null;
for (const a of process.argv.slice(2)) {
  if (a === "--single") cur = "single";
  else if (a === "--seq") cur = "seq";
  else if (cur) mode[cur].push(a);
}
const lines = (f) => fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const data = (n) => (n && n.resp ? n.resp.data : undefined);
const LEVEL_GET = { "Item Level": "get_node_DNJctx3t", "Item Category Level": "get_node_YX3D4xFA", "Item Group Level": "get_node_cbX4ILIH" };
const DATE_NODES = ["code_node_hs092Lw8", "code_node_9IzMl1j4", "code_node_93lsgfQY", "code_node_WgU9WsEM"];
const GEN_NODES = ["code_node_WJsBb8lJ", "code_node_1CHkL2vY", "code_node_rdnJWmbU", "code_node_xgeec0NC"];

// the config rows one recorded call read, its item row, its clock and its duplicate answer
function callFacts(g) {
  const n = g.nodes;
  const rows = [];
  const def = data(n.get_node_Mx1xwOKd);
  if (def && def.count) rows.push(def.data);
  const lvl = def && def.count ? def.data.batch_level_selection : null;
  const lg = LEVEL_GET[lvl];
  const sub = lg ? data(n[lg]) : null;
  if (sub && sub.count && !rows.find((r) => r.id === sub.data.id)) rows.push(sub.data);
  // v20 reads the item with sql_node_GbItem; older versions with get_node_25gj7Z38 (same two columns)
  const gi = data(n.get_node_25gj7Z38);
  const items = data(n.sql_node_GbItem) || (gi && gi.count ? [{ id: gi.data.id, item_category: gi.data.item_category, item_group_id: gi.data.item_group_id }] : []);
  const org = (data(n.code_node_v8HMhqLP) || {}).orgID;
  const dn = DATE_NODES.find((k) => n[k]);
  const dd = dn ? data(n[dn]) : null;
  const created = def && def.count && def.data.date_format === "Document Created Date";
  const now = created && dd && dd.dateToUse ? Date.parse(dd.dateToUse) : (dn && n[dn].t0) || Number(g.t0) || Date.now();
  const dup = data(n.get_node_HcPI9NET);
  const genKey = GEN_NODES.find((k) => n[k]);
  return { rows, items, now, org, older: !n.sql_node_GbItem, dup: dup ? Number(dup.count) === 1 : null, gen: genKey ? data(n[genKey]).result : null, latest: (data(n.code_node_KEYxy1GI) || {}).latestBatchConfig };
}

const tally = { same: 0, different: 0, errSame: 0, errDifferent: 0, resets: 0, formats: {} };
const notes = [];
for (const f of mode.single) {
  for (const g of lines(f)) {
    const fx = callFacts(g);
    const res = bnNumber(fx.rows, fx.items, [g.params], { now: fx.now, firstLvDeptId: fx.org, existing: fx.dup === null ? undefined : () => fx.dup });
    if (fx.older) tally.older = (tally.older || 0) + 1;
    const r = res.results[0] || {};
    const recNo = g.resp && g.resp.data ? g.resp.data.batch_number : undefined;
    if (g.exit === "end") {
      const L = fx.latest || {};
      const after = res.configs[r.config_id] ? res.configs[r.config_id].after : {};
      const ok = r.ok && r.batch_number === recNo && after.running_number === L.running_number &&
        (after.last_reset_date || null) === (L.last_reset_date || null) && r.reset_occurred === !!L.reset_occurred &&
        r.previous_running_number === L.previous_running_number && (r.generated_at || null) === (L.generated_at || null);
      if (ok) tally.same++;
      else {
        tally.different++;
        notes.push(`${g.id} ${g.tenant}: mine ${JSON.stringify(r)} after ${JSON.stringify(after)} | rec ${recNo} ${JSON.stringify(L)}`);
      }
      if (L.reset_occurred) tally.resets++;
      const fmt = (fx.rows.find((x) => x.id === L.id) || {}).batch_format;
      tally.formats[fmt] = (tally.formats[fmt] || 0) + 1;
    } else {
      // a 401 end node: the message the GR run surfaces
      const endNode = Object.keys(g.nodes).find((k) => k.startsWith("end"));
      const msgNode = ["code_node_YUZZfLYF", "code_node_jtOVVrdi", "code_node_ZpQi2VfY"].concat(DATE_NODES).find((k) => g.nodes[k] && (data(g.nodes[k]) || {}).message);
      const recMsg = msgNode ? data(g.nodes[msgNode]).message : null;
      if (!r.ok && r.message === recMsg) tally.errSame++;
      else {
        tally.errDifferent++;
        notes.push(`${g.id} ${g.tenant} exit ${g.exit}: mine ${JSON.stringify(r)} | rec ${recMsg} (${endNode})`);
      }
    }
  }
}
if (mode.single.length) {
  console.log("single calls:", JSON.stringify({ same: tally.same, different: tally.different, errorsSame: tally.errSame, errorsDifferent: tally.errDifferent, resets: tally.resets, ofAnOlderVersion: tally.older || 0 }));
  const fm = Object.entries(tally.formats).sort((a, b) => b[1] - a[1]);
  console.log("  formats:", fm.length, "distinct; most used", JSON.stringify(Object.fromEntries(fm.slice(0, 8))));
}

// sequences: one GR completion's calls, replayed from its first call's state
const seq = { same: 0, different: 0, calls: 0 };
for (const f of mode.seq) {
  for (const r of lines(f)) {
    const gens = (r.gens || []).filter((g) => g.exit === "end").sort((a, b) => (a.id < b.id ? -1 : 1));
    if (gens.length < 2) continue;
    const rec = JSON.parse(((r.nodes.get_cache_node_BGARRfinal || {}).resp || {}).data || "[]").map((x) => x.batch_number);
    // the state before the first call: every distinct config row any call read, as the FIRST call that read it saw it
    const rows = [];
    const items = [];
    for (const g of gens) {
      const fx = callFacts(g);
      for (const row of fx.rows) if (!rows.find((x) => x.id === row.id)) rows.push(row);
      for (const it of fx.items) if (!items.find((x) => x.id === it.id)) items.push(it);
    }
    const nows = gens.map((g) => callFacts(g).now);
    const orgs = gens.map((g) => callFacts(g).org);
    // one clock per call: bnNumber takes one clock, so replay call by call carrying the after-state
    let state = rows;
    const mine = [];
    for (let i = 0; i < gens.length; i++) {
      const res = bnNumber(state, items, [gens[i].params], { now: nows[i], firstLvDeptId: orgs[i] });
      const x = res.results[0] || {};
      mine.push(x.ok ? x.batch_number : "ERR:" + x.message);
      state = state.map((row) => {
        const st = res.configs[row.id];
        if (!st) return row;
        const n = Object.assign({}, row, { running_number: st.after.running_number });
        if (st.after.last_reset_date === null) delete n.last_reset_date;
        else n.last_reset_date = st.after.last_reset_date;
        return n;
      });
    }
    // and in ONE call when every call shares the clock that matters (no "Document Created Date")
    const created = rows.some((x) => x.date_format === "Document Created Date");
    const one = created ? null : bnNumber(rows, items, gens.map((g) => g.params), { now: nows[0], firstLvDeptId: orgs[0] });
    const oneNos = one ? one.results.map((x) => (x.ok ? x.batch_number : "ERR:" + x.message)) : null;
    seq.calls += gens.length;
    const same = JSON.stringify(mine) === JSON.stringify(rec.slice(0, mine.length)) && (!oneNos || JSON.stringify(oneNos) === JSON.stringify(mine));
    if (same) seq.same++;
    else {
      seq.different++;
      notes.push(`seq ${r.env} ${r.id}: mine ${JSON.stringify(mine)} one ${JSON.stringify(oneNos)} | rec ${JSON.stringify(rec)}`);
    }
  }
}
if (mode.seq.length) console.log("GR sequences:", JSON.stringify(seq));
for (const n of notes.slice(0, 30)) console.log("  " + n);
