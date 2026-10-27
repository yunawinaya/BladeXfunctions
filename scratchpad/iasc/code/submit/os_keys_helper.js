// IA output split (plan 10-27, phase 2): the payload's split rows (an array, or its JSON text read with big ids kept; [] when absent or
// unreadable)
const iaOsPayloadRows = function iaOsPayloadRows(a) {
  const v = a ? a.output_split : null;
  const rows = typeof v === "string" ? iaParseJ(v) : v;
  return Array.isArray(rows) ? rows.filter(obj) : [];
};
