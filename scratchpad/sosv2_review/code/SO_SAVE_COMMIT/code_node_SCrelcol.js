const raw = [{{node:get_cache_SCrel.data}}][0];
let results = [];
if (raw) results = typeof raw === "string" ? JSON.parse(raw) : raw;
if (!Array.isArray(results)) results = [];
const a = [{{node:wf_SCrelease.data}}][0] || {};
results.push({ gd_id: String([{{node:loop_SCrelease.gd_id}}][0] || ""), route: String(a.route || ""), job_id: String(a.job_id || ""), code: String(a.code || ""), message: String(a.message || "") });
console.log("so commit release", JSON.stringify(results[results.length - 1]));
return { results: results };