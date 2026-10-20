// Small Cycle (scratchpad/iasc): an Item Assembly holding a BOM snapshot is compared with that snapshot at item_qty instead of
// the latest BOM (reference vs actual, lines not built from it, its rows without a line) and the linked Sales Order line's
// warnings are listed (never blocking; a failed read says the figures are unavailable). A Flat line of an expanded
// sub-assembly, or references out of step with item_qty, stop the completion. Anything else: the v36 check above, unchanged.
const SC_ENABLED = __SC_ENABLED__;
const SC_WF_PROJECTION = "__SO_IA_PROJECTION__"; // SO_IA_PROJECTION
const SC_WF_RELINK = "__IA_SC_RELINK__"; // IA_SC_RELINK
/*@@SC_BOM_MIN@@*/
const scVarHtml = (t) => scS(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const scVarRun = (id, params) =>
  new Promise((resolve, reject) => {
    const p = this.runWorkflow(id, params, (res) => resolve(res), (err) => reject(err));
    if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
  });
// the linked line's warnings now: a list, or null when the figures could not be read
const scVarWarnings = async (data) => {
  let org = scS(data.organization_id);
  if (!org) {
    org = this.getVarGlobal("deptParentId");
    if (org === "0") org = this.getVarSystem("deptIds").split(",")[0];
  }
  try {
    const res = await scVarRun(SC_WF_PROJECTION, { operation: "SUMMARY", so_id: scS(data.source_so_id), so_line_id: scS(data.source_so_line_id),
      item_id: scS(data.item_id), exclude_ia_id: scS(data.page_status) === "Edit" && /^[0-9]{1,20}$/.test(scS(data.id)) ? scS(data.id) : "",
      organization_id: scS(org), proposal_qty: scQ8(data.item_qty) > 0 ? scQ8(data.item_qty).toFixed(8) : "", proposal_uom_id: scS(data.item_uom),
      baseline: scS(data.source_so_context_json) });
    const d = (res && res.data) || {};
    const r = scS(d.code) === "200" ? scParseJ(d.result_json) : null;
    if (!r || !Array.isArray(r.warnings)) return null;
    // the projection names units by id: shown by name (when the names cannot be read, by id)
    const ids = [scS(data.item_uom), scS(r.uomId)].filter((id, i, all) => id && all.indexOf(id) === i);
    const names = {};
    try {
      const u = ids.length ? await db.collection("unit_of_measurement").field("uom_name")
        .filter([{ type: "branch", operator: "all", children: [{ prop: "id", operator: "in", value: ids }, { prop: "is_deleted", operator: "equal", value: 0 }] }])
        .limit(ids.length).get() : { data: [] };
      ((u && u.data) || []).forEach((x) => (names[scS(x.id)] = scS(x.uom_name)));
    } catch (e) {}
    return r.warnings.map((w) => Object.keys(names).reduce((t, id) => (names[id] ? t.split(id).join(names[id]) : t), scS(w && w.text))).filter((t) => t);
  } catch (e) {
    console.error("Small Cycle: the Sales Order figures could not be read", e);
    return null;
  }
};
const confirmBomVariance = async (data) => {
  const mode = scS(data.bom_consumption_mode);
  const ready = SC_ENABLED === true && /^[1-9][0-9]{0,19}$/.test(SC_WF_PROJECTION) && /^[1-9][0-9]{0,19}$/.test(SC_WF_RELINK);
  const snap = ready && (mode === "STANDARD" || mode === "FLAT") && scS(data.bom_snapshot_json) ? scSnapOf(data.bom_snapshot_json) : null;
  if (!snap) return scBaseConfirmBomVariance(data);
  const lines = Array.isArray(data.stock_movement) ? data.stock_movement : [];
  const label = (l) => scS(l.item_name) || scS(l.item_selection);
  if (snap.mode === "FLAT") {
    const expanded = {};
    (snap.expand || []).forEach((id) => {
      expanded[scS(id)] = 1;
    });
    const hit = lines.filter((l) => expanded[scS(l.item_selection)] && scNum(l.total_quantity) > 0)[0];
    if (hit) {
      await this.$alert(scVarHtml(label(hit)) + " is expanded into its components in Flat mode, so it cannot also be consumed: remove its line or prepare the BOM again without it.",
        "Cannot Complete", { confirmButtonText: "OK", type: "error" }).catch(() => {});
      return false;
    }
  }
  const refs = {};
  scRecompute(snap, data.item_qty).forEach((x) => {
    refs[x.key] = x;
  });
  const differences = [];
  const seen = {};
  const stale = [];
  lines.forEach((l) => {
    const x = refs[scS(l.sc_ref_key)];
    const actual = scQ8(l.total_quantity);
    if (x && x.itemId === scS(l.item_selection) && x.uomId === scS(l.quantity_uom)) {
      seen[x.key] = 1;
      if (Math.abs(scNum(l.requested_qty) - x.qty) > 0.0005) stale.push(label(l));
      if (Math.abs(actual - x.qty) > 0.0005) differences.push("Changed: " + label(l) + " " + x.qty + " → " + actual);
    } else {
      differences.push("Added: " + label(l) + " (" + actual + ")");
    }
  });
  if (stale.length) {
    await this.$alert("The reference quantities of " + scVarHtml(stale.slice(0, 5).join(", ")) + (stale.length > 5 ? " and " + (stale.length - 5) + " more" : "")
      + " do not match the quantity " + scQ8(data.item_qty) + ": change the quantity again or press Prepare BOM, then complete again.", "Cannot Complete",
      { confirmButtonText: "OK", type: "error" }).catch(() => {});
    return false;
  }
  snap.rows.forEach((r) => {
    if (!seen[scS(r.key)]) differences.push("Removed: " + (scS(r.name) || scS(r.itemId)));
  });
  const warnings = /^[0-9]{1,20}$/.test(scS(data.source_so_line_id)) ? await scVarWarnings(data) : [];
  if (!differences.length && warnings && !warnings.length) return true;
  const parts = [];
  if (differences.length) {
    parts.push("These components differ from the prepared BOM (" + (snap.mode === "FLAT" ? "Flat" : "Standard") + ", " + scVarHtml(snap.root.version) + ", for "
      + scQ8(data.item_qty) + "):<br><br>" + differences.map((d) => "• " + scVarHtml(d)).join("<br>"));
  }
  if (warnings === null) parts.push("The Sales Order figures are unavailable right now, so its warnings could not be checked.");
  else if (warnings.length) parts.push("Sales Order:<br>" + warnings.map((w) => "• " + scVarHtml(w)).join("<br>"));
  return this.$confirm(parts.join("<br><br>") + "<br><br>Complete the assembly?", differences.length ? "Components Differ From The Prepared BOM" : "Check Before Completing", {
    confirmButtonText: "Complete",
    cancelButtonText: "Cancel",
    dangerouslyUseHTMLString: true,
    type: "warning",
  }).then(
    () => true,
    () => false,
  );
};
// -- end Small Cycle --
