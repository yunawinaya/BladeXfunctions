const raw = {{node:get_cache_GdFailA.data}};
let fails = [];
if (raw) { fails = typeof raw === "string" ? JSON.parse(raw) : raw; }
if (!Array.isArray(fails)) fails = [];

// Never test for "400": a sub-workflow can return with no code at all, so the
// caller's success is tested positively. Mirrors SOcascadeDownstreamWorkflow.
fails.push({
  doc_no: {{node:code_node_9rK80jNQ.data.docNo}} || "",
  code: String({{node:workflow_node_Cd96wivg.data.code}} || ""),
  message: {{node:workflow_node_Cd96wivg.data.message}} || ""
});

return { fails: fails };
