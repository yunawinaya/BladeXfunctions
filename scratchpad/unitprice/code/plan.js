// GET_ITEM_UNIT_PRICE_BULK - Plan: the rule sequence ("Define number iterations": the organization's Price History Config
// for the document type, else the document type's default), which history sources and whether the price tag it needs,
// and the party's price tag id (digits only, else "0": matches nothing, as the classic's null did).
const pricePlan = function pricePlan(documentType, keys, cfgRows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  const big = (v) => /^[0-9]{1,19}$/.test(v) && (v.length < 19 || v <= "9223372036854775807");
  const rows = (Array.isArray(cfgRows) ? cfgRows : cfgRows && typeof cfgRows === "object" ? [cfgRows] : []).filter((r) => r);
  const cfg = rows.filter((r) => r.kind === "cfg");
  const tag = rows.filter((r) => r.kind === "tag");
  const DEFAULTS = {
    SQT: ["Last Quotation Price", "Last Sales Order Price", "Last Sales Invoice Price", "Customer Price Tag", "Default Sales Unit Price", "Multi Pricing"],
    SO: ["Last Sales Order Price", "Last Sales Invoice Price", "Last Quotation Price", "Customer Price Tag", "Default Sales Unit Price", "Multi Pricing"],
    PREQ: ["Last Purchase Requisition Price", "Last Purchase Order Price", "Last Purchase Invoice Price", "Supplier Price Tag", "Default Purchase Unit Price"],
    PO: ["Last Purchase Order Price", "Last Purchase Invoice Price", "Last Purchase Requisition Price", "Supplier Price Tag", "Default Purchase Unit Price"],
  };
  const SOURCE = { "Last Quotation Price": "SQT", "Last Sales Order Price": "SO", "Last Sales Invoice Price": "SI",
    "Last Purchase Requisition Price": "PREQ", "Last Purchase Order Price": "PO", "Last Purchase Invoice Price": "PI" };
  let sequence = [];
  if (cfg.length === 0) {
    sequence = (DEFAULTS[documentType] || []).map((rules, i) => ({ rules: rules, line_index: i + 1 }));
  } else {
    // one config per organization + document type (the classic's get-node record); the oldest if ever more than one
    try {
      const parsed = JSON.parse(s(cfg[0].val));
      sequence = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      sequence = [];
    }
  }
  const rulesOf = sequence.map((st) => (st && typeof st === "object" ? st.rules : undefined));
  const use = (src) => (keys.pairCount > 0 && rulesOf.some((r) => SOURCE[r] === src) ? "YES" : "NO");
  const tagRule = rulesOf.some((r) => r === "Customer Price Tag" || r === "Supplier Price Tag");
  const tagId = tag.length ? s(tag[0].val).trim() : "";
  return {
    sequence: sequence,
    useSQT: use("SQT"), useSO: use("SO"), useSI: use("SI"), usePREQ: use("PREQ"), usePO: use("PO"), usePI: use("PI"),
    needTag: tagRule && keys.needFetch === "Yes" && keys.pairCount > 0 ? "YES" : "NO",
    tagIdSql: big(tagId) ? tagId : "0",
    configCount: cfg.length,
  };
};
const res = pricePlan([{{workflowparams:document_type}}][0], [{{node:code_node_UPkeys.data}}][0], [{{node:sql_node_UPcfg.data}}][0]);
console.log("price plan", JSON.stringify({ rules: res.sequence.map((st) => st && st.rules), tag: res.needTag, configs: res.configCount }));
return res;
