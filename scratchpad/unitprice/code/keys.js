// GET_ITEM_UNIT_PRICE_BULK - Keys: GET_ITEM_UNIT_PRICE's "Process input" (document_type, plantIdSafe, suppCustIdSafe) plus
// the keys of the set-based reads. Only digits, or the classic's blank, ever reach the SQL text below:
// a present-but-malformed id becomes "0" and matches nothing.
const priceKeys = function priceKeys(documentType, suppCustId, plantId, itemData, tenantId, orgId, orgParam) {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  const big = (v) => /^[0-9]{1,19}$/.test(v) && (v.length < 19 || v <= "9223372036854775807");
  const guardId = (v) => {
    const raw = s(v).trim();
    return raw === "" ? "" : big(raw) ? raw : "0";
  };
  const docType = documentType === "SO" || documentType === "SQT" ? "sd" : documentType === "PO" || documentType === "PREQ" ? "procurement" : "";
  const lines = Array.isArray(itemData) ? itemData : [];
  const pairs = [];
  const seen = {};
  for (const it of lines) {
    const row = it && typeof it === "object" ? it : {};
    // the reads match the line's own strings, as the classic's per-line SQL did
    const item = s(row.item_id);
    const uom = s(row.uom_id);
    if (big(item) && big(uom) && !seen["p" + item + "|" + uom]) {
      seen["p" + item + "|" + uom] = true;
      pairs.push([item, uom]);
    }
  }
  const tenant = s(tenantId).trim();
  // the session's organization; a nested call (workflow-node) has none and passes organization_id
  const org = big(s(orgId).trim()) ? s(orgId).trim() : s(orgParam).trim();
  return {
    document_type: docType,
    plantIdSafe: guardId(plantId),
    suppCustIdSafe: guardId(suppCustId),
    needFetch: suppCustId && suppCustId !== "" ? "Yes" : "No",
    fetchFrom: docType === "sd" ? "Customer" : "Supplier",
    side: docType === "sd" ? "sales" : "purchase",
    pairsJson: JSON.stringify(pairs),
    pairCount: pairs.length,
    tenantId: big(tenant) ? tenant : "0",
    organizationId: big(org) ? org : "0",
  };
};
const res = priceKeys([{{workflowparams:document_type}}][0], [{{workflowparams:supp_cust_id}}][0], [{{workflowparams:plant_id}}][0],
  [{{workflowparams:item_data}}][0], [{{system:tenantId}}][0], [{{global:firstLvDeptId}}][0], [{{workflowparams:organization_id}}][0]);
console.log("price keys", JSON.stringify({ doc: res.document_type, pairs: res.pairCount, fetch: res.needFetch }));
return res;
