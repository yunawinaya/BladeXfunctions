// PackingProcessWorkflow — node 2: Extract IDs
// Paste into the code-node. Replace {{...}} references if your node names differ.

const allData = {{workflowparams:allData}};
const packingId = allData.id || "";
const gdId = allData.gd_id || "";

if (!packingId) {
  return {
    packingId: "",
    gdId: "",
    hasError: 1,
    errorCode: "400",
    errorMsg: "Missing packing id",
  };
}
if (!gdId) {
  return {
    packingId,
    gdId: "",
    hasError: 1,
    errorCode: "400",
    errorMsg: "Missing gd_id on packing",
  };
}

return {
  packingId,
  gdId,
  hasError: 0,
  errorCode: "",
  errorMsg: "",
};
