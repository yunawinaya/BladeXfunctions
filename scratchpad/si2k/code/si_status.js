// SI_SAVE v84 "Final Status": what v83's Fillback wrote for si_status / posted_status / sales_invoice_no / payment_status, with the
// credit-limit downgrade of a convert applied (v83's Change Status to Draft, which ran before the fill-back).
const siStatus = function siStatus(prep, downgraded) {
  const st = {
    si_status: prep.siStatus,
    posted_status: prep.postedStatus,
    sales_invoice_no: prep.docNo,
    payment_status: prep.paymentStatus,
  };
  if (String(downgraded) === "1") {
    st.si_status = "Draft";
    st.posted_status = "";
    if (st.sales_invoice_no === "issued") st.sales_invoice_no = "draft";
    st.payment_status = "";
  }
  st.isCompleted = st.si_status === "Completed" ? "1" : "0";
  return st;
};
