(async () => {
  const rowIndex = arguments[0].rowIndex;

  const itemId = arguments[0].value;

  if (itemId && !Array.isArray(itemId)) {
    const resItem = await db.collection("item").where({ id: itemId }).get();

    const itemData = resItem.data[0];

    const {
      material_desc,
      based_uom,
      sales_default_uom,
      sales_unit_price,
      table_uom_conversion,
      mat_sales_tax_id,
    } = itemData;

    this.setData({ [`table_so.${rowIndex}.so_desc`]: material_desc });

    if (sales_default_uom) {
      this.setData({
        [`table_so.${rowIndex}.so_item_uom`]: sales_default_uom,
      });
    } else {
      this.setData({ [`table_so.${rowIndex}.so_item_uom`]: based_uom });
    }

    this.setData({ [`table_so.${rowIndex}.so_item_price`]: sales_unit_price });

    console.log("mat_sales_tax_id JN", mat_sales_tax_id);
    if (mat_sales_tax_id) {
      this.setData({
        [`table_so.${rowIndex}.so_tax_preference`]: mat_sales_tax_id,
      });
    }

    const altUoms = table_uom_conversion.map((data) => data.alt_uom_id);
    altUoms.push(based_uom);

    const uomOptions = [];

    const processData = async () => {
      for (let i = 0; i < altUoms.length; i++) {
        const res = await db
          .collection("unit_of_measurement")
          .where({ id: altUoms[i] })
          .get();
        uomOptions.push(res.data[0]);
      }
    };

    const updateUomOption = async () => {
      await processData();

      this.setOptionData([`table_so.${rowIndex}.so_item_uom`], uomOptions);
    };

    updateUomOption();

    const taxPercent = itemData.sales_tax_percent || null;

    if (taxPercent) {
      setTimeout(() => {
        this.setData({
          [`table_so.${rowIndex}.so_tax_percentage`]: taxPercent,
        });
      }, 1000);
    }
  } else {
    this.setData({
      [`table_so.${rowIndex}.so_desc`]: "",
      [`table_so.${rowIndex}.so_quantity`]: 0,
      [`table_so.${rowIndex}.so_item_uom`]: "",
      [`table_so.${rowIndex}.so_item_price`]: 0,
      [`table_so.${rowIndex}.so_gross`]: 0,
      [`table_so.${rowIndex}.so_discount`]: 0,
      [`table_so.${rowIndex}.so_discount_uom`]: "",
      [`table_so.${rowIndex}.so_discount_amount`]: 0,
      [`table_so.${rowIndex}.so_tax_preference`]: "",
      [`table_so.${rowIndex}.so_tax_percentage`]: "",
      [`table_so.${rowIndex}.so_tax_amount`]: 0,
      [`table_so.${rowIndex}.so_tax_inclusive`]: 0,
      [`table_so.${rowIndex}.so_brand`]: "",
      [`table_so.${rowIndex}.so_packaging_style`]: "",
      [`table_so.${rowIndex}.so_amount`]: 0,
      [`table_so.${rowIndex}.delivered_qty`]: 0,
    });
  }
})();
