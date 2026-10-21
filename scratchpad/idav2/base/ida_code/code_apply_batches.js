const entry = {{node:code_fillback.data.allData}};
const genCount = {{node:code_batch_plan.data.genCount}};
// Lives inside if_needs_batch_gen, so it is null whenever generation was skipped.
const raw = {{node:get_batches_final.data}};

const generated = genCount > 0
  ? (Array.isArray(raw) ? raw : (raw ? JSON.parse(raw) : []))
  : [];

const genMap = {};
generated.forEach(function (g) { genMap[g.index] = g.batch_number; });

const lines = (entry.stock_movement || []).map(function (line, index) {
  const copy = Object.assign({}, line);
  if (genMap[index]) copy.batch_number = genMap[index];
  return copy;
});

return { stock_movement: lines };