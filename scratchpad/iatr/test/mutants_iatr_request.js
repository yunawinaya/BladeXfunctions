// node scratchpad/iatr/test/mutants_iatr_request.js - each mutant of the built IA_TRANSFER_REQUEST must make test_iatr_request.js fail
// ("all" = every inlined copy of the anchor)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const REPO = path.join(__dirname, "..", "..", "..");
const FILE = path.join(REPO, "Item Assembly & BOM", "TransferRequest", "IA_TRANSFER_REQUEST.json");
const base = fs.readFileSync(FILE, "utf8");
const J = (s) => JSON.stringify(s).slice(1, -1);
const MUTANTS = [
  ["an answer goes on to the writes", J("'{{node:code_node_TRdecide.data.route}}' != 'GO'"), J("'{{node:code_node_TRdecide.data.route}}' == 'NEVER'")],
  ["the IA's organisation compared with the client's own", J("member: W.member,\n    org: g.org,"), J("member: W.member,\n    org: s(A.ia && A.ia.org),")],
  ["a lost claim goes on", J("'{{node:code_node_TRwin.data.route}}' == 'LOSE'"), J("'{{node:code_node_TRwin.data.route}}' == 'NEVER'")],
  ["a REFRESH cancels", J("'{{node:code_node_TRdecide.data.isRefresh}}' == 'YES'"), J("'{{node:code_node_TRdecide.data.isRefresh}}' == 'NEVER'")],
  ["a CREATE refreshes", J("'{{node:code_node_TRdecide.data.isCreate}}' == 'YES'"), J("'{{node:code_node_TRdecide.data.isCreate}}' == 'NEVER'")],
  ["the IA never linked", J('needLink: link === noLink ? "NO" : "YES"'), J('needLink: "NO"')],
  ["a replacement not linked to the IA", J("  const link = created ? { id: g.ia,"), J('  const link = g.op === "CREATE" ? { id: g.ia,')],
  ["the request written Draft", J('out.lot = { stock_movement_status: "Requested",'), J('out.lot = { stock_movement_status: "Draft",')],
  ["no number issued", J('stock_movement_no: "issued",'), J('stock_movement_no: "",')],
  ["no number rule", J("stock_movement_no_type: s(D.rule),"), J('stock_movement_no_type: "",')],
  ["no purpose", J("transfer_purpose: IATR_PURPOSE, source_ia_id: s(ia.id),"), J('transfer_purpose: "", source_ia_id: s(ia.id),')],
  ["DEFECT: the claim freed by another id", J('const free = { id: s(win.claimId) || "0", step_status: "FREE",'), J('const free = { id: "0", step_status: "FREE",')],
  ["the claim freed by another id", J('const free = (ok) => ({ id: s(win.claimId) || "0", step_status: "FREE",'), J('const free = (ok) => ({ id: "0", step_status: "FREE",')],
  ["a lost claim not freed", J('needFree: w.claimId ? "YES" : "NO"'), J('needFree: "NO"')],
  ["the cancel keeps the job link", J('stock_movement_status: "Cancelled", lot_v2_job_id: "",'), J('stock_movement_status: "Cancelled",')],
  ["the refresh keeps the revision", J("source_ia_rev: String(d.rev),"), J('source_ia_rev: "1",')],
  ["the refresh log replaced", J("request_log: iatrLog(named.log, Object.assign(entry, { skipped: d.skipped || [] })),"), J('request_log: iatrLog("", entry),')],
  ["CANCEL reads the lines", J('needLines: op === "CANCEL" ? "NO" : "YES"'), J('needLines: "YES"')],
  ["no read has lines", J('needLines: op === "CANCEL" ? "NO" : "YES"'), J('needLines: "NO"')],
  ["every operation reads a destination", J('needDest: dest ? "YES" : "NO"'), J('needDest: "YES"')],
  ["no named request read", J('needNamed: named ? "YES" : "NO"'), J('needNamed: "NO"')],
  ["DEFECT's reads never asked", J('needDefect: op === "DEFECT" ? "YES" : "NO"'), J('needDefect: "NO"')],
  ["the claim's key without the operation", J('result_ref: (g.key + "|" + g.op).slice(0, 250)'), J("result_ref: (g.key).slice(0, 250)")],
  ["the claim number reused", J("const name = \"CLAIM|\" + ((parseInt(W.max, 10) || 0) + 1);"), J("const name = \"CLAIM|\" + (parseInt(W.max, 10) || 1);")],
  ["no requester", J("const user = s(W.user);"), J('const user = "";')],
  ["the read-back fingerprint not compared", J("if (ok && g.op !== \"CANCEL\") ok = s(lot.fp) === s(want.fp) && "), J("if (ok && g.op !== \"CANCEL\") ok = ")],
  ["the read-back lines not compared", J(" && JSON.stringify(sources) === JSON.stringify(want.sources || []);"), J(";")],
  ["the read-back status not compared", J(" && s(lot.status) === s(want.status) &&"), J(" &&")],
  ["the read-back source not compared", J(" && iatrId(lot.source) === iatrId(g.ia) &&"), J(" &&")],
  ["an unnumbered request confirmed", J('if (ok && created) ok = no !== "" && no !== "issued" && no !== "draft";'), J("")],
  ["the guard takes a CREATE without the IA fingerprint", J('if ((dest || op === "REFRESH") && !/^IA1:'), J('if (false && !/^IA1:')],
  ["the guard takes bad defects", J("  if (!df.ok) return bad(df.message);\n"), J("")],
  // v8: reserved requests (RESERVED_REQUEST_PLAN.md Task 7)
  ["the setup never read", J("const setupOn = rrSetupOn(x.setupRows, ia.org);"), J("const setupOn = true;"), "all"],
  ["a Draft IA requests", J('  if (status !== "Created") {\n    return answer(400, "Only a Created Item Assembly'), J('  if (false) {\n    return answer(400, "Only a Created Item Assembly'), "all"],
  ["the IA's reservation never read", J("holds: A.holds, reqs: Q.reqs,"), J("holds: [], reqs: Q.reqs,")],
  ["a replacement not linked to the receipt", J("replacement_for_id: d.replacementForId,"), J('replacement_for_id: "",')],
  ["DEFECT: a refused move goes on", J("'{{node:code_node_TRdefectAns.data.route}}' == 'STOP'"), J("'{{node:code_node_TRdefectAns.data.route}}' == 'NEVER'")],
  ["DEFECT: one engine operation for every click", J('opKey: "IAD|" + iatrHash(g.key),'), J('opKey: "IAD|" + g.ia,')],
  ["DEFECT: the reservation rows not written", J("holdRows: d.holdRows, iaRows: d.iaRows, logRow: d.logRow };"), J("holdRows: [], iaRows: d.iaRows, logRow: d.logRow };")],
  ["DEFECT: the read-back not compared", J("    if (!ok) return unconfirmed(null);\n"), J("")],
  ["DEFECT: the engine's 400 answered 500", J('code: code === "409" || code === "400" ? code : "500"'), J('code: code === "409" ? code : "500"')],
  ["the guard takes no session user", J('if (!digits(inp.uid)) return bad("no session user");'), J("")],
  ["the guard takes non-digit ids", J('const wrong = ["ia_id", "organization_id"]'), J("const wrong = []")],
  ["the guard takes no click key", J('if (op !== "STATUS" && !/^[A-Za-z0-9|:_.-]{8,128}$/.test(s(inp.idempotency_key)))'), J("if (false)")],
  ["the bare-number parse dropped", J("(-?\\d{16,})(?=\\s*(?:[,\\]}]|$))/g, (m, pre, n) => (n === undefined ? m : pre + '\"' + n + '\"'))) || {};"),
    J("(-?\\d{30,})(?=\\s*(?:[,\\]}]|$))/g, (m, pre, n) => (n === undefined ? m : pre + '\"' + n + '\"'))) || {};"), "all"],
  // CANCEL of a replacement: the IA's link back to the received request (Task 10)
  ["decide: the relink not passed on", J("    out.relink = d.relink || {};\n"), ""],
  ["done: the relink never written", J('    : g.op === "CANCEL" && dec.relink && s(dec.relink.transfer_request_id) ? dec.relink : noLink;'), J("    : noLink;")],
  ["done: an empty relink written", J('    : g.op === "CANCEL" && dec.relink && s(dec.relink.transfer_request_id) ? dec.relink : noLink;'), J('    : g.op === "CANCEL" ? dec.relink : noLink;')],
];
let survived = 0;
for (const [name, from, to, mode] of MUTANTS) {
  const n = base.split(from).length - 1;
  if (n < 1 || (mode !== "all" && n !== 1)) {
    console.log("BROKEN mutant (anchor found " + n + " times): " + name);
    survived++;
    continue;
  }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "iatr-rqm-")), "IA_TRANSFER_REQUEST.json");
  fs.writeFileSync(f, mode === "all" ? base.split(from).join(to) : base.replace(from, () => to));
  const r = spawnSync(process.execPath, [path.join(__dirname, "test_iatr_request.js")], { env: Object.assign({}, process.env, { IATR_REQUEST: f }), encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  } else console.log("killed   " + name + (mode === "all" ? " (" + n + " copies)" : ""));
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
