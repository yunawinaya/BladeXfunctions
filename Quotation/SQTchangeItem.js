const rowIndex = arguments[0].rowIndex;

const {
  material_desc,
  based_uom,
  sales_unit_price,
  table_uom_conversion,
  mat_sales_tax_id,
} = arguments[0].fieldModel.item;

this.setData({ [`table_sqt.${rowIndex}.sqt_desc`]: material_desc });

this.setData({ [`table_sqt.${rowIndex}.sqt_order_uom_id`]: based_uom });

this.setData({ [`table_sqt.${rowIndex}.unit_price`]: sales_unit_price });

console.log("mat_sales_tax_id JN", mat_sales_tax_id);
if (mat_sales_tax_id) {
  this.setData({
    [`table_sqt.${rowIndex}.sqt_taxes_rate_id`]: mat_sales_tax_id,
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

  this.setOptionData([`table_sqt.${rowIndex}.sqt_order_uom_id`], uomOptions);
};

updateUomOption();

const taxPercent = arguments[0]?.fieldModel?.item?.sales_tax_percent || null;

if (taxPercent) {
  this.setData({
    [`table_sqt.${rowIndex}.sqt_tax_rate_percent`]: taxPercent,
  });
}
