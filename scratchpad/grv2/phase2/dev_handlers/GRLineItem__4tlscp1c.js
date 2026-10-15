(async () => {
  let purchaseOrderIDs = this.getValue("purchase_order_id");
  console.log(purchaseOrderIDs);

  if (!purchaseOrderIDs || purchaseOrderIDs.length === 0) {
    this.setData({
      table_gr: [],
      purchase_order_number: "",
      po_id: [],
    });
    return;
  }

  const plantId = this.getValue("plant_id");
  purchaseOrderIDs = Array.isArray(purchaseOrderIDs)
    ? purchaseOrderIDs
    : [purchaseOrderIDs];

  this.setData({
    purchase_order_number: "",
    table_gr: [],
    po_id: [],
  });

  let tableGR = [];
  let purchaseOrderNumber = [];
  let poId = [];

  // get bin location
  const resBinLocation = await db
    .collection("bin_location")
    .field("id")
    .where({ plant_id: plantId, is_deleted: 0, is_default: 1 })
    .get();

  // get putaway setup
  const resPutAwaySetup = await db
    .collection("putaway_setup")
    .where({
      plant_id: plantId,
      is_deleted: 0,
      movement_type: "Good Receiving",
    })
    .get();

  const putawaySetup = resPutAwaySetup?.data[0] || null;

  const defaultBinLocation = resBinLocation?.data[0]?.id || "";

  if (purchaseOrderIDs.length > 0) {
    for (const [index, purchaseOrderId] of purchaseOrderIDs.entries()) {
      // get PO header data
      const resPOHeader = await db
        .collection("purchase_order")
        .field("purchase_order_no,table_po")
        .where({ id: purchaseOrderId })
        .get();

      if (!resPOHeader || resPOHeader.data.length === 0) return;
      const poHeaderData = resPOHeader.data[0];

      for (const poLineItemData of poHeaderData.table_po) {
        // get Item data
        const resItem = await db
          .collection("Item")
          .field(
            "receiving_inspection,item_batch_management,batch_number_genaration,material_costing_method"
          )
          .where({ id: poLineItemData.item_id })
          .get();

        if (!resItem || resItem.data.length === 0) return;
        const itemData = resItem.data[0];

        // map GR data
        const newTableGrRecord = {
          item_id: poLineItemData.item_id,
          item_name: poLineItemData.item_name,
          item_desc: poLineItemData.item_desc,
          more_desc: poLineItemData.more_desc,
          ordered_qty: poLineItemData.quantity,
          inspection_required:
            itemData.receiving_inspection === 1 ? "Yes" : "No",
          to_received_qty: 0.0,
          received_qty: parseFloat(
            (
              poLineItemData.quantity - (poLineItemData.received_qty || 0)
            )
          ),
          item_uom: poLineItemData.quantity_uom,
          location_id: defaultBinLocation,
          item_batch_no:
            itemData?.item_batch_management === 0
              ? "-"
              : itemData?.batch_number_genaration ===
                "According To System Settings"
              ? "Auto-generated batch number"
              : "",
          inv_category: "",
          line_po_no: poHeaderData.purchase_order_no,
          initial_received_qty: parseFloat(
            (poLineItemData.received_qty || 0)
          ),
          line_po_id: poHeaderData.id,
          unit_price: poLineItemData.unit_price,
          total_price: poLineItemData.po_amount,
          item_costing_method: itemData.material_costing_method,
          line_remark_1: poLineItemData.line_remark_1,
          line_remark_2: poLineItemData.line_remark_2,
          po_line_item_id: poLineItemData.id,
        };

        tableGR.push(newTableGrRecord);
      }

      purchaseOrderNumber.push(poHeaderData.purchase_order_no);
      poId.push(poHeaderData.id);
    }

    poId = [...new Set(poId)];

    await this.setData({
      table_gr: tableGR,
      purchase_order_number: purchaseOrderNumber.join(", "),
      po_id: poId,
    });

    const resCategory = await db
      .collection("blade_dict")
      .where({ code: "inventory_category" })
      .get();

    setTimeout(async () => {
      const table_gr = this.getValue("table_gr");
      for (const [index, gr] of table_gr.entries()) {
        // check item batch field
        const path = `table_gr.${index}.item_batch_no`;
        this.disabled(path, gr.item_batch_no !== "");

        // set inventory category option and default value
        if (gr.inspection_required === "No") {
          if (!putawaySetup || putawaySetup.putaway_required === 0) {
            const invCategoryOption = resCategory.data.filter(
              (cat) =>
                cat.dict_key === "Unrestricted" || cat.dict_key === "Blocked"
            );
            this.setOptionData(
              `table_gr.${index}.inv_category`,
              invCategoryOption
            );

            this.setData({
              [`table_gr.${index}.inv_category`]: "Unrestricted",
            });
          } else if (putawaySetup && putawaySetup.putaway_required === 1) {
            const invCategoryOption = resCategory.data.filter(
              (cat) => cat.dict_key === "In Transit"
            );
            this.setOptionData(
              `table_gr.${index}.inv_category`,
              invCategoryOption
            );

            this.setData({
              [`table_gr.${index}.inv_category`]: "In Transit",
            });

            this.display('assigned_to');
          }
        } else if (gr.inspection_required === "Yes") {
          if (!putawaySetup || putawaySetup.putaway_required === 0) {
            const invCategoryOption = resCategory.data.filter(
              (cat) =>
                cat.dict_key === "Unrestricted" ||
                cat.dict_key === "Blocked" ||
                cat.dict_key === "Quality Inspection"
            );
            this.setOptionData(
              `table_gr.${index}.inv_category`,
              invCategoryOption
            );
          } else if (putawaySetup && putawaySetup.putaway_required === 1) {
            const invCategoryOption = resCategory.data.filter(
              (cat) =>
                cat.dict_key === "In Transit" ||
                cat.dict_key === "Quality Inspection"
            );
            this.setOptionData(
              `table_gr.${index}.inv_category`,
              invCategoryOption
            );
            this.display('assigned_to');
          }

          this.setData({
            [`table_gr.${index}.inv_category`]: "Quality Inspection",
          });
        }
      }
    }, 100);
  }
})();
