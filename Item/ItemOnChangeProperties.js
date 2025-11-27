(async () => {
  try {
    const value = arguments[0]?.value;
    console.log(value);
    if (value) {
      switch (value) {
        case "Packaging Material":
          await this.setData({
            business_scope: ["2", "1"],
          });
          break;
        case "Work in Progress":
          await this.setData({
            business_scope: ["3"],
          });
          break;
        case "Raw Material":
          await this.setData({
            business_scope: ["2", "3"],
          });
          break;
        case "Semi-Finished Goods":
          await this.setData({
            business_scope: ["1", "3"],
          });
          break;
        case "Product":
          await this.setData({
            business_scope: ["1"],
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
