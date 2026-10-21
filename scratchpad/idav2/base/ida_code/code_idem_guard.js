const raw = {{node:get_persisted_ida.data.data}};

// Read the stored status from the DB, never from allData: a stale tab or a
// double-click posts the pre-completion status and would move stock twice.
const rec = Array.isArray(raw) ? raw[0] : raw;
const status = rec ? rec.item_disassembly_status : '';
const blocked = status === 'Completed' || status === 'Fully Posted' ? 1 : 0;

return {
  blocked: blocked,
  blockedMessage: blocked === 1
    ? 'This Item Disassembly is already ' + status + ' and cannot be saved again.'
    : ''
};