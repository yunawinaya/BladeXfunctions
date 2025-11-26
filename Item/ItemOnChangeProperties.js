(async () => {
  try {
    const value = arguments[0]?.value;
    console.log(value);
    if (value) {
      switch (value) {
        case "Packaging Material":
          await this.setData({
            business_scope: ["Purchase", "Sales"],
          });
          break;
        case "Work in Progress":
          await this.setData({
            business_scope: ["Production"],
          });
          break;
        case "Raw Material":
          await this.setData({
            business_scope: ["Purchase", "Production"],
          });
          break;
        case "Semi-Finished Goods":
          await this.setData({
            business_scope: ["Sales", "Production"],
          });
          break;
        case "Product":
          await this.setData({
            business_scope: ["Sales"],
          });
          break;
        default:
          break;
      }
    } else {
      await this.setData({
        business_scope: [],
      });
    }
  } catch (error) {
    console.log(error);
  }
})();
