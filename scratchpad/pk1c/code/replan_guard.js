// Picking V2 1c - GD_REPLAN's guard: every id that reaches SQL is digits ("0" when rejected), the lines carry only the
// moved-line cells as text, and GD Edit V2's SQL id lists are their empty forms (a move adds no material, SO or line).
const grGuard = function grGuard(P) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const digits = (v) => /^\d+$/.test(s(v));
  const out = { route: "REJECT", gdId: "0", tenantId: "0", organizationId: "0", isLoadingBay: 0, lines: [], deltaMaterialIdsSql: "0", deltaSoLineIdsSql: "0",
    deltaSoLineIdsQuoted: "'0'", deltaSoIdsSql: "0", deltaAllocMaterialIdsSql: "0", deltaAllocLineIdsSql: "0", result_code: "", result_message: "" };
  const reject = (m) => Object.assign(out, { result_code: "400", result_message: m });
  if (!digits(P.tenantId)) return reject("no tenant");
  if (!digits(P.gdId)) return reject("gd_id must be digits");
  if (!digits(P.organizationId)) return reject("organization_id must be digits");
  const bay = s(P.isLoadingBay);
  if (bay !== "0" && bay !== "1") return reject("is_loading_bay must be 0 or 1");
  let lines = P.lines;
  if (typeof lines === "string") {
    try { lines = JSON.parse(lines); } catch (e) { return reject("lines is not JSON"); }
  }
  if (!Array.isArray(lines) || lines.length > 2000) return reject("lines must be an array of at most 2,000");
  const CELLS = ["temp_qty_data", "prev_temp_qty_data", "view_stock", "picking_status"];
  for (const l of lines) {
    if (!l || !digits(l.id) || !l.cells || typeof l.cells !== "object" || Array.isArray(l.cells)) return reject("each line needs a digits id and its cells");
    for (const k of Object.keys(l.cells)) {
      if (CELLS.indexOf(k) < 0) return reject("cell " + k + " is not a moved-line cell");
      if (l.cells[k] !== null && typeof l.cells[k] !== "string") return reject("cell " + k + " must be text");
    }
  }
  return Object.assign(out, { route: "GO", gdId: s(P.gdId), tenantId: s(P.tenantId), organizationId: s(P.organizationId), isLoadingBay: Number(bay), lines: lines });
};
