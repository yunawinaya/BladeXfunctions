const parseJsonSafely = (jsonString, defaultValue = []) => {
  try {
    return jsonString ? JSON.parse(jsonString) : defaultValue;
  } catch (error) {
    return defaultValue;
  }
};

const item = {{node:code_node_gG7AZrE1.data.item}}
const itemMaster = {{node:get_node_90sgHngm.data.data}}

const material_id = item.material_id;
const material_uom = item.gd_order_uom_id || item.good_delivery_uom_id;
const parent_line_id = item.line_so_id || "";
const doc_line_id = item.id || "";

const isBatchManagedItem = itemMaster.item_batch_management === 1;
const temporaryData = parseJsonSafely(item.temp_qty_data);

let message = null;
let code = null;

if (
  temporaryData.length === 0
) {
  message = `No temp_qty_data to process for item ${item.material_name}`;
  code = "200";
}

// GROUP temp_qty_data by location + batch combination
const groupedTempData = {};

for (const temp of temporaryData) {
  const groupKey =
    isBatchManagedItem && temp.batch_id
      ? `${temp.location_id}|${temp.batch_id}`
      : temp.location_id;

  if (!groupedTempData[groupKey]) {
    groupedTempData[groupKey] = {
      location_id: temp.location_id,
      batch_id: temp.batch_id || null,
      totalQty: 0,
    };
  }

  groupedTempData[groupKey].totalQty += parseFloat(
    temp.gd_quantity || temp.quantity || 0,
  );
}

const groupKeys = Object.keys(groupedTempData);

return {
  message: message,
  code: code,
  groupKeys: groupKeys,
  groupedTempData: groupedTempData,
  material_id: material_id,
  material_uom: material_uom,
  parent_line_id: parent_line_id,
  doc_line_id: doc_line_id,
};
