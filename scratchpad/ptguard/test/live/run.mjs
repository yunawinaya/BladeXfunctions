// Live DEV run of the SM_PLANT_TRANSFER duplicate guard, after the dev publish. From the repo root:
//   node scratchpad/ptguard/test/live/run.mjs 1   creates, replays, twins, in-flight retry, Draft key   (T1-T5)
//   node scratchpad/ptguard/test/live/run.mjs 2   Draft refusal, In Progress (single, then twins), receive, cancels (T6-T9)
// Every new node runs once on its own before any concurrent case (platform: concurrent FIRST script loads can stick).
import { spawn, execFileSync } from "child_process";
import fs from "fs";

const WF = "2025864403783462913";
const L = "scratchpad/ptguard/test/live";
fs.mkdirSync(`${L}/out`, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + "s";

const run = (req, out) => new Promise((resolve) => {
  const started = Date.now();
  console.log(stamp(), "start", out);
  const p = spawn("node", ["scratchpad/gdc/tools/runwf.mjs", WF, `${L}/req/${req}.json`, `${L}/out/${out}.json`], { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => (err += d));
  p.on("close", () => {
    let body = "";
    try { body = fs.readFileSync(`${L}/out/${out}.json`, "utf8"); } catch (e) { body = err; }
    let j;
    try { j = JSON.parse(body); } catch (e) { j = { raw: body.slice(0, 300) }; }
    const d = j && j.data !== undefined && j.data !== null ? j.data : j;
    const pick = ["code", "result_code", "id", "stock_movement_no", "stock_movement_status", "replayed", "message", "msg"].filter((k) => d && d[k] !== undefined && d[k] !== "")
      .map((k) => `${k}=${JSON.stringify(d[k])}`).join(" ");
    console.log(stamp(), "done ", out.padEnd(6), ((Date.now() - started) / 1000).toFixed(1) + "s", pick || JSON.stringify(j).slice(0, 300));
    resolve(d || {});
  });
});
const py = (...args) => execFileSync("python3", [`${L}/cases.py`, ...args], { encoding: "utf8" });
const idOf = (out) => { const j = JSON.parse(fs.readFileSync(`${L}/out/${out}.json`, "utf8")); return String((j.data || j).id || ""); };
const db = (sql) => JSON.parse(execFileSync(".dbtools/db", ["--dev", "--json", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/^\[(DEV|PROD)\][^\n]*\n/, ""));

const stage = process.argv[2];
if (stage === "1") {
  for (const c of ["P0", "T1", "T2", "T3", "T4", "T5"]) py("req", c);
  await run("P0", "P0");                                                // no-write probe: the guard's own view of this session
  const inst = db(`SELECT nodes_data FROM su_code_workflow_inst WHERE workflow_id=${WF} ORDER BY id DESC LIMIT 1`)[0];
  const prepNode = JSON.parse(inst.nodes_data || "[]").find((n) => n.node_id === "code_node_PTdupPrep");
  const prep = prepNode ? JSON.parse(prepNode.response_json_data).data : null;
  console.log(stamp(), "probe prep:", JSON.stringify(prep && { tenantId: prep.tenantId, guardOn: prep.guardOn, fpSql: prep.fpSql, runKey: prep.runKey }));
  if (!prep || prep.guardOn !== "YES" || prep.tenantId !== "000000" || !/^PTFP1\./.test(prep.fpSql)) throw new Error("guard not live for this session: stopping before any write");
  await run("T1", "T1a"); await run("T1", "T1b");                       // key: second send = REPLAY
  await run("T2", "T2a"); await run("T2", "T2b");                       // no key (old app): fingerprint REPLAY
  await Promise.all([run("T3", "T3a"), run("T3", "T3b")]);              // identical twins at the same instant
  const first = run("T4", "T4a"); await wait(6000); await run("T4", "T4b"); await first;   // retry while saving: WAIT
  await run("T4", "T4c");                                               // after it finished: REPLAY
  await run("T5", "T5a"); await run("T5", "T5b");                       // Draft with a key: REPLAY
} else if (stage === "2") {
  const t1 = idOf("T1a"), t2 = idOf("T2a");
  if (!/^\d+$/.test(t1) || !/^\d+$/.test(t2)) throw new Error("stage 1 ids missing: " + t1 + " / " + t2);
  py("req-draft", "T6", t1); await run("T6", "T6");                     // Draft on an Issued PT: refused
  py("req-ip", "T8", t1); await run("T8", "T8a");                       // In Progress, single (warms the child check)
  py("req-ip", "T7", t2); await Promise.all([run("T7", "T7a"), run("T7", "T7b")]);   // In Progress twins: one child
  const kid = db(`SELECT CAST(id AS CHAR) id FROM plant_transfer WHERE tenant_id='000000' AND parent_id=${t1} AND is_deleted=0 ORDER BY id LIMIT 1`)[0];
  if (kid) { py("req-receive", "T8r", kid.id); await run("T8r", "T8r"); }  // receive the T1 child in full
  const open = db(`SELECT CAST(id AS CHAR) id, remarks FROM plant_transfer WHERE tenant_id='000000' AND is_deleted=0 AND movement_type='Plant Transfer'
                     AND remarks IN ('PTGUARD-T2','PTGUARD-T3','PTGUARD-T4') AND stock_movement_status IN ('Issued','In Progress') ORDER BY id`);
  for (const o of open) { py("req-cancel", "T9-" + o.id, o.id); await run("T9-" + o.id, "T9-" + o.remarks.slice(8) + "-cancel"); }
} else {
  console.error("usage: node scratchpad/ptguard/test/live/run.mjs 1|2");
  process.exit(2);
}
