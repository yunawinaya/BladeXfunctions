// Created on every PO this GR reserves on (as before); a PO the edit left is recomputed from its lines
//@@RULE@@
const newPo = String([{{node:code_node_GcQty.data.newPoCsv}}][0] || "0").split(",").filter((v) => v !== "0" && v !== "");
const rows = [{{node:sql_node_GcPoStatus.data}}][0] || [];
const headers = newPo.map((id) => ({ id, gr_status: "Created" }));
for (const r of Array.isArray(rows) ? rows : [rows]) {
  const id = String(r.po_id || "");
  if (!id || newPo.includes(id)) continue;
  headers.push({ id, gr_status: poGrStatus(r) });
}
// answer id: the add-node's id (a digit string), else the key read-back; never a number that may have lost digits
const editId = String([{{node:code_node_GcPrep.data.grId}}][0] || "0");
const keyedId = String([{{node:code_node_GcKeyDup.data.myId}}][0] || "");
const added = [{{node:add_gr.data.id}}][0];
const addedId = Array.isArray(added) ? added[0] : added;
const exact = typeof addedId === "string" && /^[0-9]{1,20}$/.test(addedId) ? addedId : "";
const grId = editId !== "0" ? editId : exact || keyedId;
return { headers, hasHeaders: headers.length > 0 ? "YES" : "NO", grId };
