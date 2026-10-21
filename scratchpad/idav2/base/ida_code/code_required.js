const entry = {{node:code_fillback.data.allData}};

// Draft needs only what identifies the document. Each recovery row's own
// Storage/Bin, and the stock allocation, are Completed-only checks made in
// Validate Disassembly. The header has no storage/bin columns of its own.
const requiredFields = [
  { name: 'stock_movement_no', label: 'Item Disassembly No' },
  { name: 'issuing_operation_faci', label: 'Plant' },
  { name: 'item_id', label: 'BOM Item Code' },
  { name: 'item_qty', label: 'Disassembly Quantity' },
  { name: 'item_uom', label: 'Quantity UOM' },
  { name: 'item_disassembly_date', label: 'Date' },
  { name: 'stock_movement', label: 'Recovery Components', isArray: true, arrayType: 'object',
    arrayFields: [{ name: 'item_selection', label: 'Item Code' }] }
];

const data = {};
requiredFields.forEach(function (f) { data[f.name] = entry[f.name]; });

return {
  required_fields: JSON.stringify(requiredFields),
  data: JSON.stringify(data)
};