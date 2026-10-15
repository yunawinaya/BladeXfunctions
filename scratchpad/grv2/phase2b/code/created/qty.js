// Over-receive checks (texts as before) + reservation delta per PO line: this GR's qty - what its stored Created save held
const roundQty = (v) => parseFloat(parseFloat(v || 0).toFixed(3));
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const lines = [{{node:code_node_GcPrep.data.lines}}][0] || [];
const stored = [{{node:code_node_GcProcBusy.data.oldAgg}}][0];
const poRows = [{{node:sql_node_GcPoLines.data}}][0] || [];
const tolRows = [{{node:sql_node_GcTol.data}}][0] || [];
const continueOvercommit = String([{{workflowparams:continueOvercommit}}][0] || "");
const SLICE = 250;

const hasOld = stored !== undefined && stored !== null && typeof stored === "object";
const old = hasOld ? stored : {};
const poLineMap = new Map();
for (const r of poRows) poLineMap.set(String(r.id), r);
const tolMap = new Map();
for (const r of tolRows) {
  const k = String(r.item_id) + "|" + String(r.uom_id);
  if (!tolMap.has(k)) tolMap.set(k, Number(r.tol) || 0);
}

const hardErrors = [];
const warnings = [];
for (const a of lines) {
  const poLine = poLineMap.get(a.lid);
  if (!poLine) continue;
  const tol = tolMap.get(a.item + "|" + a.uom) || 0;
  const name = a.name;
  const newQty = a.q3;
  const ordered = parseFloat(poLine.quantity || 0);
  const received = parseFloat(poLine.received_qty || 0);
  let created = parseFloat(poLine.created_received_qty || 0);
  if (hasOld) created = Math.max(0, roundQty(created - ((old[a.lid] || {}).q3 || 0)));

  const maxReceivable = roundQty((ordered - received) * (100 + tol) / 100);
  if (newQty > maxReceivable) {
    hardErrors.push(`${name}: receiving ${newQty} exceeds remaining receivable ${Math.max(0, maxReceivable)} (Ordered ${ordered}, Already received ${received}).`);
  }
  const maxAllowed = roundQty(ordered * (100 + tol) / 100);
  const totalAfter = roundQty(received + created + newQty);
  if (totalAfter > maxAllowed) {
    warnings.push(`${name}: committed total ${totalAfter} would exceed PO max ${maxAllowed} (Received ${received}, In Created GRs ${created}, This GR ${newQty}).`);
  }
}
const errorMessage = hardErrors.length > 0 ? "Cannot save - quantity exceeds purchase order:\n" + hardErrors.join("\n") : null;
const warningMessage = warnings.length > 0
  ? "Over-Commitment Warning:\n" + warnings.join("\n") + "\n\nThis GR can be saved as Created, but may fail to receive if other Created GRs are received first.\nDo you want to proceed?"
  : null;

// an Edit can drop a PO line: it is released too
const new8 = new Map();
for (const a of lines) new8.set(a.lid, a.q8);
const updates = [];
const newPo = new Set();
const touchedPo = new Set();
for (const lid of new Set([...new8.keys(), ...Object.keys(old)])) {
  const poLine = poLineMap.get(lid);
  if (!poLine) continue;
  const po = String(poLine.po_id);
  if (new8.has(lid)) newPo.add(po);
  const delta = q8((new8.get(lid) || 0) - ((old[lid] || {}).q8 || 0));
  if (delta === 0) continue;
  const next = Math.max(0, q8(parseFloat(poLine.created_received_qty || 0) + delta));
  updates.push({ id: lid, created_received_qty: next.toFixed(8) });
  touchedPo.add(po);
}
const slices = [];
for (let i = 0; i < updates.length; i += SLICE) slices.push({ n: slices.length + 1, rows: updates.slice(i, i + SLICE) });
const ok = (v) => /^[0-9]{1,20}$/.test(v);
const relPo = [...touchedPo].filter((p) => !newPo.has(p) && ok(p));

return {
  qtyStop: hardErrors.length > 0 ? "YES" : "NO",
  errorMessage,
  overStop: warnings.length > 0 && continueOvercommit !== "Yes" ? "YES" : "NO",
  warningMessage,
  hasLineUpdates: updates.length > 0 ? "YES" : "NO",
  slices,
  lineUpdateCount: updates.length,
  newPoCsv: [...newPo].filter(ok).join(",") || "0",
  relPoCsv: relPo.join(",") || "0",
};
