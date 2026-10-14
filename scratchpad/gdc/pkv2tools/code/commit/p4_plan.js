// PICKING_BULK_COMMIT - P4 plan: each GD's header picking_status from its lines as stored now - code_node_B3E0xodz's
// rule, then GOODS_DELIVERY code_node_PkMerge's rollUpPicking (what code_node_GdRoute writes); a cancelled GD is skipped
const commitP4Plan = function commitP4Plan(facts) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const heads = {};
  const lines = {};
  for (const f of list(facts)) {
    if (f.kind === "H") heads[s(f.gd_id)] = f;
    else if (f.kind === "L") (lines[s(f.gd_id)] = lines[s(f.gd_id)] || []).push(f);
  }
  const rollUpPicking = (header, rows) => {
    if (header !== "Created" && header !== "In Progress") return header;
    const live = rows.filter((line) => s(line.material_id) && s(line.picking_status) !== "Cancelled" && (parseFloat(line.gd_qty) || 0) > 0);
    return live.length > 0 && live.every((line) => s(line.picking_status) === "Completed") ? "Completed" : header;
  };
  const rows = [];
  const skipped = [];
  for (const gdId of Object.keys(heads).sort()) {
    const h = heads[gdId];
    if (s(h.gd_status) === "Cancelled") {
      skipped.push(gdId);
      continue;
    }
    const all = lines[gdId] || [];
    const tableGd = all.filter((l) => !(s(l.item_bundle_id) && !s(l.material_id)));
    let status;
    if (!tableGd.length) status = "Created";
    else {
      let allCompleted = true;
      let anyProgress = false;
      for (const l of tableGd) {
        const ps = s(l.picking_status) || "Created";
        if (ps === "Completed") anyProgress = true;
        else if (ps === "In Progress") {
          allCompleted = false;
          anyProgress = true;
        } else allCompleted = false;
      }
      status = allCompleted ? "Completed" : anyProgress ? "In Progress" : "Created";
    }
    rows.push({ id: gdId, picking_status: rollUpPicking(status, all), was: s(h.picking_status) });
  }
  return { rows: rows.map((r) => ({ id: r.id, picking_status: r.picking_status })), need: rows.length ? "YES" : "NO", count: rows.length, skipped: skipped.length, result_message: rows.map((r) => r.id + ": " + (r.was || "-") + " -> " + r.picking_status).join(", ") + (skipped.length ? "; cancelled, skipped: " + skipped.join(", ") : "") };
};
const res = commitP4Plan([{{node:sql_node_PCp4facts.data}}][0]);
console.log("commit P4 plan", JSON.stringify({ count: res.count, skipped: res.skipped, message: res.result_message }));
return res;
