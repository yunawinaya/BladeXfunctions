// prep_vals.js <round-1 rows.json>: the assembled VPprep node on a stored receipt's round-1 rows, the receipt presented as
// locked by the test job -> its answer (as the platform hands it on) on stdout. run_prepare_sql.py takes round 2's sql*
// values from it.
const fs = require("fs");
const H = require("./_harness");
const S = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!S.hdr || !S.hdr.length) {
  process.stdout.write(JSON.stringify({ route: "FAIL", code: "GRV_INVALID_DATA", message: "no receipt row" }));
  process.exit(0);
}
const L = H.locked(S);
const r = H.runNode("VPprep", H.prepCtx(L.entry, S, L.hdr, L.lock));
if (r.missing.length) {
  console.error("tokens with no value: " + r.missing.join(", "));
  process.exit(1);
}
process.stdout.write(JSON.stringify(r.out));
