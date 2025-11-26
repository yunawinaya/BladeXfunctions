//WF Update Trigger Date : 1912705705033662466

// Trigger Workflow on Workflow Supplier Update
const updateWorkflow = [
  // { doc: "FETCH AGENT", id: "1912705705033662466" },
  // { doc: "FETCH AREA", id: "1912705705033662466" },
  // { doc: "FETCH PAYMENT TERM", id: "1912705705033662466" },
  { doc: "FETCH CURRENCY", id: "1912705705033662466" },
  { doc: "FETCH TAX", id: "1912705705033662466" },
  { doc: "FETCH TARIFF", id: "1912705705033662466" },
  { doc: "FETCH STOCK GROUP", id: "1912705705033662466" },
  { doc: "FETCH UOM", id: "1912705705033662466" },
  { doc: "FETCH ITEM", id: "1912705705033662466" },
];
const workflow = [
  // { name: "AGENT", id: "1902564270542012418" },
  // { name: "AREA", id: "1902564328364687362" },
  // { name: "PAYMENT", id: "1902564684507234306" },
  { name: "CURRENCY", id: "1902564762772946945" },
  { name: "TAX", id: "1902564973234733057" },
  { name: "TARIFF", id: "1902565114406617090" },
  { name: "STOCKGROUP", id: "1902565902747025410" },
  { name: "UOM", id: "1905177386436071425" },
  { name: "ITEM", id: "1902567364206116865" },
];

let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}

const getDate = async () => {
  return db
    .collection("sql_config")
    .where({ organization_id: organizationId })
    .get()
    .then((res) => {
      queries = res.data[0].queries;
      // Ensure configs is an array
      const configArray = Array.isArray(queries) ? queries : [queries];
      let query = {
        is_triggered: true,
        time_left: 0,
      };

      for (const configData of configArray) {
        if (configData.name === "FETCH ITEM") {
          if (configData.last_triggered_at === undefined) {
            configData.last_triggered_at = new Date().setMinutes(
              new Date().getMinutes() - 15
            );
          }
          const lastTriggered = configData.last_triggered_at
            ? new Date(configData.last_triggered_at)
            : date;
          const currentDate = new Date();
          console.log(lastTriggered);
          console.log(currentDate);
          lastTriggered.setMinutes(lastTriggered.getMinutes() + 5);
          if (lastTriggered < currentDate) {
            query.is_triggered = false;
            query.time_left = 0;
          } else {
            query.is_triggered = true;
            query.time_left = lastTriggered.getTime() - currentDate.getTime();
          }
        }
      }
      return query;
    });
};

const checkAccIntegrationType = async () => {
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }

  if (organizationId) {
    const resAI = await db
      .collection("accounting_integration")
      .where({ organization_id: organizationId })
      .get();

    if (resAI && resAI.data.length > 0) {
      const aiData = resAI.data[0];

      return aiData.acc_integration_type;
    } else {
      return null;
    }
  }
};

const runUpdate = async (id, doc) => {
  return await this.runWorkflow(id, {
    DOCUMENT: doc,
  });
};

const run = async (id) => {
  return await this.runWorkflow(id);
};

const runAutoCountWorkflow = async (id) => {
  let response;
  await this.runWorkflow(
    id,
    {},
    async (res) => {
      console.log("Sync successfully:", res);
      response = res;
    },
    (err) => {
      this.$message.error("Sync failed");
      console.error("Sync failed:", err);
    }
  );
  return response;
};

const acWorkflow = [
  { name: "TARIFF", id: "1988500539227369474" },
  { name: "TAX", id: "1988500606755663873" },
  { name: "STOCK GROUP", id: "1988500742512701441" },
  { name: "UOM", id: "1986008608307171329" },
  { name: "ITEM", id: "1988501105584238594" },
];

const init = async () => {
  const acc_integration_type = await checkAccIntegrationType();

  switch (acc_integration_type) {
    case "SQL Accounting":
      const res_date = await getDate();
      console.log(getDate());
      // this.hide("btn_sync")
      if (res_date.is_triggered) {
        const minutes = Math.floor(res_date.time_left / (1000 * 60));
        const seconds = Math.floor((res_date.time_left % (1000 * 60)) / 1000);
        console.log("return_message :", res_date.time_left);
        await alert(
          `Please wait for ${minutes} minutes and ${seconds} seconds`
        );
      } else {
        alert("Start syncing, please wait...");
        for (const { id, doc } of updateWorkflow) {
          await runUpdate(id, doc);
          console.log("Updated Triggered :", doc);
        }
        for (const { id, name } of workflow) {
          await run(id);
          console.log("running on : ", name);
        }
      }
      break;

    case "AutoCount Accounting":
      for (const { id, name } of acWorkflow) {
        const response = await runAutoCountWorkflow(id);
        console.log("running on : ", name);
        console.log("response : ", response);

        if (name === "ITEM" && response.success === true) {
          this.$alert(`Item Sync Successfully`, {
            confirmButtonText: "OK",
            type: "success",
          });
          this.refresh();
        }
      }

      break;

    case "No Accounting Integration":
      break;
  }
};

init();
