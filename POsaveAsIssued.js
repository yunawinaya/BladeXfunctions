const page_status = this.getParamsVariables("page_status");
const self = this;

const addOnPO = () => {
  const data = this.getValues();
  const items = data.table_po;
  if (Array.isArray(items)) {
    items.forEach((item, index) => {
      const onOrderData = {
        purchase_order_number: data.purchase_order_no,
        material_id: item.item_id,
        material_name: item.item_id,
        purchase_order_line: index + 1,
        scheduled_qty: item.quantity,
        open_qty: item.quantity,
        received_qty: 0,
      };

      db.collection("on_order_purchase_order")
        .add(onOrderData)
        .catch((error) => {
          console.log(
            `Error adding on_order_purchase_order for item ${index + 1}:`,
            error
          );
        });
    });
  } else {
    console.log("table_po is not an array:", items);
  }
};

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

this.getData().then((data) => {
  const {
    po_supplier_id,
    po_date,
    organization_id,
    po_currency,
    po_delivery_address,
    purchase_order_no,
    po_plant,
    po_receiving_supplier,
    po_billing_name,
    po_billing_cp,
    po_billing_address,
    po_shipping_address,
    po_payment_terms,
    po_expected_date,
    po_shipping_preference,
    po_ref_doc,
    table_po,
    po_total_gross,
    po_total_discount,
    po_total_tax,
    po_total,
    po_remark,
    po_tnc,
    preq_no,
    billing_address_line_1,
    billing_address_line_2,
    billing_address_line_3,
    billing_address_line_4,
    billing_address_city,
    billing_postal_code,
    billing_address_state,
    billing_address_country,
    shipping_address_line_1,
    shipping_address_line_2,
    shipping_address_line_3,
    shipping_address_line_4,
    shipping_address_city,
    shipping_postal_code,
    shipping_address_state,
    shipping_address_country,
    exchange_rate,
    myr_total_amount,
  } = data;

  const entry = {
    po_status: "Issued",
    purchase_order_no,
    po_supplier_id,
    po_date,
    organization_id,
    po_currency,
    po_delivery_address,
    po_plant,
    po_receiving_supplier,
    po_billing_name,
    po_billing_cp,
    po_billing_address,
    po_shipping_address,
    po_payment_terms,
    po_expected_date,
    po_shipping_preference,
    po_ref_doc,
    table_po,
    po_total_gross,
    po_total_discount,
    po_total_tax,
    po_total,
    po_remark,
    po_tnc,
    preq_no,
    billing_address_line_1,
    billing_address_line_2,
    billing_address_line_3,
    billing_address_line_4,
    billing_address_city,
    billing_postal_code,
    billing_address_state,
    billing_address_country,
    shipping_address_line_1,
    shipping_address_line_2,
    shipping_address_line_3,
    shipping_address_line_4,
    shipping_address_city,
    shipping_postal_code,
    shipping_address_state,
    shipping_address_country,
    exchange_rate,
    myr_total_amount,
  };

  if (page_status === "Add" || page_status === "Clone") {
    this.showLoading();
    db.collection("purchase_order")
      .add(entry)
      .then(() => {
        let organizationId = this.getVarGlobal("deptParentId");
        if (organizationId === "0") {
          organizationId = this.getVarSystem("deptIds").split(",")[0];
        }

        return db
          .collection("prefix_configuration")
          .where({
            document_types: "Purchase Orders",
            is_deleted: 0,
            organization_id: organizationId,
            is_active: 1,
          })
          .get()
          .then((prefixEntry) => {
            if (prefixEntry.data.length === 0) return;
            else {
              const data = prefixEntry.data[0];
              return db
                .collection("prefix_configuration")
                .where({
                  document_types: "Purchase Orders",
                  is_deleted: 0,
                  organization_id: organizationId,
                })
                .update({
                  running_number: parseInt(data.running_number) + 1,
                  has_record: 1,
                });
            }
          });
      })
      .then(async () => {
        entry.table_po.forEach(async (poLineItem, index) => {
          const itemData = await db
            .collection("Item")
            .where({ id: poLineItem.item_id })
            .get();
          const supplierData = await db
            .collection("supplier_head")
            .where({ id: entry.po_supplier_id })
            .get();
          const uomData = await db
            .collection("unit_of_measurement")
            .where({ id: poLineItem.quantity_uom })
            .get();

          let prData = [];
          let prUserData = [];

          if (entry.preq_no) {
            const resPR = await db
              .collection("purchase_requisition")
              .where({ pr_no: entry.preq_no })
              .get();
            prData.push(resPR.data[0]);

            const resUser = await db
              .collection("blade_user")
              .where({ id: prData[0].create_user })
              .get();
            prUserData.push(resUser.data[0]);
          }

          const taxData = await db
            .collection("tax_rate")
            .where({ id: poLineItem.tax_preference })
            .get();
          const termData = await db
            .collection("payment_terms")
            .where({ id: entry.po_payment_terms })
            .get();
          const plantData = await db
            .collection("blade_dept")
            .where({ id: entry.po_plant })
            .get();
          const userData = await db
            .collection("blade_user")
            .where({ id: this.getVarSystem("uid") })
            .get();

          db.collection("purchase_order_line").add({
            po_line_item_no: index + 1,
            material_code: itemData?.data[0]?.material_code
              ? itemData.data[0].material_code
              : "",
            item_name: itemData?.data[0]?.material_name
              ? itemData.data[0].material_name
              : "",
            purchase_order_number: entry.purchase_order_no,
            po_date: entry.po_date,
            po_created_by: userData.data[0].name,
            plant: plantData.data[0].dept_name,
            expected_delivery_date: entry.po_expected_date,
            pr_number: entry.preq_no || "N/A",
            pr_date: prData[0] ? prData[0].pr_date : null,
            pr_created_by: prUserData[0] ? prUserData[0].name : null,
            supplier_code: supplierData?.data[0]?.supplier_code
              ? supplierData.data[0].supplier_code
              : "",
            supplier_name: supplierData?.data[0]?.supplier_com_name
              ? supplierData.data[0].supplier_com_name
              : "",
            category: itemData?.data[0]?.material_category
              ? itemData.data[0].material_category
              : "",
            sub_category: itemData?.data[0]?.material_sub_category
              ? itemData.data[0].material_sub_category
              : "",
            material_desc: itemData?.data[0]?.material_desc
              ? itemData.data[0].material_desc
              : "",
            remarks: entry.po_remark,
            po_line_qty: poLineItem.quantity,
            po_line_uom_name: uomData?.data[0]?.uom_name
              ? uomData.data[0].uom_name
              : "",
            po_line_unit_price: poLineItem.unit_price,
            currency_code: entry.po_currency,
            po_line_discount: poLineItem.discount,
            po_line_tax_rate_id: taxData?.data[0]?.tax_code
              ? taxData.data[0].tax_code
              : "",
            tax_percentage: poLineItem.tax_rate_percent,
            po_line_tax_fee_amount: poLineItem.tax_amount,
            po_line_amount: poLineItem.po_amount,
            po_total_amount: poLineItem.po_total,
            payment_term: termData?.data[0]?.term_code
              ? termData.data[0].term_code
              : "",
            status: entry.po_status,
            po_line_invoice_id: "",
            po_line_receive_id: "",
          });
        });
      })
      .then(() => {
        addOnPO();
        closeDialog();
      })
      .catch((error) => {
        alert(error);
      });
  } else if (page_status === "Edit") {
    this.showLoading();
    const purchaseOrderId = this.getParamsVariables("purchase_order_no");
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    const prefixEntry = db
      .collection("prefix_configuration")
      .where({
        document_types: "Purchase Orders",
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get()
      .then((prefixEntry) => {
        if (prefixEntry.data.length > 0) {
          const prefixData = prefixEntry.data[0];
          const now = new Date();
          let prefixToShow;
          let runningNumber = prefixData.running_number;
          let isUnique = false;
          let maxAttempts = 10;
          let attempts = 0;

          const generatePrefix = (runNumber) => {
            let generated = prefixData.current_prefix_config;
            generated = generated.replace("prefix", prefixData.prefix_value);
            generated = generated.replace("suffix", prefixData.suffix_value);
            generated = generated.replace(
              "month",
              String(now.getMonth() + 1).padStart(2, "0")
            );
            generated = generated.replace(
              "day",
              String(now.getDate()).padStart(2, "0")
            );
            generated = generated.replace("year", now.getFullYear());
            generated = generated.replace(
              "running_number",
              String(runNumber).padStart(prefixData.padding_zeroes, "0")
            );
            return generated;
          };

          const checkUniqueness = async (generatedPrefix) => {
            const existingDoc = await db
              .collection("purchase_order")
              .where({ purchase_order_no: generatedPrefix })
              .get();
            return existingDoc.data[0] ? false : true;
          };

          const findUniquePrefix = async () => {
            while (!isUnique && attempts < maxAttempts) {
              attempts++;
              prefixToShow = generatePrefix(runningNumber);
              isUnique = await checkUniqueness(prefixToShow);
              if (!isUnique) {
                runningNumber++;
              }
            }

            if (!isUnique) {
              throw new Error(
                "Could not generate a unique Purchase Requisition number after maximum attempts"
              );
            } else {
              entry.purchase_order_no = prefixToShow;
              db.collection("purchase_order")
                .doc(purchaseOrderId)
                .update(entry);
              db.collection("prefix_configuration")
                .where({
                  document_types: "Purchase Orders",
                  is_deleted: 0,
                  organization_id: organizationId,
                })
                .update({
                  running_number: parseInt(runningNumber) + 1,
                  has_record: 1,
                });
            }
          };

          findUniquePrefix();
        } else {
          db.collection("purchase_order")
            .doc(purchaseOrderId)
            .update(entry)
            .then(async () => {
              entry.table_po.forEach(async (poLineItem, index) => {
                const itemData = await db
                  .collection("Item")
                  .where({ id: poLineItem.item_id })
                  .get();
                const supplierData = await db
                  .collection("supplier_head")
                  .where({ id: entry.po_supplier_id })
                  .get();
                const uomData = await db
                  .collection("unit_of_measurement")
                  .where({ id: poLineItem.quantity_uom })
                  .get();

                let prData = [];
                let prUserData = [];

                if (entry.preq_no) {
                  const resPR = await db
                    .collection("purchase_requisition")
                    .where({ pr_no: entry.preq_no })
                    .get();
                  prData.push(resPR.data[0]);

                  const resUser = await db
                    .collection("blade_user")
                    .where({ id: prData[0].create_user })
                    .get();
                  prUserData.push(resUser.data[0]);
                }

                const taxData = await db
                  .collection("tax_rate")
                  .where({ id: poLineItem.tax_preference })
                  .get();
                const termData = await db
                  .collection("payment_terms")
                  .where({ id: entry.po_payment_terms })
                  .get();
                const plantData = await db
                  .collection("blade_dept")
                  .where({ id: entry.po_plant })
                  .get();
                const userData = await db
                  .collection("blade_user")
                  .where({ id: this.getVarSystem("uid") })
                  .get();

                const poLineData = await db
                  .collection("purchase_order_line")
                  .where({
                    purchase_order_number: entry.purchase_order_no,
                    po_line_item_no: index + 1,
                  })
                  .get();

                const updatedData = {
                  //po_line_item_no: index +1,
                  material_code: itemData?.data[0]?.material_code
                    ? itemData.data[0].material_code
                    : "",
                  item_name: itemData?.data[0]?.material_name
                    ? itemData.data[0].material_name
                    : "",
                  purchase_order_number: entry.purchase_order_no,
                  po_date: entry.po_date,
                  po_created_by: userData.name,
                  plant: plantData.data[0].dept_name,
                  expected_delivery_date: entry.po_expected_date,
                  pr_number: entry.preq_no || "N/A",
                  pr_date: prData[0] ? prData[0].pr_date : null,
                  pr_created_by: prUserData[0] ? prUserData[0].name : null,
                  supplier_code: supplierData?.data[0]?.supplier_code
                    ? supplierData.data[0].supplier_code
                    : "",
                  supplier_name: supplierData?.data[0]?.supplier_com_name
                    ? supplierData.data[0].supplier_com_name
                    : "",
                  category: itemData?.data[0]?.material_category
                    ? itemData.data[0].material_category
                    : "",
                  sub_category: itemData?.data[0]?.material_sub_category
                    ? itemData.data[0].material_sub_category
                    : "",
                  material_desc: itemData?.data[0]?.material_desc
                    ? itemData.data[0].material_desc
                    : "",
                  remarks: entry.po_remark,
                  po_line_qty: poLineItem.quantity,
                  po_line_uom_name: uomData?.data[0]?.uom_name
                    ? uomData.data[0].uom_name
                    : "",
                  po_line_unit_price: poLineItem.unit_price,
                  currency_code: entry.po_currency,
                  po_line_discount: poLineItem.discount,
                  po_line_tax_rate_id: taxData?.data[0]?.tax_code
                    ? taxData.data[0].tax_code
                    : "",
                  tax_percentage: poLineItem.tax_rate_percent,
                  po_line_tax_fee_amount: poLineItem.tax_amount,
                  po_line_amount: poLineItem.po_amount,
                  po_total_amount: poLineItem.po_total,
                  payment_term: termData?.data[0]?.term_code
                    ? termData.data[0].term_code
                    : "",
                  status: entry.po_status,
                  po_line_invoice_id: "",
                  po_line_receive_id: "",
                };

                if (poLineData.data.length > 0) {
                  db.collection("purchase_order_line")
                    .where({
                      purchase_order_number: entry.purchase_order_no,
                      po_line_item_no: index + 1,
                    })
                    .update(updatedData);
                } else {
                  db.collection("purchase_order_line").add(updatedData);
                }
              });
            });
        }
      })

      .then(() => {
        addOnPO();
        closeDialog();
      })
      .catch((error) => {
        alert(error);
      });
  }
});
