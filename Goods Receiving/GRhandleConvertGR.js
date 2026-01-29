const mapLineItem = async (item, record) => {
  return {
    item_id: item.item_id || null,
    item_name: item.item_name,
    item_desc: item.item_desc,
    more_desc: item.more_desc,
    ordered_qty: item.quantity,
    ordered_qty_uom: item.quantity_uom || null,
    to_received_qty_uom: item.quantity_uom || null,
    // Auto-fill received_qty = ordered qty - received qty - created_received_qty
    // This matches GRaddBatchLineItem.js logic to account for Created GRs
    received_qty: parseFloat(
      (
        item.quantity -
        (item.received_qty || 0) -
        (item.created_received_qty || 0)
      ).toFixed(3)
    ),
    item_uom: item.quantity_uom || null,
    line_po_no: record.purchase_order_no,
    initial_received_qty: parseFloat((item.received_qty || 0).toFixed(3)),
    line_po_id: record.id,
    unit_price: item.unit_price,
    total_price: item.po_amount,
    line_remark_1: item.line_remark_1,
    line_remark_2: item.line_remark_2,
    po_line_item_id: item.id,
    item_category_id: item?.item_category_id || null,
  };
};

const fetchDBData = async (selectedRecords) => {
  try {
    let data = [];

    for (const record of selectedRecords) {
      console.log("record", record);
      const response = await db
        .collection("purchase_order")
        .where({ id: record.id })
        .get();

      console.log("response", response);
      if (response?.data.length > 0) {
        data.push(response.data[0]);
      }
    }

    return data;
  } catch (error) {
    console.error("Error in fetchDBData:", error);
  }
};

const mapHeaderData = async (
  record,
  poNo,
  grPrefix,
  poID,
  lineItemPromises,
  plantID
) => {
  return {
    gr_status: "Draft",
    plant_id: plantID,
    purchase_order_number: poNo,
    po_id: poID,
    gr_no: grPrefix,
    gr_date: new Date().toISOString().split("T")[0],
    organization_id: record.organization_id,
    supplier_name: record.po_supplier_id,
    currency_code: record.po_currency,
    gr_received_by: this.getVarGlobal("nickname"),
    table_gr: lineItemPromises,
    from_convert: "Yes",
  };
};

const handleMultipleGR = async (selectedRecords, plantID) => {
  const data = await fetchDBData(selectedRecords);

  console.log("Fetched Data:", data);

  let grDataPromises = [];

  for (const record of data) {
    let lineItemPromises = [];
    const lineItem = record.table_po || [];

    for (const item of lineItem) {
      // Filter out line items that are fully received
      // Match GRaddBatchLineItem.js logic: only include lines where initial_received_qty < ordered_qty
      if ((item.received_qty || 0) >= (item.quantity || 0)) {
        console.log(
          `Skipping fully received line item: ${item.item_name} (${item.received_qty}/${item.quantity})`
        );
        continue; // Skip this line item
      }

      const lineItemPromise = await mapLineItem(item, record);
      lineItemPromises.push(lineItemPromise);
    }

    // Skip PO if no line items to receive
    if (lineItemPromises.length === 0) {
      console.log(
        `Skipping PO ${record.purchase_order_no} - all line items fully received`
      );
      continue;
    }

    const grPrefix = await generateGRPrefix(record.organization_id);
    const grData = await mapHeaderData(
      record,
      record.purchase_order_no,
      grPrefix,
      [record.id],
      lineItemPromises,
      plantID
    );

    console.log("Mapped GR Data:", grData);
    grDataPromises.push(grData);
  }

  console.log("Mapped GR Data Promises:", grDataPromises);

  // Validate that there are GRs to create
  if (grDataPromises.length === 0) {
    await this.$alert(
      "All line items in the selected PO(s) are fully received. No items to convert to GR.",
      "No Items to Receive",
      {
        confirmButtonText: "OK",
        type: "warning",
      }
    );
    return;
  }

  const resGR = await Promise.all(
    grDataPromises.map((grData) => db.collection("goods_receiving").add(grData))
  );

  const grData = resGR.map((response) => response.data[0]);
  console.log("Created GR Data:", grData);

  await this.refresh();
  await this.$alert(
    `Successfully created ${grData.length} draft goods receipts.<br><br>
      <strong>Goods Receiving Numbers:</strong><br> ${grData
        .map((item) => item.gr_no)
        .join("<br>")}`,
    "Success Converted to Goods Receipts",
    {
      confirmButtonText: "OK",
      dangerouslyUseHTMLString: true,
      type: "success",
    }
  );
};

const handleSingleGR = async (selectedRecords, plantID) => {
  try {
    const data = await fetchDBData(selectedRecords);

    console.log("Fetched Data:", data);

    const uniqueSuppliers = new Set(
      data.map((record) => record.po_supplier_id)
    );

    const allSameSupplier = uniqueSuppliers.size === 1;

    if (!allSameSupplier) {
      await this.$confirm(
        `Selected POs contain multiple suppliers. Create individual goods receipts - one GR per PO?`,
        "Multiple Suppliers Detected",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          dangerouslyUseHTMLString: true,
          type: "info",
        }
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      await handleMultipleGR(selectedRecords, plantID);
      return;
    }

    let lineItemPromises = [];

    for (const record of data) {
      const lineItem = record.table_po || [];
      for (const item of lineItem) {
        // Filter out line items that are fully received
        // Match GRaddBatchLineItem.js logic: only include lines where initial_received_qty < ordered_qty
        if ((item.received_qty || 0) >= (item.quantity || 0)) {
          console.log(
            `Skipping fully received line item: ${item.item_name} (${item.received_qty}/${item.quantity})`
          );
          continue; // Skip this line item
        }

        const lineItemPromise = await mapLineItem(item, record);
        lineItemPromises.push(lineItemPromise);
      }
    }

    // Validate that there are line items to receive
    if (lineItemPromises.length === 0) {
      await this.$alert(
        "All line items in the selected PO(s) are fully received. No items to convert to GR.",
        "No Items to Receive",
        {
          confirmButtonText: "OK",
          type: "warning",
        }
      );
      return;
    }

    const record = data[0];
    const poNo = data.map((item) => item.purchase_order_no).join(", ");
    const poID = data.map((item) => item.id);
    const grPrefix = "";
    const mappedData = await mapHeaderData(
      record,
      poNo,
      grPrefix,
      poID,
      lineItemPromises,
      plantID
    );

    console.log("Mapped GR Data:", mappedData);

    await this.toView({
      target: "1901845517592285186",
      type: "add",
      data: {
        ...mappedData,
      },
      position: "rtl",
      mode: "dialog",
      width: "80%",
      title: "Add",
    });
  } catch (error) {
    console.error("Error in handleSingleGR:", error);
  }
};

const generateGRPrefix = async (organizationID) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Goods Receiving",
      is_deleted: 0,
      organization_id: organizationID,
    })
    .get();

  if (!prefixEntry.data || prefixEntry.data.length === 0) {
    throw new Error("No prefix configuration found");
  }

  const currDraftNum = parseInt(prefixEntry.data[0].draft_number) + 1;
  const grPrefix = `DRAFT-${prefixEntry.data[0].prefix_value}-` + currDraftNum;

  await db
    .collection("prefix_configuration")
    .where({
      document_types: "Goods Receiving",
      is_deleted: 0,
      organization_id: organizationID,
    })
    .update({ draft_number: currDraftNum });

  return grPrefix;
};

(async () => {
  try {
    const selectedRecords = arguments[0].selectedRecords;
    const plantID = arguments[0].plantID;

    console.log("handleConvertGR selectedRecords:", selectedRecords);

    if (selectedRecords.length > 1) {
      await this.$confirm(
        `Would you like to convert these into a single goods receipt or into multiple goods receipts?<br><br>
          <strong>Single GR:</strong> All items combined into one document<br>
          <strong>Multiple GRs:</strong> Separate receipts for better tracking`,
        "Purchase Order Conversion",
        {
          confirmButtonText: "Single GR",
          cancelButtonText: "Multiple GRs",
          dangerouslyUseHTMLString: true,
          type: "info",
          distinguishCancelAndClose: true,

          beforeClose: async (action, instance, done) => {
            if (action === "confirm") {
              this.showLoading("Converting to Goods Receiving...");
              await handleSingleGR(selectedRecords, plantID);
              this.hideLoading();
              done();
            } else if (action === "cancel") {
              this.showLoading("Converting to Goods Receiving...");
              await handleMultipleGR(selectedRecords, plantID);
              this.hideLoading();
              done();
            } else {
              done();
            }
          },
        }
      );
    } else {
      this.showLoading("Converting to Goods Receiving...");
      await handleSingleGR(selectedRecords, plantID);
      this.hideLoading();
    }
  } catch (error) {
    console.error("Error in handleSingleGR:", error);
  }
})();
