// Existing draft GR / PI of this PO (Get Draft GR / PI: numbers only)
const rows = [{{node:sql_draft_grpi.data}}][0];
const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
let message = [];
let status = 'Passed';

const draftGRNo = list.filter((r) => r.kind === 'GR').map((r) => r.doc_no).filter(Boolean).join(', ');
if(draftGRNo) message.push(draftGRNo);

const draftPINo = list.filter((r) => r.kind === 'PI').map((r) => r.doc_no).filter(Boolean).join(', ');
if(draftPINo) message.push(draftPINo);

if(message.length > 0) {
  status = 'Failed'
}

return {
  status: status,
  message: status === 'Passed' ? '' : 'The purchase order has existing GR/PI records in draft status. Proceeding will delete these record: ' + message.join(', ')
}
