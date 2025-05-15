const rowIndex = arguments[0].rowIndex;
const {
  material_desc,
  based_uom,
  purchase_default_uom,
  purchase_unit_price,
  table_uom_conversion,
  mat_purchase_tax_id,
} = arguments[0].fieldModel.item;
const altUoms = table_uom_conversion.map((data) => data.alt_uom_id);
const uomOptions = [];
const taxPercent = arguments[0]?.fieldModel?.item?.purchase_tax_percent || null;

this.setData({
  [`table_pr.${rowIndex}.pr_line_material_desc`]: material_desc,
  [`table_pr.${rowIndex}.pr_line_unit_price`]: purchase_unit_price,
  [`table_pr.${rowIndex}.pr_line_tax_rate_id`]: mat_purchase_tax_id,
});

if (purchase_default_uom) {
  this.setData({
    [`table_pr.${rowIndex}.pr_line_uom_id`]: purchase_default_uom,
  });
} else {
  this.setData({
    [`table_pr.${rowIndex}.pr_line_uom_id`]: based_uom,
  });
}

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

  this.setOptionData([`table_pr.${rowIndex}.pr_line_uom_id`], uomOptions);
};

updateUomOption();

if (taxPercent) {
  setTimeout(() => {
    this.setData({
      [`table_pr.${rowIndex}.pr_line_taxes_percent`]: taxPercent,
    });
  }, 1000);
}
