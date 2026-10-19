const toDatas = {{node:code_node_Qxtc1i6K.data.updatedToDatas}};
const currentIndexRaw = {{node:get_cache_node_6yG35O6H.data}};
const index = currentIndexRaw ? parseInt(currentIndexRaw, 10) : 0;

const toData = toDatas[index];
const pickingStatus = toData.picking_status;

return {
  toData,
  pickingStatus,
  index,
  nextIndex: index + 1,
  docNo: toData.to_id || toData.id || "",
}