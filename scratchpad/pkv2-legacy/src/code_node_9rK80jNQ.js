const gdDatas = {{node:code_node_B3E0xodz.data.updatedGdDatas}};
const currentIndexRaw = {{node:get_cache_node_3lCsEcVi.data}};
const index = currentIndexRaw ? parseInt(currentIndexRaw, 10) : 0;

const gdData = gdDatas[index];
const pickingStatus = gdData.picking_status;

return {
  gdData,
  pickingStatus,
  index,
  nextIndex: index + 1,
  docNo: gdData.delivery_no || gdData.id || "",
}