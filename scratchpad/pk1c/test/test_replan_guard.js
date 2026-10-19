// Picking V2 1c: code/replan_guard.js (grGuard), GD_REPLAN's input check: every id that reaches SQL is digits, the lines
// carry only the moved-line cells, and the id lists GD Edit V2's SQL takes are the empty "0" forms.
const fs = require("fs");
const path = require("path");
const { eq, done } = require("../../gdc/pkv2tools/harness.js");
const grGuard = new Function(fs.readFileSync(path.join(__dirname, "..", "code", "replan_guard.js"), "utf8") + "\nreturn grGuard;")();
const ok = { gdId: "2110988053635010562", organizationId: "2064222911015276546", isLoadingBay: 1, tenantId: "073522",
  lines: JSON.stringify([{ id: "2110988053748256770", cells: { temp_qty_data: "[]", prev_temp_qty_data: "[]", view_stock: "Total: 0 PCS", picking_status: "Completed" } }]) };
const g = grGuard(ok);
eq("valid input: GO", [g.route, g.gdId, g.organizationId, g.tenantId, Number(g.isLoadingBay), g.lines.length], ["GO", ok.gdId, ok.organizationId, "073522", 1, 1]);
eq("valid input: the SQL id lists", [g.deltaMaterialIdsSql, g.deltaSoLineIdsSql, g.deltaSoLineIdsQuoted, g.deltaSoIdsSql, g.deltaAllocMaterialIdsSql, g.deltaAllocLineIdsSql],
  ["0", "0", "'0'", "0", "0", "0"]);
eq("lines as an array (not text) also pass", grGuard(Object.assign({}, ok, { lines: JSON.parse(ok.lines) })).route, "GO");
eq("isLoadingBay 0 as text", Number(grGuard(Object.assign({}, ok, { isLoadingBay: "0" })).isLoadingBay), 0);
const bad = (label, patch) => {
  const r = grGuard(Object.assign({}, ok, patch));
  eq(label + ": REJECT, ids safe", [r.route, r.gdId, r.organizationId, r.tenantId], ["REJECT", "0", "0", "0"]);
};
bad("gd_id with SQL", { gdId: "1 OR 1=1" });
bad("organization_id empty", { organizationId: "" });
bad("no tenant", { tenantId: null });
bad("is_loading_bay 2", { isLoadingBay: 2 });
bad("lines not JSON", { lines: "[{" });
bad("a line id with a quote", { lines: JSON.stringify([{ id: "1'", cells: {} }]) });
bad("a cell that is not a moved-line cell", { lines: JSON.stringify([{ id: "1", cells: { gd_qty: "5" } }]) });
bad("a cell that is not text", { lines: JSON.stringify([{ id: "1", cells: { temp_qty_data: [] } }]) });
bad("too many lines", { lines: JSON.stringify(Array.from({ length: 2001 }, (_, i) => ({ id: String(i + 1), cells: {} }))) });
done();
