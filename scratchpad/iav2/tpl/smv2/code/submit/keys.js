// LOT_V2_SUBMIT - Keys: the form's record (INVALID when it is not one); what the background save does not take that the form's
// lines alone show (CONTRACT section 7: HU, serial lines, production-order links, entry categories other than Unrestricted /
// Blocked; bundles and lines waiting for auto-allocation are taken since V2.1; not for a Cancel - the list sends no lines; a
// Draft is never refused: NOT_ELIGIBLE); and the digit-only ids the reads take (a read that is not needed gets "0" / NO)
const lotFormReasons = function lotFormReasons(form, flat) {
  if (num(form.is_production_order) === 1) return "it is linked to a production order";
  return lotLineReasons(flat);
};
const submitKeys = function submitKeys(guard, entry, form) {
  const base = { ok: "NO", why: "", errorCode: "", itemIdsSql: "0", storedLotId: "0", needStored: "NO", needAfter: "NO", plantId: "0", organizationId: "0", lineCount: 0 };
  if (!form || typeof form !== "object" || Array.isArray(form)) return Object.assign(base, answer("INVALID", "400", "form: the Location Transfer's record", { errorCode: "LOT_INVALID_REQUEST" }));
  const act = entry.action;
  const flat = act === "CANCEL" ? [] : flatOf(form.stock_movement);
  const editing = act === "COMPLETE" || act === "EDIT";
  const lineCount = act === "CANCEL" ? num(entry.lineCount) : editing ? Math.max(num(entry.lineCount), flat.length) : flat.length;
  base.lineCount = lineCount;
  const why = act === "CANCEL" ? "" : lotFormReasons(form, flat);
  if (why) return Object.assign(base, notEligible(why, lineCount, guard.saveAs), { why: why });
  const items = {};
  for (const l of flat) {
    if (digits(l.item_selection)) items[s(l.item_selection)] = true;
    for (const e of lotJsonList(l.temp_qty_data)) if (e && typeof e === "object" && digits(e.material_id)) items[s(e.material_id)] = true;
  }
  const org = guard.pageStatus === "Edit" ? entry.organizationId : s(form.organization_id);
  const plant = act === "CANCEL" ? entry.plantId : lotIdStr(form.issuing_operation_faci) || entry.plantId;
  const stored = editing || act === "CANCEL";
  return Object.assign(base, answer("GO", "", ""), {
    ok: "YES", itemIdsSql: ["0"].concat(Object.keys(items)).join(","), storedLotId: stored ? guard.lotId : "0", needStored: stored ? "YES" : "NO",
    needAfter: act === "DIRECT" || act === "STAGE" ? "YES" : "NO", plantId: digits(plant) ? plant : "0", organizationId: digits(org) ? org : "0",
  });
};
const res = submitKeys([{{node:code_node_LSguard.data}}][0], [{{node:code_node_LSentry.data}}][0], [{{workflowparams:form}}][0]);
console.log("submit keys", JSON.stringify({ route: res.route, why: res.why, lines: res.lineCount, items: res.itemIdsSql.split(",").length - 1, plant: res.plantId, stored: res.needStored }));
return res;
