const data = this.getValues();
const salesOrderIds = Array.isArray(data.so_id) ? data.so_id : [data.so_id];
console.log("Sales Order IDs:", salesOrderIds);

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
    // Fetch Sales Order data for all sales order IDs
    const soPromises = salesOrderIds.map(async (soId) => {
      try {
        const soResult = await db
          .collection("sales_order")
          .where({
            id: soId,
          })
          .get();

        const soData = extractData(soResult);
        console.log(`Extracted Sales Order data for ${soId}:`, soData);
        return soData;
      } catch (error) {
        console.error(`Error retrieving data for SO ${soId}:`, error);
        return null;
      }
    });

    const allSOData = (await Promise.all(soPromises)).filter(Boolean);
    console.log("All SO data:", allSOData);

    // Additional check to ensure we have SO data to process
    if (allSOData.length === 0) {
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

    // Create a map of material IDs from all SOs to validate GD items
    const validItems = new Set();
    allSOData.forEach((soData) => {
      const soItems = soData.table_so || [];
      soItems.forEach((item) => {
        if (item.item_name) {
          validItems.add(item.item_name);
        }
      });
    });

    // Validate that GD items match SO items
    let allGDItemsValid = true;
    allGDData.forEach((gdData) => {
      const gdItems = gdData.table_gd || [];
      gdItems.forEach((item) => {
        if (item.material_id && !validItems.has(item.material_id)) {
          console.warn(`GD item ${item.material_id} is not in any Sales Order`);
          allGDItemsValid = false;
        }
      });
    });

    if (!allGDItemsValid) {
      console.warn(
        "Some GD items do not match any SO items. Proceeding with caution."
      );
      // You can decide whether to stop processing here or continue
      // For now, we'll continue but you might want to add logic to stop if needed
    }

    // Process data and create table entries, keeping SO structure
    const newTableSI = [];

    // Create delivery quantity map from all GDs
    const deliveryQtyMap = {};
    allGDData.forEach((gdData) => {
      const gdItems = gdData.table_gd || [];
      gdItems.forEach((item) => {
        if (item.material_id) {
          if (!deliveryQtyMap[item.material_id]) {
            deliveryQtyMap[item.material_id] = 0;
          }
          deliveryQtyMap[item.material_id] += parseFloat(item.gd_qty) || 0;
        }
      });
    });

    // Process each SO and maintain its structure
    allSOData.forEach((soData) => {
      const soItems = soData.table_so || [];

      soItems.forEach((soItem) => {
        const itemId = soItem.item_name;
        if (!itemId) return;

        // Get delivery quantity from our map
        const deliveryQty = deliveryQtyMap[itemId] || 0;

        // Create entry for this SO item
        newTableSI.push({
          line_so_id: soData.id || "",
          line_so_no: soData.so_no || "",
          material_id: itemId,
          material_desc: soItem.so_desc || "",
          so_order_quantity: parseFloat(soItem.so_quantity) || 0,
          so_order_uom_id: soItem.so_item_uom,
          good_delivery_quantity: deliveryQty,
          unit_price: soItem.so_item_price,
          si_discount: soItem.so_discount,
          si_discount_uom_id: soItem.so_discount_uom,
          si_tax_rate_id: soItem.so_tax_preference,
          tax_rate_percent: soItem.so_tax_percentage,
          si_tax_inclusive: soItem.so_tax_inclusive,
          invoice_qty: deliveryQty,
          invoice_qty_uom_id: soItem.so_item_uom,
        });
      });
    });

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
