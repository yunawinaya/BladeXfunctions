// Small Cycle save checks shared by IA_SAVE v13 and IA_V2_SUBMIT v4 (scratchpad/iasc/CONTRACT.md sections 2-6): scIn decides
// what to read, scClassicCheck merges (a key a payload leaves out keeps its stored value) and validates; pure, ES2015
const SC_KEYS = ["source_so_id", "source_so_line_id", "source_so_context_json", "bom_consumption_mode", "source_bom_id", "bom_snapshot_json", "planned_output_qty"];
const scIn = function scIn(input) {
  const a = (input && input.allData) || {};
  const digits = (v) => /^[0-9]{1,20}$/.test(scS(v));
  const page = scS(input.pageStatus) || scS(a.page_status);
  const edit = page === "Edit" && digits(a.id);
  const present = SC_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(a, k));
  const line = scS(a.source_so_line_id);
  return { need: edit || present.length > 0 ? "YES" : "NO", edit: edit ? "YES" : "NO", tenantId: digits(input.tenantId) ? scS(input.tenantId) : "0",
    iaId: edit ? scS(a.id) : "0", lineId: digits(line) ? line : "0", present: present.join(",") };
};
const scClassicCheck = function scClassicCheck(input) {
  const a = input.allData || {};
  const sin = input.scIn || {};
  const src = spRows(input.rows)[0] || {};
  const stored = src.stored && typeof src.stored === "object" ? src.stored : null;
  const line = src.line || null;
  const header = src.header || null;
  const digits = (v) => /^[0-9]{1,20}$/.test(scS(v));
  const has = (k) => Object.prototype.hasOwnProperty.call(a, k);
  const pick = (k) => (has(k) ? a[k] : stored ? stored[k] : null);
  const text = (v) => (v && typeof v === "object" ? JSON.stringify(v) : scS(v));
  let planned = pick("planned_output_qty");
  planned = scS(planned) === "" ? null : Math.max(0, scQ8(planned)).toFixed(8);
  const out = { route: "OK", message: "", source_so_id: scS(pick("source_so_id")), source_so_line_id: scS(pick("source_so_line_id")),
    source_so_context_json: text(pick("source_so_context_json")), bom_consumption_mode: scS(pick("bom_consumption_mode")), source_bom_id: scS(pick("source_bom_id")),
    bom_snapshot_json: text(pick("bom_snapshot_json")), planned_output_qty: planned };
  const stop = (why) => Object.assign({}, out, { route: "STOP", message: why });
  if ((out.source_so_id === "") !== (out.source_so_line_id === "") || (out.source_so_id && (!digits(out.source_so_id) || !digits(out.source_so_line_id)))) {
    return stop("The Sales Order link is incomplete: select the Sales Order line again.");
  }
  if (out.bom_consumption_mode && out.bom_consumption_mode !== "STANDARD" && out.bom_consumption_mode !== "FLAT") {
    return stop("Unknown BOM mode " + out.bom_consumption_mode + ": choose Standard or Flat.");
  }
  // the server owns the link context: the stored one on an Edit (the client's is only a preview), none on an Add / Clone
  const storedCtx = stored ? text(stored.source_so_context_json) : "";
  const old = stored ? scParseJ(storedCtx) || {} : {};
  const history = Array.isArray(old.history) ? old.history : [];
  const at = scS(input.nowIso);
  const by = scS(input.uid);
  const storedLine = stored ? scS(stored.source_so_line_id) : "";
  if (out.source_so_line_id) {
    const isNew = sin.edit !== "YES" || out.source_so_line_id !== storedLine;
    if (isNew) {
      // the line's organisation is compared with the IA's: an IA without one cannot be linked
      if (!digits(scS(a.organization_id))) return stop("This Item Assembly has no organization: reopen it and save again.");
      const p = scProject({ line: line, header: header, fg: null, ias: [], iaItemId: scS(a.item_id), iaOrgId: scS(a.organization_id) });
      if (!line || scS(line.id) !== out.source_so_line_id || !p.eligibleNew) {
        return stop("This Sales Order line cannot be linked: " + (p.reason || "it no longer exists.") + " Select another line or save without a link.");
      }
      if (scS(line.sales_order_id) !== out.source_so_id) return stop("The Sales Order line does not belong to that Sales Order: select the line again.");
      out.source_so_context_json = JSON.stringify({ v: 1, soId: scS(header.id), lineId: scS(line.id), soNo: scS(header.so_no), lineIndex: scS(line.line_index),
        customerId: scS(header.customer_id), itemId: scS(line.item_name), orderedQty: scS(line.so_quantity), uomId: scS(line.so_item_uom),
        headerStatus: scS(header.so_status), lineStatus: scS(line.line_status), linkedAt: at, linkedBy: by,
        history: history.concat([{ op: storedLine ? "RELINK" : "LINK", lineId: scS(line.id), orderedQty: scS(line.so_quantity), at: at, by: by }]).slice(-20) });
    } else if (stored && scS(stored.item_id) && scS(stored.item_id) !== scS(a.item_id)) {
      // an item changed on the Sales Order side is only a warning (ITEM_CHANGED); changed on the IA under its link it is refused
      return stop("The item of this Item Assembly was changed while it is linked to a Sales Order line: unlink it first, or link a line of the new item.");
    } else if (stored) {
      out.source_so_context_json = storedCtx;
    }
  } else if (storedLine) {
    out.source_so_context_json = JSON.stringify(Object.assign({}, old, { lineId: "", history: history.concat([{ op: "UNLINK", lineId: storedLine, at: at, by: by }]).slice(-20) }));
  } else {
    out.source_so_context_json = storedCtx;
  }
  if (out.bom_consumption_mode === "FLAT" && !out.bom_snapshot_json) return stop("Prepare the Flat BOM before saving: no BOM snapshot is saved.");
  if (out.bom_consumption_mode && out.bom_snapshot_json) {
    const chk = scCheck(out.bom_snapshot_json, { bom_consumption_mode: out.bom_consumption_mode, item_id: a.item_id, item_uom: a.item_uom, source_bom_id: out.source_bom_id,
      item_qty: a.item_qty }, a.stock_movement, { completing: scS(input.saveAs) !== "Draft" });
    if (!chk.ok) return stop(chk.message);
  }
  return out;
};
if (typeof module !== "undefined") module.exports = { SC_KEYS, scIn, scClassicCheck };
