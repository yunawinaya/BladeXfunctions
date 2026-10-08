# A loop at the start of a parallel branch breaks the add-node in a sibling branch

[English](#english) · [中文](#中文)

---

## English

**Error:** `节点[Add Packing Data]执行失败[Index 0 out of bounds for length 0]`

| | |
|---|---|
| Environment | Production, https://lsh.mes.sudu.ai (tenant 128671) |
| Workflow | PICKING, id `2020683258347081730` |
| Failing node | `add_node_LcxwYc7z` "Add Packing Data", batch insert into Packing (table `1993515601863524353`) |
| Frequency | Intermittent: 2 failures in 56 runs where both branches ran |

One condition-all-node runs two branches: an add-node, and a branch whose first node is a loop. When both branches run at the same time, the add-node sometimes fails with the error above. The instance stops at that node and the add-node writes nothing. The input data is valid. We believe the cause is in the platform: the loop's runtime state is kept in the instance-wide context and is not isolated per branch.

### Failed instances

| Instance id | Started (UTC+8) | Run time | Branch input |
|---|---|---|---|
| `2108089351207522305` | 2026-10-08 14:57:22 | 66.4 s | add 2 rows, loop 7 items |
| `2105552770156335105` | 2026-10-01 14:57:54 | 14.9 s | add 1 row, loop 1 item |

Logs:

- `/app/logs/workflow/20261008/2108089351207522305.log`
  https://lsh.mes.sudu.ai/api/su-code-service/ossExtend/viewFile/000-1//sumes/upload/20261008/07b1d1e9e5aebfae25edfa4ec6e8d73c.log
- Error file recorded in that instance's `nodes_data`:
  https://lsh.mes.sudu.ai/api/su-code-service/ossExtend/viewFile/000-1//sumes/upload/20261008/5f139b776f0acea108078481409bdc37.txt
- `/app/logs/workflow/20261001/2105552770156335105.log`
  https://lsh.mes.sudu.ai/api/su-code-service/ossExtend/viewFile/000-1//sumes/upload/20261001/7857e2d6e84a8854ed4c28db8a179797.log

### Workflow structure

```
code_node_gudzrvMQ            returns packingDataList[], packingsToUpdate[], hasCreates, hasUpdates
condition_all_NEt9SBHT        (condition-all-node)
├─ branch hasCreates == 1
│    add_node_LcxwYc7z        add-node, batch; every field is an array path:
│                             {{node:code_node_gudzrvMQ.data.packingDataList.<field>}}
│                             packing_no = 'issued', packing_no_type = {{node:get_node_P2TpS5kS.data.data.id}}
├─ branch hasUpdates == 1
│    loop_PackingUpdates      loop, loopType "Var" over {{node:code_node_gudzrvMQ.data.packingsToUpdate}}
│      update_node_Mt4SJsF8   filter id in {{node:loop_PackingUpdates.existing_packing_id}}
└─ branch (empty)
return_node_8pe4Lsgp
```

### Evidence

- **The input is valid.** In both failures the add-node input has the same fields, types and empty fields as 165 successful runs of the same node in the same tenant.
- **It fails before the insert.** No rows were written and no serial number was used: Packing PACK-20261008-0298 was created at 14:46:51, and the next one, 0299, at 15:00:29.
- **It fails only when both branches run.** PICKING runs from 2026-09-24 to 2026-10-08, all tenants:

  | Branches that ran | Runs | Failures |
  |---|---:|---:|
  | add-node only | 113 | 0 |
  | loop only | 599 | 0 |
  | both | 56 | **2** |

- **At the moment of failure, the other branch's loop had just started.** From `su_code_workflow_inst.context`:
  - 10-08: `loop.node.id.stack = ["loop_PackingUpdates"]`, and no `loop.index.loop_PackingUpdates` or `loop.current.loop_PackingUpdates` yet.
  - 10-01: `loop.node.id.stack = ["loop_PackingUpdates"]`, `loop.index.loop_PackingUpdates = 0`.
- **The same design works when the loop starts later.** In workflow GD_UNUSED_FN_NEW (`2032273338771128322`), block `condition_all_6v3Hmb18`, the loop `loop_88bcQyIz` runs after a code-node and a set-cache-node in its branch. In the same period it ran in parallel with an add-node 5,282 times and with an update-node 5,078 times, with no failure.
- **Timeline.** The loop was added to this branch on 2026-09-18; before that, the branch held a single update-node. Both failures came after. From 2026-09-08 to 2026-10-08 no other instance of any workflow failed with this error.
- **Related observation.** In a successful run (`2108091114182545409`), `loop_PackingUpdates` is still on `loop.node.id.stack` after the instance ends, while the loop `loop_zRdd7yAf`, which is not inside a parallel branch, is removed when it finishes.

### Likely cause

The loop's runtime state (`loop.node.id.stack`, `loop.index.<id>`, `loop.current.<id>`) is stored in the context shared by every branch of the instance. When the loop in branch 2 has just pushed itself onto `loop.node.id.stack`, or is in its first iteration, the add-node in branch 1 resolves its `{{node:...}}` values as if it were inside that loop. It gets an empty list and throws `IndexOutOfBoundsException`. The stack trace in the logs above should confirm or rule this out.

### What we need from you

- Check the stack trace of the two instances and tell us where the exception is thrown.
- Confirm whether loop state is shared between the branches of a condition-all-node. If it is, isolate it per branch (per execution path), and remove a loop from `loop.node.id.stack` when it finishes inside a branch.
- Tell us which other node types (update-node, search-node, code-node) a loop in another branch can affect, so we can avoid that design until it is fixed.

### Our workaround

We are moving the add-node and the loop out of the condition-all-node. They will run one after the other: first the add-node, then the loop, each behind its own if-node on `hasCreates` / `hasUpdates`.

### How to reproduce (not yet tried on a test environment)

- A code-node returns two arrays: `list` (1 or more rows) and `items` (1 or more rows).
- A condition-all-node with two branches. Branch A: an add-node that inserts one row per element of `list`, with fields `{{node:<code-node>.data.list.<field>}}`. Branch B: a loop (`loopType "Var"`) over `{{node:<code-node>.data.items}}` as the first node, with an update-node inside.
- Run it many times. In our production data, 2 of 56 runs with both branches failed (about 3.6%).

Both failures started at 14:57 local time on different days. We think this is a coincidence, but mention it in case a scheduled job runs then.

---

## 中文

**报错：** `节点[Add Packing Data]执行失败[Index 0 out of bounds for length 0]`

| | |
|---|---|
| 环境 | 生产环境，https://lsh.mes.sudu.ai（租户 128671） |
| 工作流 | PICKING，ID `2020683258347081730` |
| 报错节点 | `add_node_LcxwYc7z`「Add Packing Data」，批量新增到 Packing 表（`1993515601863524353`） |
| 频率 | 偶发：两个分支同时执行的 56 次中失败 2 次 |

一个并行分支节点（condition-all-node）同时运行两个分支：一个是新增节点，另一个分支的第一个节点是循环节点。两个分支同时执行时，新增节点偶尔出现上面的错误，实例停在这个节点，新增节点没有写入任何数据。输入数据是正常的。我们认为问题在平台：循环的运行状态保存在整个实例共享的上下文中，没有按分支隔离。

### 失败的实例

| 实例 ID | 开始时间（UTC+8） | 耗时 | 分支输入 |
|---|---|---|---|
| `2108089351207522305` | 2026-10-08 14:57:22 | 66.4 秒 | 新增 2 行，循环 7 次 |
| `2105552770156335105` | 2026-10-01 14:57:54 | 14.9 秒 | 新增 1 行，循环 1 次 |

日志：

- `/app/logs/workflow/20261008/2108089351207522305.log`
  https://lsh.mes.sudu.ai/api/su-code-service/ossExtend/viewFile/000-1//sumes/upload/20261008/07b1d1e9e5aebfae25edfa4ec6e8d73c.log
- 该实例 `nodes_data` 中记录的错误文件：
  https://lsh.mes.sudu.ai/api/su-code-service/ossExtend/viewFile/000-1//sumes/upload/20261008/5f139b776f0acea108078481409bdc37.txt
- `/app/logs/workflow/20261001/2105552770156335105.log`
  https://lsh.mes.sudu.ai/api/su-code-service/ossExtend/viewFile/000-1//sumes/upload/20261001/7857e2d6e84a8854ed4c28db8a179797.log

### 节点结构

```
code_node_gudzrvMQ            返回 packingDataList[]、packingsToUpdate[]、hasCreates、hasUpdates
condition_all_NEt9SBHT        （并行分支节点 condition-all-node）
├─ 分支 hasCreates == 1
│    add_node_LcxwYc7z        新增节点，批量；每个字段都是数组路径：
│                             {{node:code_node_gudzrvMQ.data.packingDataList.<字段>}}
│                             packing_no = 'issued'，packing_no_type = {{node:get_node_P2TpS5kS.data.data.id}}
├─ 分支 hasUpdates == 1
│    loop_PackingUpdates      循环节点，loopType "Var"，遍历 {{node:code_node_gudzrvMQ.data.packingsToUpdate}}
│      update_node_Mt4SJsF8   修改节点，条件 id in {{node:loop_PackingUpdates.existing_packing_id}}
└─ 分支（空）
return_node_8pe4Lsgp
```

### 证据

- **输入正常。** 两次失败时新增节点的输入，与同一租户中该节点 165 次成功执行的输入相比，字段、类型和空值字段都一致。
- **在写入之前就失败了。** 没有写入任何数据，也没有占用流水号：PACK-20261008-0298 创建于 14:46:51，下一个 0299 创建于 15:00:29。
- **只有两个分支同时执行时才失败。** 2026-09-24 至 2026-10-08 所有租户的 PICKING 执行：

  | 执行的分支 | 次数 | 失败 |
  |---|---:|---:|
  | 只有新增节点 | 113 | 0 |
  | 只有循环 | 599 | 0 |
  | 两个都执行 | 56 | **2** |

- **失败时，另一个分支的循环刚刚开始。** 来自 `su_code_workflow_inst.context`：
  - 10-08：`loop.node.id.stack = ["loop_PackingUpdates"]`，还没有 `loop.index.loop_PackingUpdates` 和 `loop.current.loop_PackingUpdates`。
  - 10-01：`loop.node.id.stack = ["loop_PackingUpdates"]`，`loop.index.loop_PackingUpdates = 0`。
- **循环不在分支开头时，同样的设计没有问题。** 工作流 GD_UNUSED_FN_NEW（`2032273338771128322`）的并行分支节点 `condition_all_6v3Hmb18` 中，循环 `loop_88bcQyIz` 前面有一个代码节点和一个缓存节点。同一时期它与新增节点并行 5,282 次、与修改节点并行 5,078 次，没有失败。
- **时间线。** 这个循环是 2026-09-18 加入该分支的，之前分支里只有一个修改节点。两次失败都发生在这之后。2026-09-08 至 2026-10-08 期间，所有工作流中没有其他实例出现这个错误。
- **另一个现象。** 在一次成功的执行中（`2108091114182545409`），实例结束后 `loop_PackingUpdates` 仍在 `loop.node.id.stack` 中；而不在并行分支中的循环 `loop_zRdd7yAf` 结束后会被移除。

### 推测原因

循环的运行状态（`loop.node.id.stack`、`loop.index.<id>`、`loop.current.<id>`）保存在实例所有分支共享的上下文中。当分支 2 的循环刚把自己压入 `loop.node.id.stack`，或处于第一次迭代时，分支 1 的新增节点在解析 `{{node:...}}` 的值时，被当作在这个循环里面执行，取到一个空列表，抛出 `IndexOutOfBoundsException`。上面日志中的堆栈信息应该可以确认或排除这一点。

### 需要协助

- 查看两个实例的堆栈信息，告诉我们异常是在哪里抛出的。
- 确认并行分支节点的各个分支之间是否共享循环状态。如果是，请按分支（执行路径）隔离循环状态，并在分支内的循环结束时把它从 `loop.node.id.stack` 中移除。
- 告诉我们另一个分支中的循环还会影响哪些节点类型（修改节点、查询节点、代码节点），在修复之前我们会避开这种设计。

### 我们的临时方案

我们把新增节点和循环移出并行分支节点，改为先执行新增节点，再执行循环，各自放在一个判断 `hasCreates` / `hasUpdates` 的条件节点下。

### 复现方法（尚未在测试环境验证）

- 一个代码节点返回两个数组：`list`（1 行或以上）和 `items`（1 行或以上）。
- 一个并行分支节点，包含两个分支。分支 A：新增节点，按 `list` 每个元素新增一行，字段为 `{{node:<代码节点>.data.list.<字段>}}`。分支 B：第一个节点是循环节点（`loopType "Var"`），遍历 `{{node:<代码节点>.data.items}}`，循环内放一个修改节点。
- 多次执行。我们的生产数据中，两个分支同时执行的 56 次里有 2 次失败（约 3.6%）。

两次失败的开始时间都是当地时间 14:57（不同日期）。我们认为是巧合，如果该时间有定时任务，可供参考。
