// node scratchpad/iasc/test/mutants_iatr_wf.js - each mutant of the BUILT IA_SAVE v15 / IA_V2_SUBMIT v7 (the IA transfer request guard,
// classic/patch_v15.py + submit/patch_v7.py, built into a temp folder: the repo's files are v16 / v8 now, see mutants_iatr_wf2.js) must make
// test_v15_sim.js / sim_submit_v7.js fail. A text mutant replaces its JSON-escaped anchor ("all" = every inlined copy); a function mutant
// edits the parsed workflow.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const IASC = path.join(__dirname, "..");
const REPO = path.join(IASC, "..", "..");
const BUILT = path.join(REPO, "Item Assembly & BOM", "SmallCycle");
const J = (s) => JSON.stringify(s).slice(1, -1);
// v14 / v6 built once (the tests' bases)
const base = (script, file) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "iatr-wf-base-"));
  const r = spawnSync("python3", [path.join(IASC, script), "--write"], { env: Object.assign({}, process.env, { IASC_OUT: out }), encoding: "utf8" });
  if (r.status !== 0) throw new Error(script + ": " + r.stderr.slice(-800));
  return path.join(out, file);
};
const TARGET = {
  SAVE: { file: "IA_SAVE.json", env: "IA_V15", test: "test_v15_sim.js", base: { IA_V14: base("classic/patch_v14.py", "IA_SAVE.json") } },
  SUBMIT: { file: "IA_V2_SUBMIT.json", env: "IA_V7", test: "sim_submit_v7.js", base: { IA_V6: base("submit/patch_v6.py", "IA_V2_SUBMIT.json") } },
};
const node = (doc, id) => {
  let hit = null;
  const walk = (n) => {
    if (hit || !n || typeof n !== "object") return;
    if (n.id === id && n.type) hit = n;
    else Object.values(n).forEach(walk);
  };
  walk(doc.nodes);
  return hit;
};
const undeclare = (id, name) => (doc) => {
  const d = node(doc, id).data;
  const before = d.response_json.length;
  d.response_json = d.response_json.filter((r) => r.name !== name);
  if (d.response_json.length !== before - 1) throw new Error("no " + name + " declared on " + id);
};
const SAVE_IN = "{{node:code_node_IAguardIn.data.";
const SUB_G = "{{node:code_node_ISguard.data.";
const MUTANTS = [
  // ---- IA_SAVE: the read
  ["SAVE", "the read's gate always closed", J("IF('" + SAVE_IN + "trRead}}' = 'YES' OR"), J("IF('NO' = 'YES' OR")],
  ["SAVE", "the read's gate always open (a Draft save reads it)", J("IF('" + SAVE_IN + "trRead}}' = 'YES' OR"), J("IF('YES' = 'YES' OR")],
  ["SAVE", "a stored Created never opens the read", J("OR h.item_assembly_status <> 'Draft',"), J("OR 1 = 0,")],
  ["SAVE", "another IA's request", J("rq.source_ia_id = '" + SAVE_IN + "iaId}}'"), J("rq.source_ia_id = '0'")],
  ["SAVE", "any tenant's request", J("rq.tenant_id = '" + SAVE_IN + "tenantId}}' AND rq.is_deleted = 0"), J("rq.is_deleted = 0")],
  ["SAVE", "deleted requests read", J("rq.tenant_id = '" + SAVE_IN + "tenantId}}' AND rq.is_deleted = 0"), J("rq.tenant_id = '" + SAVE_IN + "tenantId}}'")],
  ["SAVE", "any purpose read", J("AND rq.transfer_purpose = 'IA_SUPPLY' AND"), J("AND")],
  ["SAVE", "Cancelled requests read", J("AND COALESCE(rq.stock_movement_status, '') <> 'Cancelled'"), J("AND 1 = 1")],
  ["SAVE", "the oldest request", J("ORDER BY rq.id DESC LIMIT 1"), J("ORDER BY rq.id ASC LIMIT 1")],
  ["SAVE", "deleted request lines read", J("AND rl.is_deleted = 0) rx"), J(") rx")],
  ["SAVE", "the last line's bin", J("MIN(rl.id) AS first_id"), J("MAX(rl.id) AS first_id")],
  ["SAVE", "the read's iatr column not declared (the platform drops it)", undeclare("sql_node_IAguard", "iatr")],
  // ---- IA_SAVE: the guard's input and decision
  ["SAVE", "the Draft path from the trimmed saveAs", J('const iaGuardTrDraft = iaGuardIn.saveAs === "Draft";'), J('const iaGuardTrDraft = iaS(iaGuardIn.saveAs) === "Draft";')],
  ["SAVE", "ia_target_status ignored", J('const iaGuardTrTarget = iaGuardDoc.ia_target_status === "Created";'), J("const iaGuardTrTarget = false;")],
  ["SAVE", "a Created save does not open the read", J('trRead: !iaGuardTrDraft || iaGuardTrTarget ? "YES" : "NO"'), J('trRead: !iaGuardTrDraft ? "YES" : "NO"')],
  ["SAVE", "trDraft not declared", undeclare("code_node_IAguardIn", "trDraft")],
  ["SAVE", "the read's column not taken", J("iaGuardTrRaw = row.iatr === undefined ? null : row.iatr;"), J("iaGuardTrRaw = null;")],
  ["SAVE", "the request decided before the existing guards", J("const iaGuardTr = !iaGuardBusy && !iaGuardFinal && !iaGuardCancelled && !iaGuardBig\n  ?"),
    J("const iaGuardTr = true\n  ?")],
  ["SAVE", "the outcome: the Draft path ignored", J('iatrgOutcome(iaS(iaGuardOut.trDraft) === "YES"'), J("iatrgOutcome(false")],
  ["SAVE", "the outcome: ia_target_status ignored", J('iaS(iaGuardOut.trTarget) === "YES", iaGuardStored)'), J("false, iaGuardStored)")],
  ["SAVE", "a live request not refused", J("refuse400: iaGuardBusy || iaGuardBig || iaGuardTr.refuse ?"), J("refuse400: iaGuardBusy || iaGuardBig ?")],
  ["SAVE", "the request's message dropped", J(": iaGuardBig ? iaS(iaGuardOut.bigMessage) : iaGuardTr.message,"), J(': iaGuardBig ? iaS(iaGuardOut.bigMessage) : "",')],
  ["SAVE", "a received request's picks never checked", J('iatrPicks: iaGuardTr.picks ? "YES" : "NO",'), J('iatrPicks: "NO",')],
  ["SAVE", "iatrPicks not declared", undeclare("code_node_IAguardStored", "iatrPicks")],
  // ---- IA_SAVE: the picks node
  ["SAVE", "if_IAtrPicks never taken", J("'{{node:code_node_IAguardStored.data.iatrPicks}}' == 'YES'"), J("'{{node:code_node_IAguardStored.data.iatrPicks}}' == 'NEVER'")],
  ["SAVE", "the picks' refusal never returned", J("'{{node:code_node_IAtrPicks.data.route}}' == 'STOP'"), J("'{{node:code_node_IAtrPicks.data.route}}' == 'NEVER'")],
  ["SAVE", "the picks' 400 with the guard's message", '"value": "{{node:code_node_IAtrPicks.data.message}}"', '"value": "{{node:code_node_IAguardStored.data.message}}"'],
  ["SAVE", "the picks of no line", J("iatrgPicks(iatrgDoc.stock_movement, iatrgReq)"), J("iatrgPicks([], iatrgReq)")],
  ["SAVE", "the picks node reads no request", J("const iatrgReq = iatrgRequest(iatrgRow.iatr);"), J("const iatrgReq = iatrgRequest(null);")],
  ["SAVE", "the picks node's route not declared", undeclare("code_node_IAtrPicks", "route")],
  // ---- IA_V2_SUBMIT: the facts read
  ["SUBMIT", "the read's gate always closed", J(SUB_G + "iaId}} > 0 AND '" + SUB_G + "operation}}' = 'SUBMIT'"), J("0 > 0 AND '" + SUB_G + "operation}}' = 'SUBMIT'")],
  ["SUBMIT", "a STATUS poll reads it", J("AND '" + SUB_G + "operation}}' = 'SUBMIT'"), J("AND 'SUBMIT' = 'SUBMIT'")],
  ["SUBMIT", "another IA's request", J("rq.source_ia_id = '" + SUB_G + "iaId}}'"), J("rq.source_ia_id = '0'")],
  ["SUBMIT", "any tenant's request", J("rq.tenant_id = '" + SUB_G + "tenantId}}' AND rq.is_deleted = 0"), J("rq.is_deleted = 0")],
  ["SUBMIT", "deleted requests read", J("rq.tenant_id = '" + SUB_G + "tenantId}}' AND rq.is_deleted = 0"), J("rq.tenant_id = '" + SUB_G + "tenantId}}'")],
  ["SUBMIT", "any purpose read", J("AND rq.transfer_purpose = 'IA_SUPPLY' AND"), J("AND")],
  ["SUBMIT", "Cancelled requests read", J("AND COALESCE(rq.stock_movement_status, '') <> 'Cancelled'"), J("AND 1 = 1")],
  ["SUBMIT", "the oldest request", J("ORDER BY rq.id DESC LIMIT 1) AS iatr"), J("ORDER BY rq.id ASC LIMIT 1) AS iatr")],
  ["SUBMIT", "deleted request lines read", J("AND rl.is_deleted = 0) rx"), J(") rx")],
  ["SUBMIT", "the last line's bin", J("MIN(rl.id) AS first_id"), J("MAX(rl.id) AS first_id")],
  ["SUBMIT", "the facts' iatr column not declared (the platform drops it)", undeclare("sql_node_ISfacts", "iatr")],
  // ---- IA_V2_SUBMIT: the entry
  ["SUBMIT", "the entry does not refuse a live request", J('    if (tr.refuse) return Object.assign(base, answer("STOP", "400", tr.message, { errorCode: tr.code }));\n'), ""],
  ["SUBMIT", "the entry reads no request", J('iatrgDecide(iatrgRequest(f.iatr), "COMPLETED", stored)'), J('iatrgDecide(iatrgRequest(null), "COMPLETED", stored)')],
  ["SUBMIT", "the entry's error code lost", J("{ errorCode: tr.code }"), J('{ errorCode: "IA_STOP" }')],
  // ---- IA_V2_SUBMIT: the gate
  ["SUBMIT", "the gate does not refuse a pick off the bin", J('    if (!tp.ok) return out("STOP", "400", tp.message, tp.code);\n'), ""],
  ["SUBMIT", "the gate gets no facts", J("  facts: [{{node:sql_node_ISfacts.data}}][0] });\n"), J("  facts: [] });\n")],
  ["SUBMIT", "the gate checks no line", J("iatrgPicks(lines, trReq)"), J("iatrgPicks([], trReq)")],
  ["SUBMIT", "the gate's check after the eligibility answer", J("  const trFacts = list(R.facts)[0] || {};\n"),
    J("  if (g.why) return Object.assign(base, notEligible(g.why, base.pickCount));\n  const trFacts = list(R.facts)[0] || {};\n")],
  ["SUBMIT", "the gate takes every IA as already final", J('iatrgDecide(trReq, "COMPLETED", s(trFacts.item_assembly_status))'), J('iatrgDecide(trReq, "COMPLETED", "Completed")')],
];
const text = {};
const OWN = { SAVE: base("classic/patch_v15.py", "IA_SAVE.json"), SUBMIT: base("submit/patch_v7.py", "IA_V2_SUBMIT.json") };
for (const t of Object.keys(TARGET)) text[t] = fs.readFileSync(OWN[t], "utf8");
let survived = 0;
for (const [t, name, from, to, mode] of MUTANTS) {
  let out;
  if (typeof from === "function") {
    const doc = JSON.parse(text[t]);
    from(doc);
    out = JSON.stringify(doc, null, 1) + "\n";
  } else {
    const k = text[t].split(from).length - 1;
    if (k < 1 || (mode !== "all" && k !== 1)) {
      console.log("BROKEN mutant (anchor found " + k + " times): " + t + " " + name);
      survived++;
      continue;
    }
    out = mode === "all" ? text[t].split(from).join(to) : text[t].replace(from, () => to);
  }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "iatr-wf-m-")), TARGET[t].file);
  fs.writeFileSync(f, out);
  const env = Object.assign({}, process.env, TARGET[t].base, { [TARGET[t].env]: f });
  const r = spawnSync(process.execPath, [path.join(__dirname, TARGET[t].test)], { env: env, encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + t + " " + name);
  } else console.log("killed   " + t + " " + name);
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
