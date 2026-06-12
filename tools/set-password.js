// Reset the admin password from the command line:
//   npm run set-password -- "my-new-password"
const auth = require('../lib/auth');

const next = process.argv[2];
if (!next || next.length < 8) {
  console.error('Usage: npm run set-password -- "new-password"  (min 8 characters)');
  process.exit(1);
}
auth.setPassword(next);
console.log('Admin password updated.');
