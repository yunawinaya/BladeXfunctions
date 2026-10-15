// The saved PO's id: the row Add Data inserted (Add / Clone) or the PO this Edit updated. Its header is read back once,
// after approval, by Get PO Header; only the approval path reads the whole record (Get PO Snapshot).
const pageStatus = {{workflowparams:allData.page_status}};
const added = {{node:add_po.data.id}};
const addedId = Array.isArray(added) ? added[0] : added;
const id = String((pageStatus == "Add" || pageStatus == "Clone" ? addedId : {{workflowparams:allData.id}}) || "").trim();

return { poData: { id: id }, poIdSql: /^[0-9]{1,19}$/.test(id) ? id : "0" };
