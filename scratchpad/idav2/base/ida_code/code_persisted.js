const pageStatus = {{workflowparams:pageStatus}};
const updated = {{node:get_ida.data.data}};
const added = {{node:add_ida.data}};

// One of these two ran; the other resolves null. Guarded on pageStatus.
let rec = pageStatus === 'Edit' ? updated : added;
if (Array.isArray(rec)) rec = rec[0];
rec = rec || {};

// The serial engine replaced the 'issued' sentinel during the write, so this is
// the first point the REAL document number exists. Everything downstream stamps
// trx_no from here -- stamping it from the fillback copy would write the literal
// string 'issued' onto every inventory movement.
return {
  docId: rec.id ? String(rec.id) : '',
  stock_movement_no: rec.stock_movement_no || ''
};