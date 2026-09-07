// Apply to the extracted, pinned private app worker package before npm pack.
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const file = path.join(root, 'dist/cli.js');
let source = fs.readFileSync(file, 'utf8');
function replace(from, to) { if (!source.includes(from)) throw new Error('Worker patch target missing'); source = source.replace(from, to); }
replace("        .option('--cookies <values...>',", "        .option('--credentials-stdin', 'Read app session credentials from stdin; never read browser storage')\n        .option('--cookies <values...>',");
replace('                const { csrfToken, cookieHeader } = parseCookieOption(options.cookies);', `                let credentials;
                if (options.credentialsStdin) {
                    let input = '';
                    for await (const chunk of process.stdin) {
                        input += chunk.toString();
                        if (input.length > 16384) throw new Error('Invalid app session credentials');
                    }
                    credentials = JSON.parse(input);
                    if (!credentials || !/^[a-zA-Z0-9]+$/.test(credentials.csrfToken ?? '') ||
                        !/^ct0=[a-zA-Z0-9]+; auth_token=[a-zA-Z0-9]+$/.test(credentials.cookieHeader ?? '')) {
                        throw new Error('Invalid app session credentials');
                    }
                } else {
                    credentials = parseCookieOption(options.cookies);
                }
                const { csrfToken, cookieHeader } = credentials;`);
replace("const output = { mode: 'quick', status: 'error', added: 0", "const output = { mode: 'quick', status: /returned (401|403)\\b|Invalid app session credentials/.test(error.message) ? 'auth_required' : 'error', added: 0");
// Invalid/expired sessions may be returned as HTTP 200 with GraphQL auth errors.
fs.writeFileSync(file, source);
const graph = path.join(root, 'dist/graphql-bookmarks.js');
let graphql = fs.readFileSync(graph, 'utf8');
const target = '        const json = await response.json();';
if (!graphql.includes(target)) throw new Error('GraphQL patch target missing');
graphql = graphql.replace(target, target + `
        if (json?.errors?.some(error => [32, 89, 135, 215, 239].includes(error.code))) {
            throw new Error('GraphQL Bookmarks API returned 401.');
        }`);
fs.writeFileSync(graph, graphql);
const manifest = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')); pkg.version = '1.3.23-local.2';
fs.writeFileSync(manifest, JSON.stringify(pkg, null, 2) + '\n');
