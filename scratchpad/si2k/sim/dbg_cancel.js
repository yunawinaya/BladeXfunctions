// debug: one SI_CANCEL run through the lean workflow, printing the outputs of its nodes
const fs = require("fs");
const L = require("./lib.js");
const { Engine } = require("./engine.js");
const { cancelWorld } = require("./replay_cancel.js");
const r = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const rec = {};
for (const x of L.parseJ(r.nodes_data) || []) { const o = L.parseJ(x.response_json_data); if (o && "data" in o) rec[x.node_id] = o.data; }
const doc = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const e = new Engine(doc, cancelWorld(rec, String(r.tenant_id))(), {});
const out = e.run({ si_id: L.parseJ(r.request_json_data).workflowparams.si_id });
for (const id of process.argv.slice(4)) console.log(id, JSON.stringify(out.ctx.out[id]).slice(0, 700));
