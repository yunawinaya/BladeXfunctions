// IA_V2_SUBMIT - MIN-02 (BA 10-22): a background completion of a stored IA (DIRECT from its stored Draft / Created) takes the same
// completion claim as the normal save (IAS|<ia> / CLAIM|<n>) before its first write (the batch number, its lock, its job) and frees it
// once the IA is Processing: that status then refuses every other completion. A new IA (Add, Clone): no claim. Switch off: no claim
const IA_CLAIM_ENABLED = true;
const entry = [{{node:code_node_ISentry.data}}][0] || {};
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const stored = s(entry.storedStatus);
const claim = IA_CLAIM_ENABLED === true && s(entry.action) === "DIRECT" && (stored === "Draft" || stored === "Created") && digits(entry.iaId) &&
  digits(entry.tenantId) && digits(entry.organizationId);
console.log("ia claim in", JSON.stringify({ claim: claim, ia: s(entry.iaId) }));
return { claim: claim ? "YES" : "NO", ia: claim ? s(entry.iaId) : "0", tenantId: claim ? s(entry.tenantId) : "0", org: claim ? s(entry.organizationId) : "0" };
