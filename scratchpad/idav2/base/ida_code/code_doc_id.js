const entry = {{node:code_fillback.data.allData}};
const persisted = {{node:code_persisted.data.docId}};
// Each add-node lives in a mutually exclusive branch, so at most one of these
// resolves; the others come back null.
const addedDraft = {{node:add_draft.data}};

const firstId = function (raw) {
  if (!raw) return '';
  const row = raw.length > 0 ? raw[0] : raw;
  return row && row.id ? String(row.id) : '';
};

return { id: String(persisted || '') || firstId(addedDraft) || String(entry.id || '') };