// Prep + header refusals for "Revert Completed Item Assembly".
//
// Completion writes two kinds of movement under the document number: an IA OUT
// per component pick and one IA IN for the assembled item. A revert writes the
// mirror image as IA-R. Pairing each IA-R row with the IA row it undid tells
// this run exactly what is still outstanding, which is what makes a retry after
// a half-finished run safe.
const EPS = 0.005;
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const roundQty = (v) => parseFloat(num(v).toFixed(3));
const asArr = (v) => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);
const S = (v) => (v === null || v === undefined ? "" : String(v));
// Snowflake ids are past JS's safe integer range, so they are compared as strings.
const cmpId = (a, b) => {
  a = S(a);
  b = S(b);
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
};
const digits = (v) => (/^[0-9]+$/.test(S(v)) ? S(v) : "0");
const token = (v) => (/^[A-Za-z0-9\/\-_. ]{1,64}$/.test(S(v)) ? S(v) : "");

const iaRaw = {{node:get_node_iaRvIa.data.data}};
const ia = Array.isArray(iaRaw) ? iaRaw[0] || null : iaRaw && iaRaw.id ? iaRaw : null;
const iaId = S({{node:code_node_iaRvParams.data.iaId}});
const iaNo = S({{node:code_node_iaRvParams.data.iaNo}});
const orgParam = S({{node:code_node_iaRvParams.data.organizationId}});
const orgId = ia ? S(ia.organization_id) : "";
// A Manual Input number can repeat in another organization.
const movRows = asArr({{node:sql_node_iaRvMovs.data}}).filter((r) => S(r.organization_id) === orgId);
const batchRows = asArr({{node:search_node_iaRvBatch.data.data}}).filter((b) => S(b.organization_id) === orgId);

let refuse = 0;
let refuseMessage = "";
const deny = (msg) => {
  if (!refuse) {
    refuse = 1;
    refuseMessage = msg;
  }
};

if (!ia || !ia.id || !token(orgId) || (orgParam && orgParam !== orgId)) {
  deny("Item Assembly record not found for this organization.");
}
const status = ia ? S(ia.item_assembly_status) : "";
const postedStatus = ia ? S(ia.posted_status).trim() : "";
if (!refuse && status === "Fully Posted") {
  deny("This Item Assembly has been posted to accounting and cannot be reverted.");
}
if (!refuse && status !== "Completed") {
  deny("Only Completed Item Assembly can be reverted (this one is " + (status || "blank") + ").");
}
if (!refuse && postedStatus === "Posted") {
  deny("This Item Assembly has been posted to accounting and cannot be reverted.");
}

// Components go OUT and come back IN; the assembled item goes IN and goes back OUT.
const sideOf = (r) => {
  const t = S(r.transaction_type);
  const m = S(r.movement).toUpperCase();
  if ((t === "IA" && m === "OUT") || (t === "IA-R" && m === "IN")) return "component";
  if ((t === "IA" && m === "IN") || (t === "IA-R" && m === "OUT")) return "assembled";
  return "";
};
const ownRows = movRows.filter((r) => S(r.trx_no) === iaNo && sideOf(r) !== "");

// A reversal is written to the same item, batch, bin, category and handling
// unit as the row it undoes, so that tuple is the pairing key.
const tupleOf = (r) =>
  sideOf(r) + "|" + S(r.item_id) + "|" + S(r.batch_number_id) + "|" + S(r.bin_location_id) + "|" +
  S(r.inventory_category) + "|" + S(r.handling_unit_id);
const byTuple = {};
for (const r of ownRows) {
  const t = tupleOf(r);
  if (!byTuple[t]) byTuple[t] = [];
  byTuple[t].push(r);
}
let liveRows = [];
let partialRow = 0;
for (const t of Object.keys(byTuple)) {
  const ordered = byTuple[t].slice().sort((a, b) => cmpId(a.id, b.id));
  let outstanding = 0;
  let cycle = [];
  for (const r of ordered) {
    if (S(r.transaction_type) === "IA") {
      outstanding = roundQty(outstanding + num(r.base_qty));
      cycle.push(r);
      continue;
    }
    outstanding = roundQty(outstanding - num(r.base_qty));
    if (outstanding <= EPS) {
      outstanding = 0;
      cycle = [];
    }
  }
  let acc = 0;
  const live = [];
  for (let i = cycle.length - 1; i >= 0 && acc < outstanding - EPS; i--) {
    live.unshift(cycle[i]);
    acc = roundQty(acc + num(cycle[i].base_qty));
  }
  if (Math.abs(acc - outstanding) > EPS) partialRow = 1;
  liveRows = liveRows.concat(live);
}
liveRows.sort((a, b) => cmpId(a.id, b.id));
const liveOut = liveRows.filter((r) => sideOf(r) === "component");
const liveIn = liveRows.filter((r) => sideOf(r) === "assembled");

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
const assembledItemId = ia ? S(ia.item_id) : "";
const itemIds = uniq(liveRows.map((r) => r.item_id));
const assembledIds = uniq([assembledItemId].concat(liveIn.map((r) => r.item_id)));
// Every Batch row this document minted is a candidate for removal, including
// one whose receipt never landed, so their balances are fetched as well.
const ownBatchIds = batchRows.filter((b) => S(b.material_id) === assembledItemId).map((b) => b.id);
const batchIds = uniq(liveIn.map((r) => r.batch_number_id).concat(ownBatchIds));
const huIds = uniq(liveOut.map((r) => r.handling_unit_id));
const orNone = (arr) => (arr.length > 0 ? arr : ["-1"]);
const csv = (arr) => arr.map(digits).filter((v) => v !== "0").join(",") || "0";
const plantId = ia ? S(ia.issuing_operation_faci) : "";

return {
  refuse,
  refuseMessage,
  headerOnly: liveRows.length === 0 ? 1 : 0,
  iaId,
  iaNo,
  organizationId: orgId,
  plantId,
  plantIdSql: digits(plantId),
  iaIdSql: digits(iaId),
  orgSql: token(orgId),
  assembledItemId,
  itemIdsCsv: csv(itemIds),
  assembledIdsCsv: csv(assembledIds),
  liveOut,
  liveIn,
  partialRow,
  itemIds: orNone(itemIds),
  assembledIds: orNone(assembledIds),
  batchIds: orNone(batchIds),
  huIds: orNone(huIds),
  batchRows,
};
