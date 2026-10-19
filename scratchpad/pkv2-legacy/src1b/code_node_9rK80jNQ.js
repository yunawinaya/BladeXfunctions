// One GD per pass, from the loop item (routed by code_node_GdPlan).
const item = {{node:loop_zRdd7yAf}} || {};
const gdData = item.gd || {};

return {
  gdData,
  pickingStatus: gdData.picking_status,
  route: item.route || "",
  failCode: item.failCode || "",
  failMessage: item.failMessage || "",
  docNo: gdData.delivery_no || gdData.id || "",
}