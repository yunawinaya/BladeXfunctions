console.log("JN", arguments[0]);
const rowIndex = arguments[0].rowIndex;

const {
  material_desc,
  based_uom,
  purchase_unit_price,
  table_uom_conversion,
  mat_purchase_tax_id,
} = arguments[0].fieldModel.item;

this.setData({ [`table_po.${rowIndex}.item_desc`]: material_desc });

this.setData({ [`table_po.${rowIndex}.quantity_uom`]: based_uom });

this.setData({ [`table_po.${rowIndex}.unit_price`]: purchase_unit_price });

this.setData({ [`table_po.${rowIndex}.tax_preference`]: mat_purchase_tax_id });

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

  this.setOptionData([`table_po.${rowIndex}.quantity_uom`], uomOptions);
};

updateUomOption();

const taxPercent = arguments[0]?.fieldModel?.item?.purchase_tax_percent || null;

if (taxPercent) {
  db.collection("tax_rate_percent")
    .where({ id: taxPercent })
    .get()
    .then((resTAX) => {
      console.log("taxPercent", resTAX);

      this.setData({
        [`table_po.${rowIndex}.tax_rate_percent`]:
          resTAX.data[0].tax_rate_percent,
      });

      console.log("tax", resTAX.data[0].tax_rate_percent);
    });
}
