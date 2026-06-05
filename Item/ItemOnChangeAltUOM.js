(async () => {
  try {
    const basedUOM = this.getValue("based_uom");
    const selectedUOM = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;

    const tableUOMConversion = this.getValue("table_uom_conversion");
    const tableSupplierPrice = this.getValue("table_supplier_price");
    const tableCustomerPrice = this.getValue("table_customer_price");

    const purchaseDefaultUOM = this.getValue("purchase_default_uom");
    const salesDefaultUOM = this.getValue("sales_default_uom");

    if (basedUOM === selectedUOM && rowIndex !== 0) {
      await this.$alert("Based UOM and Selected UOM cannot be same", "Error", {
        confirmButtonText: "OK",
        type: "error",
      });
      this.setData({
        [`table_uom_conversion.${rowIndex}.alt_uom_id`]: "",
      });
      return;
    }

    if (
      tableUOMConversion.filter((item) => item.alt_uom_id === selectedUOM)
        .length > 1
    ) {
      console.log(
        tableUOMConversion.filter((item) => item.alt_uom_id === selectedUOM),
      );
      await this.$alert("Alt UOM already been selected", "Error", {
        confirmButtonText: "OK",
        type: "error",
      });
      this.setData({
        [`table_uom_conversion.${rowIndex}.alt_uom_id`]: "",
      });
    }

    const conversionUOMs = new Set(
      tableUOMConversion.map((item) => item.alt_uom_id),
    );
    const supplierUOMs = tableSupplierPrice.map((item) => item.sup_price_uom);
    const customerUOMs = tableCustomerPrice.map((item) => item.cust_price_uom);

    const missingSupplierUOMs = supplierUOMs.filter(
      (uom) => !conversionUOMs.has(uom),
    );
    const missingCustomerUOMs = customerUOMs.filter(
      (uom) => !conversionUOMs.has(uom),
    );
    const missingPurchaseUOM =
      purchaseDefaultUOM && !conversionUOMs.has(purchaseDefaultUOM);
    const missingSalesUOM =
      salesDefaultUOM && !conversionUOMs.has(salesDefaultUOM);

    if (
      selectedUOM &&
      (missingSupplierUOMs.length > 0 ||
        missingCustomerUOMs.length > 0 ||
        missingPurchaseUOM ||
        missingSalesUOM)
    ) {
      await this.$confirm(
        "The alt UOM has been changed. It will reset the UOM in purchase and sales information. Are you sure you want to continue?",
        "Confirmation",
        {
          confirmButtonText: "Yes",
          cancelButtonText: "No",
          type: "warning",
        },
      )
        .then(() => {
          this.setData({
            ...(missingPurchaseUOM ? { purchase_default_uom: "" } : {}),
            ...(missingSalesUOM ? { sales_default_uom: "" } : {}),
            ...(missingSupplierUOMs.length > 0
              ? {
                  table_supplier_price: [
                    ...tableSupplierPrice.map((item) => ({
                      ...item,
                      sup_price_uom: !conversionUOMs.has(item.sup_price_uom)
                        ? ""
                        : item.sup_price_uom,
                    })),
                  ],
                }
              : {}),
            ...(missingCustomerUOMs.length > 0
              ? {
                  table_customer_price: [
                    ...tableCustomerPrice.map((item) => ({
                      ...item,
                      cust_price_uom: !conversionUOMs.has(item.cust_price_uom)
                        ? ""
                        : item.cust_price_uom,
                    })),
                  ],
                }
              : {}),
          });
        })
        .catch(() => {
          this.setData({
            [`table_uom_conversion.${rowIndex}.alt_uom_id`]: "",
          });
          throw new Error("Alt UOM clear");
        });
    }
  } catch (error) {
    console.error(error);
  }
})();
