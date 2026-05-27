# GitHub Projects v2 — GraphQL Queries

Quick-reference queries for configuring Projects v2 boards via the GitHub GraphQL API.

## Discovery — list all user projects

```graphql
query {
  user(login: "LOGIN") {
    projectsV2(first: 10) {
      nodes { id title url closed }
    }
  }
}
```

## Discover project fields and Status options

```graphql
query {
  node(id: "PROJECT_NODE_ID") {
    ... on ProjectV2 {
      fields(first: 20) {
        nodes {
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id name }
          }
          ... on ProjectV2Field {
            id
            name
            dataType
          }
        }
      }
    }
  }
}
```

## Create a new project board

```graphql
mutation {
  createProjectV2(input: {
    ownerId: "OWNER_NODE_ID",
    title: "Project Name"
  }) {
    projectV2 { id number title url createdAt }
  }
}
```

## Update Status field with custom workflow stages

```graphql
mutation {
  updateProjectV2Field(input: {
    fieldId: "PVTSSF_lAHO...",
    singleSelectOptions: [
      # Preserve existing option IDs for options you're keeping
      {id: "f75ad846", name: "Todo",        color: BLUE,   description: "Not started"},
      {id: "47fc9ee4", name: "In Progress", color: GREEN,  description: "Active"},
      {id: "98236657", name: "Done",        color: PURPLE, description: "Complete"},
      # New options — no id field, auto-assigned
      {name: "Triage",    color: GRAY,   description: "Awaiting triage"},
      {name: "Ready",     color: BLUE,   description: "Ready to pick up"},
      {name: "Running",   color: GREEN,  description: "Being worked on"},
      {name: "Blocked",   color: RED,    description: "Stuck"},
      {name: "Archived",  color: GRAY,   description: "No longer relevant"}
    ]
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id
        name
        options { id name }
      }
    }
  }
}
```

## Add a GitHub issue/PR to a project board

First, get the content's `node_id`. For an issue or PR, it's the `node_id` field from the GitHub REST API or from the `createIssue`/`createPullRequest` GraphQL mutation response.

```graphql
mutation {
  addProjectV2ItemById(input: {
    projectId: "PROJECT_NODE_ID",
    contentId: "ISSUE_NODE_ID"
  }) {
    item {
      id           # The project item's ID (PVTI_...), needed for status updates
    }
  }
}
```

## Set an item's Status on the board

After adding an item to the board, set its Status field value using the option IDs discovered via the field discovery query above (the `updateProjectV2Field` mutation returns new IDs for options created without explicit IDs):

```graphql
mutation {
  updateProjectV2ItemFieldValue(input: {
    projectId: "PROJECT_NODE_ID",
    itemId: "PVTI_...",       # from addProjectV2ItemById above
    fieldId: "PVTSSF_...",    # the Status field's node ID
    value: {
      singleSelectOptionId: "99c10a20"  # the target option's ID (e.g. "Triage")
    }
  }) {
    projectV2Item {
      id
    }
  }
}
```

**Pitfalls:**
- The option IDs CHANGE whenever you re-create the status options via `updateProjectV2Field` with different option lists. If you replace "Todo, In Progress, Done" with "Triage, Todo, Ready, Running, Blocked, Completed, Archived", the old option IDs are invalid. Re-query the field after any status update to get the current option IDs.
- `updateProjectV2ItemFieldValue` fails with `"The single select option Id does not belong to the field"` if you pass an old/stale option ID. Always query current options (see "Discover project fields and Status options" above) before setting status on a new item.

```
GRAY, BLUE, GREEN, YELLOW, ORANGE, RED, PINK, PURPLE
```

## Label management REST endpoints

| Action | Method | Endpoint |
|---|---|---|
| List labels | GET | `/repos/{owner}/{repo}/labels` |
| Create label | POST | `/repos/{owner}/{repo}/labels` |
| Update label | PATCH | `/repos/{owner}/{repo}/labels/{name}` |
| Delete label | DELETE | `/repos/{owner}/{repo}/labels/{name}` |

Label payload:
```json
{"name": "bug", "color": "d73a4a", "description": "Something isn't working"}
```
