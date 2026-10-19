const raw = {{node:get_cache_GdFailC.data}};
let fails = [];
if (raw) { fails = typeof raw === "string" ? JSON.parse(raw) : raw; }
if (!Array.isArray(fails)) fails = [];

fails.push({
  doc_no: {{node:code_node_9rK80jNQ.data.docNo}} || "",
  code: {{node:code_node_9rK80jNQ.data.failCode}} || "400",
  message: {{node:code_node_9rK80jNQ.data.failMessage}} || ""
});

return { fails: fails };
