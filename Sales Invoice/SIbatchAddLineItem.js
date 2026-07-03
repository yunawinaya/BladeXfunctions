const checkExistingSOinSI = async (gdArray) => {
  const gdNumbersWithSI = new Set(); // Use Set to avoid duplicates

  await Promise.all(
    gdArray.flatMap((gd) =>
      gd.sales_order_id.map((soId) =>
        db
          .collection("sales_invoice")
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [
                { prop: "so_id", operator: "in", value: soId.id },
                { prop: "gd_no_display", operator: "isNull", value: null },
              ],
            },
          ])
          .get()
          .then((response) => {
            if (response.data[0]) {
              // Only add gd number if PI exists
              gdNumbersWithSI.add(gd.goods_delivery_number);
            }
          }),
      ),
    ),
  );

  console.log("gd numbers with existing SIs:", Array.from(gdNumbersWithSI));
  return Array.from(gdNumbersWithSI);
};

const fetchSOLineItemData = async (soLineItemIDs) => {
  const resSOLineItem = await Promise.all(
    soLineItemIDs.map((lineId) =>
      db.collection("sales_order_axszx8cj_sub").doc(lineId).get(),
    ),
  );

  const soLineItemData = resSOLineItem.map((response) => response.data[0]);
  return soLineItemData;
};

const processData = async (referenceType, latesttableSI) => {
  this.display(["so_no_display"]);
  if (referenceType.endsWith("GD")) {
    this.display("gd_no_display");
  } else {
    this.hide("gd_no_display");
  }

  for (const [index, si] of latesttableSI.entries()) {
    const result = si.tax_percent && si.tax_percent >= 0;
    this.disabled([`table_si.${index}.tax_percent`], !result);

    if (referenceType.endsWith("GD")) {
      this.display(`table_si.line_gd_no`);
    } else {
      this.hide(`table_si.line_gd_no`);
    }
  }
};

(async () => {
  try {
    const previousReferenceType = this.getValue("reference_type");
    const currentItemArray = arguments[0].itemArray;
    let existingSI = this.getValue("table_si");
    const referenceType = arguments[0].referenceType;

    const customerName = this.getValue("customer_id");

    let tableSI = [];
    let salesOrderNumber = [];
    let soId = [];
    let goodsDeliveryNumber = [];
    let gdId = [];

    // Validation: If no item selected, pop up error and return early
    if (currentItemArray.length === 0) {
      await this.$alert(
        "Please select at least one sales order / goods delivery / item.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
        },
      );

      console.log("User clicked Cancel or closed the dialog");
      return;
    }

    // Validation: If reference type changed, pop up confirmation dialog to confirm with user, if confirmed, reset existing SI line items
    if (previousReferenceType && previousReferenceType !== referenceType) {
      await this.$confirm(
        `You've selected a different reference type than previously used. <br><br>Current Reference Type: ${referenceType} <br>Previous Reference Type: ${previousReferenceType} <br><br>Switching will <strong>reset all items</strong> in this document. Do you want to proceed?`,
        "Different Reference Type Detected",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "error",
          dangerouslyUseHTMLString: true,
        },
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      existingSI = [];
    }

    // Check Customer
    const uniqueCustomers = new Set(
      currentItemArray.map((item) =>
        referenceType.startsWith("Document")
          ? item.customer_id
          : item.customer.id,
      ),
    );
    const allSameCustomer = uniqueCustomers.size === 1;

    if (!allSameCustomer) {
      await this.$alert(
        "Invoiced item(s) from more than two different customers is not allowed.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
        },
      );

      console.log("User clicked Cancel or closed the dialog");
      return;
    }
    if (customerName && customerName !== [...uniqueCustomers][0]) {
      await this.$confirm(
        `You've selected a different customer than previously used. <br><br>Switching will <strong>reset all items</strong> in this document. Do you want to proceed?`,
        "Different Customer Detected",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "error",
          dangerouslyUseHTMLString: true,
        },
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      existingSI = [];
    }

    // If reference type is GD, check if selected GD has existing SI, if has, pop up dialog to inform user and return early
    if (referenceType === "Document - GD" || referenceType === "Item - GD") {
      const existingGDNumbers = await checkExistingSOinSI(currentItemArray);

      // if has existing purchase invoice, pop dialog and reset gr
      if (existingGDNumbers && existingGDNumbers.length > 0) {
        await this.$alert(
          `Sales Order(s) in the ${existingGDNumbers.join(
            ", ",
          )} has existing Sales Invoice(s). Please choose different Goods Delivery(s).`,
          "Existing Sales Invoice(s) Detected",
          {
            confirmButtonText: "OK",
            type: "warning",
            dangerouslyUseHTMLString: false,
          },
        ).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          throw new Error();
        });
      }
    }

    // TEMP GUARD: block combining internal-trading and non-internal documents in
    // one Sales Invoice. Internal = the source SO/GD has a "Linked" row in
    // document_linkage (created by the PO->SO / GD->GR internal-trading flows).
    // The reference type is uniform per SI (switching type resets the table
    // above), so we classify the SO for *-SO and the GD for *-GD.
    {
      const isGD = referenceType.endsWith("GD");

      // Collect the doc ids to classify: new selection + existing SI lines, so
      // adding a non-internal document onto an already-internal invoice is caught.
      const docIdSet = new Set();
      if (isGD) {
        for (const gd of currentItemArray) {
          if (gd.goods_delivery_id) docIdSet.add(gd.goods_delivery_id);
        }
        (existingSI || []).forEach(
          (l) => l.line_gd_id && docIdSet.add(l.line_gd_id),
        );
      } else {
        for (const so of currentItemArray) {
          const soId =
            referenceType === "Document - SO"
              ? so.sales_order_id
              : so.sales_order?.id;
          if (soId) docIdSet.add(soId);
        }
        (existingSI || []).forEach(
          (l) => l.line_so_id && docIdSet.add(l.line_so_id),
        );
      }

      const docIds = [...docIdSet];
      if (docIds.length > 0) {
        const linkRes = await db
          .collection("document_linkage")
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [
                {
                  prop: isGD ? "source_doc_type" : "target_doc_type",
                  operator: "equal",
                  value: isGD ? "Goods Delivery" : "Sales Order",
                },
                {
                  prop: isGD ? "source_doc_id" : "target_doc_id",
                  operator: "in",
                  value: docIds,
                },
                { prop: "link_status", operator: "equal", value: "Linked" },
              ],
            },
          ])
          .get();

        const internalSet = new Set(
          (linkRes?.data || []).map((r) =>
            isGD ? r.source_doc_id : r.target_doc_id,
          ),
        );
        const internalCount = docIds.filter((id) => internalSet.has(id)).length;

        if (internalCount > 0 && internalCount < docIds.length) {
          await this.$alert(
            "Cannot combine internal trading and non-internal documents in the same Sales Invoice. Please select only one type.",
            "Error",
            { confirmButtonText: "OK", type: "error" },
          );
          return;
        }
      }
    }

    this.closeDialog("dialog_select_item");
    this.showLoading();

    switch (referenceType) {
      case "Document - SO":
        for (const so of currentItemArray) {
          for (const soItem of so.table_so) {
            const newtableSIRecord = {
              material_id: soItem.item_name || "",
              material_name: soItem.item_id,
              material_desc: soItem.so_desc || "",

              more_desc: soItem.more_desc || "",
              line_remark_1: soItem.line_remark_1 || "",
              line_remark_2: soItem.line_remark_2 || "",
              line_remark_3: soItem.line_remark_3 || "",

              line_so_no: so.sales_order_number,
              line_gd_no: "",

              so_order_quantity: soItem.so_quantity,
              so_order_uom_id: soItem.so_item_uom,
              good_delivery_quantity: soItem.delivered_qty,
              invoice_qty: soItem.so_quantity - (soItem.invoice_qty || 0),
              available_inv_qty: soItem.so_quantity - (soItem.invoice_qty || 0),
              invoice_qty_uom_id: soItem.so_item_uom,
              unit_price: soItem.so_item_price,
              si_discount: soItem.so_discount,
              si_discount_uom_id: soItem.so_discount_uom,
              si_tax_rate_id: soItem.so_tax_preference,
              tax_percent: soItem.so_tax_percentage,
              si_tax_inclusive: soItem.so_tax_inclusive,

              line_so_id: so.sales_order_id,
              so_line_id: soItem.id,
              line_gd_id: "",
              gd_line_id: "",
              item_category_id: soItem.item_category_id,
              custom_fields: soItem.custom_fields,
              tariff_id: soItem.tariff_id,
            };

            tableSI.push(newtableSIRecord);
          }
        }

        break;

      case "Document - GD":
        for (const gd of currentItemArray) {
          const soLineItemIDs = gd.table_gd.map((gd) => gd.so_line_item_id);

          const soLineItemData = await fetchSOLineItemData(soLineItemIDs);
          console.log("soLineItemData", soLineItemData);
          for (const [index, gdItem] of gd.table_gd.entries()) {
            const newtableSIRecord = {
              material_id: gdItem.material_id || "",
              material_name: gdItem.material_name,
              material_desc: gdItem.gd_material_desc || "",

              more_desc: gdItem.more_desc || "",
              line_remark_1: gdItem.line_remark_1 || "",
              line_remark_2: gdItem.line_remark_2 || "",
              line_remark_3: gdItem.line_remark_3 || "",

              line_so_no: gdItem.line_so_no,
              line_gd_no: gd.goods_delivery_number,

              so_order_quantity: gdItem.gd_order_quantity,
              so_order_uom_id: gdItem.good_delivery_uom_id,
              good_delivery_quantity: gdItem.gd_qty,
              invoice_qty: gdItem.gd_qty - (gdItem.invoice_qty || 0),
              available_inv_qty: gdItem.gd_qty - (gdItem.invoice_qty || 0),
              invoice_qty_uom_id: gdItem.good_delivery_uom_id,
              unit_price: soLineItemData[index].so_item_price,
              si_discount: soLineItemData[index].so_discount,
              si_discount_uom_id: soLineItemData[index].so_discount_uom,
              si_tax_rate_id: soLineItemData[index].so_tax_preference,
              tax_percent: soLineItemData[index].so_tax_percentage,
              si_tax_inclusive: soLineItemData[index].so_tax_inclusive,
              custom_fields: gdItem.custom_fields,
              line_so_id: gdItem.line_so_id,
              so_line_id: gdItem.so_line_item_id,
              line_gd_id: gd.goods_delivery_id,
              gd_line_id: gdItem.id,
              item_category_id: gdItem.item_category_id,
              tariff_id: gdItem.tariff_id,
            };

            tableSI.push(newtableSIRecord);
          }
        }
        break;

      case "Item - SO":
        for (const soItem of currentItemArray) {
          const newtableSIRecord = {
            material_id: soItem.item.id || "",
            material_name: soItem.item.material_name,
            material_desc: soItem.item_desc || "",

            more_desc: soItem.more_desc || "",
            line_remark_1: soItem.line_remark_1 || "",
            line_remark_2: soItem.line_remark_2 || "",
            line_remark_3: soItem.line_remark_3 || "",

            line_so_no: soItem.sales_order.so_no,
            line_gd_no: "",

            so_order_quantity: soItem.so_quantity,
            so_order_uom_id: soItem.so_item_uom,
            good_delivery_quantity: soItem.delivered_qty,
            invoice_qty: soItem.so_quantity - (soItem.invoice_qty || 0),
            available_inv_qty: soItem.so_quantity - (soItem.invoice_qty || 0),
            invoice_qty_uom_id: soItem.so_item_uom,
            unit_price: soItem.so_item_price,
            si_discount: soItem.so_discount,
            si_discount_uom_id: soItem.so_discount_uom,
            si_tax_rate_id: soItem.so_tax_preference,
            tax_percent: soItem.so_tax_percentage,
            si_tax_inclusive: soItem.so_tax_inclusive,

            line_so_id: soItem.sales_order.id,
            so_line_id: soItem.sales_order_line_id,
            line_gd_id: "",
            gd_line_id: "",
            item_category_id: soItem.item.item_category,
            custom_fields: soItem.custom_fields,
            tariff_id: soItem.tariff_id,
          };

          tableSI.push(newtableSIRecord);
        }
        break;

      case "Item - GD":
        for (const gdItem of currentItemArray) {
          const newtableSIRecord = {
            material_id: gdItem.item.id || "",
            material_name: gdItem.item.material_name,
            material_desc: gdItem.item_desc || "",

            more_desc: gdItem.more_desc || "",
            line_remark_1: gdItem.line_remark_1 || "",
            line_remark_2: gdItem.line_remark_2 || "",
            line_remark_3: gdItem.line_remark_3 || "",

            line_so_no: gdItem.line_so_no,
            line_gd_no: gdItem.goods_delivery_number,

            so_order_quantity: gdItem.ordered_qty,
            so_order_uom_id: gdItem.uom,
            good_delivery_quantity: gdItem.delivered_qty,
            invoice_qty: gdItem.delivered_qty - (gdItem.invoiced_qty || 0),
            available_inv_qty:
              gdItem.delivered_qty - (gdItem.invoiced_qty || 0),
            invoice_qty_uom_id: gdItem.uom,
            unit_price: gdItem.so_line_item.so_item_price,
            si_discount: gdItem.so_line_item.so_discount,
            si_discount_uom_id: gdItem.so_line_item.so_discount_uom,
            si_tax_rate_id: gdItem.so_line_item.so_tax_preference,
            tax_percent: gdItem.so_line_item.so_tax_percentage,
            si_tax_inclusive: gdItem.so_line_item.so_tax_inclusive,

            line_so_id: gdItem.line_so_id,
            so_line_id: gdItem.so_line_item.id,
            line_gd_id: gdItem.goods_delivery_id,
            gd_line_id: gdItem.goods_delivery_line_id,
            item_category_id: gdItem.item.item_category,
            custom_fields: gdItem.custom_fields,
            tariff_id: gdItem.tariff_id,
          };

          tableSI.push(newtableSIRecord);
        }
        break;

      default:
        break;
    }

    tableSI = tableSI.filter(
      (si) =>
        si.invoice_qty !== 0 &&
        !existingSI.find((siItem) => siItem.so_line_id === si.so_line_id),
    );

    const latesttableSI = [...existingSI, ...tableSI];

    soId = [...new Set(latesttableSI.map((si) => si.line_so_id))];
    salesOrderNumber = [...new Set(latesttableSI.map((si) => si.line_so_no))];

    gdId = [...new Set(latesttableSI.map((si) => si.line_gd_id))];
    goodsDeliveryNumber = [
      ...new Set(latesttableSI.map((si) => si.line_gd_no)),
    ];

    console.log("tableSI", tableSI);
    await this.setData({
      customer_id: referenceType.startsWith("Document")
        ? currentItemArray[0].customer_id
        : currentItemArray[0].customer.id,
      so_no_display: salesOrderNumber.join(", "),
      so_id: soId,
      gd_no_display: goodsDeliveryNumber.join(", "),
      gd_id: gdId,
      table_si: [...existingSI, ...tableSI],
      reference_type: referenceType,
    });

    setTimeout(async () => {
      await processData(referenceType, latesttableSI);
    }, 50);

    this.triggerEvent("SIcalculation", { SIlineItem: latesttableSI });

    this.hideLoading();
  } catch (error) {
    console.error(error);
    this.hideLoading();
  }
})();
