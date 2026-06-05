const overwriteData = async (itemPriceData, rowIndex) => {
  await this.setData({
    [`table_so.${rowIndex}.so_item_price`]: itemPriceData.cust_price_unit_price,
    [`table_so.${rowIndex}.so_discount`]: itemPriceData.cust_price_discount,
    [`table_so.${rowIndex}.so_discount_uom`]:
      itemPriceData.cust_price_discount_type,
    [`table_so.${rowIndex}.so_tax_preference`]: itemPriceData.cust_price_tax,
    [`table_so.${rowIndex}.so_tax_percentage`]:
      itemPriceData.cust_price_tax_percent,
    [`table_so.${rowIndex}.min_price`]: itemPriceData.cust_price_min_price,
    [`table_so.${rowIndex}.max_price`]: itemPriceData.cust_price_max_price,
  });

  //wzp 0528修改
  let Row = arguments[0];
  Row.row = this.getValue(`table_so.${rowIndex}`);

  await this.triggerEvent("SOCalculation", Row);
};

const setMinMaxPriceData = (itemPriceData, rowIndex) => {
  this.setData({
    [`table_so.${rowIndex}.min_price`]: itemPriceData.cust_price_min_price,
    [`table_so.${rowIndex}.max_price`]: itemPriceData.cust_price_max_price,
  });
};

const getLocalDate = () => {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60000;
  const localTime = new Date(now.getTime() - timezoneOffset);
  return localTime.toISOString().slice(0, 19).replace("T", " ");
};

(async () => {
  const itemID = arguments[0].row.item_name;
  const rowIndex = arguments[0].rowIndex;
  const quantity = arguments[0].value;
  const customerID = this.getValue("customer_name") ?? null;
  const uomID = arguments[0].row.so_item_uom;
  let priceTagID = "";
  const overwrite = arguments[0].overwrite ?? "From Item";
  const currentDate = await getLocalDate();

  console.log("arguments[0]", arguments[0]);
  console.log("currentDate", currentDate);

  // Recompute packing quantity from the packing_conversion already stored on
  // the line by SOonChangeUOM (no Item fetch needed here): packing_qty =
  // so_quantity / packing_conversion.
  const packingConversion = this.getValue(
    `table_so.${rowIndex}.packing_conversion`,
  );
  if (packingConversion && Number(packingConversion) > 0) {
    const packingQty =
      Math.round((quantity / Number(packingConversion)) * 1000) / 1000;
    this.setData({ [`table_so.${rowIndex}.packing_qty`]: packingQty });
  }

  // Recompute net weight from the weight_conversion (per-unit weight in the
  // SO's UOM) already stored on the line by SOonChangeUOM: net_weight =
  // so_quantity * weight_conversion.
  const weightConversion = this.getValue(
    `table_so.${rowIndex}.weight_conversion`,
  );
  if (
    weightConversion !== undefined &&
    weightConversion !== null &&
    weightConversion !== ""
  ) {
    const netWeight =
      Math.round(quantity * Number(weightConversion) * 1000) / 1000;
    this.setData({ [`table_so.${rowIndex}.net_weight`]: netWeight });
  }

  if (customerID) {
    const resCustomer = await db
      .collection("Customer")
      .field("price_tag_id")
      .doc(customerID)
      .get();

    if (resCustomer && resCustomer.data.length > 0) {
      priceTagID = resCustomer.data[0].price_tag_id;
    }

    const priceTagFilter = new Filter("all")
      .orGroup((idGroup) =>
        idGroup
          .numberEqual("cust_price_tag_id", priceTagID)
          .numberEqual("customer_id", customerID),
      )
      .orGroup((date) =>
        date
          .andGroup((dateRange) =>
            dateRange
              .isNull("cust_price_date_from")
              .isNull("cust_price_date_to"),
          )
          .andGroup((dateRange) =>
            dateRange
              .lessThan("cust_price_date_from", currentDate)
              .isNull("cust_price_date_to"),
          )
          .andGroup((dateRange) =>
            dateRange
              .isNull("cust_price_date_from")
              .greaterThan("cust_price_date_to", currentDate),
          )
          .andGroup((dateRange) =>
            dateRange
              .lessThan("cust_price_date_from", currentDate)
              .greaterThan("cust_price_date_to", currentDate),
          ),
      )
      .numberEqual("Item_id", itemID)
      .numberEqual("cust_price_uom", uomID)
      .andGroup((qty) =>
        qty
          .orGroup((minQty) =>
            minQty
              .lessThanInclusive("cust_min_order_qty", quantity)
              .numberEqual("cust_min_order_qty", 0),
          )
          .orGroup((maxQty) =>
            maxQty
              .greaterThanInclusive("cust_max_order_qty", quantity)
              .numberEqual("cust_max_order_qty", 0),
          ),
      )
      .build();

    const resItemPrice = await db
      .collection("item_i9q0d8uj_sub")
      .filter(priceTagFilter)
      .get();

    console.log("resItemPrice", resItemPrice);

    if (resItemPrice && resItemPrice.data.length > 0) {
      const itemPriceData =
        resItemPrice.data.find(
          (itemPrice) => itemPrice.customer_id === customerID,
        ) || resItemPrice.data[0];
      const tableSO = this.getValue("table_so");
      if (
        tableSO[rowIndex].so_item_price !==
          itemPriceData.cust_price_unit_price ||
        tableSO[rowIndex].so_discount !== itemPriceData.cust_price_discount ||
        tableSO[rowIndex].so_discount_uom !==
          itemPriceData.cust_price_discount_type ||
        tableSO[rowIndex].so_tax_preference !== itemPriceData.cust_price_tax ||
        tableSO[rowIndex].so_tax_percentage !==
          itemPriceData.cust_price_tax_percent
      ) {
        if (overwrite === "From Item") {
          await this.$confirm(
            "Multipricing found for this item. Do you want to use it?",
            "Confirmation",
            {
              confirmButtonText: "Overwrite",
              cancelButtonText: "Keep",
              dangerouslyUseHTMLString: true,
              type: "info",
              distinguishCancelAndClose: true,

              beforeClose: async (action, instance, done) => {
                if (action === "confirm") {
                  await overwriteData(itemPriceData, rowIndex);
                  done();
                } else if (action === "cancel") {
                  done();
                } else {
                  done();
                }
              },
            },
          );
        } else if (overwrite === "Yes - from customer change") {
          await overwriteData(itemPriceData, rowIndex);
        } else if (overwrite === "No - from customer change") {
          await setMinMaxPriceData(itemPriceData, rowIndex);
        }
      }
    } else {
      await setMinMaxPriceData(
        { cust_price_max_price: 0, cust_price_min_price: 0 },
        rowIndex,
      );
    }
  }
})();
