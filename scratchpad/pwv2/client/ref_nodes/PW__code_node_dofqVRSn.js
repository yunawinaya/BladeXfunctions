const inventoryMovements = {{node:code_node_M7XzDZ48.data.inventoryMovements}} || [];
const currentIndexRaw = {{node:get_cache_node_CqyAlkUh.data}};
const index = currentIndexRaw ? parseInt(currentIndexRaw, 10) : 0;
const data = inventoryMovements[index];
const movement = data.movement;
const huData = data.hu_data && data.hu_data !== "" ? JSON.parse(data.hu_data) : null;

return {
  data,
  movement,
  index,
  nextIndex: index + 1,
  huData,
  huId: huData?.handling_unit_id || "",
}
