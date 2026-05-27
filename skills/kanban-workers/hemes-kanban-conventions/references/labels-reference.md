# Hemes GitHub Labels Reference

Created on the `LogicalOgbonna/hemes` repo for tagging kanban tasks.

## Type labels (pick one)

| Label | Color | Hex |
|-------|-------|-----|
| bug | Red | `#d73a4a` |
| feature | Cyan | `#a2eeef` |
| research | Purple | `#7057ff` |
| docs | Blue | `#0075ca` |
| refactor | White | `#ffffff` |
| blog | Light blue | `#bfd4f2` |

## Area labels (pick one or more)

| Label | Color | Hex |
|-------|-------|-----|
| frontend | Blue | `#1d76db` |
| backend | Purple | `#5319e7` |
| infra | Yellow | `#fbca04` |

## Priority labels (optional)

| Label | Color | Hex |
|-------|-------|-----|
| urgent | Dark red | `#b60205` |
| quick-win | Green | `#0e8a16` |
| blocked | Black | `#000000` |

## API creation reference

Labels were created via:
```
POST https://api.github.com/repos/LogicalOgbonna/hemes/labels
```
Using GitHub personal access token with `repo` scope.
