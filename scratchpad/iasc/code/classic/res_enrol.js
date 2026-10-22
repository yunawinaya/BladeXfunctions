// IA_SAVE - RES-01 enrolment (scratchpad/iasc/res01/RES01_PLAN.md): holds on + saved as Created (code_fillback: the Created button, or a
// Draft save of an IA stored Created) -> RESERVING; a Draft is never enrolled (BA, 10-22). The desktop form then starts IA_HOLD: IA_SAVE
// never calls it (a crashed child would fail the save after the write; user 10-21)
const on = ([{{node:code_node_SCin.data}}][0] || {}).res === "YES";
const status = String([{{node:code_fillback.data.allData.item_assembly_status}}][0] || "");
const id = String([{{node:code_doc_id.data.id}}][0] || "");
const enrol = on && status === "Created" && /^[0-9]{1,20}$/.test(id);
console.log("res enrol", JSON.stringify({ on: on, status: status, id: id, enrol: enrol }));
return { enrol: enrol ? "YES" : "NO", id: enrol ? id : "", hold: enrol ? "RESERVING" : "" };
