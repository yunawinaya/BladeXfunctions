const line = {{node:loop_gen_batch}};

return {
  index: line.index,
  item_id: line.item_id,
  document_date: line.document_date || null,
  manufacturing_date: line.manufacturing_date || null,
  expired_date: line.expired_date || null
};