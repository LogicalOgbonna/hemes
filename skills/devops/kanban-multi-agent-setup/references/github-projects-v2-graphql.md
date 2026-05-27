# GitHub Projects v2 — GraphQL API Reference

## Node Discovery

Every GitHub Projects v2 board has a unique node ID. Get it via:

```graphql
query {
  user(login: "USERNAME") {
    projectsV2(first: 10) {
      nodes { id title url }
    }
  }
}
```

For an org-owned project:
```graphql
query {
  organization(login: "ORG_NAME") {
    projectsV2(first: 10) {
      nodes { id title url }
    }
  }
}
```

## Fields & Options

Query all fields on a project to find the Status field's ID and current options:

```graphql
query {
  node(id: "PROJECT_NODE_ID") {
    ... on ProjectV2 {
      fields(first: 20) {
        nodes {
          ... on ProjectV2Field { id name dataType }
          ... on ProjectV2SingleSelectField {
            id name dataType
            options { id name }
          }
        }
      }
    }
  }
}
```

The Status field has `dataType: SINGLE_SELECT`. Its ID is something like `PVTSSF_lAHOAYYjQM4BYylYzhT10fg`.

## Update Status Field Options

Replace all options in a single mutation. **This is a full replace** — you must list ALL options (existing + new) in a single call. It does not append.

**CRITICAL: Option ID behavior**

When you run `updateProjectV2Field` with `singleSelectOptions`:
- If you INCLUDE the `id` field for an existing option, that option's identity is preserved and items already using it keep their values
- If you OMIT the `id` field, the existing option is treated as a NEW option — it gets a NEW ID, and any items previously assigned that status lose their field value
- If you run the mutation a second time without including ANY IDs from the first run, ALL option IDs change (because GitHub generates new IDs for every entry that lacks an `id`)

**Pattern for safe updates:**
1. First, query the current options to get their IDs
2. Keep the IDs in your update for options you want to preserve
3. Only omit `id` for genuinely new options

```graphql
mutation {
  updateProjectV2Field(input: {
    fieldId: "STATUS_FIELD_ID",
    singleSelectOptions: [
      # Existing — keep id to preserve item values
      {id: "EXISTING_OPTION_ID_1", name: "Todo",       color: BLUE,   description: "Tasks logged but not started"},
      # New — omit id, GitHub generates it
      {name: "Triage",    color: GRAY,   description: "New items waiting to be triaged"},
      {name: "Ready",     color: ORANGE, description: "Ready to be picked up"},
    ]
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id name
        options { id name }
      }
    }
  }
}
```

After any mutation, you should query the options again to get the new IDs before using them in item-field-value mutations.

## Add an Item to the Board

Once you've created a GitHub issue (via REST API, `POST /repos/{owner}/{repo}/issues`), add it to the project board:

```graphql
mutation {
  addProjectV2ItemById(input: {
    projectId: "PROJECT_NODE_ID"
    contentId: "ISSUE_NODE_ID"   # e.g. I_kwDOSnzAgs8AAAABDXOlug
  }) {
    item {
      id                        # e.g. PVTI_lAHOAYYjQM4BYylYzgtx-1U
    }
  }
}
```

The `contentId` is the GitHub node ID of the issue, NOT the issue number. You get it from the `node_id` field in the REST API response when creating the issue, or from a GraphQL query.

## Set an Item's Status Field

After adding an item to the board, set its Status column value:

```graphql
mutation {
  updateProjectV2ItemFieldValue(input: {
    projectId: "PROJECT_NODE_ID"
    itemId: "ITEM_ID"                # from addProjectV2ItemById result
    fieldId: "STATUS_FIELD_ID"       # the SINGLE_SELECT field ID
    value: {
      singleSelectOptionId: "OPTION_ID"  # the option's current ID
    }
  }) {
    projectV2Item {
      id
    }
  }
}
```

**Common error:** "The single select option Id does not belong to the field" — this means either:
- The option ID is stale (you ran updateProjectV2Field after the option was created and the ID changed)
- You're passing the wrong field ID
- Query the current options to get fresh IDs

## Full Pipeline: Issue → Board Item → Status

```
1. POST /repos/{owner}/{repo}/issues  →  get issue.node_id
2. addProjectV2ItemById(contentId: issue.node_id)  →  get item.id
3. updateProjectV2ItemFieldValue(itemId: item.id, singleSelectOptionId: status_option_id)
```

Example using Python + GraphQL for step 2+3:

```python
import json, urllib.request

# Step 1 was done via REST API — you have the issue's node_id
issue_node_id = "I_kwDOSnzAgs8AAAABDXOlug"

# Step 2: Add to project
add_mutation = """
mutation {
  addProjectV2ItemById(input: {
    projectId: "PVT_kwHOAYYjQM4BYylY"
    contentId: "%s"
  }) { item { id } }
}
""" % issue_node_id

# ... execute via urllib.request

item_id = result["data"]["addProjectV2ItemById"]["item"]["id"]

# Step 3: Set status to Triage
status_mutation = """
mutation {
  updateProjectV2ItemFieldValue(input: {
    projectId: "PVT_kwHOAYYjQM4BYylY"
    itemId: "%s"
    fieldId: "PVTSSF_lAHOAYYjQM4BYylYzhT10fg"
    value: { singleSelectOptionId: "99c10a20" }
  }) { projectV2Item { id } }
}
""" % item_id
```

## Valid Colors

Enum `ProjectV2SingleSelectFieldOptionColor`:

| Name | Use case |
|------|----------|
| `GRAY` | Triage, Archived, neutral states |
| `BLUE` | Todo, Ready, informational |
| `GREEN` | In Progress, Running, positive states |
| `YELLOW` | Warning / attention-light |
| `ORANGE` | Ready, medium priority |
| `RED` | Blocked, urgent, error states |
| `PINK` | Special / highlight |
| `PURPLE` | Done, Completed, review states |

## Common Mistakes

1. **Using `updateProjectV2StatusField`** — this mutation does NOT exist. The correct mutation is `updateProjectV2Field` with the `singleSelectOptions` argument.
2. **Omitting existing option IDs** — if you don't include the `id` field for existing options, items already assigned those statuses will lose their field values. Query first, then pass IDs in the update.
3. **Mixing up Hermes kanban and GitHub board statuses** — the Hermes kanban SQLite DB has its own internal statuses. The GitHub board is a different system with a different Status field. Configure both independently.
4. **Forgetting the return field name** — the mutation returns `projectV2Field` (not `field`), which is a `ProjectV2FieldConfiguration` union. Use inline fragments to access `ProjectV2SingleSelectField` properties.
5. **Stale option IDs after re-run** — every time you run `updateProjectV2Field` without passing the current `id` values, GitHub generates new IDs for those options. Always re-query options after updating them.
