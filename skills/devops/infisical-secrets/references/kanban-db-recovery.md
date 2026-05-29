# Kanban DB Corruption Recovery

When the kanban SQLite DB gets corrupt, the gateway logs repeated `KanbanDbCorruptError` on every dispatcher tick and the kanban system stops working. Here's how to recover.

## Detection

The gateway will log:

```
ERROR gateway.run: kanban dispatcher: tick failed on board default
...
hermes_cli.kanban_db.KanbanDbCorruptError: Refusing to open corrupt kanban DB at ...: integrity_check returned '*** in database main ***\nTree X page Y cell Z: Rowid NNN out of order'
```

A backup is auto-created at `~/.hermes/kanban.db.corrupt.<timestamp>.bak`.

## Surgical Recovery (preferred — keeps all healthy data)

The DB has multiple tables. Corruption typically hits one or two tables. Other tables are fully readable. Recover by reading each healthy table, skipping the corrupt ones, and rebuilding:

```python
import sqlite3, os

db = os.path.expanduser('~/.hermes/kanban.db')
bak = db + '.pre-recovery.' + os.popen('date +%Y%m%d_%H%M%S').read().strip()
os.rename(db, bak)
print(f'Backed up corrupt DB to {bak}')

# Read from backup, rebuild skipping corrupt tables
src = sqlite3.connect(bak)
tables = src.execute("SELECT name, sql FROM sqlite_master WHERE type='table'").fetchall()

dst = sqlite3.connect(db)
for name, ddl in tables:
    try:
        dst.execute(ddl)
        rows = src.execute(f'SELECT * FROM "{name}"').fetchall()
        if not rows:
            continue
        cols = [d[1] for d in src.execute(f'PRAGMA table_info("{name}")').fetchall()]
        placeholders = ','.join(['?'] * len(cols))
        dst.executemany(f'INSERT INTO "{name}" VALUES ({placeholders})', rows)
    except Exception as e:
        print(f'Skipping {name} during rebuild: {e}')
dst.commit()

integ = dst.execute('PRAGMA integrity_check').fetchone()[0]
print(f'Rebuilt integrity: {integ}')

src.close()
dst.close()

if integ != 'ok':
    print('FATAL: could not rebuild kanban DB — try full salvage below')
    exit(1)
```

## Full Salvage (if surgery fails)

If the surgical recovery fails (integ != 'ok'), try row-level recovery — attempt to read each row individually and skip only the corrupt rows within a table:

```python
import sqlite3, os

db = os.path.expanduser('~/.hermes/kanban.db')
bak = db + '.pre-salvage.' + os.popen('date +%Y%m%d_%H%M%S').read().strip()
os.rename(db, bak)

src = sqlite3.connect(bak)
tables = src.execute("SELECT name, sql FROM sqlite_master WHERE type='table'").fetchall()

dst = sqlite3.connect(db)
for name, ddl in tables:
    if not ddl:
        continue
    try:
        dst.execute(ddl)
    except Exception as e:
        print(f'Cannot create {name}: {e}')
        continue
    
    try:
        rows = src.execute(f'SELECT * FROM "{name}"').fetchall()
        if not rows:
            continue
        cols = [d[1] for d in src.execute(f'PRAGMA table_info("{name}")').fetchall()]
        placeholders = ','.join(['?'] * len(cols))
        dst.executemany(f'INSERT INTO "{name}" VALUES ({placeholders})', rows)
    except:
        # Row-level recovery: read max rowid, try each
        try:
            max_id = src.execute(f'SELECT MAX(rowid) FROM "{name}"').fetchone()[0]
            if max_id:
                cols = [d[1] for d in src.execute(f'PRAGMA table_info("{name}")').fetchall()]
                placeholders = ','.join(['?'] * len(cols))
                recovered = 0
                for rid in range(1, max_id + 1):
                    try:
                        row = src.execute(f'SELECT * FROM "{name}" WHERE rowid=?', (rid,)).fetchone()
                        if row:
                            dst.execute(f'INSERT INTO "{name}" VALUES ({placeholders})', row)
                            recovered += 1
                    except:
                        pass  # skip corrupt row
                print(f'  {name}: recovered {recovered}/{max_id} rows individually')
        except:
            print(f'  {name}: no recovery possible')

dst.commit()
integ = dst.execute('PRAGMA integrity_check').fetchone()[0]
print(f'Salvaged integrity: {integ}')
src.close()
dst.close()
```

## Verification

After recovery, confirm the DB is healthy and data is intact:

```bash
python3 -c "
import sqlite3
conn = sqlite3.connect(os.path.expanduser('~/.hermes/kanban.db'))
result = conn.execute('PRAGMA integrity_check').fetchone()[0]
t = conn.execute('SELECT COUNT(*) FROM tasks').fetchone()[0]
e = conn.execute('SELECT COUNT(*) FROM task_events').fetchone()[0]
r = conn.execute('SELECT COUNT(*) FROM task_runs').fetchone()[0]
print(f'Integrity: {result}, tasks={t}, events={e}, runs={r}')
conn.close()
"
```

Compare task counts to what you saw before corruption. Some tasks with NULL IDs (fully corrupt rows) will be lost, but all healthy data survives.

## Common Corruptions

| Error pattern | Likely cause | Recovery method |
|---|---|---|
| `Rowid NNN out of order` | Page-level B-tree corruption in one table | Surgical recovery (table-level read) |
| `database disk image is malformed` | Multiple corrupted pages | Full salvage (row-level read) |
| `malformed database schema` | sqlite_master table corrupt | Use most recent `.bak` file |

## Pitfalls

- **sqlite3 CLI may not be installed** — use Python's `sqlite3` module instead
- **Don't reuse a bak file that was itself created from a corrupt DB** — all `.corrupt.*.bak` files from the same event chain are also corrupt
- **The gateway crash-loop creates many backups** — one per dispatch tick. Clean them up after recovery: `rm -f ~/.hermes/kanban.db.corrupt.*.bak`
- **Rebuilt DB has integrity 'ok' but fewer rows** — rows on the corrupted page(s) are lost. This is expected and unavoidable
- **After recovery, restart the gateway** to clear the dispatcher error state: `systemctl --user restart hermes-gateway`
