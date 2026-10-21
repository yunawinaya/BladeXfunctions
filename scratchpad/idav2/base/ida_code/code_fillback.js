// 8dp is the maximum configurable column precision: rounding COMPUTED values there keeps
// every client-configured scale intact while killing float residue.
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
let allData = {{workflowparams:allData}};
const saveAs = {{workflowparams:saveAs}};
const pageStatus = {{workflowparams:pageStatus}};

// stock_movement is the persisted recovery table. Only its columns survive: the
// form also carries UI-only keys, and the client-side cleanup is not a boundary.
const LINE_FIELDS = [
  'id', 'item_selection', 'item_name', 'item_desc', 'requested_qty', 'bom_ratio',
  'total_quantity', 'quantity_uom', 'storage_location_id', 'location_id',
  'batch_number', 'manufacturing_date', 'expired_date', 'item_remark',
  'item_remark_2', 'item_remark_3', 'project_id', 'uom_options'
];

const lines = (allData.stock_movement || []).map(function (src, index) {
  const line = {};
  LINE_FIELDS.forEach(function (k) {
    if (src[k] !== undefined) line[k] = src[k];
  });
  line.requested_qty = q8(src.requested_qty);
  line.total_quantity = q8(src.total_quantity);
  // A null ratio marks a manually added row; rounding it would turn it into 0
  // and make the form rescale that row on the next quantity change.
  const ratio = src.bom_ratio;
  line.bom_ratio = ratio === null || ratio === undefined || ratio === '' ? null : q8(ratio);
  line.organization_id = allData.organization_id;
  line.issuing_plant = allData.issuing_operation_faci || null;
  line.line_index = index + 1;
  return line;
});
allData.stock_movement = lines;

// item_qty is decimal on the header -- the source quantity being disassembled.
allData.item_qty = q8(allData.item_qty);

const storedStatus = pageStatus === 'Add' ? 'Draft' : (allData.item_disassembly_status || 'Draft');
allData.item_disassembly_status = saveAs;

// The platform replaces these sentinels with a real number on insert. -9999 is
// Manual Input, where the user's typed number stands.
if (saveAs === 'Draft') {
  if (allData.stock_movement_no_type !== -9999 &&
      (!allData.stock_movement_no || allData.stock_movement_no === '')) {
    allData.stock_movement_no = 'draft';
  }
} else {
  if (allData.stock_movement_no_type !== -9999 &&
      (!allData.stock_movement_no || allData.stock_movement_no === '' ||
       storedStatus !== 'Completed')) {
    allData.stock_movement_no = 'issued';
  }
  // Posting to accounting is a separate step (Post button), never part of Complete.
  allData.posted_status = 'Unposted';
}

return { allData: allData, storedStatus: storedStatus };