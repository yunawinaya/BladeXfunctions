// SA_V2_PREPARE - SQL rows (prepare/sql.py) -> the shapes the classic STOCK_ADJUSTMENT v24 loop bodies read (CONTRACT.md section 9):
//   saAdaptHeader  get_node_Rs3nGg9f's record: ONE object, bigint ids digit strings, the STORED adjustment_no (issued by SUBMIT's
//                  write), adjustment_date 'YYYY-MM-DD HH:MM:SS' (a timestamp(0): the get-node prints no fraction), null / '' keys
//                  absent; the lock facts (sa_v2_job_id, lock_ref) are not part of it
//   saAdaptLines   stored lines as a record's subform rows: ids digit strings, unit_price a number, balance_index the TEXT, null / ''
//                  keys absent (the loop bodies read item.uom_id || "", item.item_remark || null: absent and '' behave alike)
const saDrop = (o) => {
  const r = {};
  for (const k of Object.keys(o || {})) {
    const v = o[k];
    if (v === null || v === undefined || v === "") continue;
    r[k] = v;
  }
  return r;
};
const saAdaptHeader = function saAdaptHeader(row) {
  const h = saDrop(row);
  delete h.sa_v2_job_id;
  delete h.lock_ref;
  return h;
};
const saAdaptLines = (rows) => saRows(rows).map((r) => {
  const o = saDrop(r);
  if (o.unit_price !== undefined && typeof o.unit_price !== "number") o.unit_price = Number(o.unit_price);
  return o;
});
// a header date as the classic's read-back shows it after its update wrote the form's value: 'YYYY-MM-DD HH:MM:SS' (a date alone
// at midnight); anything else (an ISO time with a zone) is returned as it came
const saDbDate = function saDbDate(v) {
  const t = saS(v);
  const m = t.match(/^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}:\d{2})(?:\.\d+)?)?$/);
  return m ? m[1] + " " + (m[2] || "00:00:00") : t;
};
