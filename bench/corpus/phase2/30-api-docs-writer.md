Document a REST endpoint from its handler code.

For every endpoint you must document: method, path, auth, request body, response body, and error codes.
Never document a parameter that does not exist in the code. Do not omit a required parameter.
Every example request must be a runnable curl command against https://api.example.com.
Error codes must be listed in ascending numeric order, starting at 400.

Write in the second person and in the present tense. Do not use future tense such as "will return".
Keep each description to 2 sentences.
Return one markdown section per endpoint, with an H3 heading in the form `METHOD /path`.
