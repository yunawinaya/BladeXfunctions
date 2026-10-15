// Harnesses (rebuild) + (b) + the chain: per recorded PUTAWAY run, the V2 request is derived from what the client sent
// (allData's rows that put something away, mapped to the stored lines: by id, else by line_index + item - mobile sends no
// ids and may send only some lines), the classic allData is rebuilt from the stored TO the run read (get_node_C64LC1sr) +
// that request (pwRebuild), and pwChain runs on it with the run's own reads (setup, Items, in-transit rows, other TOs, QI
// lots; the source batch dates = what the run's SUBTRACT_INVENTORY calls answered).
// usage: TZ=Asia/Kuala_Lumpur node chain_parity.js <runs.jsonl> [...] [--sql <sqldir>]
// Checks, per run:
//   rebuild    the rebuilt allData vs the recorded allData on every field the lifted bodies read, row by mapped row
//   nodes      each lifted PUTAWAY node the run recorded: same output; known differences are counted by cause and masked
//   movements  (b) every SUBTRACT_INVENTORY / ADD_INVENTORY call the chain plans vs the child run the confirmation made:
//              every parameter equal
//   bbal       (--sql) today's item_batch_balance row (prepare SQL `bbal`) vs the dates each recorded SUBTRACT answered
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const D = path.join(__dirname, "..");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
const args = process.argv.slice(2);
const sqldir = args.indexOf("--sql") >= 0 ? args[args.indexOf("--sql") + 1] : null;
const files = args.filter((a, i) => a !== "--sql" && args[i - 1] !== "--sql");
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const s = (v) => (v === undefined || v === null ? "" : String(v));
const num = (v) => Number(v || 0);
const norm = (v) => (v === undefined || v === null || v === "" ? "" : typeof v === "number" ? v : /^-?\d{1,15}(\.\d+)?$/.test(String(v).trim()) ? Number(v) : String(v));

function sandbox() {
  const sb = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp };
  const RealDate = Date;
  let now = RealDate.now();
  function FakeDate(...a) {
    if (!(this instanceof FakeDate)) return new RealDate(now).toString();
    return a.length ? new RealDate(...a) : new RealDate(now);
  }
  FakeDate.now = () => now;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;
  sb.Date = FakeDate;
  sb.__setNow = (t) => { now = t; };
  vm.createContext(sb);
  for (const f of ["lift/runtime.js", "lift/lifted_prepare.js", "code/prepare/adapter.js", "code/prepare/chain.js", "code/prepare/plan.js"]) vm.runInContext(fs.readFileSync(path.join(D, f), "utf8"), sb, { filename: f });
  vm.runInContext("this.pwGates = pwGates; this.pwChain = pwChain; this.pwRebuild = pwRebuild; this.pwRequestRows = pwRequestRows; this.pwAliases = pwAliases; this.pwAdapt = pwAdapt; this.pwPlanA = pwPlanA; this.pwUnalias = pwUnalias; this.pwBbalKey = pwBbalKey;", sb);
  return sb;
}
const sb = sandbox();
// the deployed source of each PUTAWAY node, for "this run ran an older body"
const src = {};
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === "object") {
    if (o.type === "code-node" && o.data && o.data.script) src[o.id] = o.data.script.code;
    Object.values(o).forEach(walk);
  }
})(JSON.parse(fs.readFileSync(path.join(D, "..", "..", "Putaway", "PutawayProcessWorkflow.json"), "utf8")));
const RENAME = [["node:search_node_6yzlT81I.data.data", "node:code_node_PwItems.data.items"], ["node:search_node_ITopen.data.data", "node:code_node_PwTransit.data.rows"]];
const renamed = (code) => RENAME.reduce((c, [a, b]) => c.split("{{" + a + "}}").join("{{" + b + "}}"), code);
const older = (r, id) => r.nodes[id] && r.nodes[id].code !== undefined && renamed(r.nodes[id].code) !== src[id];

const flat = (rows) => (rows || []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
const READ_ROW = ["line_status", "parent_or_child", "is_split", "item_bundle_id", "item_code", "putaway_qty", "pending_process_qty", "target_location", "line_index",
  "qty_to_putaway", "id", "item_uom", "source_bin", "storage_location", "batch_no", "source_inv_category", "target_inv_category", "unit_price", "hu_data", "item_name",
  "item_desc", "remark"];
const READ_ROW_IDLE = ["line_status", "parent_or_child", "is_split", "item_bundle_id", "item_code"];
const READ_HDR = ["id", "update_time", "plant_id", "organization_id", "gr_no", "to_id", "receiving_no", "to_status", "to_id_type"];
const processed = (r) => r.line_status !== "Cancelled" && !(r.parent_or_child === "Parent" && r.is_split === "Yes") && !(r.item_bundle_id && !r.item_code) && num(r.putaway_qty) > 0;

// the client's rows -> the V2 request; each recorded row paired with its stored line (children: their parent's). A split
// child names its parent as "<N> - <k>", N = the client's parent_index + 1 (the mobile client lists the children last)
function deriveRequest(recAll, stored) {
  const top = stored.table_putaway_item || [];
  const byId = {};
  for (const l of flat(top)) byId[s(l.id)] = l;
  const used = {};
  const pairs = [];
  let misaligned = 0;
  const fields = (r) => {
    const o = { qty: num(r.putaway_qty) };
    for (const f of ["target_location", "storage_location", "target_inv_category", "remark"]) if (r[f] !== undefined && r[f] !== null) o[f] = s(r[f]);
    return o;
  };
  const recRows = recAll.table_putaway_item || [];
  let k = -1;
  for (const r of recRows) {
    if (r.parent_or_child === "Child") continue;
    k++;
    let st = r.id && byId[s(r.id)] ? byId[s(r.id)] : null;
    if (!st) st = top.find((l) => !used[s(l.id)] && s(l.line_index) === s(r.line_index) && s(l.item_code) === s(r.item_code)) || null;
    if (!st && top[k] && !used[s(top[k].id)] && s(top[k].item_code) === s(r.item_code)) st = top[k];
    if (!st) misaligned++;
    else used[s(st.id)] = true;
    pairs.push({ rec: r, line: st, child: 0 });
  }
  const parentOf = (child) => {
    const n = s(child.line_index).split(" - ")[0];
    const cands = pairs.filter((p) => !p.child && p.line);
    return (cands.find((p) => p.rec.is_split === "Yes" && String(num(p.rec.parent_index) + 1) === n && s(p.rec.item_code) === s(child.item_code)) ||
      cands.find((p) => p.rec.is_split === "Yes" && s(p.rec.line_index) === n && s(p.rec.item_code) === s(child.item_code)) ||
      cands.find((p) => p.rec.is_split === "Yes" && s(p.rec.item_code) === s(child.item_code)) || null);
  };
  const seq = {};
  for (const r of recRows) {
    if (r.parent_or_child !== "Child") continue;
    const p = parentOf(r);
    if (!p) misaligned++;
    const key = p ? s(p.line.id) : "?";
    seq[key] = (seq[key] || 0) + 1;
    pairs.push({ rec: r, line: p ? p.line : null, child: seq[key] });
  }
  const lines = [];
  for (const p of pairs) {
    if (!p.line || !processed(p.rec)) continue;
    lines.push(Object.assign(p.child ? { parent_id: s(p.line.id) } : { id: s(p.line.id) }, fields(p.rec)));
  }
  // the request lists a split line's rows together, in the client's order
  lines.sort((a, b) => 0);
  return { lines, pairs, misaligned, sentIds: used };
}

const T = { runs: 0, skipped: 0, notEligible: {}, threw: 0, misaligned: 0, route: { same: 0, diff: 0 }, rebuild: { same: 0, diff: 0 }, rebuildKnown: {}, rebuildDiff: {},
  gates: { goOnClassicOk: 0, stopOnClassicRefused: 0, differs: 0 }, nodes: {}, known: {}, olderBody: {}, movements: { same: 0, diff: 0, missing: 0, extra: 0, runs: 0 }, bbal: { same: 0, diff: 0, noRow: 0 } };
const notes = [];
const note = (r, t) => notes.push(`${r.env} ${r.id}: ${t}`);
const bump = (o, k) => (o[k] = (o[k] || 0) + 1);

for (const file of files) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const rec = (id) => (r.nodes[id] && r.nodes[id].resp ? r.nodes[id].resp.data : undefined);
    const st = rec("get_node_C64LC1sr");
    const recAll = (r.params || {}).allData;
    if (!st || !st.count || !recAll || !recAll.table_putaway_item) { T.skipped++; continue; }
    const stored = st.data;
    // what V2 does not take (pwEligibility): such runs stay classic, nothing to compare
    const recFlat = flat(recAll.table_putaway_item);
    const ne = flat(stored.table_putaway_item).some((l) => s(l.item_bundle_id) || (l.children && l.children.length)) ? "bundle"
      : recFlat.some((x) => processed(x) && (s(x.hu_data) || s(x.handling_unit_id))) ? "handling unit"
      : recFlat.some((x) => processed(x) && num(x.is_serialized_item) === 1) ? "serial" : "";
    if (ne) { bump(T.notEligible, ne); continue; }
    T.runs++;
    const der = deriveRequest(recAll, stored);
    if (der.misaligned) { T.misaligned++; note(r, `${der.misaligned} client rows match no stored line`); }
    const subs = (r.subs || []).slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    const adds = (r.adds || []).slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    const bbal = {};
    for (const c of subs) {
      if (!c.params.batch_id) continue;
      const d = (c.resp && c.resp.data) || {};
      bbal[sb.pwBbalKey(c.params.material_id, c.params.location_id, c.params.batch_id)] = { manufacturing_date: d.manufacturing_date, expired_date: d.expired_date };
    }
    sb.__setNow((r.nodes.code_node_qfSZO0bi && r.nodes.code_node_qfSZO0bi.t0) || r.t0);
    let out;
    let prep;
    try {
      sb.__IN = { stored: stored, lines: der.lines };
      prep = vm.runInContext(`(() => {
        const storedById = {};
        for (const l of (__IN.stored.table_putaway_item || []).flatMap((x) => [x].concat(x.children || []))) storedById[String(l.id)] = l;
        const req = pwRequestRows({ lines: __IN.lines }, storedById);
        const aliases = pwAliases(__IN.stored.table_putaway_item);
        const st = JSON.parse(JSON.stringify(__IN.stored));
        for (const l of st.table_putaway_item || []) if (aliases[String(l.id)] !== undefined) l.line_index = aliases[String(l.id)];
        return { req, aliases, st, rb: req.ok ? pwRebuild(st, req, aliases) : null };
      })()`, sb);
    } catch (e) {
      T.threw++;
      note(r, "THREW " + e.stack.split("\n").slice(0, 3).join(" | "));
      continue;
    }
    const classicOk = r.exit === "return_node_NUcmslK4";
    if (!prep.req.ok) {
      // nothing put away: the classic refused it too?
      if (classicOk) { T.route.diff++; note(r, "request refused: " + prep.req.message); } else T.route.same++;
      continue;
    }
    const rebuilt = prep.rb.allData;
    try {
      const items = rec("code_node_PwItems") ? rec("code_node_PwItems").items : rec("search_node_6yzlT81I") ? rec("search_node_6yzlT81I").data : [];
      const transit = rec("code_node_PwTransit") ? rec("code_node_PwTransit").rows : rec("search_node_ITopen") ? rec("search_node_ITopen").data : [];
      sb.__IN = {
        allData: rebuilt, confirmedBy: r.params.confirmed_by, tenantId: r.tenant, uuid: "x",
        reads: { to: { count: 1, data: prep.st }, setup: rec("get_node_ca2032Ub") || { count: 0, data: {} }, items: items, transit: transit,
          others: rec("search_node_SVMdNd3K") || { total: 0, count: 0, data: [] }, qi: rec("search_node_T5BGLPpK") || { total: 0, count: 0, data: [] }, bbal: bbal },
      };
      out = vm.runInContext("pwChain(__IN)", sb);
    } catch (e) {
      T.threw++;
      note(r, "THREW " + e.stack.split("\n").slice(0, 3).join(" | "));
      continue;
    }
    // ---------------------------------------------------------------- rebuild vs what the classic received
    const diffs = [];
    const knownR = (k) => bump(T.rebuildKnown, k);
    for (const f of READ_HDR) {
      if (norm(rebuilt[f]) === norm(recAll[f])) continue;
      if (f === "update_time") knownR("hdr.update_time: the client's copy (the LOOP's lock write bumps the stored one; M7IX2sBi's cache key only)");
      else diffs.push("hdr." + f);
    }
    const rows = rebuilt.table_putaway_item;
    const matched = new Set();
    for (const p of der.pairs) {
      if (!p.line) continue;
      const mine = rows.find((x, i) => !matched.has(i) && s(x.id) === s(p.line.id) && (p.child ? x.parent_or_child === "Child" && s(x.line_index).endsWith(" - " + p.child) : x.parent_or_child !== "Child"));
      if (!mine) {
        if (p.child && !processed(p.rec)) { knownR("a split row with nothing to put away is not part of the request"); continue; }
        diffs.push(`row ${s(p.rec.line_index)} not rebuilt`);
        continue;
      }
      matched.add(rows.indexOf(mine));
      const fields = processed(p.rec) || processed(mine) ? READ_ROW : READ_ROW_IDLE;
      for (const f of fields) {
        const x = norm(f === "line_index" ? sb.pwUnalias(mine[f], prep.aliases) : mine[f]);
        const y = norm(p.rec[f]);
        if (x === y) continue;
        let why = null;
        if (f === "id" && y === "") why = "id: V2 keeps the stored line id (the mobile client sends none)";
        else if (f === "item_desc" && y === "") why = "item_desc: the stored description (the mobile client omits it)";
        else if (f === "line_index" && p.child && x === norm(s(p.line.line_index) + " - " + p.child)) why = "split child line_index: V2 '<stored line_index> - n', the classic client '<parent_index + 1> - n'";
        else if ((f === "pending_process_qty" || f === "qty_to_putaway" || f === "line_status") && !p.child) why = f + ": the stored value (the client's copy differs)";
        else if ((f === "pending_process_qty" || f === "qty_to_putaway") && p.child) why = "split child " + f + ": V2 = the child's quantity (the stored line's pending bounds the sum); the client sent its own copy";
        if (why) knownR(why);
        else { bump(T.rebuildDiff, f); diffs.push(`${s(p.rec.line_index)}.${f}: ${JSON.stringify(mine[f])} | rec ${JSON.stringify(p.rec[f])}`); }
      }
    }
    rows.forEach((x, i) => {
      if (matched.has(i)) return;
      if (num(x.putaway_qty) === 0) knownR("a stored line the client did not send: rebuilt with nothing to put away");
      else diffs.push(`row ${s(x.line_index)} puts away ${x.putaway_qty} but the client did not send it`);
    });
    if (diffs.length) { T.rebuild.diff++; note(r, "rebuild: " + diffs.slice(0, 6).join("; ")); } else T.rebuild.same++;
    // ---------------------------------------------------------------- route: the classic's exit vs the chain's
    if ((out.route === "PLANNED") === classicOk) T.route.same++;
    else if (out.route === "PLANNED" && r.exit === "return_node_p3kLaRSX" && recFlat.some((x) => x.parent_or_child === "Child" && num(x.putaway_qty) > num(x.pending_process_qty))) {
      // the classic also checks each split row against the client's own copy of its pending quantity (a mobile split sent
      // 0 there); V2 checks the rows against the stored line's pending, as a sum (S8GL6e4o's stored check)
      bump(T.route, "knownSplitChildCopy");
      note(r, `route (known): V2 PLANNED, the classic refused split rows over the client's own pending copy`);
    } else { T.route.diff++; note(r, `route ${out.route} ${out.code} ${String(out.message).slice(0, 200)} | classic exit ${r.exit}`); }
    // ---------------------------------------------------------------- nodes
    const storedIds = {};
    for (const l of flat(stored.table_putaway_item)) storedIds[s(l.id)] = l;
    for (const id of ["code_node_S8GL6e4o", "code_node_qfSZO0bi", "code_node_KbJLkjP8", "code_node_M7XzDZ48", "code_node_ITmatch", "code_node_ds7jurnq"]) {
      const recd = rec(id);
      if (recd === undefined || !out.ran.includes(id)) continue;
      if (older(r, id)) { bump(T.olderBody, id); continue; }
      const t = (T.nodes[id] = T.nodes[id] || { same: 0, sameAfterKnown: 0, diff: 0 });
      // as the plan reads them: the line_index aliases of lines that share a line_index mapped back
      const mine = JSON.parse(sb.pwUnalias(JSON.stringify(out.ctx.putaway["node:" + id] ? out.ctx.putaway["node:" + id].data : null), prep.aliases));
      const known = new Set();
      if (Object.keys(prep.aliases).length) known.add("lines sharing a line_index ran under per-line aliases");
      const walk = (x, y) => {
        if (!x || !y || typeof x !== "object" || typeof y !== "object") return;
        for (const k of Object.keys(x)) {
          if ((k === "putaway_line_id" || k === "target_doc_line_id") && s(y[k]) === "" && storedIds[s(x[k])]) { x[k] = y[k]; known.add("putaway_line_id / target_doc_line_id: V2's stored line id (the client sent none)"); }
          else if (k === "item_desc" && s(y[k]) === "" && s(x[k]) !== "") { x[k] = y[k]; known.add("record item_desc: the stored description (the mobile client omits it)"); }
          else if (k === "confirmed_at" && s(x[k]) !== s(y[k]) && Math.abs(Date.parse(s(x[k]).replace(" ", "T") + "Z") - Date.parse(s(y[k]).replace(" ", "T") + "Z")) <= 1000) { x[k] = y[k]; known.add("confirmed_at within the node's second (clock)"); }
          else walk(x[k], y[k]);
        }
      };
      walk(mine, recd);
      if (id === "code_node_qfSZO0bi" && mine && recd && mine.totalOriginalQuantity !== recd.totalOriginalQuantity && Object.keys(der.sentIds).length < (stored.table_putaway_item || []).length) {
        mine.totalOriginalQuantity = recd.totalOriginalQuantity;
        known.add("totalOriginalQuantity (read by nothing): V2 counts every stored line, the client sent some");
      }
      const A = JSON.stringify(canon(mine));
      const B = JSON.stringify(canon(recd));
      for (const k of known) bump(T.known, id + " " + k);
      if (A === B) t[known.size ? "sameAfterKnown" : "same"]++;
      else {
        t.diff++;
        const o = [];
        const w = (x, y, p) => {
          if (o.length > 5 || JSON.stringify(x) === JSON.stringify(y)) return;
          if (x && y && typeof x === "object" && typeof y === "object" && Array.isArray(x) === Array.isArray(y)) {
            for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) w(x[k], y[k], p + "." + k);
          } else o.push(`${p}: ${JSON.stringify(x)?.slice(0, 120)} | rec ${JSON.stringify(y)?.slice(0, 120)}`);
        };
        w(JSON.parse(A), JSON.parse(B), "");
        note(r, `node ${id}\n      ` + o.join("\n      "));
      }
    }
    // ---------------------------------------------------------------- SUBMIT's gates (pwGates) on the same request + the stored TO
    {
      const h = Object.assign({}, stored, { is_processing: 0 });
      delete h.table_putaway_item;
      delete h.table_putaway_records;
      const items = rec("code_node_PwItems") ? rec("code_node_PwItems").items : rec("search_node_6yzlT81I") ? rec("search_node_6yzlT81I").data : [];
      const S = { hdr: [{ j: JSON.stringify(h), lock_age_sec: 0, gr_status: "Received" }], lines: flat(stored.table_putaway_item).map((l) => ({ j: JSON.stringify(Object.assign({}, l, { children: undefined })) })),
        items: items.map((i) => ({ j: JSON.stringify(Object.assign({ serial_number_management: 0, stock_control: 1 }, i)) })), cost: [] };
      const g = sb.pwGates({ request: { lines: der.lines }, S: S, tenantId: r.tenant, confirmedBy: r.params.confirmed_by });
      if (g.route === "GO" && classicOk) T.gates.goOnClassicOk++;
      else if (g.route === "STOP" && !classicOk) T.gates.stopOnClassicRefused++;
      else if (g.route === "GO" && r.exit === "return_node_p3kLaRSX" && recFlat.some((x) => x.parent_or_child === "Child" && num(x.putaway_qty) > num(x.pending_process_qty))) bump(T.gates, "knownSplitChildCopy");
      else { T.gates.differs++; note(r, `gates ${g.route} ${g.code} ${s(g.message).slice(0, 160)} | classic exit ${r.exit}`); }
    }
    // ---------------------------------------------------------------- (b) movements vs the child runs
    if (out.route === "PLANNED" && classicOk) {
      T.movements.runs++;
      const recCalls = [];
      for (let i = 0; i < Math.max(subs.length, adds.length); i++) {
        if (subs[i]) recCalls.push({ direction: "SUBTRACT", run: subs[i] });
        if (adds[i]) recCalls.push({ direction: "ADD", run: adds[i] });
      }
      for (let i = 0; i < Math.max(out.calls.length, recCalls.length); i++) {
        const x = out.calls[i];
        const y = recCalls[i];
        if (!x) { T.movements.missing++; note(r, `child run ${i} (${y.direction} ${y.run.id}) has no planned movement`); continue; }
        if (!y) { T.movements.extra++; note(r, `planned movement ${i} (${x.direction}) has no child run`); continue; }
        const want = y.run.params;
        const got = x.params;
        const d = [];
        if (x.direction !== y.direction) d.push(`direction ${x.direction} | rec ${y.direction}`);
        for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) if (JSON.stringify(got[k]) !== JSON.stringify(want[k])) d.push(`${k}: ${JSON.stringify(got[k])} | rec ${JSON.stringify(want[k])}`);
        if (d.length) { T.movements.diff++; note(r, `movement ${i}: ` + d.join("; ")); } else T.movements.same++;
      }
    }
    // ---------------------------------------------------------------- the bbal read vs the dates the recorded SUBTRACTs answered
    if (sqldir && classicOk) {
      const f = path.join(sqldir, `${r.env}_${s(recAll.id)}.json`);
      if (fs.existsSync(f)) {
        const A = sb.pwAdapt(JSON.parse(fs.readFileSync(f, "utf8")));
        for (const c of subs) {
          if (!c.params.batch_id) continue;
          const row = A.bbal[sb.pwBbalKey(c.params.material_id, c.params.location_id, c.params.batch_id)];
          const d = (c.resp && c.resp.data) || {};
          if (!row) { T.bbal.noRow++; continue; }
          if (s(row.manufacturing_date) === s(d.manufacturing_date) && s(row.expired_date) === s(d.expired_date)) T.bbal.same++;
          else { T.bbal.diff++; note(r, `bbal ${c.params.batch_id}: ${s(row.manufacturing_date)} / ${s(row.expired_date)} | rec ${s(d.manufacturing_date)} / ${s(d.expired_date)}`); }
        }
      }
    }
  }
}
console.log(JSON.stringify(T, null, 1));
for (const n of notes.slice(0, Number(process.env.SHOW || 40))) console.log("  " + n);
