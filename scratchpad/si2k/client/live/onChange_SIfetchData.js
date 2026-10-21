(async () => {
    const data = this.getValues();
    this.setData({
        'table_si': []
    });

    const salesOrderId = data.so_id;
    const goodsDeliveryId = data.goods_delivery_number;
    if (salesOrderId.length === 0 || goodsDeliveryId.length === 0) {

        if(salesOrderId.length === 0) {
             this.setData({
                invoice_subtotal: 0,
                invoice_total_discount: 0,
                invoice_taxes_amount: 0,
                invoice_total: 0,
                myr_total_amount: 0,
            });
        } 
        return;
    }

    try {
        console.log("Sales Order ID:", salesOrderId);

        const resSO = await Promise.all(
            salesOrderId.map(soId => db.collection('sales_order').doc(soId).get())
        );

        const resGD = await Promise.all(
            goodsDeliveryId.map(gdId => db.collection('goods_delivery').doc(gdId).get())
        );

        const soData = resSO.map(response => response.data[0]);
        const gdData = resGD.map(response => response.data[0]);
        console.log('Sales order data:', soData);
        
        const displayText = gdData
                    .map(gd => gd?.delivery_no)
                    .filter(Boolean)
                    .join(', ');

        this.setData({'gd_no_display': displayText});
        
        // Create a single array for all line items across all POs
        const itemMapByIndex = [];;

        let soLineItem = [];

        for(const so of soData) {
            const filteredSO = so.table_so.filter((soItem) => soItem.item_name !== '' || soItem.so_desc !== '')
            soLineItem.push(...filteredSO);
        }

        console.log('soLineItem', soLineItem)

        // Process each GR
        for (const gd of gdData) {
            const gdLineItemData = gd.table_gd || [];
            console.log('gdLineItemData for GD:', gd.gd_no, gdLineItemData);

            // Process each line item
            if (gdLineItemData.length > 0) {
                gdLineItemData.forEach((gdItem, lineItemIndex) => {
                    const currentSO = soData.find(so => so.id === gdItem.line_so_id)
                    console.log("currentSO:", currentSO);
                    console.log("Processing GD item:", gdItem);

                    if(!itemMapByIndex[lineItemIndex]) {
                        itemMapByIndex[lineItemIndex] = {
                            line_so_no: gdItem.line_so_no,
                            line_so_id: gdItem.line_so_id,
                            material_id: gdItem.material_id || '',
                            material_name: gdItem.material_name || '',
                            material_desc: gdItem.gd_material_desc || "",
                            so_order_quantity: gdItem.gd_order_quantity,
                            so_order_uom_id: soLineItem[lineItemIndex].so_item_uom,

                            more_desc: gdItem.more_desc || "",
                            line_remark_1: gdItem.line_remark_1 || "",
                            line_remark_2: gdItem.line_remark_2 || "",

                            good_delivery_quantity: 0,
                            invoice_qty: 0,
                            invoice_qty_uom_id: soLineItem[lineItemIndex].so_item_uom,
                            unit_price: soLineItem[lineItemIndex].so_item_price,
                            si_discount: soLineItem[lineItemIndex].so_discount,
                            si_discount_uom_id: soLineItem[lineItemIndex].so_discount_uom,
                            tax_rate_percent: soLineItem[lineItemIndex].so_tax_percentage,
                            si_tax_rate_id: soLineItem[lineItemIndex].so_tax_preference,
                            si_tax_inclusive: soLineItem[lineItemIndex].so_tax_inclusive,
                        };

                    }

                    itemMapByIndex[lineItemIndex].good_delivery_quantity += gdItem.gd_qty || 0;
                    itemMapByIndex[lineItemIndex].invoice_qty = itemMapByIndex[lineItemIndex].good_delivery_quantity;

                });
            }
        }


        // Set the data after processing all POs
        if (itemMapByIndex.length > 0) {
            await this.setData({'table_si': itemMapByIndex});

            setTimeout(() => {
                itemMapByIndex.forEach((item, lineItemIndex) => {
                    if (item.tax_rate_percent && item.tax_rate_percent >= 0) {
                        this.disabled([`table_si.${lineItemIndex}.tax_rate_percent`], false);
                    }
                });
            }, 1000);

            this.triggerEvent('SIcalculation', { SIlineItem: itemMapByIndex });
        }
    } catch (error) {
        this.$message.error(error.toString());
    }
})();
