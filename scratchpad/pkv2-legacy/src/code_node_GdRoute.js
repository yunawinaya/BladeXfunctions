// A normal pick changes only the GD header picking_status: write that, rolled up exactly as GOODS_DELIVERY's
// code_node_PkMerge does, instead of re-saving the whole GD. The full re-save still runs when this pick moved
// stock or force-completed (refused above 500 lines before any write); auto-complete is skipped above 500 lines.
const MAX_SYNC_GD_LINES = 500;
const gd = {{node:code_node_9rK80jNQ.data.gdData}} || {};
const pickingStatus = {{node:code_node_9rK80jNQ.data.pickingStatus}} || "";
const setupRaw = {{node:get_node_Uj1uV9PU.data.data}};
const setup = (Array.isArray(setupRaw) ? setupRaw[0] : setupRaw) || {};
const lineCounts = {{node:code_node_SizeGuard.data.lineCounts}} || {};
const needFullSave = Number({{node:code_node_SizeGuard.data.needFullSave}} || 0) === 1;
const gdId = String(gd.id || "");
const lineCount = Number(lineCounts[gdId] || 0);

// Verbatim from GOODS_DELIVERY code_node_PkMerge.
const rollUpPicking = (header, rows) => {
  if (header !== "Created" && header !== "In Progress") return header;
  const lines = (rows || [])
    .flatMap((row) => [row, ...(Array.isArray(row.children) ? row.children : [])])
    .filter((line) => line.material_id && line.picking_status !== "Cancelled" &&
      (parseFloat(line.gd_qty) || 0) > 0);
  return lines.length > 0 && lines.every((line) => line.picking_status === "Completed")
    ? "Completed" : header;
};

let route = "STATUS";
let failCode = "";
let failMessage = "";
if (gd.gd_status === "Cancelled") {
  route = "SKIP";
  failCode = "400";
  failMessage = "the Goods Delivery is cancelled";
} else if (pickingStatus === "Completed" && Number(setup.auto_completed_gd || 0) === 1) {
  if (lineCount > MAX_SYNC_GD_LINES) {
    route = "SKIP";
    failCode = "200";
    failMessage = lineCount + " lines is above the " + MAX_SYNC_GD_LINES +
      "-line limit for completing it automatically; complete it from the Goods Delivery";
  } else {
    route = "COMPLETE";
  }
} else if (needFullSave) {
  route = "CREATED";
}

return {
  route,
  gdId,
  headerStatus: rollUpPicking(pickingStatus, gd.table_gd),
  failCode,
  failMessage,
};
