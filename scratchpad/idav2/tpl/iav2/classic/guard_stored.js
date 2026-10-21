// The STORED status decides: Processing = a background job holds it; Completed / Fully Posted saved as Draft = the stale-tab double move
const iaGuardRows = [{{node:sql_node_IAguard.data}}][0];
const iaGuardOut = [{{node:code_node_IAguardIn.data}}][0] || {};
let iaGuardStored = "";
try {
  const rows = Array.isArray(iaGuardRows) ? iaGuardRows : iaGuardRows && typeof iaGuardRows === "object" ? [iaGuardRows] : [];
  const row = rows.find((r) => r && typeof r === "object") || {};
  iaGuardStored = iaS(row.item_assembly_status);
} catch (e) {
  iaGuardStored = "";
}
const iaGuardBusy = iaGuardStored === "Processing";
const iaGuardFinal = !iaGuardBusy && iaS(iaGuardOut.saveAs) === "Draft" && IA_FINAL.indexOf(iaGuardStored) >= 0;
const iaGuardBig = !iaGuardBusy && !iaGuardFinal && iaS(iaGuardOut.big) === "YES";
return {
  stored: iaGuardStored,
  refuse400: iaGuardBusy || iaGuardBig ? "YES" : "NO",
  refuse409: iaGuardFinal ? "YES" : "NO",
  message: iaGuardBusy ? IA_TEXT.busy : iaGuardFinal ? IA_TEXT.classicFinal(iaGuardStored) : iaGuardBig ? iaS(iaGuardOut.bigMessage) : "",
};
