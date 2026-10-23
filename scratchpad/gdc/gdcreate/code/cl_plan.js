// GD_ASYNC_SUBMIT - Credit check plan: PREPARE's own rule (code_node_CLplan00) at the click - full_cl_check = 1, not No
// Accounting, a customer; the total of the top-level lines (a bundle row carries its items' total)
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const setupRows = [{{node:sql_node_GSclSetup.data}}][0];
const setup = (Array.isArray(setupRows) ? setupRows[0] : setupRows) || {};
let payload = {};
try {
  payload = JSON.parse(s([{{node:code_node_EluyWNR5.data.payloadText}}][0]) || "{}") || {};
} catch (e) {
  payload = {};
}
const header = payload.header || {};
let total = 0;
for (const line of Array.isArray(payload.lines) ? payload.lines : []) {
  if (!line || s(line.stable_line_key).indexOf(".") !== -1) continue;
  const oq = parseFloat(line.gd_order_quantity) || 0;
  const gq = parseFloat(line.gd_qty) || 0;
  if (oq > 0 && gq > 0) total += ((parseFloat(line.total_price) || 0) / oq) * gq;
}
const customerId = s(Array.isArray(header.customer_name) ? header.customer_name[0] : header.customer_name);
let why = "";
if (s(setup.full_cl_check) !== "1") why = "full_cl_check is off";
else if (s(header.acc_integration_type) === "No Accounting") why = "No Accounting";
else if (!customerId) why = "no customer";
console.log("submit credit plan", JSON.stringify({ need: !why, total: total, why: why }));
return { needCL: why ? "NO" : "YES", customerId: customerId, total: Number(total.toFixed(8)), why: why };
