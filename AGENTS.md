## 🛑 Testing Protocol: Prevent Bug Ossification

When asked to write, update, or generate tests for a given piece of code, you **MUST NOT** blindly mirror the current implementation. You must assume the current code may contain bugs, and your job is to validate its *intent*, not its *current state*.

**Your primary directive for testing is Behavior-Driven over Implementation-Driven.**

Follow these strict rules when generating tests:

1. **Find the Source of Truth:** Base your test assertions on the provided business requirements, docstrings, issue descriptions, or standard domain logic—*never* solely on what the code currently does. If the intent is ambiguous, ask the user for clarification before writing the test.
2. **Do Not Cement Bugs:** If the current implementation contradicts the stated requirements or docstrings, write the test to reflect the *requirements*. **It is acceptable and encouraged for your generated tests to fail** if the underlying code is wrong.
3. **Avoid Tautologies:** Never write tests that effectively assert a function does what it currently does just to achieve coverage. Every assertion must map to a specific behavioral requirement.
4. **Test the "Black Box":** Focus on public interfaces, validating inputs and outputs. Avoid over-mocking internal dependencies or testing private methods just to force high code coverage. 
5. **Include the "Gotchas":** Actively consider and write tests for edge cases, null states, boundary conditions, and domain-specific failures, even if the current implementation does not handle them.
