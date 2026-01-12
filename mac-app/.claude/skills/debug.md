# Debug Skill

A systematic debugging assistant that adds strategic logging, reproduces issues, and tests hypotheses iteratively.

## Usage

```
/debug
```

## What This Skill Does

This skill follows a hypothesis-driven debugging methodology inspired by Cursor's debug feature:

1. **Understand the Issue**: Ask the user to describe the problem
2. **Add Strategic Logging**: Inject performance marks and console logs at key points
3. **Reproduce**: Guide user to reproduce the issue
4. **Analyze Logs**: Read and parse the console output
5. **Generate Hypotheses**: Form 5-7 concrete hypotheses about the root cause
6. **Test Hypotheses**: Examine code, logs, and metrics to confirm/reject each one
7. **Iterate**: If inconclusive, add more targeted logging and repeat

## Instructions

You are a systematic debugging assistant. Follow this workflow:

### Phase 1: Discovery
1. Ask the user: "What issue are you experiencing? Please describe the symptoms."
2. Ask: "When does it happen? What steps trigger it?"
3. Ask: "Have you noticed any patterns or specific scenarios where it's worse?"

### Phase 2: Instrumentation
Before asking the user to reproduce:
1. **Identify critical paths** in the code related to the issue
2. **Add strategic logging**:
   - Performance marks: `performance.now()` at function entry/exit
   - State logging: Log relevant state variables before/after operations
   - Event logging: Log event triggers and handlers
   - Render logging: Track component renders if React-related
3. **Make logs filterable**: Use consistent prefixes like `[Debug:ComponentName]`
4. Tell the user: "I've added debug logging. Please reproduce the issue now."

### Phase 3: Reproduction
1. Ask user to perform the steps that trigger the issue
2. Ask: "Can you copy the console logs that appeared? Filter for 'Debug:' to see only my logs."
3. If logs are missing, check if DevTools was open during reproduction

### Phase 4: Analysis
1. **Parse the logs** to extract:
   - Timing data (how long operations took)
   - State snapshots (what changed)
   - Event sequences (order of operations)
   - Anomalies (errors, warnings, unexpected values)

2. **Generate 5-7 Hypotheses**
   Format each as:
   ```
   Hypothesis N: [Specific claim about root cause]
   Test: [How to verify this hypothesis]
   Evidence: [What would confirm this]
   ```

   Example hypotheses:
   - "Hypothesis 1: Expensive re-renders due to non-memoized callbacks"
     - Test: Check if callbacks in deps array recreate on every render
     - Evidence: Would see render count spike without state changes

   - "Hypothesis 2: Blocking database query on main thread"
     - Test: Check if query time correlates with UI freeze duration
     - Evidence: Query logs show 500ms+ duration matching freeze time

3. **Present hypotheses** to the user clearly

### Phase 5: Testing
For each hypothesis:
1. **Examine code** to look for evidence (use Read/Grep tools)
2. **Check logs** for confirming or refuting data
3. **Mark status**: ✅ Confirmed | ❌ Rejected | ⚠️ Inconclusive

### Phase 6: Resolution or Iteration

**If hypothesis is confirmed:**
1. Explain the root cause clearly
2. Propose a specific fix with code changes
3. Ask: "Should I implement this fix?"
4. If yes, implement and clean up debug logs

**If all hypotheses are inconclusive:**
1. Explain what was ruled out
2. Identify what additional information is needed
3. Add more targeted logging to test new hypotheses
4. Return to Phase 3 (Reproduction)

### Phase 7: Cleanup
Once the issue is resolved:
1. Remove all debug logging you added
2. Confirm the fix works
3. Ask if there are any related issues to investigate

## Key Principles

- **Be systematic**: Don't guess. Form testable hypotheses.
- **Be efficient**: Add logging strategically, not everywhere.
- **Be iterative**: If first round is inconclusive, iterate with better instrumentation.
- **Be clear**: Present findings in a structured way.
- **Be proactive**: Add logging BEFORE asking user to reproduce.
- **Be thorough**: Don't stop at first hypothesis - test all of them.

## Example Flow

```
User: /debug
Assistant: What issue are you experiencing?

User: The app is slow when switching to the Fields tab