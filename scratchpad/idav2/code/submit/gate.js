// IDA_V2_SUBMIT - Gate (CONTRACT section 7 order): eligibility, the lifted classic gates + the typed-number check, limits, the WA screen,
// the batchnum dry run (nothing reserved, nothing written)
const idaFlagged = (rows, keyOf) => {
  const set = {};
  for (const r of idaRows(rows)) set[keyOf(r)] = r;
  return set;
};
const idaCode = (it, id) => s(it && it.material_code) || s(id);
// controller ruling 10-21 (integration run: a 5,000-receipt op 2 is ~98 MB in one COMMIT tick): at most 2,500 movements per leg in V2
const IDA_V2_MAX_LEG = 2500;
const idaLegTooBig = (n, what) => "This Item Disassembly has " + n + " " + what + ". At most 2,500 can be completed in the background at once - please split the disassembly.";
// the first reason the background completion does not take this IDA (CONTRACT section 7 "Eligibility"), or ""
const idaIneligible = function idaIneligible(a, itemIds, byItem, R) {
  for (const id of itemIds) if (!byItem[id]) return "item " + id + " not found";
  if (idaHasHu(a)) return "handling units";
  const srcId = idaIdStr(a.item_id);
  const src = byItem[srcId];
  if (src && num(src.serial_number_management) === 1) return "serial-numbered source item";
  if (src && idaNonStockItem(src)) return "source item not stock controlled";
  if (src && !idaStockSet(src)) return "item " + idaCode(src, srcId) + " has no stock control setting";
  const lines = idaRecoveryLines(a.stock_movement);
  for (const l of lines) {
    const it = byItem[idaIdStr(l.item_selection)];
    if (it && !idaStockSet(it)) return "item " + idaCode(it, l.item_selection) + " has no stock control setting";
  }
  const picks = idaPicks(a);
  const odd = picks.find((p) => IDA_OK_CATEGORIES.indexOf(idaCategory(p.category)) < 0);
  if (odd) return idaCategory(odd.category) + " stock";
  const stock = lines.filter((l) => idaStockItem(byItem[idaIdStr(l.item_selection)]));
  const cost = idaFlagged(R.cost, (r) => s(r.material_id) + "|" + (s(r.batch_id) || "0"));
  if (picks.some((p) => cost[srcId + "|" + (idaIdStr(p.batch_id) || "0")]) || stock.some((l) => cost[idaIdStr(l.item_selection) + "|0"])) return "costing migration";
  const dup = idaFlagged(R.dup, (r) => s(r.t) + "|" + s(r.material_id) + "|" + s(r.location_id) + "|" + s(r.batch_id));
  const pickDup = (p) => dup["B|" + srcId + "|" + idaIdStr(p.location_id) + "|"] || (idaIdStr(p.batch_id) && dup["T|" + srcId + "|" + idaIdStr(p.location_id) + "|" + idaIdStr(p.batch_id)]);
  if (picks.some(pickDup) || stock.some((l) => dup["B|" + idaIdStr(l.item_selection) + "|" + idaIdStr(l.location_id) + "|"])) return "duplicate balance rows";
  if (!stock.length) return "no stock to receive";
  return "";
};
// lifted CHECK_REQUIRED_FIELD v8 (code_node_AeSdXE85) over code_required's { required_fields, data }
const idaCheckRequired = (tenantId, req) => __withContext({ "system:tenantId": tenantId, "workflowparams:entry": req.data,
  "workflowparams:required_fields": req.required_fields }, () => __run("code_node_AeSdXE85"));
// F4: the first TYPED line of a stock item whose number a live Batch row of the organization holds (utf8mb4_general_ci = idaBatchKey)
const idaTypedTaken = function idaTypedTaken(rows, byItem, holders) {
  const held = {};
  for (const h of idaRows(holders)) held[idaBatchKey(h.batch_number)] = true;
  for (let i = 0; i < rows.length; i++) {
    const l = rows[i];
    const it = byItem[idaIdStr(l.item_selection)];
    if (!idaStockItem(it) || idaBatchKind(l, it) !== "TYPED") continue;
    if (held[idaBatchKey(l.batch_number)]) return IDA_TEXT.typedExists(idaLineLabel(i + 1, l), idaS(l.batch_number));
  }
  return "";
};
const submitGate = function submitGate(guard, entry, keys, form, R) {
  const base = { reason: "", errorCode: "", allData: {}, lineCount: num(keys.lineCount), pickCount: num(keys.pickCount), moveCount: num(keys.moveCount), stockLines: 0,
    nonStockLines: 0, autoLines: 0, plantId: s(keys.plantId), organizationId: s(keys.organizationId), stockMovementNo: "" };
  const out = (route, code, message, errorCode, extra) => Object.assign(base, answer(route, code, message, Object.assign({ errorCode: errorCode || "" }, extra || {})));
  if (entry.action !== "DIRECT") return out("STOP", "400", "the gate does not take " + s(entry.action), "IDA_INVALID_REQUEST");
  const byItem = {};
  const itemRows = idaRows(R.items);
  for (const it of itemRows) byItem[s(it.id)] = it;
  const holderRows = idaRows(R.batches);
  // one context: fill-back -> item ids -> eligibility -> code_required + CHECK_REQUIRED_FIELD -> code_validate (search_items / search_batches = the reads)
  let f = null;
  try {
    f = idaFill(guard, form, (r) => {
      const why = idaIneligible(r.allData, r.itemIds, byItem, R);
      if (why) return { why: why };
      const chk = idaCheckRequired(guard.tenantId, __run("code_required"));
      if (s(chk.status) === "Failed") return { chk: chk };
      __set("node:search_items", { data: { total: itemRows.length, count: itemRows.length, data: itemRows } });
      __set("node:search_batches", { data: { total: holderRows.length, count: holderRows.length, data: holderRows } });
      return { chk: chk, v: __run("code_validate") };
    });
  } catch (e) {
    return out("STOP", "400", "The Item Disassembly could not be checked: " + s(e && e.message), "IDA_INVALID_DATA");
  }
  const a = f.allData;
  const rows = a.stock_movement;
  const lines = idaRecoveryLines(rows);
  const g = f.more || {};
  base.lineCount = lines.length;
  base.pickCount = idaPickCount(a);
  base.moveCount = idaMoveCount(a, rows);
  if (g.why) return Object.assign(base, notEligible(g.why, base.moveCount));
  if (s(g.chk && g.chk.status) === "Failed") return out("STOP", "400", s(g.chk.message), "IDA_REQUIRED_FIELDS");
  if (s(g.v && g.v.status) !== "Passed") return out("STOP", "400", s(g.v && g.v.message) || "The Item Disassembly could not be checked.", "IDA_INVALID");
  const taken = idaTypedTaken(rows, byItem, holderRows);
  if (taken) return out("STOP", "400", taken, "IDA_INVALID");
  base.stockLines = lines.filter((l) => idaStockItem(byItem[idaIdStr(l.item_selection)])).length;
  base.nonStockLines = lines.filter((l) => idaNonStockItem(byItem[idaIdStr(l.item_selection)])).length;
  if (base.pickCount > IDA_MAX_MOVES) return out("STOP", "400", IDA_TEXT.splitRequired(base.pickCount, "source picks"), "IDA_SPLIT_REQUIRED", { reason: "split" });
  if (lines.length > IDA_MAX_MOVES) return out("STOP", "400", IDA_TEXT.splitRequired(lines.length, "recovery lines"), "IDA_SPLIT_REQUIRED", { reason: "split" });
  if (base.pickCount > IDA_V2_MAX_LEG) return out("STOP", "400", idaLegTooBig(base.pickCount, "source picks"), "IDA_SPLIT_REQUIRED", { reason: "split" });
  if (base.stockLines > IDA_V2_MAX_LEG) return out("STOP", "400", idaLegTooBig(base.stockLines, "recovery lines"), "IDA_SPLIT_REQUIRED", { reason: "split" });
  // ruling 7 (the engine refuses an empty leg): code_validate and "no stock to receive" already refused both cases
  if (!base.pickCount || !base.stockLines) return out("STOP", "400", "The Item Disassembly has nothing to issue or nothing to receive.", "IDA_INVALID_DATA");
  const srcId = idaIdStr(a.item_id);
  const wa = idaFlagged(R.wa, (r) => s(r.material_id) + "|" + (s(r.batch_id) || "0"));
  const noWa = idaPicks(a).find((p) => wa[srcId + "|" + (idaIdStr(p.batch_id) || "0")]);
  if (noWa) {
    const b = idaIdStr(noWa.batch_id);
    return out("STOP", "400", "No Weighted Average costing record for item " + idaCode(byItem[srcId], srcId) + " at this plant" + (b ? " (batch " + b + ")" : "")
      + ". The batch was most likely moved between plants without its costing record; create it for this plant before issuing this stock.", "IDA_NO_WA_RECORD");
  }
  const auto = rows.filter((l) => idaBatchKind(l, byItem[idaIdStr(l.item_selection)]) === "AUTO");
  base.autoLines = auto.length;
  if (auto.length) {
    const dry = idaBatchnum(R.bnc, itemRows.map((it) => ({ id: s(it.id), item_category: it.item_category, item_group_id: it.item_group_id })),
      auto.map((l) => idaBatchRequest(a, l, base.organizationId)), Date.now());
    if (dry.error) return out("STOP", "400", s(dry.error), "IDA_BATCH_CONFIG");
  }
  return out("GO", "", "", "", { allData: a, stockMovementNo: s(a.stock_movement_no) });
};
