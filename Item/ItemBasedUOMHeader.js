(async () => {
  try {
    const data = this.getValues();
    const based_uom = data.based_uom;

    if (based_uom !== data.previous_based_uom) {
      const tableSupplierPrice = data.table_supplier_price;
      let hasSupplierPriceUOM = false;
      let hasCustomerPriceUOM = false;

      if (tableSupplierPrice.length > 0) {
        hasSupplierPriceUOM = tableSupplierPrice?.some(
          (item) => item.sup_price_uom === data.previous_based_uom,
        );
      }

      const tableCustomerPrice = data.table_customer_price;

      if (tableCustomerPrice.length > 0) {
        hasCustomerPriceUOM = tableCustomerPrice?.some(
          (item) => item.cust_price_uom === data.previous_based_uom,
        );
      }

      if (
        (data.purchase_default_uom === data.previous_based_uom ||
          data.sales_default_uom === data.previous_based_uom ||
          hasCustomerPriceUOM ||
          hasSupplierPriceUOM) &&
        data.previous_based_uom &&
        based_uom !== data.previous_based_uom
      ) {
        await this.$confirm(
          "The base UOM has been changed. It will reset the UOM in purchase and sales information. Are you sure you want to continue?",
          "Confirmation",
          {
            confirmButtonText: "Yes",
            cancelButtonText: "No",
            type: "warning",
          },
        ).catch(() => {
          this.setData({
            based_uom: data.previous_based_uom,
          });
          throw new Error("Base UOM not changed");
        });
      }

      await this.disabled(
        [
          "table_uom_conversion",
          "table_supplier_price",
          "table_customer_price",
          "purchase_default_uom",
          "sales_default_uom",
        ],
        false,
      );

      const tableUOMConversion = this.getValue("table_uom_conversion");
      const tablePackingDetail = this.getValue("table_packing_detail");
      this.setData({
        table_uom_conversion: [
          {
            alt_qty: 1,
            alt_uom_id: based_uom,
            base_qty: 1,
            base_uom_id: based_uom,
            text_b4j8h211: "=",
          },
          ...tableUOMConversion.slice(1),
        ],
        table_packing_detail: [
          {
            packing_qty: 1,
            packing_uom_id: based_uom,
            quantity: 1,
            uom_id: based_uom,
            text_b4j8h211: "=",
          },
          ...tablePackingDetail.slice(1),
        ],
        previous_based_uom: based_uom,
        ...(data.previous_based_uom === data.purchase_default_uom
          ? { purchase_default_uom: "" }
          : {}),
        ...(data.previous_based_uom === data.sales_default_uom
          ? { sales_default_uom: "" }
          : {}),
        table_supplier_price:
          (tableSupplierPrice?.length && [
            ...tableSupplierPrice.map((item) => ({
              ...item,
              sup_price_uom:
                item.sup_price_uom === data.previous_based_uom
                  ? based_uom
                  : item.sup_price_uom,
            })),
          ]) ||
          [],

        table_customer_price:
          (tableCustomerPrice?.length && [
            ...tableCustomerPrice.map((item) => ({
              ...item,
              cust_price_uom:
                item.cust_price_uom === data.previous_based_uom
                  ? based_uom
                  : item.cust_price_uom,
            })),
          ]) ||
          [],
      }).then(() => {
        setTimeout(() => {
          this.disabled(
            [
              `table_uom_conversion.0.base_qty`,
              `table_uom_conversion.0.alt_uom_id`,
            ],
            true,
          );
        }, 50);
      });

      data.table_uom_conversion.forEach((uom, index) => {
        this.setData({
          [`table_uom_conversion.${index}.base_uom_id`]: based_uom,
        });
      });

      data.table_packing_detail.forEach((uom, index) => {
        this.setData({
          [`table_packing_detail.${index}.uom_id`]: based_uom,
        });
      });

      data.table_packing_detail.forEach((uom, index) => {
        this.setData({
          [`table_packing_detail.${index}.uom_id`]: based_uom,
        });
      });
    } else if (based_uom === data.previous_based_uom) {
      data.table_uom_conversion.forEach((uom, index) => {
        this.setData({
          [`table_uom_conversion.${index}.base_uom_id`]: based_uom,
        });
      });

      data.table_packing_detail.forEach((uom, index) => {
        this.setData({
          [`table_packing_detail.${index}.uom_id`]: based_uom,
        });
      });
    } else if (!based_uom) {
      data.table_uom_conversion.forEach((uom, index) => {
        this.setData({
          [`table_uom_conversion.${index}.base_uom_id`]: "",
        });
      });
      data.table_packing_detail.forEach((uom, index) => {
        this.setData({
          [`table_packing_detail.${index}.uom_id`]: "",
        });
      });
      this.disabled(
        [
          "table_uom_conversion",
          "table_packing_detail",
          "table_supplier_price",
          "table_customer_price",
          "sales_default_uom",
          "purchase_default_uom",
        ],
        true,
      );
    }
  } catch (error) {
    console.error("Error in UOM processing:", error);
  }
})();
