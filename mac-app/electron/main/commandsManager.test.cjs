/**
 * Simple test script for CommandsManager detection logic.
 * 
 * Run: node electron/main/commandsManager.test.cjs
 */

const testCases = [
  // Singular command - should match the one nearest command name
  {
    name: 'Simple singular: "run the include command"',
    text: 'run the include command',
    availableCommands: ['include', 'flow', 'commit'],
    expectedMatches: ['include'],
  },
  
  // Key test: common word used, then explicit command
  {
    name: 'False positive prevention: "please include some stuff and run the flow command"',
    text: 'please include some stuff and run the flow command',
    availableCommands: ['include', 'flow', 'commit'],
    expectedMatches: ['flow'], // Should NOT match 'include'
  },
  
  // Plural commands - should match multiple
  {
    name: 'Plural commands list: "use the commands include, commit, and main"',
    text: 'use the commands include, commit, and main',
    availableCommands: ['include', 'commit', 'main', 'flow'],
    expectedMatches: ['include', 'commit', 'main'],
  },
  
  // Multiple singular command mentions
  {
    name: 'Multiple singular mentions: "run the include command and then the flow command"',
    text: 'run the include command and then the flow command',
    availableCommands: ['include', 'flow', 'commit'],
    expectedMatches: ['include', 'flow'],
  },
  
  // No command word
  {
    name: 'No command word: "please include this in the review"',
    text: 'please include this in the review',
    availableCommands: ['include', 'flow', 'commit'],
    expectedMatches: [], // No "command" word, so no match
  },
  
  // Command appears but no matching command name nearby
  {
    name: 'No matching command nearby: "run the debug command"',
    text: 'run the debug command',
    availableCommands: ['include', 'flow', 'commit'],
    expectedMatches: [], // 'debug' is not a known command
  },
  
  // Test word boundary
  {
    name: 'Word boundary: should not match "including"',
    text: 'the including stuff is done, run the flow command',
    availableCommands: ['include', 'flow'],
    expectedMatches: ['flow'], // 'including' shouldn't match 'include'
  },
  
  // Order before command word
  {
    name: 'Command name before word: "flow command please"',
    text: 'flow command please',
    availableCommands: ['include', 'flow', 'commit'],
    expectedMatches: ['flow'],
  },
  
  // Multiple command words with common word used
  {
    name: 'Complex sentence with false positive risk',
    text: 'I want to include some context. Now run the commit command.',
    availableCommands: ['include', 'commit', 'flow'],
    expectedMatches: ['commit'], // Only 'commit' is explicitly invoked
  },
];

/**
 * Find all occurrences of "command" and "commands" in text.
 */
function findCommandWords(text) {
  const matches = [];
  const regex = /\bcommands?\b/gi;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const isPlural = match[0].toLowerCase() === 'commands';
    matches.push({ index: match.index, isPlural });
  }
  
  return matches;
}

/**
 * Check if a match at a given index represents a complete word.
 */
function isWordBoundary(text, index, word) {
  const beforeChar = index > 0 ? text[index - 1] : ' ';
  const afterChar = index + word.length < text.length ? text[index + word.length] : ' ';
  
  const boundaryPattern = /[\s,.:;!?'"()\[\]{}|<>\/\\-]/;
  const isBeforeBoundary = index === 0 || boundaryPattern.test(beforeChar);
  const isAfterBoundary = index + word.length === text.length || boundaryPattern.test(afterChar);
  
  return isBeforeBoundary && isAfterBoundary;
}

/**
 * Find the nearest command name to a given position (for singular "command").
 */
function findNearestCommand(text, commandWordIndex, availableCommands, alreadyMatched) {
  const windowSize = 50;
  const windowStart = Math.max(0, commandWordIndex - windowSize);
  const windowEnd = Math.min(text.length, commandWordIndex + 'command'.length + windowSize);
  
  let nearestCommand = null;
  let nearestDistance = Infinity;

  for (const commandName of availableCommands) {
    if (alreadyMatched.has(commandName)) continue;

    let searchStart = 0;
    while (true) {
      const nameIndex = text.indexOf(commandName, searchStart);
      if (nameIndex === -1) break;

      if (nameIndex >= windowStart && nameIndex <= windowEnd) {
        if (isWordBoundary(text, nameIndex, commandName)) {
          const distance = Math.abs(nameIndex - commandWordIndex);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestCommand = commandName;
          }
        }
      }

      searchStart = nameIndex + 1;
    }
  }

  return nearestCommand;
}

/**
 * Find multiple commands in a list following "commands" (plural).
 */
function findCommandsInList(text, commandsWordIndex, availableCommands, alreadyMatched) {
  const foundCommands = [];
  
  const searchStart = commandsWordIndex + 'commands'.length;
  const searchEnd = Math.min(text.length, searchStart + 100);
  
  const remainingText = text.slice(searchStart, searchEnd);
  const sentenceEnd = remainingText.search(/[.!?]/);
  const listText = sentenceEnd !== -1 
    ? remainingText.slice(0, sentenceEnd) 
    : remainingText;

  for (const commandName of availableCommands) {
    if (alreadyMatched.has(commandName)) continue;

    const nameIndex = listText.toLowerCase().indexOf(commandName);
    if (nameIndex !== -1) {
      if (isWordBoundary(listText.toLowerCase(), nameIndex, commandName)) {
        foundCommands.push(commandName);
      }
    }
  }

  return foundCommands;
}

/**
 * Simulate the detection logic for testing purposes.
 */
function detectCommands(text, availableCommands) {
  const lowerText = text.toLowerCase();
  const commandSet = new Set(availableCommands.map(c => c.toLowerCase()));

  // Check if "command" or "commands" appears in the text.
  if (!lowerText.includes('command')) {
    return [];
  }

  const matchedCommandNames = new Set();
  const commandWordMatches = findCommandWords(lowerText);

  for (const match of commandWordMatches) {
    if (match.isPlural) {
      // Plural "commands" → look for multiple command names in a list.
      const listCommands = findCommandsInList(lowerText, match.index, commandSet, matchedCommandNames);
      for (const cmd of listCommands) {
        matchedCommandNames.add(cmd);
      }
    } else {
      // Singular "command" → find the ONE nearest command name.
      const nearestCommand = findNearestCommand(lowerText, match.index, commandSet, matchedCommandNames);
      if (nearestCommand) {
        matchedCommandNames.add(nearestCommand);
      }
    }
  }

  return Array.from(matchedCommandNames);
}

// Run tests
function runTests() {
  console.log('Running CommandsManager detection logic tests...\n');
  
  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const result = detectCommands(testCase.text, testCase.availableCommands);
    const resultSorted = result.sort();
    const expectedSorted = testCase.expectedMatches.sort();
    
    const success = 
      resultSorted.length === expectedSorted.length &&
      resultSorted.every((v, i) => v === expectedSorted[i]);

    if (success) {
      console.log(`✅ PASS: ${testCase.name}`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${testCase.name}`);
      console.log(`   Input: "${testCase.text}"`);
      console.log(`   Available: [${testCase.availableCommands.join(', ')}]`);
      console.log(`   Expected: [${testCase.expectedMatches.join(', ')}]`);
      console.log(`   Got:      [${result.join(', ')}]`);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
