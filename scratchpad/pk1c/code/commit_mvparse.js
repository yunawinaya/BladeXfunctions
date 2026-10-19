// PICKING_BULK_COMMIT 1c - the move's parts, written by PREPARE under the payload's nonce: every moved GD's verdict (VRD),
// movements (ENG, the job's one INVENTORY_BULK_APPLY operation, GD by GD), reservation writes (RES) and the moved lines'
// allocation before / after (ALC); with the id lists PM1-PM3 read the rows by.
const commitMoveParse = function commitMoveParse(entry, rows) {
  const out = { ok: "NO", movements: [], res: { updates: [], creates: [] }, alc: [], resIdsJson: '["0"]', lineIdsJson: '["0"]', counts: {}, why: "" };
  const text = {};
  for (const r of pmList(rows).slice().sort((a, b) => (pmS(a.step_name) < pmS(b.step_name) ? -1 : 1))) {
    const p = pmS(r.step_name).split("|");
    if (p.length !== 5 || p[1] !== pmS(entry.moveNonce)) continue;
    const k = p[2] + "|" + p[3];
    text[k] = (text[k] || "") + (r.result_ref === undefined || r.result_ref === null ? "" : String(r.result_ref));
  }
  const part = (k) => (text[k] === undefined ? undefined : pmParseJ(text[k]));
  const gis = Object.keys(text).filter((k) => k.indexOf("VRD|") === 0).map((k) => k.slice(4)).sort();
  if (!gis.length) return Object.assign(out, { why: "the move's parts are missing" });
  for (const gi of gis) {
    const v = part("VRD|" + gi);
    if (!v || pmS(v.verdict) !== "OK") return Object.assign(out, { why: "the re-plan of a moved delivery is not OK (" + gi + ")" });
    const eng = part("ENG|" + gi);
    const res = part("RES|" + gi);
    if (!Array.isArray(eng) || !res) return Object.assign(out, { why: "a moved delivery's parts are incomplete (" + gi + ")" });
    out.movements = out.movements.concat(eng);
    out.res.updates = out.res.updates.concat(pmList(res.updates));
    out.res.creates = out.res.creates.concat(pmList(res.creates));
  }
  const alc = part("ALC|000");
  if (!Array.isArray(alc) || !alc.length) return Object.assign(out, { why: "the moved lines' allocation part is missing" });
  out.alc = alc;
  const ids = (xs) => { const u = xs.map(pmS).filter((x) => /^[0-9]{1,20}$/.test(x)); return JSON.stringify(u.length ? u : ["0"]); };
  return Object.assign(out, { ok: "YES", resIdsJson: ids(out.res.updates.map((u) => u.id)), lineIdsJson: ids(alc.map((l) => l.id)),
    counts: { gds: gis.length, lines: alc.length, movements: out.movements.length, reservation_updates: out.res.updates.length, reservation_creates: out.res.creates.length } });
};
const res = commitMoveParse([{{node:code_node_PCentry.data}}][0], [{{node:sql_node_PCmvparts.data}}][0]);
console.log("commit move parts", JSON.stringify({ ok: res.ok, counts: res.counts, why: res.why }));
return res;
