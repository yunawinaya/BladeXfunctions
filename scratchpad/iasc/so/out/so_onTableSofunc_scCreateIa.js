// onTableSofunc_scCreateIa - Sales Order form, table_so row action "Create IA" (Small Cycle, scratchpad/iasc): opens the SO Linked
// IAs page for this line (and creates an Item Assembly for it). The Item Assembly form is opened from that page, so saving an IA refreshes the page, never
// this Sales Order.
const SC_PAGE = "2112449353901772801"; // SO_LINKED_IAS_PAGE
const SC_ACTION = "create";
const scRow = (arguments[0] && arguments[0].row) || {};
const scText = (v) => (v === undefined || v === null ? "" : String(v)).trim();
if (!/^[1-9][0-9]{0,19}$/.test(SC_PAGE)) {
  this.$message.warning("The Item Assemblies page is not set up yet.");
} else if (!/^[0-9]{1,20}$/.test(scText(scRow.id)) || !scText(scRow.item_name)) {
  this.$message.warning("Save the Sales Order first: this line has no Item Assemblies yet.");
} else {
  this.toView({
    target: SC_PAGE,
    targetType: "Page",
    mode: "dialog",
    type: "add",
    width: "80%",
    title: "Item Assemblies - " + scText(this.getValue("so_no")) + " line " + scText(scRow.line_index),
    params: {
      so_id: scText(this.getValue("id")),
      so_line_id: scText(scRow.id),
      item_id: scText(scRow.item_name),
      organization_id: scText(this.getValue("organization_id")),
      sc_action: SC_ACTION,
    },
  });
}
