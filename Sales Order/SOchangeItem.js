const rowIndex = arguments[0].rowIndex;

const {
  material_desc,
  based_uom,
  mat_sales_tax_id,
  table_uom_conversion,
  sales_unit_price,
} = arguments[0].fieldModel.item;

// Set basic fields
this.setData({
  [`table_so.${rowIndex}.so_desc`]: material_desc,
  [`table_so.${rowIndex}.so_item_uom`]: based_uom,
  [`table_so.${rowIndex}.so_tax_preference`]: mat_sales_tax_id,
});
if (this.getValue(`table_so.${rowIndex}.so_item_price`) === 0) {
  this.setData({
    [`table_so.${rowIndex}.so_item_price`]: sales_unit_price,
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
    if (res.data.length > 0) {
      uomOptions.push({
        value: res.data[0].id,
        label: res.data[0].uom_name,
      });
    }
  }
};

const updateUomOption = async () => {
  await processData();

  await this.setOptionData([`table_so.${rowIndex}.so_item_uom`], uomOptions);
  for (let i = 0; i < uomOptions.length; i++) {
    if (uomOptions[i].value === based_uom) {
      await this.setData({
        [`table_so.${rowIndex}.so_item_uom`]: uomOptions[i],
      });
    }
  }
};

updateUomOption();

// Only fetch tax rate if both tax_preference and tax_percent exist
const taxPercent = fieldModel?.sales_tax_percent;
const taxPreference = fieldModel?.mat_sales_tax_id;

if (taxPreference && taxPercent) {
  db.collection("tax_rate_percent")
    .where({ id: taxPercent })
    .get()
    .then((resTAX) => {
      if (resTAX.data.length > 0) {
        this.setData({
          [`table_so.${rowIndex}.so_tax_percentage`]:
            resTAX.data[0].tax_rate_percent,
        });
      }
    })
    .catch((error) => {
      console.error("Error fetching tax rate:", error);
    });
} else {
  // Clear tax percentage if no tax preference
  this.setData({
    [`table_so.${rowIndex}.so_tax_percentage`]: null,
  });
}
