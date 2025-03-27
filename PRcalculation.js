const data = this.getValues();
console.log("Data", data);
const items = data.table_pr;
let totalGross = 0;
let totalDiscount = 0;
let totalTax = 0;
let totalAmount = 0;
if (Array.isArray(items)) {
    items.forEach((item, index) => {
        // Ensure values are numeric
        const quantity = Number(item.pr_line_qty) || 0;
        const unitPrice = Number(item.pr_line_unit_price || 0);
        
        // Calculate gross for this specific item
        const grossValue = quantity * unitPrice;
        
        // Get discount, discountUOM, and tax info for this row
        const discount = Number(this.getValue(`table_pr.${index}.pr_line_discount`)) || 0;
        const discountUOM = this.getValue(`table_pr.${index}.pr_line_discount_uom`);
        const taxRate = Number(this.getValue(`table_pr.${index}.pr_line_taxes_percent`)) || 0;
        let taxInclusive = this.getValue(`table_pr.${index}.pr_tax_inclusive`);
        
        // Convert taxInclusive to a boolean value
        taxInclusive = (taxInclusive && taxInclusive.length > 0) || taxInclusive === 1;
        
        // Set gross value
        this.setData({
            [`table_pr.${index}.pr_line_gross`]: grossValue
        });
        item.pr_line_gross = grossValue;
        
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
                [`table_pr.${index}.pr_line_discount_amount`]: discountAmount
            });
            item.pr_line_discount_amount = discountAmount;
        }
        
        // Calculate amount after discount
        const amountAfterDiscount = grossValue - discountAmount;
        
        // Calculate tax amount based on taxInclusive flag using the correct logic
        let taxAmount = 0;
        let finalAmount = amountAfterDiscount;
        
        if (taxRate) {
            const taxRateDecimal = taxRate / 100;
            this.display('pr_total_tax_fee')
            
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
                [`table_pr.${index}.pr_line_tax_fee_amount`]: taxAmount
            });
            item.pr_line_tax_fee_amount = taxAmount;
        } else {
            this.hide("pr_total_tax_fee")
            this.setData({
                [`table_pr.${index}.pr_line_tax_fee_amount`]: 0
            });
            item.pr_line_tax_fee_amount = 0;
        }
        
        // Set final amount
        this.setData({
            [`table_pr.${index}.pr_line_amount`]: finalAmount
        });
        item.pr_line_amount = finalAmount;
        
        // Add to running totals
        totalGross += grossValue;
        totalDiscount += discountAmount;
        totalTax += taxAmount;
        totalAmount += finalAmount;
    });
    
    // Set the total fields
    this.setData({
        'pr_sub_total': totalGross,
        'pr_discount_total': totalDiscount,
        'pr_total_tax_fee': totalTax,
        'pr_total_price': totalAmount
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