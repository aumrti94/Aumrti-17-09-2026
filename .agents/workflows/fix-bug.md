# Workflow: Bug Fix

Goal: Fix a reported bug without breaking existing functionality.

Steps:
1. Read the error message and identify the affected file(s).
2. Read those files completely before making any changes.
3. Identify the root cause — do not fix symptoms.
4. Make the minimal change that fixes the root cause.
5. Verify the fix does not break related features.
6. Run TypeScript check: bun tsc --noEmit
7. Open the browser to localhost:8080 and verify the fix visually.
8. Report: what was broken, why it broke, what was changed.
