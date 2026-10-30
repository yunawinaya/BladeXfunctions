// __HANDLER_NAME__ - Sales Order list, By Item tab, row action "__ACTION_TITLE__" (the user, 10-28; scratchpad/iasc/so_list): opens the
// SO Linked IAs page for this line (__WHAT__), as the Sales Order form's line action does. The list's row holds the Sales Order and the
// item as records (their ids inside) but not the organisation: the order is read once for it, and (as the list's View / Edit do) it is
// not opened while the order is saved in the background.
const SC_PAGE = "__SO_LINKED_IAS_PAGE__";
const SC_ACTION = "__ACTION__";
const scRow = (arguments[0] && arguments[0].row) || {};
const scText = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const scId = (v) => scText(v && typeof v === "object" ? v.id : v);
const scSo = scRow.sales_order_id && typeof scRow.sales_order_id === "object" ? scRow.sales_order_id : {};
const scDigits = (v) => /^[0-9]{1,20}$/.test(v);
const scSoId = scId(scRow.sales_order_id);
const scRefuse = () => this.$message.warning("This line's Item Assemblies can't be opened: refresh the list and try again.");
(async () => {
  if (!scDigits(scSoId) || !scDigits(scText(scRow.id)) || !scDigits(scId(scRow.item_name))) return scRefuse();
  let so = null;
  try {
    const res = await db.collection("sales_order").field("organization_id,is_processing").where({ id: scSoId, is_deleted: 0 }).get();
    so = ((res && res.data) || [])[0] || null;
  } catch (e) {
    console.error("SO list: the Sales Order could not be read", e);
  }
  const scOrg = so ? scId(so.organization_id) : "";
  if (so && Number(so.is_processing) === 1) {
    this.$message.warning("This sales order is being saved in the background. Please wait until it finishes, then open it again.");
  } else if (!scDigits(scOrg)) {
    scRefuse();
  } else {
    this.toView({
      target: SC_PAGE,
      targetType: "Page",
      mode: "dialog",
      type: "add",
      width: "80%",
      title: "Item Assemblies - " + (scText(scSo.so_no) || scSoId) + " line " + scText(scRow.line_index),
      params: { so_id: scSoId, so_line_id: scText(scRow.id), item_id: scId(scRow.item_name), organization_id: scOrg, sc_action: SC_ACTION },
    });
  }
})();
