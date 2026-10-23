// GD_ASYNC_SUBMIT - Credit check asked? Only the GD form asks (needCL "required", 10-23), and only for a new save
const asked = String([{{workflowparams:needCL}}][0] || "").trim() === "required";
const route = String([{{node:code_node_iJTFTwP3.data.route}}][0] || "").trim();
return { ask: asked && route === "CREATE" ? "YES" : "NO" };
