// IA_SAVE - RES-01 Created numbering (user 10-22): a Created IA carries its real number, like a Created GD. A stored Draft saved as Created
// takes it here, right after its write: the Draft write (update_draft) keeps the stored number on purpose (a mobile edit sends none), so
// this write gives it the 'issued' sentinel and the platform issues the number. A reverted Draft's number belongs to its completed cycle:
// it is issued anew too. Manual Input keeps the typed number; a new IA got its number at the insert (code_fillback)
const a = [{{node:code_fillback.data.allData}}][0] || {};
const stored = String([{{node:code_node_IAguardStored.data.stored}}][0] || "");
const page = String([{{workflowparams:pageStatus}}][0] || "");
const id = String([{{node:code_doc_id.data.id}}][0] || "");
const issue = page === "Edit" && stored === "Draft" && String(a.item_assembly_status || "") === "Created" && a.stock_movement_no_type !== -9999 &&
  /^[0-9]{1,20}$/.test(id);
console.log("ia number", JSON.stringify({ issue: issue, stored: stored, id: id }));
return { issue: issue ? "YES" : "NO", id: issue ? id : "", no: issue ? "issued" : "" };
