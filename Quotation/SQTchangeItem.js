const rowIndex = arguments[0]?.rowIndex;

// Set the description value
this.setData({
  [`table_sqt.${rowIndex}.sqt_desc`]:
    arguments[0].fieldModel.item.material_desc,
});

// Extract UOM data from the field model
const { table_uom_conversion, based_uom } = arguments[0].fieldModel.item;

// Collect all UOMs
const altUoms = table_uom_conversion.map((data) => data.alt_uom_id);
altUoms.push(based_uom);

const uomOptions = [];

const processData = async () => {
  for (let i = 0; i < altUoms.length; i++) {
    const res = await db
      .collection("unit_of_measurement")
      .where({ id: altUoms[i] })
      .get();
    if (res.data && res.data[0]) {
      uomOptions.push({
        value: res.data[0].id,
        label: res.data[0].uom_name,
      });
    }
  }
};

const updateUomOption = async () => {
  await processData();

  await this.setOptionData(
    [`table_sqt.${rowIndex}.sqt_order_uom_id`],
    uomOptions
  );
  // for (let i = 0; i < uomOptions.length; i++) {
  //   if (uomOptions[i].value === based_uom) {
  //     await this.setData({
  //       [`table_sqt.${rowIndex}.sqt_order_uom_id`]: uomOptions[i].value,
  //     });
  //   }
  // }
};

updateUomOption();
