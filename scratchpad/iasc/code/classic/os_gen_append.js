const cachedRaw = {{node:get_OSbatches.data}};
const arr = Array.isArray(cachedRaw) ? cachedRaw : (cachedRaw ? JSON.parse(cachedRaw) : []);

arr.push({
  index: {{node:code_OSgenPick.data.index}},
  batch_number: {{node:code_OSgenNorm.data.batchNumber}}
});

return { generated: arr };
