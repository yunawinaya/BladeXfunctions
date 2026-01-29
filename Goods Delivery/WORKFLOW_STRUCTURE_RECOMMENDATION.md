# Recommended Workflow Structure for GD Reserved Table Allocation

## Current Issue

The "IF No Reserved Table" branch (checking if `search_node_IJAcucMA.data.total == 0`) causes duplicate allocations during re-allocation when no pending records exist.

## Recommended Structure

### Option 1: Remove IF Branch Entirely (RECOMMENDED)

```
Pre-loop: Fetch Old Allocated Data
  ↓
Loop table_gd
  ↓
  Loop temp_data
    ↓
    Search for Pending Records (search_node_IJAcucMA)
    ↓
    Execute Workflow.js (code_node_Njvhx8FJ)
    ↓
    Process results (Update/Create nodes)
  ↓
Post-loop: Cleanup Orphaned Allocations
```

**Why**: Workflow.js handles ALL scenarios internally:
- Initial allocation with pending records
- Initial allocation without pending records (creates direct allocation)
- Re-allocation with increase/decrease/no change
- Re-allocation when no pending exists

### Option 2: Keep IF Branch but Add oldAllocatedData Check (ALTERNATIVE)

If you want to keep the optimization for initial allocation (avoiding Workflow.js execution):

```javascript
// IF condition should be:
search_node_IJAcucMA.data.total == 0 && oldAllocatedData.length == 0

// TRUE branch: Initial allocation with no pending (direct allocation)
// FALSE branch: Either pending exists OR this is re-allocation (run Workflow.js)
```

**Why**: This ensures re-allocation ALWAYS goes through Workflow.js, even when no pending records exist.

## Workflow JSON Modifications

### Remove IF Branch

**Before:**
```json
{
  "search_node_IJAcucMA": { ... },
  "if_jSk7c3YB": {
    "condition": "search_node_IJAcucMA.data.total == 0",
    "true": {
      "nodes": { "code_node_wkOKP7KD": { ... } }
    },
    "false": {
      "nodes": { "code_node_Njvhx8FJ": { ... } }
    }
  }
}
```

**After:**
```json
{
  "search_node_IJAcucMA": { ... },
  "code_node_Njvhx8FJ": {
    "type": "code",
    "label": "Workflow.js - Handle Allocation/Re-allocation",
    "data": "... Workflow.js code ..."
  },
  "process_results": {
    "nodes": {
      "update_records": { ... },
      "create_record": { ... }
    }
  }
}
```

### Update IF Condition (Alternative)

**Modified IF:**
```json
{
  "if_jSk7c3YB": {
    "condition": "search_node_IJAcucMA.data.total == 0 && (!oldAllocatedData || oldAllocatedData.length == 0)",
    "true": {
      "label": "Initial allocation - No pending records",
      "nodes": { "code_node_wkOKP7KD": { ... } }
    },
    "false": {
      "label": "Has pending OR is re-allocation",
      "nodes": { "code_node_Njvhx8FJ": { ... } }
    }
  }
}
```

## Complete Workflow Node Structure

```json
{
  "nodes": {
    "pre_loop_fetch_old_allocated": {
      "type": "database_query",
      "collection": "reserved_table",
      "operation": "find",
      "query": {
        "target_reserved_id": "{{form:_id}}",
        "status": "Allocated",
        "organization_id": "{{form:organization_id}}"
      },
      "output": "oldAllocatedRecords"
    },

    "loop_table_gd": {
      "type": "loop",
      "source": "{{form:table_gd}}",
      "nodes": {
        "loop_temp_data": {
          "type": "loop",
          "source": "{{line:temp_data}}",
          "params": {
            "oldAllocatedData": "{{node:pre_loop_fetch_old_allocated.data}}"
          },
          "nodes": {
            "search_node_IJAcucMA": {
              "type": "database_query",
              "collection": "reserved_table",
              "operation": "find",
              "query": {
                "plant_id": "{{workflowparams:plant_id}}",
                "organization_id": "{{workflowparams:organization_id}}",
                "material_id": "{{workflowparams:material_id}}",
                "bin_location": "{{workflowparams:location_id}}",
                "batch_id": "{{workflowparams:batch_id}}",
                "status": "Pending",
                "parent_id": "{{workflowparams:parent_id}}",
                "parent_line_id": "{{workflowparams:parent_line_id}}"
              }
            },

            "code_node_Njvhx8FJ": {
              "type": "code",
              "label": "Workflow.js - Handle All Allocation Scenarios",
              "code": "... Workflow.js content ..."
            },

            "process_results": {
              "nodes": {
                "loop_updates": {
                  "type": "loop",
                  "source": "{{node:code_node_Njvhx8FJ.recordsToUpdate}}",
                  "nodes": {
                    "update_record": {
                      "type": "database_update",
                      "collection": "reserved_table",
                      "doc_id": "{{item:_id}}",
                      "data": "{{item}}"
                    }
                  }
                },
                "create_record": {
                  "type": "database_create",
                  "collection": "reserved_table",
                  "data": "{{node:code_node_Njvhx8FJ.recordToCreate}}",
                  "condition": "{{node:code_node_Njvhx8FJ.recordToCreate}} != null"
                }
              }
            }
          }
        }
      }
    },

    "post_loop_cleanup": {
      "type": "code",
      "label": "Cleanup Orphaned Allocations",
      "code": "... CleanupOrphanedAllocations.js content ..."
    }
  }
}
```

## Testing Scenarios

### Scenario 1: Initial Allocation - No Pending
- **Search Result**: 0 pending records
- **oldAllocatedData**: []
- **Expected**: Workflow.js creates direct allocation (lines 391-417)

### Scenario 2: Initial Allocation - With Pending
- **Search Result**: Pending records exist
- **oldAllocatedData**: []
- **Expected**: Workflow.js allocates from pending (lines 283+)

### Scenario 3: Re-allocation - Increase Qty, No Pending
- **Search Result**: 0 pending records
- **oldAllocatedData**: [10 qty Allocated]
- **Expected**: Workflow.js finds match, calculates netChange=+5, creates direct allocation for +5 (lines 128-276)

### Scenario 4: Re-allocation - Decrease Qty
- **Search Result**: Any (doesn't matter)
- **oldAllocatedData**: [10 qty Allocated]
- **Expected**: Workflow.js finds match, calculates netChange=-5, releases 5 qty to Pending (lines 70-122)

## Summary

**Answer to your question**: No, the "IF No Reserved Table" branch does NOT correctly support the new re-allocation logic. It should be removed or modified to check both pending AND oldAllocatedData conditions.

**Recommended Action**: Remove the IF branch and always execute Workflow.js, which now handles all scenarios correctly.
