// IA_SAVE v14 - the split's receipts (osReceiptPlan): its Batch rows read back, one ADD_INVENTORY call per row with its batch's id;
// STOP = the batches are not all there (PARTIAL|RECEIPT|0/n: the header says Completed, the components are issued)
const res = osReceiptPlan([{{node:code_node_OSfinal.data}}][0], [{{node:code_node_OSplan.data}}][0], osJ([{{node:sql_node_OSbatchRead.data}}][0]),
  [{{node:code_fillback.data.allData}}][0]);
console.log("ia output split receipts", JSON.stringify({ route: res.route, n: res.n }));
return { route: res.route, message: res.message, receipts: res.receipts, n: res.n, marker: res.marker };
