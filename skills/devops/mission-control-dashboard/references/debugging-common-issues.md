# Debugging Common Issues — Mission Control Dashboard

## `renderTasks` Missing `board.innerHTML`

**Symptom:** Task count badge shows the correct number (e.g. "7") but the task board is empty. The `renderTasks` function runs without errors.

**Root cause:** The HTML string is built but never assigned to the DOM element.

```javascript
// WRONG — builds html but never renders it
function renderTasks(data) {
  let html = '';
  for (const s of order) {
    // ... build html ...
  }
  // Missing: board.innerHTML = html;
}

// RIGHT:
function renderTasks(data) {
  let html = '';
  for (const s of order) {
    // ... build html ...
  }
  board.innerHTML = html;
}
```

## Broken Brace Nesting (Function Scope Leak)

**Symptom:** All JS stops working after a certain function. Keyboard shortcuts fail. Click handlers produce "function is not defined" errors.

**Root cause:** A function's closing `}` was placed at the wrong indentation level, causing all subsequent functions to be nested inside it (and thus not globally accessible).

**Example:** If `renderTasks`'s closing brace is at column 0 instead of column 2, the outer for loop closes at column 0 — but the function never closes. Everything below becomes a nested function:

```javascript
function renderTasks(data) {
  for (const s of order) {
    for (const t of items) {
      // ...
    }
  }
  // ✓ This } closes the outer for loop
}
// ✗ Missing: this } should close the function
function previewBody() { // ← Actually nested inside renderTasks!
```

**Fix:** Count braces carefully. Each opening `{` needs a closing `}` at the same nesting level. Use a linter or format-on-save to catch these.

## sqlite3.Row `.get()` Method

Python 3.11's `sqlite3.Row` does NOT have a `.get()` method (added in 3.12).

**Symptom:** `AttributeError: 'sqlite3.Row' object has no attribute 'get'`

**Fix:**
```python
# Wrong:
author = c.get("author", "system")

# Right:
author = c["author"] if "author" in c else "system"
```

## CDN Script Loading Order

**Symptom:** Markdown shows raw syntax (e.g. `## Header` instead of rendered heading). No console errors.

**Root cause:** `marked` and `DOMPurify` are loaded with `defer` but local scripts are loaded without `defer`. Deferred scripts run AFTER parsing, but non-deferred scripts run DURING parsing. So by the time `main.js` runs, the CDN libraries haven't loaded yet.

**Fix:** All scripts must consistently use `defer`:

```html
<script src="cdn/marked.min.js" defer></script>
<script src="cdn/dompurify.min.js" defer></script>
<script src="scripts/state.js" defer></script>
<script src="scripts/main.js" defer></script>
```

## No `updated_at` Column

The kanban `tasks` table has no `updated_at` column. Using it in SQL returns `no such column` errors.

**Fix:** Use `COALESCE(started_at, created_at) DESC` for recency sorting.
