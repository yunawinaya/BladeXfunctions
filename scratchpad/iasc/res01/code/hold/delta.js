// IA_HOLD - Delta: an unfinished run's rows resolved from the engine's record (DONE -> finish, nothing moved -> roll back,
// uncertain -> Needs review, no new move), then what this IA wants held against what it holds; the keys whose free stock to read
const hdDeltaStep = function hdDeltaStep(g, st, items, opsRows, consumedRows, plan) {
  const rows = Array.isArray(st.rows) ? st.rows : [];
  const state = {};
  (opsRows || []).forEach((o) => (state[hdS(o.op)] = o));
  const rec = hdRecover(rows, state);
  const fix = { publish: [], close: [], drop: [], restore: [] };
  const after = {};
  rows.forEach((r) => (after[hdS(r.id)] = Object.assign({}, r)));
  let uncertain = false;
  rec.forEach((x) => {
    if (x.outcome === "UNCERTAIN") return void (uncertain = true);
    const f = hdFinish(x.outcome, x.rows);
    ["publish", "close", "drop", "restore"].forEach((k) => (fix[k] = fix[k].concat(f[k])));
    f.publish.concat(f.restore).forEach((u) => (after[u.id].status = "Allocated"));
    f.close.concat(f.drop).forEach((u) => delete after[u.id]);
  });
  const rowsAfter = Object.keys(after).map((k) => after[k]);
  const out = { route: uncertain ? "REVIEW" : "GO", fix: fix, needPublish: fix.publish.length ? "YES" : "NO", needClose: fix.close.length ? "YES" : "NO",
    needDrop: fix.drop.length ? "YES" : "NO", needRestore: fix.restore.length ? "YES" : "NO", rowsAfter: rowsAfter, holds: [], releases: [], notHeld: [], keysJson: "[]", mats: "0",
    needBal: "NO", plant: /^[0-9]{1,20}$/.test(hdS((st.ia || {}).plant_id)) ? hdS(st.ia.plant_id) : "0", deliver: [], over: [], under: [], why: "" };
  if (uncertain) return out;
  if (g.op === "CLOSE" && hdS((plan || {}).badNo) === "YES") return Object.assign(out, { route: "REVIEW", why: "its number cannot be used to read what its completion issued" });
  if (g.op === "CLOSE") {
    // after completion: what it issued from Reserved (less this cycle's deliveries) delivers the holds, the rest is released
    const net = hdNet(consumedRows, items);
    // the completion's own split (split.js) says which hold - line and category - each issue from Reserved came from (review M1)
    const own = rowsAfter.filter((r) => hdS(r.status) === "Allocated" && Number(r.is_deleted) !== 1);
    const split = resSplitLines(st.lines || [], { rows: own, live: 0 }, Object.keys(items || {}).map((k) => items[k]));
    const cl = hdClose(rowsAfter, net.net, items, split.used);
    const keys = [];
    const mats = [];
    cl.releases.forEach((x) => {
      const key = [hdS(x.frag.materialId), hdS(x.frag.binId), hdS(x.frag.batchId) || "0"];
      if (!key.every((v) => HD_ID.test(v))) return;
      keys.push(key);
      if (mats.indexOf(key[0]) < 0) mats.push(key[0]);
    });
    return Object.assign(out, { releases: cl.releases, deliver: cl.deliver, over: cl.over, under: net.under,
      keysJson: "[" + keys.map((k) => "[" + k.join(",") + "]").join(",") + "]", mats: mats.length ? mats.join(",") : "0", needBal: keys.length ? "YES" : "NO" });
  }
  const w = g.op === "RELEASE_ALL" ? { fragments: [], notHeld: [] } : hdWanted({ lines: st.lines || [], items: items });
  const d = hdDelta(w.fragments, hdHeld(rowsAfter));
  // only digit ids reach the SQL text (the items read returns digit ids only; a pick's bin and batch come from the client):
  // a hold on anything else is not made (PICK), a release always comes from a stored row (bigint ids)
  const idsOk = (f) => [hdS(f.materialId), hdS(f.binId), hdS(f.batchId) || "0"].every((v) => HD_ID.test(v));
  const notHeld = w.notHeld.slice();
  const holds = d.holds.filter((h) => (idsOk(h.frag) ? true : (notHeld.push({ lineId: h.frag.lineId, reason: "PICK" }), false)));
  const releases = d.releases.filter((r) => idsOk(r.frag));
  const keys = [];
  const mats = [];
  holds.concat(releases).forEach((x) => {
    const key = [hdS(x.frag.materialId), hdS(x.frag.binId), hdS(x.frag.batchId) || "0"];
    keys.push(key);
    if (mats.indexOf(key[0]) < 0) mats.push(key[0]);
  });
  out.holds = holds;
  out.releases = releases;
  out.notHeld = notHeld;
  // the JSON text written from the digit strings: Number() would round a 19-digit id (live run 10-21 12:14 read no balance)
  out.keysJson = "[" + keys.map((k) => "[" + k.join(",") + "]").join(",") + "]";
  out.mats = mats.length ? mats.join(",") : "0";
  out.needBal = keys.length ? "YES" : "NO";
  return out;
};
const itemsOf = (rows) => {
  const out = {};
  hdSqlRows(rows).forEach((i) => (out[hdS(i.id)] = i));
  return out;
};
const res = hdDeltaStep([{{node:code_node_HDguard.data}}][0] || {}, hdSqlRow([{{node:sql_node_HDstate.data}}][0]), itemsOf([{{node:sql_node_HDitems.data}}][0]),
  hdSqlRows([{{node:sql_node_HDops.data}}][0]), hdSqlRows([{{node:sql_node_HDconsumed.data}}][0]), [{{node:code_node_HDplan.data}}][0] || {});
console.log("hold delta", JSON.stringify({ route: res.route, holds: res.holds.length, releases: res.releases.length, fix: [res.fix.publish.length, res.fix.close.length,
  res.fix.drop.length, res.fix.restore.length] }));
return res;
