# Performance Optimization Guidelines

## Critical Rule: Avoid Redundant Database Fetches

### ❌ **NEVER DO THIS - Multiple Unnecessary Fetches**

```javascript
// BAD: Fetching from multiple collections when data exists in one
const checkUniqueness = async (value) => {
  // Fetch 1: Check collection A
  const resultA = await db.collection("collectionA").where({...}).get();

  // Fetch 2: Check collection B (REDUNDANT if A already has the data!)
  const resultB = await db.collection("collectionB").where({...}).get();

  // Fetch 3: Check collection C (MORE REDUNDANCY!)
  const resultC = await db.collection("collectionC").where({...}).get();

  return resultA || resultB || resultC;
}
```

**Problems:**
- 🐌 **3x slower** - Multiple network round trips
- 💰 **3x cost** - More database reads = higher cost
- ⏱️ **Poor UX** - Users see long loading times
- 🔥 **Resource waste** - Unnecessary server load

---

### ✅ **DO THIS - Single Source of Truth**

```javascript
// GOOD: Single fetch from the authoritative collection
const checkUniqueness = async (value) => {
  // Fetch ONCE from the source of truth
  const result = await db.collection("packing_line").where({...}).get();

  return !result.data || result.data.length === 0;
}
```

**Benefits:**
- ⚡ **3x faster** - Single database query
- 💰 **Lower cost** - Minimal database reads
- ✨ **Better UX** - Fast response times
- 🎯 **Single source of truth** - Clear data ownership

---

## Real-World Example: HU Number Validation

### Before Optimization (SLOW ❌)

```javascript
const checkHUUniqueness = async (huNo, organizationId, plantId) => {
  // Fetch 1: packing_line collection
  const packingLines = await db.collection("packing_line")
    .where({ hu_no: huNo, organization_id, plant_id, is_deleted: 0 })
    .get();

  if (packingLines.data?.length > 0) return false;

  // Fetch 2: packing collection (REDUNDANT!)
  const packings = await db.collection("packing")
    .where({ organization_id, plant_id, is_deleted: 0 })
    .get();

  // Fetch 3: Loop through packing.table_hu arrays (SLOW!)
  for (const packing of packings.data) {
    if (packing.table_hu?.some(hu => hu.hu_no === huNo)) {
      return false;
    }
  }

  return true;
}
```

**Performance Issues:**
- 2+ database fetches per validation
- Array iteration on client side
- 10 manual HU validations = **20+ database calls** 🔥

---

### After Optimization (FAST ✅)

```javascript
const checkHUUniqueness = async (huNo, organizationId, plantId) => {
  // Single fetch from authoritative source
  const existingInPackingLine = await db
    .collection("packing_line")
    .where({
      hu_no: huNo,
      organization_id: organizationId,
      plant_id: plantId,
      is_deleted: 0,
    })
    .get();

  return !existingInPackingLine.data || existingInPackingLine.data.length === 0;
}
```

**Performance Gains:**
- 1 database fetch per validation
- No client-side array iteration
- 10 manual HU validations = **10 database calls** ⚡
- **50% reduction in database calls!**

---

## Decision Tree: Should I Fetch from Multiple Collections?

```
┌─────────────────────────────────────────┐
│ Do I need data from Collection B?      │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ Is the data already in Collection A?   │
└─────────────┬───────┬───────────────────┘
              │       │
         YES  │       │  NO
              │       │
              ▼       ▼
        ┌─────────┐   ┌──────────────────┐
        │ DON'T   │   │ OK to fetch from │
        │ FETCH!  │   │ Collection B     │
        └─────────┘   └──────────────────┘
```

---

## Best Practices

### 1. **Identify Single Source of Truth**

Before writing queries, ask:
- Which collection is the authoritative source for this data?
- Is this data duplicated elsewhere for convenience?
- Can I get everything I need from one collection?

### 2. **Denormalization is OK, But Don't Query It**

```javascript
// Packing record (for display convenience)
{
  id: "pack-001",
  table_hu: [
    { hu_no: "HU-0001", ... }, // Convenience copy
    { hu_no: "HU-0002", ... }
  ]
}

// Packing Line records (SOURCE OF TRUTH)
{
  id: "line-001",
  packing_id: "pack-001",
  hu_no: "HU-0001",  // ← Query THIS for validation
  ...
}
```

**Rule:** Denormalize for reads, but validate against the source of truth.

### 3. **Batch Operations When Possible**

```javascript
// ❌ BAD: N queries in a loop
for (const item of items) {
  await checkUniqueness(item.hu_no);  // 1 query per item
}

// ✅ GOOD: Single query with multiple values
const huNumbers = items.map(item => item.hu_no);
const existing = await db.collection("packing_line")
  .where({ hu_no: db.command.in(huNumbers) })  // 1 query total
  .get();
```

### 4. **Use Indexes Properly**

Ensure your queries are indexed:
```javascript
// This query needs indexes on:
// - organization_id
// - plant_id
// - hu_no
// - is_deleted

await db.collection("packing_line")
  .where({
    hu_no: "HU-0001",
    organization_id: "org-123",
    plant_id: "plant-456",
    is_deleted: 0
  })
  .get();
```

---

## Performance Monitoring

Track these metrics:
- ⏱️ **Query count per operation** - Should be minimal
- 📊 **Response time** - Should be under 2 seconds
- 💾 **Database read cost** - Monitor your bill
- 🔄 **Redundant queries** - Zero tolerance

---

## Code Review Checklist

Before committing code that fetches data:

- [ ] Am I fetching from the authoritative collection?
- [ ] Could this data already be in memory or another fetch?
- [ ] Am I fetching inside a loop? (Consider batching)
- [ ] Do I need ALL the fields I'm fetching?
- [ ] Is this query indexed?
- [ ] Could I reduce the number of database calls?

---

## Example: Optimized Packing Functions

### File: `PackingSaveAsCreated.js`

**Optimizations Applied:**

1. ✅ **`checkHUUniqueness`** - Single fetch from `packing_line` only
2. ✅ **`getMaxHUNumber`** - Single fetch from `packing_line` only
3. ✅ Removed redundant fetches from `packing` collection
4. ✅ HU data normalized in `packing_line` (source of truth)
5. ✅ `packing.table_hu` is convenience copy, NOT queried

**Performance Result:**
- Before: 2 fetches per validation
- After: 1 fetch per validation
- **50% reduction in database calls**

---

## Remember

> "The fastest database query is the one you don't make."

Always ask yourself:
1. Do I really need this data?
2. Do I already have it?
3. Can I get it in fewer queries?

**When in doubt, fetch LESS, not more.**
