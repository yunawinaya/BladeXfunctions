let huData = {{node:code_node_dofqVRSn.data.huData}} || null;
if (huData && huData?.table_hu_items && huData?.table_hu_items.length > 0) {
  huData.table_hu_items[0].location_id = {{node:code_node_dofqVRSn.data.data.bin_location_id}};
  huData.table_hu_items[0].balance_id = {{node:workflow_node_wCxvhaAr.data.balanceId}} || "";
}

return {
  table_hu_items: huData?.table_hu_items || [],
  hasHuData: huData?.hasHuData || 0,
  handling_unit_id: huData?.handling_unit_id || "",
  handling_no: huData?.handling_no || "",
  hu_material_id: huData?.hu_material_id || "",
  hu_type: huData?.hu_type || "",
  hu_uom: huData?.hu_uom || "",
  remark: huData?.remark || "",
}

