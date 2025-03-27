const data = this.getValues();
console.log("Data", data);
const items = data.table_pi;
let totalGross = 0;
let totalDiscount = 0;
let totalTax = 0;
let totalAmount = 0;

if (Array.isArray(items)) {
    items.forEach((item, index) => {
        // Calculate gross for this specific item
        const invoiceQty = parseFloat(item.invoice_qty || 0);
        const unitPrice = parseFloat(item.order_unit_price || 0);
        const grossValue = invoiceQty * unitPrice;
        
        // Get discount, discountUOM, and tax info for this row
        const discount = parseFloat(item.order_discount || 0);
        const discountUOM = item.discount_uom;
        const taxRate = parseFloat(item.inv_tax_rate_id || 0);
        let taxInclusive = item.tax_inclusive;
        
        // Convert taxInclusive to a boolean or number value
        taxInclusive = (taxInclusive && taxInclusive.length > 0) || taxInclusive === 1;
        
        // Set gross value
        this.setData({
            [`table_pi.${index}.order_gross`]: grossValue
        });
        item.gross = grossValue;
        
        // Calculate discount amount
        let discountAmount = 0;
        if (discount) {
            if (discountUOM === '1901807898758074370') {
                discountAmount = discount;
            } else {
                discountAmount = grossValue * discount / 100;
            }
            
            // Set discount amount
            this.setData({
                [`table_pi.${index}.discount_amount`]: discountAmount
            });
            item.discount_amount = discountAmount;
        }
        
        // Calculate amount after discount
        const amountAfterDiscount = grossValue - discountAmount;
        
        // Calculate tax amount based on taxInclusive flag using the correct logic
        let taxAmount = 0;
        let finalAmount = amountAfterDiscount;
        
        if (taxRate) {
            const taxRateDecimal = taxRate / 100;
            this.display('invoice_taxes_amount')
            
            if (taxInclusive) {
                // Tax inclusive calculation
                taxAmount = amountAfterDiscount - (amountAfterDiscount / (1 + taxRateDecimal));
                finalAmount = amountAfterDiscount; // The gross already includes tax
            } else {
                // Tax exclusive calculation
                taxAmount = amountAfterDiscount * taxRateDecimal;
                finalAmount = amountAfterDiscount + taxAmount;
            }
            
            // Set tax amount
            this.setData({
                [`table_pi.${index}.tax_amount`]: taxAmount
            });
            item.tax_amount = taxAmount;
        } else {
            // No tax rate
            this.hide('invoice_taxes_amount')
            this.setData({
                [`table_pi.${index}.tax_amount`]: 0
            });
            item.tax_amount = 0;
        }
        
        // Set final amount
        this.setData({
            [`table_pi.${index}.invoice_amount`]: finalAmount
        });
        item.total_amount = finalAmount;
        
        // Add to running totals
        totalGross += grossValue;
        totalDiscount += discountAmount;
        totalTax += taxAmount;
        totalAmount += finalAmount;
    });
    
    // Set the total fields - updated field names for PI
    this.setData({
        'invoice_subtotal': totalGross,
        'invoice_total_discount': totalDiscount,
        'invoice_taxes_amount': totalTax,
        'invoice_total': totalAmount
    });
    
    console.log("Updated items with calculations:", items);
    console.log("Totals calculated:", {
        totalGross,
        totalDiscount,
        totalTax,
        totalAmount
    });
    
    const updatedData = this.getValues();
    console.log("Form data after update:", updatedData);
    
    return items;
} else {
    console.log("Not an array:", items);
    return items;
}