const customerData = {{node:get_node_GerIauhj.data.data}}

const controlTypes = customerData.control_type_list;
const outstandingAmount = parseFloat(customerData.outstanding_balance || 0) || 0;
const overdueAmount = parseFloat(customerData.overdue_inv_total_amount || 0) || 0;
const overdueLimit = parseFloat(customerData.overdue_limit || 0) || 0;
const creditLimit = parseFloat(customerData.customer_credit_limit || 0) || 0;
const totalAmount = parseFloat({{workflowparams:total}} || 0) || 0;
const revisedOutstandingAmount = outstandingAmount + totalAmount;

if (controlTypes && Array.isArray(controlTypes)) {
  const controlTypeChecks = {
    0: () => {
      return { result: true, priority: "unblock" };
    },

    1: () => {
      if (overdueAmount > overdueLimit) {
        return { result: false, popupNumber: 2, priority: "block" };
      }
      return { result: true, priority: "unblock" };
    },

    2: () => {
      if (overdueAmount > overdueLimit) {
        return { result: false, popupNumber: 4, priority: "override" };
      }
      return { result: true, priority: "unblock" };
    },

    3: () => {
      if (revisedOutstandingAmount > creditLimit) {
        return { result: false, popupNumber: 1, priority: "block" };
      }
      return { result: true, priority: "unblock" };
    },

    4: () => {
      const creditExceeded = revisedOutstandingAmount > creditLimit;
      const overdueExceeded = overdueAmount > overdueLimit;

      if (creditExceeded && overdueExceeded) {
        return { result: false, popupNumber: 3, priority: "block" };
      } else if (creditExceeded) {
        return { result: false, popupNumber: 1, priority: "block" };
      } else if (overdueExceeded) {
        return { result: false, popupNumber: 2, priority: "block" };
      }
      return { result: true, priority: "unblock" };
    },

    5: () => {
      const creditExceeded = revisedOutstandingAmount > creditLimit;
      const overdueExceeded = overdueAmount > overdueLimit;

      if (creditExceeded) {
        if (overdueExceeded) {
          return { result: false, popupNumber: 3, priority: "block" };
        } else {
          return { result: false, popupNumber: 1, priority: "block" };
        }
      } else if (overdueExceeded) {
        return { result: false, popupNumber: 4, priority: "override" };
      }
      return { result: true, priority: "unblock" };
    },

    6: () => {
      if (revisedOutstandingAmount > creditLimit) {
        return { result: false, popupNumber: 5, priority: "override" };
      }
      return { result: true, priority: "unblock" };
    },

    7: () => {
      const creditExceeded = revisedOutstandingAmount > creditLimit;
      const overdueExceeded = overdueAmount > overdueLimit;

      if (overdueExceeded) {
        return { result: false, popupNumber: 2, priority: "block" };
      } else if (creditExceeded) {
        return { result: false, popupNumber: 5, priority: "override" };
      }
      return { result: true, priority: "unblock" };
    },

    8: () => {
      const creditExceeded = revisedOutstandingAmount > creditLimit;
      const overdueExceeded = overdueAmount > overdueLimit;

      if (creditExceeded && overdueExceeded) {
        return { result: false, popupNumber: 7, priority: "override" };
      } else if (creditExceeded) {
        return { result: false, popupNumber: 5, priority: "override" };
      } else if (overdueExceeded) {
        return { result: false, popupNumber: 4, priority: "override" };
      }
      return { result: true, priority: "unblock" };
    },

    9: () => {
      return { result: false, popupNumber: 6, priority: "block" };
    },
  };

  const applicableControls = controlTypes
    .filter((ct) => ct.document_type === {{workflowparams:document_type}})
    .map((ct) => {
      const checkResult = controlTypeChecks[ct.control_type]
        ? controlTypeChecks[ct.control_type]()
        : { result: true, priority: "unblock" };
      return {
        ...checkResult,
        control_type: ct.control_type,
      };
    });

  const priorityOrder = { block: 1, override: 2, unblock: 3 };
  applicableControls.sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );

  for (const control of applicableControls) {
    if (control.result !== true) {
      return {
        result: false,
        popupNumber: control.popupNumber,
        priority: control.priority,
        creditLimitData: {
          creditLimit: creditLimit,
          revisedOutstandingAmount: revisedOutstandingAmount,
          overdueLimit: overdueLimit,
          overdueAmount: overdueAmount
        }
      };
    }
  }

  return { result: true };
}
