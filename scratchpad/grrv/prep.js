// Prep + cheap header refusals for "Revert Completed Goods Receiving".
//
// Everything the revert needs is DERIVED from what is on the record today; no
// completion-time snapshot exists. The one non-obvious derivation is which of
// this GR's GRN movement rows are still LIVE: a GR can be reverted, completed
// again and reverted again, and a revert can fail half way through. So each
// GRN-R reversal row is PAIRED with the GRN row it reversed, and the unpaired
// GRN rows are the ones this run has to undo.
const EPS = 0.005;
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const roundQty = (v) => parseFloat(num(v).toFixed(3));
const asArr = (v) => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);
const S = (v) => (v === null || v === undefined ? "" : String(v));
// Snowflake ids are ~2e18, past JS's safe integer range, so ids are compared as
// strings: same length sorts lexically, a longer string is always the larger id.
const cmpId = (a, b) => {
  a = S(a);
  b = S(b);
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
};
const digits = (v) => (/^[0-9]+$/.test(S(v)) ? S(v) : "0");

const grRaw = {{node:get_node_grRvGr.data.data}};
const gr = Array.isArray(grRaw) ? grRaw[0] || null : grRaw && grRaw.id ? grRaw : null;
const movRows = asArr({{node:sql_node_grRvMovs.data}});
const grId = S({{node:code_node_grRvParams.data.grId}});
const grNo = S({{node:code_node_grRvParams.data.grNo}});
const orgId = S({{node:code_node_grRvParams.data.organizationId}});

// table_gr is a tree: an item bundle is ONE row with its items under `children`.
// Every per-line rule downstream walks this flattened view, exactly as the
// completion workflow's loopRows does.
const flattenGrRows = (rows) => {
  const flat = [];
  for (const row of rows || []) {
    flat.push(row);
    for (const child of Array.isArray(row.children) ? row.children : []) flat.push(child);
  }
  return flat;
};

// Row routing, copied verbatim from GRsaveWorkflow code_node_D9IbUV8t so the
// revert reverses exactly the rows completion wrote.
const isSplitParent = (r) => r.is_split === "Yes" && r.parent_or_child === "Parent";
const isChild = (r) => r.parent_or_child === "Child";
const skipInventory = (r) => (!r.item_id || isSplitParent(r) ? 1 : 0);
const updatesPOLine = (r) => (isChild(r) ? 0 : 1);
const updatesOnOrder = (r) =>
  isSplitParent(r) || (!isSplitParent(r) && !isChild(r) && skipInventory(r) === 0) ? 1 : 0;
const addsInventory = (r) =>
  isChild(r) || (!isSplitParent(r) && skipInventory(r) === 0) ? 1 : 0;

let refuse = 0;
let refuseMessage = "";
const deny = (msg) => {
  if (!refuse) {
    refuse = 1;
    refuseMessage = msg;
  }
};

if (!gr || !gr.id) {
  deny("Goods Receiving record not found for this organization.");
}

const status = gr ? S(gr.gr_status) : "";
const putawayStatus = gr ? S(gr.putaway_status) : "";
const piStatus = gr ? S(gr.pi_status).trim() : "";
const returnStatus = gr ? S(gr.return_status).trim() : "";
const postedStatus = gr ? S(gr.posted_status).trim() : "";
const lines = gr ? flattenGrRows(gr.table_gr) : [];

// "Completed" and "Received" are the same inventory state: completion rewrites
// the status to Received whenever a putaway is required or a line goes to
// quality inspection, and the putaway later flips it back to Completed.
if (!refuse && status !== "Completed" && status !== "Received") {
  deny("Only Completed or Received Goods Receiving can be reverted (this one is " + (status || "blank") + ").");
}
// An invoice that was cancelled writes "Cancelled" back onto the GR, which is
// not a live invoice.
if (!refuse && piStatus !== "" && piStatus.toLowerCase() !== "cancelled") {
  deny("Already invoiced (" + piStatus + "). Please cancel the purchase invoice first.");
}
if (!refuse && returnStatus !== "" && returnStatus.toLowerCase() !== "cancelled") {
  deny("A purchase return exists (" + returnStatus + "). Please cancel the purchase return first.");
}
if (!refuse) {
  for (const line of lines) {
    if (num(line.return_quantity) > EPS || num(line.created_return_qty) > EPS) {
      deny("A purchase return has already claimed quantity from this receipt.");
      break;
    }
  }
}
if (!refuse && postedStatus === "Posted") {
  deny("This Goods Receiving has been posted to accounting and cannot be reverted.");
}
if (!refuse && (putawayStatus === "In Progress" || putawayStatus === "Completed")) {
  deny("Putaway is already " + putawayStatus + ". The stock has been put away and cannot be reverted.");
}

// --- Live GRN rows (pairing) -------------------------------------------------
const ownRows = movRows.filter(
  (r) => S(r.trx_no) === grNo && (r.transaction_type === "GRN" || r.transaction_type === "GRN-R")
);
const ownGrn = ownRows.filter((r) => r.transaction_type === "GRN").sort((a, b) => cmpId(a.id, b.id));
const ownRev = ownRows.filter((r) => r.transaction_type === "GRN-R").sort((a, b) => cmpId(a.id, b.id));

const rowKey = (r) =>
  S(r.item_id) + "|" + S(r.bin_location_id) + "|" + S(r.batch_number_id) + "|" + S(r.inventory_category);

// Walk this document's movements oldest first, keeping the receipts that have
// not been reversed yet. Whenever that set empties the receipt was fully
// reversed, so the next receipt starts a fresh cycle. `liveRows` is what this
// run has to undo; `cycleRows` is everything the current cycle posted, which is
// what the document's own quantities should still add up to even when an
// earlier run stopped half way.
const ordered = ownRows.slice().sort((a, b) => cmpId(a.id, b.id));
let openRows = [];
let cycleRows = [];
for (const r of ordered) {
  if (r.transaction_type === "GRN") {
    openRows.push(r);
    cycleRows.push(r);
    continue;
  }
  let matchIdx = -1;
  for (let i = 0; i < openRows.length; i++) {
    const g = openRows[i];
    if (rowKey(g) !== rowKey(r)) continue;
    if (Math.abs(num(g.base_qty) - num(r.base_qty)) > EPS) continue;
    matchIdx = i;
    break;
  }
  if (matchIdx === -1) continue;
  openRows.splice(matchIdx, 1);
  if (openRows.length === 0) cycleRows = [];
}
const liveRows = openRows;

// Packaging deductions the handling-unit workflow made for this GR, minus any
// already put back by an earlier revert.
const huOutAll = movRows.filter((r) => r.transaction_type === "HU" && S(r.parent_trx_no) === grNo);
const huReAll = movRows.filter((r) => r.transaction_type === "HU-R" && S(r.parent_trx_no) === grNo);
const reCount = {};
for (const r of huReAll) reCount[S(r.trx_no)] = (reCount[S(r.trx_no)] || 0) + 1;
const huOutRows = [];
for (const r of huOutAll) {
  const k = S(r.trx_no);
  if (reCount[k] > 0) {
    reCount[k] -= 1;
    continue;
  }
  huOutRows.push(r);
}

// Per-tuple anchor: the newest live receipt on that (item, batch). Anything
// posted on the tuple after it, by anyone else, means the stock moved on.
const tupleKey = (item, batch) => S(item) + "|" + S(batch);
const tupleAnchors = {};
for (const r of liveRows) {
  const k = tupleKey(r.item_id, r.batch_number_id);
  if (!tupleAnchors[k] || cmpId(r.id, tupleAnchors[k]) > 0) tupleAnchors[k] = S(r.id);
}
let minLiveId = "";
for (const r of liveRows) if (!minLiveId || cmpId(r.id, minLiveId) < 0) minLiveId = S(r.id);
if (!minLiveId) minLiveId = grId;

// --- Id sets for the second fetch round --------------------------------------
const uniq = (arr) => {
  const seen = {};
  const out = [];
  for (const v of arr) {
    const k = S(v);
    if (!k || seen[k]) continue;
    seen[k] = 1;
    out.push(k);
  }
  return out;
};
const itemIds = uniq(
  lines.map((l) => l.item_id).concat(liveRows.map((r) => r.item_id)).concat(huOutRows.map((r) => r.item_id))
);
const batchIds = uniq(liveRows.map((r) => r.batch_number_id));
const huIds = uniq(liveRows.map((r) => r.handling_unit_id));
const poIds = uniq(asArr(gr ? gr.po_id : []).concat(lines.map((l) => l.line_po_id)));
const poLineIds = uniq(lines.map((l) => l.po_line_item_id));
// An empty array would match every row, so an impossible id is used instead.
const orNone = (arr) => (arr.length > 0 ? arr : ["-1"]);

// Values interpolated into sql-node text are guarded here, not in the SQL.
const itemIdsCsv = itemIds.map(digits).filter((v) => v !== "0").join(",") || "0";
const plantId = gr ? S(gr.plant_id) : "";

if (!refuse && liveRows.length === 0) {
  let needsInventory = 0;
  for (const line of lines) if (addsInventory(line) === 1) needsInventory = 1;
  if (needsInventory === 1) {
    deny("No stock movements are left to reverse for this Goods Receiving. It may already have been reverted.");
  }
}

return {
  refuse,
  refuseMessage,
  grId,
  grIdList: [grId],
  grNo,
  organizationId: orgId,
  plantId,
  plantIdSql: digits(plantId),
  minLiveIdSql: digits(minLiveId),
  grIdSql: digits(grId),
  grNoSql: S({{node:code_node_grRvParams.data.grNoSql}}),
  orgSql: S({{node:code_node_grRvParams.data.orgSql}}),
  itemIdsCsv,
  previousStatus: gr ? S(gr.previous_status) : "",
  lines,
  liveRows,
  cycleRows,
  huOutRows,
  tupleAnchors,
  itemIds: orNone(itemIds),
  batchIds: orNone(batchIds),
  huIds: orNone(huIds),
  poIds: orNone(poIds),
  poLineIds: orNone(poLineIds),
};
