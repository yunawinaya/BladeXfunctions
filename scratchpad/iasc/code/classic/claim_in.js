// IA_SAVE - MIN-02 (BA 10-22): one server-owned completion per Item Assembly. A completion (this block runs for !Draft) of a stored IA
// (an Edit: a Clone carries its source's id) takes the IA's completion claim before its first write (the batch number, the header, the
// stock): IAS|<ia> / CLAIM|<n> in gd_publish_step, whose unique (tenant, job_id, step_name) key fails a twin's insert. Switch off: no claim
const IA_CLAIM_ENABLED = true;
const guard = [{{node:code_node_IAguardIn.data}}][0] || {};
const all = [{{node:code_fillback.data.allData}}][0] || {};
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const org = s(all.organization_id);
const claim = IA_CLAIM_ENABLED === true && s(guard.check) === "YES" && digits(guard.iaId) && digits(guard.tenantId) && digits(org);
console.log("ia claim in", JSON.stringify({ claim: claim, ia: s(guard.iaId) }));
return { claim: claim ? "YES" : "NO", ia: claim ? s(guard.iaId) : "0", tenantId: claim ? s(guard.tenantId) : "0", org: claim ? org : "0" };
