// INVENTORY_BULK_APPLY guard: request, session tenant, run nonce, and every list the SQL nodes bind (digits only)
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const DIG = /^[0-9]{1,20}$/;
const KEY = /^[A-Za-z0-9._-]{1,40}$/;
const MAX_MOVEMENTS = 5000;

const bulkGuard = function bulkGuard(inp) {
  const reject = (code, message) => ({ route: "REJECT", result_code: code, result_message: message });
  const mode = s(inp.mode).toUpperCase();
  const op = s(inp.operationKey);
  const org = s(inp.organizationId);
  const tenant = s(inp.tenantId);
  if (mode !== "PLAN" && mode !== "APPLY") return reject("REQUEST_INVALID", "mode must be PLAN or APPLY");
  if (!/^[A-Za-z0-9|:._-]{1,32}$/.test(op)) return reject("REQUEST_INVALID", "operation_key must be 1-32 of A-Z a-z 0-9 | : . _ -");
  if (!DIG.test(org)) return reject("REQUEST_INVALID", "organization_id must be digits");
  if (!DIG.test(tenant)) return reject("REQUEST_INVALID", "no session tenant");
  let list = inp.movements;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch (e) {
      return reject("REQUEST_INVALID", "movements is not JSON");
    }
  }
  if (!Array.isArray(list) || !list.length) return reject("REQUEST_INVALID", "movements must be a non-empty array");
  if (list.length > MAX_MOVEMENTS) return reject("REQUEST_INVALID", "at most " + MAX_MOVEMENTS + " movements per operation");

  const seen = {};
  const mats = {};
  const balTuples = {};
  const batchTuples = {};
  const costPairs = {};
  const lockKeys = {};
  const effectKeys = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i] || {};
    const at = "movements[" + i + "] ";
    const key = s(m.movement_key);
    if (!KEY.test(key)) return reject("REQUEST_INVALID", at + "movement_key must be 1-40 of A-Z a-z 0-9 . _ -");
    if (seen[key]) return reject("REQUEST_INVALID", at + "movement_key " + key + " repeats");
    seen[key] = true;
    const dir = s(m.direction);
    if (dir !== "SUBTRACT" && dir !== "ADD") return reject("REQUEST_INVALID", at + "direction must be SUBTRACT or ADD");
    for (const f of ["material_id", "plant_id", "location_id"]) if (!DIG.test(s(m[f]))) return reject("REQUEST_INVALID", at + f + " must be digits");
    const batch = s(m.batch_id);
    if (batch && !DIG.test(batch)) return reject("REQUEST_INVALID", at + "batch_id must be digits or empty");
    if (s(m.organization_id) !== org) return reject("REQUEST_INVALID", at + "organization_id differs from the operation's");
    if (dir === "ADD" && s(m.batch_number) && s(m.batch_number) !== "-" && !batch) return reject("UNSUPPORTED_NEW_BATCH", at + "creating a new batch is not supported yet");
    if (m.unit_price_from !== undefined && m.unit_price_from !== null && s(m.unit_price_from) !== "" && !seen[s(m.unit_price_from)]) {
      return reject("REQUEST_INVALID", at + "unit_price_from must name an earlier movement");
    }
    const mat = s(m.material_id);
    const loc = s(m.location_id);
    const plant = s(m.plant_id);
    mats[mat] = true;
    balTuples["[" + mat + "," + loc + "," + plant + "]"] = true;
    costPairs["[" + mat + "," + plant + "]"] = true;
    lockKeys["ITEM|" + mat + "|" + loc] = true;
    // plant-level FIFO / WA rows: written by every movement that is not a category move (core.js isMovingInv 0)
    const moving = m.isMovingInv === undefined || m.isMovingInv === null ? 0 : Number(m.isMovingInv);
    if (moving !== 1) lockKeys["COST|" + mat + "|" + plant] = true;
    if (batch) {
      batchTuples["[" + mat + "," + loc + "," + batch + "," + plant + "]"] = true;
      lockKeys["BATCH|" + mat + "|" + loc + "|" + batch] = true;
    }
    effectKeys.push(op + "|" + key);
  }
  const keys = Object.keys(lockKeys).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // lists reach the SQL as ONE bound JSON string, unpacked by JSON_TABLE (ids stay exact: digits become JSON integers)
  const jsonList = (o) => "[" + Object.keys(o).join(",") + "]";
  return {
    route: "GO",
    result_code: "",
    result_message: "",
    mode: mode,
    operationKey: op,
    organizationId: org,
    tenantId: tenant,
    nonce: (s(inp.uuid).replace(/[^0-9a-fA-F]/g, "") + "000000000000").slice(0, 12),
    count: list.length,
    materialIdsCsv: Object.keys(mats).join(",") || "0",
    balTuplesJson: jsonList(balTuples),
    batchTuplesJson: jsonList(batchTuples),
    costPairsJson: jsonList(costPairs),
    effectKeysJson: JSON.stringify(effectKeys),
    lockKeys: keys,
    lockKeysJson: JSON.stringify(keys),
  };
};

return bulkGuard({
  mode: [{{workflowparams:mode}}][0],
  operationKey: [{{workflowparams:operation_key}}][0],
  organizationId: [{{workflowparams:organization_id}}][0],
  movements: [{{workflowparams:movements}}][0],
  tenantId: [{{system:tenantId}}][0],
  uuid: [{{system:uuid}}][0],
});
