// Routes every GD once. A normal pick changes only the GD header picking_status: those go in one write below,
// rolled up exactly as GOODS_DELIVERY's code_node_PkMerge does. Only a full re-save (this pick moved stock or
// force-completed; refused above 500 lines before any write), an auto-complete (skipped above 500 lines) or a
// skip note goes through the per-GD loop.
const MAX_SYNC_GD_LINES = 500;
const gdDatas = {{node:code_node_B3E0xodz.data.updatedGdDatas}} || [];
const setupRaw = {{node:get_node_Uj1uV9PU.data.data}};
const setup = (Array.isArray(setupRaw) ? setupRaw[0] : setupRaw) || {};
const lineCounts = {{node:code_node_SizeGuard.data.lineCounts}} || {};
const needFullSave = Number({{node:code_node_SizeGuard.data.needFullSave}} || 0) === 1;

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

const statusRows = [];
const loopItems = [];
for (const gd of gdDatas) {
  const pickingStatus = gd.picking_status || "";
  const gdId = String(gd.id || "");
  const lineCount = Number(lineCounts[gdId] || 0);
  if (gd.gd_status === "Cancelled") {
    loopItems.push({ gd, route: "SKIP", failCode: "400", failMessage: "the Goods Delivery is cancelled" });
  } else if (pickingStatus === "Completed" && Number(setup.auto_completed_gd || 0) === 1) {
    if (lineCount > MAX_SYNC_GD_LINES) {
      loopItems.push({
        gd,
        route: "SKIP",
        failCode: "200",
        failMessage: lineCount + " lines is above the " + MAX_SYNC_GD_LINES +
          "-line limit for completing it automatically; complete it from the Goods Delivery",
      });
    } else {
      loopItems.push({ gd, route: "COMPLETE" });
    }
  } else if (needFullSave) {
    loopItems.push({ gd, route: "CREATED" });
  } else {
    statusRows.push({ id: gdId, picking_status: rollUpPicking(pickingStatus, gd.table_gd) });
  }
}

return {
  statusRows,
  hasStatusRows: statusRows.length > 0 ? 1 : 0,
  loopItems,
  hasLoopItems: loopItems.length > 0 ? 1 : 0,
};
