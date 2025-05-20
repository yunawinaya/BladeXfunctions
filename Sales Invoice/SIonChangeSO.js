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

    // Process data and create table entries, keeping SO structure
    const newTableSI = [];

    // Process each SO and maintain its structure
    allSOData.forEach((soData) => {
      const soItems = soData.table_so || [];

      soItems.forEach((soItem) => {
        const itemId = soItem.item_name;
        if (!itemId) return;

        // Use delivered_qty from table_so
        const deliveryQty = parseFloat(soItem.delivered_qty || 0);

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
    calculateTotals();
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
