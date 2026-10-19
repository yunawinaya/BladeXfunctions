// (a) The lifted IA_REVERT v4 bodies (revert/lift/lifted_revert.js) reproduce EVERY recorded classic run exactly: each recorded
// code_node_iaRvParams / _iaRvPrep / _iaRvBuild fed the values the platform substituted into it (its variableMap) gives the
// recorded output, through the platform's output rules (declared keys, nulls dropped, int truncated); the build runs on the
// recorded run's clock (its docDate). usage: node lifted_vs_recorded.js [fixture dir; default H.FIXTURES, outside the repo]
const H = require("./_harness");
const dir = process.argv[2] || H.FIXTURES;
const all = H.runs(dir);
if (!all.length) {
  console.log("NOTICE: no recorded run fixture: lifted vs recorded skipped");
  process.exit(0);
}
let nodes = 0;
for (const r of all) {
  const docDate = (() => {
    const b = r.nodes.code_node_iaRvBuild;
    const d = b && b.resp && b.resp.data;
    const x = d && ((d.subtracts || [])[0] || (d.adds || [])[0]);
    return x ? Date.parse(x.doc_date) : undefined;
  })();
  const sb = H.load([], docDate);
  for (const id of ["code_node_iaRvParams", "code_node_iaRvPrep", "code_node_iaRvBuild"]) {
    const n = r.nodes[id];
    if (!n) continue;
    nodes++;
    // the recorded body is the base's body (the lift's source is what ran)
    const base = sb.__N[id];
    H.ok(!!base, r.env + " " + r.id + " " + id + ": lifted");
    const got = H.runLifted(sb, id, n.vars || {});
    const want = n.resp && n.resp.data;
    const d = H.diff(got, want);
    H.ok(!d, r.env + " " + r.id + " " + id + ": the lifted output = the recorded output", d);
    H.ok(H.canon(n.decl) === H.canon(base.decl), r.env + " " + r.id + " " + id + ": declared outputs = the base's", { rec: n.decl, base: base.decl });
  }
  console.log("ok   " + r.env + " " + r.id + " (" + r.exit + "): " + ["code_node_iaRvParams", "code_node_iaRvPrep", "code_node_iaRvBuild"].filter((x) => r.nodes[x]).length + " node(s) reproduced"
    + (docDate ? " on the run's clock " + new Date(docDate).toISOString() : ""));
}
H.ok(nodes >= all.length, "every recorded lifted node compared", nodes);
H.done("lifted vs recorded (" + all.length + " runs, " + nodes + " nodes)");
