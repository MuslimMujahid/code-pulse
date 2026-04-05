---
name: ralph-gh
description: Convert a PRD GitHub issue to prd.json format for the ralph-gh autonomous agent. Use when you have a PRD issue and need to create prd.json. Triggers on: convert this prd, create prd.json, ralph-gh json, turn into ralph format.
user-invocable: true
---

# ralph-gh PRD Converter

Converts a PRD GitHub issue to `.ralph-gh/prd.json` for autonomous execution by `ralph-gh run`.

---

## The Job

1. Get the PRD issue number from the current session context (the issue just created by `/prd`)
2. Fetch the full PRD: `gh issue view <number>`
3. Convert the PRD's user stories into `.ralph-gh/prd.json`
4. Tell the user: "prd.json written. Run `ralph-gh run` to start the agent."

---

## Output Format

```json
{
  "project": "[Project Name]",
  "branchName": "feat/[feature-name-kebab-case]",
  "description": "[Feature description from PRD title/intro]",
  "userStories": [
    {
      "id": "US-001",
      "title": "[Story title]",
      "description": "As a [user], I want [feature] so that [benefit]",
      "acceptanceCriteria": [
        "Criterion 1",
        "Criterion 2",
        "Typecheck passes"
      ],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
```

Write to: `.ralph-gh/prd.json`

---

## Branch Name

- Use prefix `feat/` followed by a slug derived from the PRD title
- Slug: lowercase, hyphens, 3-6 words
- Example: `feat/task-priority-system`

---

## Story Size: The Number One Rule

**Each story must be completable in ONE ralph-gh iteration (one context window).**

Each iteration spawns a fresh AI instance with clean context. If a story is too big, the agent runs out of context before finishing and produces broken code.

### Right-sized stories:
- Add a database column and migration
- Add a UI component to an existing page
- Update a server action with new logic
- Add a filter dropdown to a list

### Too big (split these):
- "Build the entire dashboard" — split into: schema, queries, UI components, filters
- "Add authentication" — split into: schema, middleware, login UI, session handling
- "Refactor the API" — split into one story per endpoint or pattern

**Rule of thumb:** If you cannot describe the change in 2-3 sentences, it is too big.

---

## Story Ordering: Dependencies First

Stories execute in priority order. Earlier stories must not depend on later ones.

**Correct order:**
1. Schema / database changes (migrations)
2. Server actions / backend logic
3. UI components that use the backend
4. Dashboard / summary views that aggregate data

---

## Acceptance Criteria: Must Be Verifiable

Each criterion must be something the agent can CHECK, not something vague.

### Good (verifiable):
- "Add `status` column to tasks table with default 'pending'"
- "Filter dropdown has options: All, Active, Completed"
- "Clicking delete shows confirmation dialog"
- "Typecheck passes"

### Bad (vague):
- "Works correctly"
- "User can do X easily"
- "Handles edge cases"

### Always include as final criterion:
```
"Typecheck passes"
```

For stories with testable logic, also include:
```
"Tests pass"
```

For stories that change UI, also include:
```
"Verify in browser using dev-browser skill"
```

---

## Checklist Before Writing

- [ ] Each story is completable in one iteration (small enough)
- [ ] Stories are ordered by dependency (schema → backend → UI)
- [ ] Every story has "Typecheck passes" as a criterion
- [ ] UI stories have "Verify in browser using dev-browser skill"
- [ ] Acceptance criteria are verifiable, not vague
- [ ] No story depends on a later story
- [ ] All stories start with `passes: false`
