const raw = {{node:wf_OSgenerate.data}};
const batchNumber = raw && raw.batch_number ? String(raw.batch_number) : '';
const label = {{node:code_OSgenPick.data.label}};

return {
  batchNumber: batchNumber,
  isError: batchNumber === '' ? 1 : 0,
  message: batchNumber === ''
    ? 'Could not generate a batch number for ' + label + ' of the output split. Check the Batch Number Configuration for this item.'
    : ''
};
