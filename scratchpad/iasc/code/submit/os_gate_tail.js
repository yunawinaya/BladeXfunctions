  // IA output split (plan 10-27, phase 2): the rows this completion receives - the payload's, or the stored ones when it leaves the key out
  // (then it may not move the IA's plant, item or bin) - checked as IA_SAVE v14's completion before any write: STOP 400 IA_OS_INVALID
  const os = osJ(R.os) || {};
  const om = osMerge(a, os.stored || null, { edit: guard.pageStatus === "Edit" && digits(guard.iaId), tenantId: guard.tenantId });
  if (om.route === "STOP") return out("STOP", "400", om.message, "IA_OS_INVALID");
  const oc = osCompletion(om, a, itemRows, os, guard.uid);
  if (oc.route === "STOP") return out("STOP", "400", oc.message, "IA_OS_INVALID");
  const osSplit = oc.split === "YES";
  const parentId = iaIdStr(a.item_id);
  if (osSplit) {
    // a duplicate balance at a row's bin is the classic's, as at the header's bin (iaIneligible)
    const dup = iaFlagged(R.dup, (r) => s(r.t) + "|" + s(r.material_id) + "|" + s(r.location_id) + "|" + s(r.batch_id));
    if (oc.output_split.some((r) => dup["B|" + parentId + "|" + r.os_location_id + "|"])) return Object.assign(base, notEligible("duplicate balance rows", base.pickCount));
    // row 1 into the header's single fields (single-value readers keep working; item_qty stays the total); one receipt per row
    Object.assign(a, osHeader(oc.output_split, a, oc.kind));
    base.movementCount = picks.length + oc.output_split.length;
  }
  const parent = byItem[parentId] || {};
  const needBatch = num(parent.item_batch_management) === 1 && parent.batch_number_genaration === IA_AUTO_BATCH;
  if (needBatch) {
    // a System split numbers each group (its own dates) after this gate: GENERATE_BATCH's date rule per group; its single call is skipped
    const cfg = parseJson(entry.batchCfg);
    const msg = osSplit ? oc.genGroups.map((g) => {
      const m = iaBatchPrecheck(cfg, Object.assign({}, a, { manufacturing_date: g.manufacturing_date, expired_date: g.expired_date }));
      return / is required\.$/.test(m) ? m.replace(/\.$/, "") + " for " + g.label + " of the output split." : m;
    }).filter((m) => m)[0] || "" : iaBatchPrecheck(cfg, a);
    if (msg) return out("STOP", "400", msg, "IA_BATCH_FAILED");
  }
  const one = needBatch && !osSplit;
  return out("GO", "", "", "", { allData: a, stockMovementNo: s(a.stock_movement_no), needBatch: one ? "YES" : "NO", batchItemId: one ? iaIdStr(a.item_id) : "",
    batchDocDate: one ? a.item_assembly_date || null : null, batchMfgDate: one ? a.manufacturing_date || null : null,
    batchExpDate: one ? a.expired_date || null : null, batchOrg: one ? base.organizationId : "", osSplit: osSplit ? "YES" : "NO", osKind: oc.kind, osRows: oc.output_split,
    osGroups: oc.groups, osGen: oc.gen, osGenGroups: oc.genGroups, osCacheKey: oc.cacheKey });
};
