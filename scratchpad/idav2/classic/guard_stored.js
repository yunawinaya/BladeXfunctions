// The STORED status decides: Processing = a background job holds it; Completed / Fully Posted saved as Draft = the stale-tab double move
const idaGuardRows = [{{node:sql_node_IDAguard.data}}][0];
const idaGuardOut = [{{node:code_node_IDAguardIn.data}}][0] || {};
let idaGuardStored = "";
try {
  const rows = Array.isArray(idaGuardRows) ? idaGuardRows : idaGuardRows && typeof idaGuardRows === "object" ? [idaGuardRows] : [];
  const row = rows.find((r) => r && typeof r === "object") || {};
  idaGuardStored = idaS(row.item_disassembly_status);
} catch (e) {
  idaGuardStored = "";
}
const idaGuardBusy = idaGuardStored === "Processing";
const idaGuardFinal = !idaGuardBusy && idaS(idaGuardOut.saveAs) === "Draft" && IDA_FINAL.indexOf(idaGuardStored) >= 0;
const idaGuardBig = !idaGuardBusy && !idaGuardFinal && idaS(idaGuardOut.big) === "YES";
return {
  stored: idaGuardStored,
  refuse400: idaGuardBusy || idaGuardBig ? "YES" : "NO",
  refuse409: idaGuardFinal ? "YES" : "NO",
  message: idaGuardBusy ? IDA_TEXT.busy : idaGuardFinal ? IDA_TEXT.classicFinal(idaGuardStored) : idaGuardBig ? idaS(idaGuardOut.bigMessage) : "",
};
