const handleSinglePO = async (preqRecords) => {
  console.log("Handle Single PO");
  try {
    const preqData = await fetchPREQData(preqRecords);
    console.log("Fetched PREQ Data:", preqData);

    const preqIDs = preqData.map((preq) => preq.id);
    console.log("PREQ IDs to be linked:", preqIDs);

    const preqNos = preqData.map((preq) => preq.pr_no).join(", ");
    console.log("PREQ Numbers to be linked:", preqNos);

    const uniqueSuppliers = new Set(
      preqData.map((preq) => preq.pr_supplier_name),
    );
    const allSameSupplier = uniqueSuppliers.size === 1;

    const uniquePreqType = new Set(preqData.map((preq) => preq.preq_type));
    const allSamePreqType = uniquePreqType.size === 1;

    if (!allSameSupplier) {
      this.$alert(
        "All selected purchase requisitions must be from the same supplier to create a single purchase order.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
        },
      );
      return;
    }

    if (!allSamePreqType) {
      this.$alert(
        "All selected purchase requisitions must be from the same PREQ Type to create a single purchase order.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
        },
      );
      return;
    }

    let poLineItemPromises = [];
    let lineIndex = 0;
    for (const preq of preqData) {
      const lineItem = preq.table_pr || [];
      for (const item of lineItem) {
        if (preq.preq_type === "Contract") {
          if (item.order_qty === item.pr_line_qty) {
            continue;
          }
        }
        lineIndex++;
        const lineItemPromise = await mapLineItemToPOLine(
          item,
          preq,
          lineIndex,
        );

        poLineItemPromises.push(lineItemPromise);
      }
    }

    const data = preqData[0];
    const lineItemLength = poLineItemPromises.length;
    const poPrefix = "";
    const plantID = "";
    const poData = await mapToPOData(
      data,
      poLineItemPromises,
      lineItemLength,
      poPrefix,
      preqIDs,
      preqNos,
      plantID,
    );
    console.log("Mapped PO Data:", poData);

    await this.toView({
      target: "1902776039445217282",
      type: "add",
      data: {
        ...poData,
      },
      position: "rtl",
      mode: "dialog",
      width: "80%",
      title: "Add",
    });
  } catch (error) {
    console.error("Error in handleSinglePO:", error);
  }
};

const handleMultiplePO = async (preqRecords) => {
  console.log("Handle Multiple PO");
  try {
    const preqData = await fetchPREQData(preqRecords);
    console.log("Fetched PREQ Data:", preqData);

    let poDataPromises = [];

    for (const preq of preqData) {
      let poLineItemPromises = [];
      const lineItem = preq.table_pr || [];
      let lineIndex = 0;
      for (const [index, item] of lineItem.entries()) {
        console.log("Index:", index, "Item:", item);
        if (preq.preq_type === "Contract") {
          if (item.order_qty === item.pr_line_qty) {
            continue;
          }
        }

        lineIndex++;
        const lineItemPromise = await mapLineItemToPOLine(
          item,
          preq,
          lineIndex + 1,
        );

        poLineItemPromises.push(lineItemPromise);
      }
      const lineItemLength = poLineItemPromises.length;
      const poPrefix = "draft";
      const poData = await mapToPOData(
        preq,
        poLineItemPromises,
        lineItemLength,
        poPrefix,
        [preq.id],
        preq.pr_no,
        preq.plant_id,
      );
      console.log("Mapped PO Data:", poData);
      poDataPromises.push(poData);
    }

    console.log("All PO Data to be added:", poDataPromises);

    const resPODraftFormat = await db
      .collection("su_code_serial_no_rule")
      .where({
        department_id: this.getVarGlobal("firstLvDeptId"),
        business_type: "Purchase Orders",
        is_default: 1,
      })
      .get();

    if (!resPODraftFormat || resPODraftFormat.data.length === 0) return;
    const resPO = await Promise.all(
      poDataPromises.map((poData) =>
        db.collection("purchase_order").add({
          ...poData,
          purchase_order_no_type: resPODraftFormat.data[0].id,
        }),
      ),
    );

    const poData = resPO.map((response) => response.data[0]);
    console.log("Created PO Records:", poData);

    await this.refresh();
    await this.$alert(
      `Successfully created ${poData.length} draft purchase orders.<br><br>
      <strong>Purchase Order Numbers:</strong><br> ${poData
        .map((item) => item.purchase_order_no)
        .join("<br>")}`,
      "Success Converted to Purchase Orders",
      {
        confirmButtonText: "OK",
        dangerouslyUseHTMLString: true,
        type: "success",
      },
    );
  } catch (error) {
    console.error("Error in handleMultiplePO:", error);
  }
};

const fetchPREQData = async (preqRecords) => {
  try {
    const resPreq = await Promise.all(
      preqRecords.map((item) =>
        db.collection("purchase_requisition").doc(item.id).get(),
      ),
    );

    const preqData = resPreq.map((response) => response.data[0]);
    return preqData;
  } catch (error) {
    console.error("Error fetching PREQ data:", error);
    throw error;
  }
};

const mapLineItemToPOLine = async (item, preq, lineIndex) => {
  return {
    item_id: item.pr_line_material_id,
    item_name: item.pr_line_material_name,
    item_desc: item.pr_line_material_desc,
    quantity:
      preq.preq_type === "Contract"
        ? item.pr_line_qty - item.order_qty
        : item.pr_line_qty,
    quantity_uom: item.pr_line_uom_id,
    unit_price: item.pr_line_unit_price,
    gross: item.pr_line_gross,
    discount: item.pr_line_discount,
    discount_uom: item.pr_line_discount_uom,
    discount_amount: item.pr_line_discount_amount,
    tax_preference: item.pr_line_tax_rate_id,
    tax_percent: item.pr_line_taxes_percent,
    tax_amount: item.pr_line_tax_fee_amount,
    tax_inclusive: item.pr_tax_inclusive,
    po_amount: item.pr_line_amount,
    more_desc: item.more_desc,
    line_remark_1: item.line_remark_1,
    line_remark_2: item.line_remark_2,
    tariff_id: item.tariff_id,
    supplier_id: preq.pr_supplier_name || null,
    plant_id: preq.plant_id || null,
    payment_term_id: preq.pr_payment_term_id || null,
    shipping_preference_id: preq.pr_ship_preference_id || null,
    billing_state_id: preq.billing_address_state || null,
    billing_country_id: preq.billing_address_country || null,
    shipping_state_id: preq.shipping_address_state || null,
    shipping_country_id: preq.shipping_address_country || null,
    preq_id: preq.id || null,
    preq_line_id: item.id || null,
    item_category_id: item.item_category_id,
    organization_id: preq.organization_id,
    line_index: lineIndex,
    line_status: "Draft",
    po_created_by: this.getVarGlobal("nickname"),
    further_description: item.further_description,
    po_expected_date: item.pr_delivery_date,
  };
};

const mapToPOData = async (
  data,
  poLineItemPromises,
  lineItemLength,
  poPrefix,
  preqIDs,
  preqNos,
  plantID,
) => {
  return {
    po_status: "Draft",
    preq_no: preqNos,
    preq_id: preqIDs,
    purchase_order_no: poPrefix, // Use generated prefix
    po_supplier_id: data.pr_supplier_name,
    po_date: new Date(),
    organization_id: data.organization_id,
    po_currency: data.currency_code,
    po_delivery_address: "Organization",
    exchange_rate_currency: data.currency_code,
    total_gross_currency: data.currency_code,
    total_discount_currency: data.currency_code,
    total_tax_currency: data.currency_code,
    total_amount_currency: data.currency_code,
    exchange_rate: data.exchange_rate,
    po_plant: plantID,
    po_receiving_supplier: "",
    po_billing_address: data.preq_billing_address,
    po_shipping_address: data.preq_shipping_address,
    po_payment_terms: data.pr_payment_term_id,
    po_expected_date: data.pr_delivery_date,
    po_shipping_preference: data.pr_ship_preference_id,
    table_po: poLineItemPromises,
    po_total_gross: data.pr_sub_total,
    po_total_discount: data.pr_discount_total,
    po_total_tax: data.pr_total_tax_fee,
    po_total: data.pr_total_price,
    po_remark: data.pr_remark,
    po_tnc: data.pr_term_condition,
    billing_address_line_1: data.billing_address_line_1,
    billing_address_line_2: data.billing_address_line_2,
    billing_address_line_3: data.billing_address_line_3,
    billing_address_line_4: data.billing_address_line_4,
    billing_address_city: data.billing_address_city,
    billing_postal_code: data.billing_postal_code,
    billing_address_state: data.billing_address_state,
    billing_address_country: data.billing_address_country,
    billing_address_phone: data.billing_address_phone,
    billing_address_name: data.billing_address_name,
    billing_attention: data.billing_attention,
    billing_address_fax: data.billing_address_fax,
    shipping_address_line_1: data.shipping_address_line_1,
    shipping_address_line_2: data.shipping_address_line_2,
    shipping_address_line_3: data.shipping_address_line_3,
    shipping_address_line_4: data.shipping_address_line_4,
    shipping_address_city: data.shipping_address_city,
    shipping_postal_code: data.shipping_postal_code,
    shipping_address_state: data.shipping_address_state,
    shipping_address_country: data.shipping_address_country,
    shipping_address_phone: data.shipping_address_phone,
    shipping_address_name: data.shipping_address_name,
    shipping_attention: data.shipping_attention,
    shipping_address_fax: data.shipping_address_fax,
    myr_total_amount: data.myr_total_amount,
    partially_received: `0 / ${lineItemLength}`,
    fully_received: `0 / ${lineItemLength}`,
    po_remark2: data.pr_remark2,
    po_remark3: data.pr_remark3,
    po_remark4: data.pr_remark4,
    po_remark5: data.pr_remark5,
    price_tag_id: data.price_tag_id,
  };
};

(async () => {
  try {
    const unCompletedListID = "custom_6scpe4ng";
    const allListID = "custom_xa2fu9as";
    const tabUncompletedElement = document.getElementById(
      "tab-tab_uncompleted",
    );

    const activeTab = tabUncompletedElement?.classList.contains("is-active")
      ? "Uncompleted"
      : "All";

    let selectedRecords;

    selectedRecords = this.getComponent(
      activeTab === "Uncompleted" ? unCompletedListID : allListID,
    )?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      selectedRecords = selectedRecords.filter(
        (item) =>
          item.preq_status === "Issued" ||
          item.preq_status === "Completed" ||
          item.preq_status === "Processing",
      );

      if (selectedRecords.length === 0) {
        await this.$alert(
          "No selected records are available for conversion. Please select records with status 'Issued' or 'Completed'.",
          "No Records to Convert",
          {
            confirmButtonText: "OK",
            dangerouslyUseHTMLString: true,
            type: "warning",
          },
        );
        return;
      }

      // Filter out records that are not "Issued"
      await this.$confirm(
        `Only these purchase requisition records available for conversion. Proceed?<br><br>
        <strong>Selected Records:</strong><br> ${selectedRecords
          .map((item) => item.pr_no)
          .join("<br>")}`,
        "Confirm Conversion",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          dangerouslyUseHTMLString: true,
          type: "info",
        },
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      // Process multiple selections
      if (selectedRecords.length > 1) {
        console.log("this.$confirm", this.$confirm);
        await this.$confirm(
          `You have selected ${selectedRecords.length} purchase requisition records. Would you like to convert these into a single purchase order or into multiple purchase orders?<br><br>
          <strong>Single PO:</strong> All items combined into one document<br>
          <strong>Multiple POs:</strong> Separate orders for better tracking`,
          "Purchase Requisition Conversion",
          {
            confirmButtonText: "Single PO",
            cancelButtonText: "Multiple POs",
            dangerouslyUseHTMLString: true,
            type: "info",
            distinguishCancelAndClose: true,

            beforeClose: async (action, instance, done) => {
              if (action === "confirm") {
                this.showLoading("Converting to Purchase Order...");
                await handleSinglePO(selectedRecords);
                await this.getComponent(
                  activeTab === "Uncompleted" ? unCompletedListID : allListID,
                )?.$refs.crud.clearSelection();
                this.hideLoading();
                done();
              } else if (action === "cancel") {
                this.showLoading("Converting to Purchase Order...");
                await handleMultiplePO(selectedRecords);
                await this.getComponent(
                  activeTab === "Uncompleted" ? unCompletedListID : allListID,
                )?.$refs.crud.clearSelection();
                this.hideLoading();
                done();
              } else {
                done();
              }
            },
          },
        );
      } else if (selectedRecords.length === 1) {
        this.showLoading("Converting to Purchase Order...");
        await handleSinglePO(selectedRecords);
      }

      await this.getComponent(
        activeTab === "Uncompleted" ? unCompletedListID : allListID,
      )?.$refs.crud.clearSelection();
      this.hideLoading();
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
