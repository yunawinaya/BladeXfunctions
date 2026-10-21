const cachedRaw = {{node:get_batches.data}};
const arr = Array.isArray(cachedRaw) ? cachedRaw : (cachedRaw ? JSON.parse(cachedRaw) : []);

arr.push({
  index: {{node:code_gen_pick.data.index}},
  batch_number: {{node:code_normalize_batch.data.batchNumber}}
});

return { generatedBatches: arr };