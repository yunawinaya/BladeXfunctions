// IA_V2_SUBMIT - Gate (CONTRACT section 7 order): eligibility, the lifted classic gates, limits, the WA screen, the GENERATE_BATCH pre-check
const IA_BATCH_LEVELS = ["Item Level", "Item Category Level", "Organization Level", "Item Group Level"];
const IA_AUTO_BATCH = "According To System Settings";
// the picks op 1 moves: lines whose item is stock-controlled, picks with sm_quantity > 0, line then pick order (code_issue_line)
const iaStockPicks = function iaStockPicks(lines, byItem) {
  const out = [];
  lines.forEach((l, i) => {
    const m = iaIdStr(l.item_selection);
    if (!iaStockItem(byItem[m])) return;
    for (const p of iaPicks(l)) out.push({ line: i + 1, m: m, loc: iaIdStr(p.location_id), b: iaIdStr(p.batch_id), category: iaCategory(p.category) });
  });
  return out;
};
const iaFlagged = (rows, keyOf) => {
  const set = {};
  for (const r of iaRows(rows)) set[keyOf(r)] = r;
  return set;
};
// the first reason the background completion does not take this IA (CONTRACT section 7 "Checks done in SQL"), or ""
const iaIneligible = function iaIneligible(a, lines, itemIds, byItem, R) {
  for (const id of itemIds) if (!byItem[id]) return "item " + id + " not found";
  if (lines.some(iaLineHasHu) || iaJsonList(a.table_hu).length > 0) return "handling units";
  if (itemIds.some((id) => num(byItem[id].serial_number_management) === 1)) return "serial numbers";
  const parentId = iaIdStr(a.item_id);
  const parent = byItem[parentId];
  if (parent && !iaStockItem(parent)) return "assembled item not stock controlled";
  for (const l of lines) {
    const it = byItem[iaIdStr(l.item_selection)];
    if (it && !iaStockSet(it)) return "item " + (s(it.material_code) || s(it.id)) + " has no stock control setting";
  }
  if (parent && num(parent.item_batch_management) === 1 && parent.batch_number_genaration !== IA_AUTO_BATCH) return "manual batch number";
  const picks = iaStockPicks(lines, byItem);
  const odd = picks.find((p) => IA_OK_CATEGORIES.indexOf(p.category) < 0);
  if (odd) return odd.category + " stock";
  const cost = iaFlagged(R.cost, (r) => s(r.material_id) + "|" + (s(r.batch_id) || "0"));
  if (picks.some((p) => cost[p.m + "|" + (p.b || "0")]) || (parentId && cost[parentId + "|0"])) return "costing migration";
  const dup = iaFlagged(R.dup, (r) => s(r.t) + "|" + s(r.material_id) + "|" + s(r.location_id) + "|" + s(r.batch_id));
  const recvLoc = iaIdStr(a.location_id);
  if (picks.some((p) => dup["B|" + p.m + "|" + p.loc + "|"] || (p.b && dup["T|" + p.m + "|" + p.loc + "|" + p.b])) || (parentId && dup["B|" + parentId + "|" + recvLoc + "|"])) {
    return "duplicate balance rows";
  }
  if (!picks.length) return "no stock to issue";
  return "";
};
// GENERATE_BATCH v20's own refusals that its default batch_number_config row predicts (exact texts; contract deviation 1)
const iaBatchPrecheck = function iaBatchPrecheck(cfg, a) {
  const c = obj(cfg) ? cfg : {};
  if (num(c.n) !== 1 || IA_BATCH_LEVELS.indexOf(c.level) < 0) return "No default batch found.";
  switch (c.date_format) {
    case "Document Date":
      return a.item_assembly_date ? "" : "Document Date is required.";
    case "Expired Date":
      return a.expired_date ? "" : "Expired Date is required.";
    case "Manufacturing Date":
      return a.manufacturing_date ? "" : "Manufacturing Date is required.";
    case "Document Created Date":
      return "";
    default:
      return "Invalid date format configuration.";
  }
};
// lifted CHECK_REQUIRED_FIELD v8 (code_node_AeSdXE85) over code_required's { required_fields, data }
const iaCheckRequired = (tenantId, req) => __withContext({ "system:tenantId": tenantId, "workflowparams:entry": req.data, "workflowparams:required_fields": req.required_fields },
  () => __run("code_node_AeSdXE85"));
const submitGate = function submitGate(guard, entry, keys, form, R) {
  const base = { reason: "", errorCode: "", allData: {}, lineCount: num(keys.lineCount), pickCount: num(keys.pickCount), stockPickCount: 0, nonStockLines: 0,
    movementCount: 0, plantId: s(keys.plantId), organizationId: s(keys.organizationId), stockMovementNo: "", needBatch: "NO", batchItemId: "", batchDocDate: null,
    batchMfgDate: null, batchExpDate: null, batchOrg: "" };
  const out = (route, code, message, errorCode, extra) => Object.assign(base, answer(route, code, message, Object.assign({ errorCode: errorCode || "" }, extra || {})));
  if (entry.action !== "DIRECT") return out("STOP", "400", "the gate does not take " + s(entry.action), "IA_INVALID_REQUEST");
  const byItem = {};
  const itemRows = iaRows(R.items);
  for (const it of itemRows) byItem[s(it.id)] = it;
  // one context: fill-back -> item ids -> eligibility -> code_required + CHECK_REQUIRED_FIELD -> code_validate (v12)
  let f = null;
  try {
    f = iaFill(guard, form, (r) => {
      const why = iaIneligible(r.allData, r.allData.stock_movement, r.itemIds, byItem, R);
      if (why) return { why: why };
      const chk = iaCheckRequired(guard.tenantId, __run("code_required"));
      if (s(chk.status) === "Failed") return { chk: chk };
      __set("node:search_items", { data: { total: itemRows.length, count: itemRows.length, data: itemRows } });
      return { chk: chk, v: __run("code_validate") };
    });
  } catch (e) {
    return out("STOP", "400", "The Item Assembly could not be checked: " + s(e && e.message), "IA_INVALID_DATA");
  }
  const a = f.allData;
  const lines = a.stock_movement;
  const g = f.more || {};
  if (g.why) return Object.assign(base, notEligible(g.why, base.pickCount));
  if (s(g.chk && g.chk.status) === "Failed") return out("STOP", "400", s(g.chk.message), "IA_REQUIRED_FIELDS");
  if (s(g.v && g.v.status) !== "Passed") return out("STOP", "400", s(g.v && g.v.message) || "The Item Assembly could not be checked.", "IA_ASSEMBLY_INVALID");
  const picks = iaStockPicks(lines, byItem);
  base.stockPickCount = picks.length;
  base.nonStockLines = lines.filter((l) => iaNonStockItem(byItem[iaIdStr(l.item_selection)])).length;
  base.movementCount = picks.length + 1;
  if (picks.length > IA_MAX_PICKS) return out("STOP", "400", IA_TEXT.splitRequired(picks.length), "IA_SPLIT_REQUIRED", { reason: "split" });
  const wa = iaFlagged(R.wa, (r) => s(r.material_id) + "|" + (s(r.batch_id) || "0"));
  const noWa = picks.find((p) => wa[p.m + "|" + (p.b || "0")]);
  if (noWa) {
    const it = byItem[noWa.m] || {};
    return out("STOP", "400", "No Weighted Average costing record for item " + (s(it.material_code) || noWa.m) + " at this plant" + (noWa.b ? " (batch " + noWa.b + ")" : "")
      + ". The batch was most likely moved between plants without its costing record; create it for this plant before issuing this stock.", "IA_NO_WA_RECORD");
  }
  const parent = byItem[iaIdStr(a.item_id)] || {};
  const needBatch = num(parent.item_batch_management) === 1 && parent.batch_number_genaration === IA_AUTO_BATCH;
  if (needBatch) {
    const msg = iaBatchPrecheck(parseJson(entry.batchCfg), a);
    if (msg) return out("STOP", "400", msg, "IA_BATCH_FAILED");
  }
  return out("GO", "", "", "", { allData: a, stockMovementNo: s(a.stock_movement_no), needBatch: needBatch ? "YES" : "NO", batchItemId: needBatch ? iaIdStr(a.item_id) : "",
    batchDocDate: needBatch ? a.item_assembly_date || null : null, batchMfgDate: needBatch ? a.manufacturing_date || null : null,
    batchExpDate: needBatch ? a.expired_date || null : null, batchOrg: needBatch ? base.organizationId : "" });
};
