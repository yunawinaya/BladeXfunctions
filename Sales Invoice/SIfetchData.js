const data = this.getValues();
const salesOrderId = data.so_id;
console.log("Sales Order ID:", salesOrderId);

// Helper function to extract data from different response formats
function extractData(result) {
  if (Array.isArray(result) && result.length > 0) {
    return result[0];
  } else if (typeof result === "object" && result !== null) {
    if (result.data) {
      return Array.isArray(result.data) && result.data.length > 0
        ? result.data[0]
        : result.data;
    } else if (
      result.docs &&
      Array.isArray(result.docs) &&
      result.docs.length > 0
    ) {
      return result.docs[0].data ? result.docs[0].data() : result.docs[0];
    }
    return result;
  }
  return null;
}

// Helper function to calculate discount amount
function calculateDiscount(grossValue, discount, discountUOM) {
  if (!discount || discount === 0 || !discountUOM) {
    return 0;
  }

  let discountAmount = 0;
  if (discountUOM === "Amount") {
    discountAmount = discount;
  } else if (discountUOM === "%") {
    discountAmount = (grossValue * discount) / 100;
  }

  // Cap discount at gross value
  return Math.min(discountAmount, grossValue);
}

// Helper function to calculate tax
function calculateTax(amountAfterDiscount, taxRate, taxInclusive) {
  if (!taxRate) {
    return {
      taxAmount: 0,
      finalAmount: amountAfterDiscount,
    };
  }

  const taxRateDecimal = taxRate / 100;
  let taxAmount = 0;
  let finalAmount = amountAfterDiscount;

  if (taxInclusive === 1) {
    // Tax inclusive calculation
    taxAmount =
      amountAfterDiscount - amountAfterDiscount / (1 + taxRateDecimal);
    finalAmount = amountAfterDiscount;
  } else {
    // Tax exclusive calculation
    taxAmount = amountAfterDiscount * taxRateDecimal;
    finalAmount = amountAfterDiscount + taxAmount;
  }

  return {
    taxAmount: parseFloat(taxAmount.toFixed(2)),
    finalAmount: parseFloat(finalAmount.toFixed(2)),
  };
}

// Get GD numbers from arguments
const gdNumbers = arguments[0].value;
console.log("GD Numbers:", gdNumbers);

// Check if gdNumbers is empty or invalid before proceeding
if (!gdNumbers || (Array.isArray(gdNumbers) && gdNumbers.length === 0)) {
  this.setData({ table_si: [] });
  console.log("GD numbers is empty, skipping processing");
  return; // Exit early if gdNumbers is empty
}

// Display GD Numbers for user reference
Promise.all(
  gdNumbers.map((gdId) =>
    db
      .collection("goods_delivery")
      .doc(gdId) // Direct document reference
      .get()
      .then((doc) => (doc ? doc.data[0].delivery_no : null))
  )
).then((results) => {
  const displayText = results.filter(Boolean).join(", ");
  console.log("gd", results);
  this.setData({ gd_no_display: displayText });
});

// Main processing
const processSalesInvoice = async () => {
  try {
    // Fetch Sales Order data
    const soResult = await db
      .collection("sales_order")
      .where({
        id: salesOrderId,
      })
      .get();

    const SOData = extractData(soResult);
    console.log("Extracted Sales Order data:", SOData);

    if (!SOData) {
      console.error("No valid Sales Order data found");
      return;
    }

    // Additional validation check to make sure gdNumbers is an array
    if (!Array.isArray(gdNumbers)) {
      console.error("GD numbers is not an array:", gdNumbers);
      return;
    }

    // Fetch all Goods Delivery data
    const gdPromises = gdNumbers.map(async (gdNumber) => {
      try {
        const gdResult = await db
          .collection("goods_delivery")
          .where({
            id: gdNumber,
          })
          .get();

        const gdData = extractData(gdResult);
        console.log(`Extracted GD data for ${gdNumber}:`, gdData);
        return gdData;
      } catch (error) {
        console.error(`Error retrieving data for GD ${gdNumber}:`, error);
        return null;
      }
    });

    const allGDData = (await Promise.all(gdPromises)).filter(Boolean);
    console.log("All GD data:", allGDData);

    // Additional check to ensure we have GD data to process
    if (allGDData.length === 0) {
      console.log("No valid GD data found, skipping further processing");
      return;
    }

    // Process data and create item map
    const itemMap = {};

    // Process SO data first
    const soItems = SOData.table_so || SOData.items || [];
    if (Array.isArray(soItems)) {
      soItems.forEach((soItem) => {
        console.log("Processing SO item:", soItem);
        const itemId = soItem.item_name;
        if (itemId) {
          itemMap[itemId] = {
            item_id: itemId,
            item_desc: soItem.so_desc || "",
            item_uom: soItem.so_item_uom,
            ordered_qty: soItem.so_quantity,
            unit_price: soItem.so_item_price,
            amount: soItem.so_amount,
            discount: soItem.so_discount,
            discount_uom: soItem.so_discount_uom,
            tax_rate: soItem.so_tax_percentage,
            tax_preference: soItem.so_tax_preference,
            tax_inclusive: soItem.so_tax_inclusive,
            delivery_qty: 0,
          };
          console.log(`Added SO item ${itemId} to map:`, itemMap[itemId]);
        }
      });
    }

    // Then process GD data to update received quantities
    allGDData.forEach((gdRecord) => {
      console.log("Processing GD record, table_gd:", gdRecord.table_gd);

      if (gdRecord && Array.isArray(gdRecord.table_gd)) {
        gdRecord.table_gd.forEach((item) => {
          console.log("Processing GD item:", item);
          const itemId = item.material_id;

          if (!itemId) {
            return;
          }

          if (!itemMap[itemId]) {
            // If item wasn't in SO data, initialize with default values
            itemMap[itemId] = {
              item_id: itemId,
              item_desc: item.material_desc || "",
              item_uom: item.gd_uom_id || "",
              ordered_qty: 0,
              unit_price: 0,
              amount: 0,
              discount: 0,
              discount_uom: "%",
              tax_rate: 0,
              tax_preference: "",
              tax_inclusive: 0,
              delivery_qty: 0,
            };
            console.log(
              `Created new item ${itemId} from GD data:`,
              itemMap[itemId]
            );
          }

          const deliveryQty = parseFloat(item.gd_qty) || 0;
          itemMap[itemId].delivery_qty += deliveryQty;
          console.log(
            `Updated delivery qty for ${itemId} to ${itemMap[itemId].delivery_qty}`
          );
        });
      }
    });

    const consolidatedItems = Object.values(itemMap);
    console.log("Consolidated items:", consolidatedItems);

    const newTableSI = consolidatedItems.map((item) => ({
      material_id: item.item_id,
      material_desc: item.item_desc,
      so_order_quantity: item.ordered_qty,
      so_order_uom_id: item.item_uom,
      good_delivery_quantity: item.delivery_qty,
      unit_price: item.unit_price,
      si_discount: item.discount,
      si_discount_uom_id: item.discount_uom,
      si_tax_rate_id: item.tax_preference,
      tax_rate_percent: item.tax_rate,
      si_tax_inclusive: item.tax_inclusive,
      invoice_qty: item.delivery_qty,
      invoice_qty_uom_id: item.item_uom,
    }));

    console.log("Final table_si data:", newTableSI);
    await this.setData({
      table_si: newTableSI,
    });

    // Calculate totals after setting table_si
    await calculateTotals();
  } catch (error) {
    console.error("Error in processSalesInvoice:", error);
  }
};

// Function to calculate totals
const calculateTotals = () => {
  const items = this.getValues().table_si;
  const exchangeRate = data.exchange_rate;
  let totalGross = 0;
  let totalDiscount = 0;
  let totalTax = 0;
  let totalAmount = 0;

  if (Array.isArray(items)) {
    items.forEach((item, index) => {
      const quantity = Number(item.invoice_qty) || 0;
      const unitPrice = parseFloat(item.unit_price) || 0;
      const grossValue = quantity * unitPrice;

      totalGross += grossValue;

      this.setData({
        [`table_si.${index}.gross`]: grossValue,
        [`table_si.${index}.si_amount`]: grossValue,
        invoice_subtotal: totalGross,
      });

      // Calculate discount
      const discount = parseFloat(item.si_discount) || 0;
      const discountUOM = item.si_discount_uom_id;
      const discountAmount = calculateDiscount(
        grossValue,
        discount,
        discountUOM
      );

      if (discountAmount > 0) {
        this.setData({
          [`table_si.${index}.discount_amount`]: parseFloat(
            discountAmount.toFixed(2)
          ),
        });
      } else {
        this.setData({
          [`table_si.${index}.discount_amount`]: 0,
        });
      }

      const amountAfterDiscount = grossValue - discountAmount;

      // Calculate tax
      const taxRate = Number(item.tax_rate_percent) || 0;
      const taxInclusive = item.si_tax_inclusive;
      const { taxAmount, finalAmount } = calculateTax(
        amountAfterDiscount,
        taxRate,
        taxInclusive
      );

      // Set tax amount
      this.setData({
        [`table_si.${index}.tax_amount`]: taxAmount,
      });

      // Set final amount
      this.setData({
        [`table_si.${index}.si_amount`]: finalAmount,
      });

      totalDiscount += discountAmount;
      totalTax += taxAmount;
      totalAmount += finalAmount;
    });

    if (totalTax > 0) {
      this.display(["invoice_taxes_amount", "total_tax_currency"]);
    }

    this.setData({
      invoice_total_discount: parseFloat(totalDiscount.toFixed(2)),
      invoice_taxes_amount: parseFloat(totalTax.toFixed(2)),
      invoice_total: parseFloat(totalAmount.toFixed(2)),
    });

    if (exchangeRate) {
      this.setData({
        myr_total_amount: exchangeRate * parseFloat(totalAmount.toFixed(2)),
      });
    }
  } else {
    console.log("Not an array:", items);
  }
};

// Start the main process
processSalesInvoice();
