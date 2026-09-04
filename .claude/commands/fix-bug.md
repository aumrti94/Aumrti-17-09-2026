---
description: Fix a reported bug without breaking existing functionality
---

Fix this bug: $ARGUMENTS

1. Read the error message and identify the affected file(s).
2. Read those files completely before making any changes.
3. Identify the root cause — do not fix symptoms.
4. Make the minimal change that fixes the root cause.
5. Verify the fix does not break related features.
6. Run the TypeScript check: `npm run build` (or `npx tsc --noEmit` for a faster type-only check).
7. If this is a UI-visible bug, start the dev server and verify the fix visually at
   `localhost:8080` before reporting done.
8. Report: what was broken, why it broke, what was changed.
