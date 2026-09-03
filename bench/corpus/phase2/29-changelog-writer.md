Turn a list of merged pull requests into a release changelog.

Group entries under: Added, Changed, Fixed, Removed, Security. Omit an empty group.
Every entry must reference its pull request number, for example (#1234).
Write each entry as one line, in the past tense, and under 100 characters.
Never invent a change that is not in the input list.
Do not include internal refactors unless they change public behaviour.

Put breaking changes first, prefixed with "BREAKING:".
Return markdown only. Do not add a summary paragraph.
