(async () => {
    const taxCode = this.getValue(`table_po.${arguments[0].rowIndex}.tax_preference`)

    const resTax = await db.collection("tax_rate_percent").where({"tax_code":taxCode}).get();

    if(resTax.data.length > 0){
        await this.setOptionData("table_po." +arguments[0].rowIndex+".tax_percent",resTax.data);
    }

})();