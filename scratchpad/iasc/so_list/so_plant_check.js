// Convert to GD, made in another plant (the user, 10-28; scratchpad/iasc/so_list): a delivery allocates only in its own plant, so the
// selected Sales Orders' Item Assemblies (not cancelled) and Pending production reservations in a plant other than the chosen one are
// named first: Continue converts as before, Cancel stops (the Select Plant dialog stays open). One read of each for all the selected
// Sales Orders; a failed read converts as before
const soPlantElsewhere = async (records, plantID) => {
  const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const esc = (v) => str(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const all = (children) => [{ type: "branch", operator: "all", children: children }];
  const plant = str(plantID);
  const ids = (records || []).map((r) => str(r && r.id)).filter((id) => /^[0-9]{1,20}$/.test(id));
  if (!ids.length) return true;
  const soNo = {};
  (records || []).forEach((r) => {
    if (r) soNo[str(r.id)] = str(r.so_no) || str(r.id);
  });
  const other = (p) => /^[0-9]{1,20}$/.test(str(p)) && str(p) !== plant;
  const hits = [];
  let names = {};
  try {
    const [ias, prod] = await Promise.all([
      db.collection("sm_item_assembly").field("stock_movement_no,issuing_operation_faci,source_so_id,item_assembly_status")
        .filter(all([{ prop: "source_so_id", operator: "in", value: ids }, { prop: "is_deleted", operator: "equal", value: 0 }])).get(),
      db.collection("on_reserved_gd").field("doc_no,plant_id,parent_id,parent_no")
        .filter(all([{ prop: "parent_id", operator: "in", value: ids }, { prop: "doc_type", operator: "equal", value: "Production" },
          { prop: "status", operator: "equal", value: "Pending" }, { prop: "is_deleted", operator: "equal", value: 0 }])).get(),
    ]);
    ((ias && ias.data) || []).filter((x) => str(x.item_assembly_status) !== "Cancelled" && other(x.issuing_operation_faci))
      .forEach((x) => hits.push({ so: soNo[str(x.source_so_id)], what: "Item Assembly " + str(x.stock_movement_no), plant: str(x.issuing_operation_faci) }));
    ((prod && prod.data) || []).filter((x) => other(x.plant_id))
      .forEach((x) => hits.push({ so: soNo[str(x.parent_id)] || str(x.parent_no), what: "production " + str(x.doc_no), plant: str(x.plant_id) }));
  } catch (e) {
    console.error("Convert to GD: the plant check could not run - converting as before", e);
    return true;
  }
  if (!hits.length) return true;
  try {
    const d = await db.collection("blade_dept").field("dept_name")
      .filter(all([{ prop: "id", operator: "in", value: hits.map((h) => h.plant).concat([plant]).filter((p, i, a) => a.indexOf(p) === i) }])).get();
    ((d && d.data) || []).forEach((x) => (names[str(x.id)] = str(x.dept_name)));
  } catch (e) {
    names = {};
  }
  const nm = (id) => esc(names[id] || id);
  const lines = hits.slice(0, 10).map((h) => "&bull; " + esc(h.so) + ": " + esc(h.what) + " is in " + nm(h.plant));
  if (hits.length > 10) lines.push("&hellip; and " + (hits.length - 10) + " more");
  try {
    await this.$confirm("A delivery from " + nm(plant) + " can only use stock in " + nm(plant) + ", but these were made or reserved in another plant:<br><br>" +
      lines.join("<br>") + "<br><br>Convert in " + nm(plant) + " anyway?", "Another plant",
    { confirmButtonText: "Continue", cancelButtonText: "Cancel", type: "warning", dangerouslyUseHTMLString: true });
    return true;
  } catch (e) {
    return false;
  }
};
