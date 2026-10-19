// Picking V2 1c: the BUILT Picking/AsyncV2/GD_REPLAN.json run on the Picking V2 interpreter, its SQL answered by DEV
// (read-only: every statement must be a SELECT). A synthetic move: the first allocation entry of one line goes to another
// bin of the plant (move.js builds the cells as classic PICKING would). Prints the plan, the node data and the time.
// usage: node replan_live.js <tenant> <gd_id> <is_loading_bay 0|1> [line_index=0]; REQ_OUT / RES_OUT = files for the request and
// the full answer (to compare with the deployed workflow run on the same request)
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Engine } = require("../../gdc/pkv2tools/sim/engine.js");

const ROOT = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [tenant, gdId, bay, lineIndex] = process.argv.slice(2);
if (!/^\d+$/.test(tenant || "") || !/^\d+$/.test(gdId || "") || !/^[01]$/.test(bay || "")) throw new Error("usage: replan_live.js <tenant> <gd_id> <0|1> [line_index]");
const select = (sql) => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("not a SELECT: " + sql.slice(0, 80));
  return JSON.parse(execFileSync(ROOT + ".dbtools/db", ["--dev", "--json", sql], { maxBuffer: 1 << 30 }).toString());
};
const pkMovePlan = new Function(fs.readFileSync(path.join(__dirname, "..", "code", "move.js"), "utf8") + "\nreturn pkMovePlan;")();

const gd = select(`SELECT CAST(g.id AS CHAR) id, CAST(g.organization_id AS CHAR) org, CAST(g.plant_id AS CHAR) plant, g.delivery_no FROM goods_delivery g WHERE g.tenant_id = '${tenant}' AND g.id = ${gdId}`)[0];
const lines = select(`SELECT CAST(l.id AS CHAR) id, CAST(l.goods_delivery_id AS CHAR) goods_delivery_id, CAST(l.material_id AS CHAR) material_id, l.picking_status, l.temp_qty_data, l.view_stock
  FROM goods_delivery_fwii8mvb_sub l WHERE l.tenant_id = '${tenant}' AND l.goods_delivery_id = ${gdId} AND l.is_deleted = 0 AND l.temp_qty_data LIKE '[{%' AND COALESCE(l.picking_status, '') <> 'Completed' ORDER BY l.id LIMIT 50`);
const line = lines[Number(lineIndex || 0)];
const entry = JSON.parse(line.temp_qty_data)[0];
const bin = select(`SELECT CAST(b.id AS CHAR) id, b.bin_location_combine FROM bin_location b WHERE b.tenant_id = '${tenant}' AND b.plant_id = ${gd.plant} AND b.is_deleted = 0
  AND b.id <> ${entry.location_id} ORDER BY b.id LIMIT 1`)[0];
const names = select(`SELECT CAST(b.id AS CHAR) id, b.bin_location_combine, b.bin_name FROM bin_location b WHERE b.id IN (${entry.location_id}, ${bin.id})`);
const record = { gd_line_id: line.id, source_bin: String(entry.location_id), target_location: bin.id, batch_no: entry.batch_id || null, target_batch: entry.batch_id || null,
  store_out_qty: Number(entry.gd_quantity), item_code: line.material_id };
const mv = pkMovePlan({ records: [record], gdLines: [line], locations: names, batches: [], hus: [] });
if (!mv.lines.length) throw new Error("move.js moved nothing: " + JSON.stringify(mv.errors));
const cells = mv.lines.map((l) => ({ id: l.id, cells: { temp_qty_data: l.temp_qty_data, prev_temp_qty_data: l.before_temp, view_stock: l.view_stock, picking_status: line.picking_status || "Created" } }));

const sql = new Proxy({}, { get: () => (text) => select(text) });
const e = new Engine({ dir: ROOT + "Picking/AsyncV2", db: { tenantId: tenant }, mocks: { sql: sql, read: {} } });
const t0 = Date.now();
const req = { gd_id: gdId, organization_id: gd.org, is_loading_bay: bay, lines: JSON.stringify(cells) };
if (process.env.REQ_OUT) fs.writeFileSync(process.env.REQ_OUT, JSON.stringify(req));
const r = e.run("GD_REPLAN", req);
if (process.env.RES_OUT) fs.writeFileSync(process.env.RES_OUT, JSON.stringify(r.returned || {}));
const ms = Date.now() - t0;
const out = r.returned || {};
console.log(JSON.stringify({ gd: gd.delivery_no, move: [record.source_bin, "->", record.target_location, record.store_out_qty], route: out.route, code: out.code, message: out.message,
  movements: (out.movements || []).map((m) => [m.movement_key, m.direction, m.inventory_category, m.location_id, m.quantity, m.unit_price_from || ""]),
  res_updates: (out.res_updates || []).map((u) => [u.id, u.before.status, "->", u.after.status, u.after.reserved_qty]),
  res_creates: (out.res_creates || []).map((c) => [c.status, c.bin_location, c.reserved_qty, c.source_reserved_id, c.reserved_date]),
  gdl_patches: (out.gdl_patches || []).map((p) => [p.id, Object.keys(p.cells).sort()]), gdl_inserts: out.gdl_inserts, gdl_deletes: out.gdl_deletes,
  gdh_cells: Object.keys(out.gdh_cells || {}), reorder: out.reorder, line_count: out.line_count, node_data_bytes: r.ctx.bytes, run_ms: ms }, null, 1));
