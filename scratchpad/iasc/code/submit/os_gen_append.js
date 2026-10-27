const cachedRaw = {{node:get_ISosBatches.data}};
const arr = Array.isArray(cachedRaw) ? cachedRaw : (cachedRaw ? JSON.parse(cachedRaw) : []);

arr.push({
  index: {{node:code_ISosGenPick.data.index}},
  batch_number: {{node:code_ISosGenNorm.data.batchNumber}}
});

return { generated: arr };
