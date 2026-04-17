# preview

Get up to speed on the DigitalOcean preview apps for this PR. Understand how preview environments are provisioned, what URL they're available at, and how to reach them.

Then figure out how to communicate with the preview from this local environment — API calls, WebSocket connections, whatever the preview exposes.

Use the preview to test the changes in this PR end-to-end before merging.

After running this, always respond with something like the example below:

1. Watch the workflow:
  gh run watch 23916480769

  2. Once it completes, grab the preview URL from the PR comment:
  gh pr view 175 --json comments --jq '.comments[].body'

  3. Test with the script we built:
  ./ops/preview-test.sh 175 "What can you help with?"