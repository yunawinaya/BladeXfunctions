// IA_SC_RELINK - Check: only a completed IA whose SO line is gone, onto a live line of the same SO, item and organisation;
// the baseline is rewritten from the new line and the history keeps its last 20 entries
const rlCheck = function rlCheck(g, ia, lh, nowIso) {
  const stop = (why) => ({ route: "STOP", code: "400", message: why, rows: [], needUpd: "NO" });
  if (!ia) return stop("Item Assembly not found.");
  const status = spS(ia.status);
  if (status === "Processing") return stop("This Item Assembly is being processed in the background - please wait for it to finish.");
  if (status === "Draft") return stop("Edit the Item Assembly to change its Sales Order line.");
  if (status !== "Completed" && status !== "Fully Posted") return stop("Only a completed Item Assembly can be re-linked here (it is " + (status || "without a status") + ").");
  if (spS(ia.item_id) !== spS(g.item) || spS(ia.organization_id) !== spS(g.org)) return stop("This Item Assembly does not match the request: open it again.");
  if (!spS(ia.source_so_line_id)) return stop("This Item Assembly is not linked to a Sales Order line.");
  if (Number(ia.old_line_live) > 0) return stop("Its Sales Order line still exists, so there is nothing to re-link.");
  const line = lh && lh.line;
  const header = lh && lh.header;
  if (!line || Number(line.is_deleted) === 1 || !header || Number(header.is_deleted) === 1) return stop("The chosen Sales Order line no longer exists.");
  if (spS(line.sales_order_id) !== spS(ia.source_so_id)) return stop("Re-link it to a line of the same Sales Order.");
  if (spS(line.item_name) !== spS(ia.item_id)) return stop("The chosen line is for a different item.");
  if (spS(header.organization_id) !== spS(ia.organization_id)) return stop("The chosen line belongs to another organisation.");
  const old = spParseJ(ia.source_so_context_json) || {};
  const history = (Array.isArray(old.history) ? old.history : [])
    .concat([{ op: "RELINK", lineId: spS(line.id), orderedQty: spS(line.so_quantity), at: nowIso, by: spS(g.uid) }]).slice(-20);
  const ctx = { v: 1, soId: spS(header.id), lineId: spS(line.id), soNo: spS(header.so_no), lineIndex: spS(line.line_index), customerId: spS(header.customer_id),
    itemId: spS(line.item_name), orderedQty: spS(line.so_quantity), uomId: spS(line.so_item_uom), headerStatus: spS(header.so_status),
    lineStatus: spS(line.line_status), linkedAt: nowIso, linkedBy: spS(g.uid), history: history };
  return { route: "OK", code: "200", message: "", rows: [{ id: spS(ia.id), source_so_line_id: spS(line.id), source_so_context_json: JSON.stringify(ctx) }], needUpd: "YES" };
};
const res = rlCheck([{{node:code_node_RLguard.data}}][0] || {}, spRows([{{node:sql_node_RLia.data}}][0])[0] || null,
  spRows([{{node:sql_node_RLline.data}}][0])[0] || null, new Date().toISOString());
console.log("relink check", JSON.stringify({ route: res.route, message: res.message }));
return res;
