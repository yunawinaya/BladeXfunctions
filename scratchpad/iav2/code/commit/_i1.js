// I1 helpers (entry_end, i1_decide, i1_check): the planned Batch row's identity (= the I1|I|001 intent) and "ours" = the live
// rows of that identity inserted after the job existed (id > jobId); numbers compare as utf8mb4_general_ci does (grv2 batchKey)
const batchKey = (n) => s(n).toLowerCase().replace(/ +$/, "");
const idAfter = (id, jobId) => digits(id) && (s(id).length > s(jobId).length || (s(id).length === s(jobId).length && s(id) > s(jobId)));
const identityOf = (row) => ({ batch_number: s(row.batch_number), material_id: s(row.material_id), plant_id: s(row.plant_id), organization_id: s(row.organization_id),
  transaction_no: s(row.transaction_no) });
const sameIdentity = (o, idt) => !!o && !!idt && batchKey(o.batch_number) === batchKey(idt.batch_number) && s(o.material_id) === s(idt.material_id)
  && s(o.plant_id) === s(idt.plant_id) && s(o.organization_id) === s(idt.organization_id) && s(o.transaction_no) === s(idt.transaction_no);
const oursOf = (rows, idt, jobId) => iaRows(rows).filter((o) => sameIdentity(o, idt) && idAfter(o.id, jobId)).map((o) => s(o.id)).filter((x, i, a) => a.indexOf(x) === i);
// IA output split (plan 10-27): a BATCH part of one row ({row}) or one per output split group ({rows}); its I1|I|001 intent is then the
// list of their identities, and I1's DONE row maps each number (batchKey) to its Batch row id (batch_ids)
const batchRowsOf = (part) => (part && typeof part === "object" ? (Array.isArray(part.rows) ? part.rows : part.row && typeof part.row === "object" ? [part.row] : []) : []);
const intentsOf = (intent) => (Array.isArray(intent) ? intent : intent && typeof intent === "object" ? [intent] : []);
