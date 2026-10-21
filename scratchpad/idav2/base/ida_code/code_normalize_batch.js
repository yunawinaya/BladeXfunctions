const raw = {{node:wf_generate_batch.data}};
const batchNumber = raw && raw.batch_number ? String(raw.batch_number) : '';
const itemId = {{node:code_gen_pick.data.item_id}};

return {
  batchNumber: batchNumber,
  isError: batchNumber === '' ? 1 : 0,
  message: batchNumber === ''
    ? 'Could not generate a batch number for item ' + itemId + '. Check the Batch Number Configuration for this item.'
    : ''
};