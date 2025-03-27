const data = this.getValues();
console.log("Data", data);
const items = data.table_po;
let totalGross = 0;
let totalDiscount = 0;
let totalTax = 0;
let totalAmount = 0;

if (Array.isArray(items)) {
    items.forEach((item, index) => {
        // Ensure values are numeric
        const quantity = Number(item.quantity) || 0;
        const unitPrice = Number(item.unit_price) || 0;
        
        // Calculate gross for this specific item
        const grossValue = quantity * unitPrice;
        
        // Get discount, discountUOM, and tax info for this row
        const discount = Number(this.getValue(`table_po.${index}.discount`)) || 0;
        const discountUOM = this.getValue(`table_po.${index}.discount_uom`);
        const taxRate = Number(this.getValue(`table_po.${index}.tax_rate`)) || 0;
        let taxInclusive = this.getValue(`table_po.${index}.tax_inclusive`);
        
        // Convert taxInclusive to a boolean or number value
        taxInclusive = (taxInclusive && taxInclusive.length > 0) || taxInclusive === 1;
        
        // Set gross value
        this.setData({
            [`table_po.${index}.gross`]: grossValue
        });
        item.gross = grossValue;
        
        // Calculate discount amount
        let discountAmount = 0;
        if (discount) {
            if (discountUOM === '1901807898758074370') { // "Amount" discount type
                discountAmount = discount;
            } else {
                discountAmount = grossValue * discount / 100;
            }
            
            // Set discount amount
            this.setData({
                [`table_po.${index}.discount_amount`]: discountAmount
            });
            item.discount_amount = discountAmount;
        }
        
        // Calculate amount after discount
        const amountAfterDiscount = grossValue - discountAmount;
        
        // Calculate tax amount based on taxInclusive flag - using the logic from the second example
        let taxAmount = 0;
        let finalAmount = amountAfterDiscount;
        
        if (taxRate) {
            const taxRateDecimal = taxRate / 100;
            
            if (taxInclusive) {
                // Tax inclusive calculation (like in the second example)
                taxAmount = amountAfterDiscount - (amountAfterDiscount / (1 + taxRateDecimal));
                finalAmount = amountAfterDiscount; // The gross already includes tax
            } else {
                // Tax exclusive calculation
                taxAmount = amountAfterDiscount * taxRateDecimal;
                finalAmount = amountAfterDiscount + taxAmount;
            }
            
            // Set tax amount
            this.setData({
                [`table_po.${index}.tax_amount`]: taxAmount
            });
            item.tax_amount = taxAmount;
        } else {
            this.setData({
                [`table_po.${index}.tax_amount`]: 0
            });
            item.tax_amount = 0;
        }
        
        // Set final amount
        this.setData({
            [`table_po.${index}.po_amount`]: finalAmount
        });
        item.po_amount = finalAmount;
        
        // Add to running totals
        totalGross += grossValue;
        totalDiscount += discountAmount;
        totalTax += taxAmount;
        totalAmount += finalAmount;
    });
    
    // Set the total fields
    this.setData({
        'po_total_gross': totalGross,
        'po_total_discount': totalDiscount,
        'po_total_tax': totalTax,
        'po_total': totalAmount
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