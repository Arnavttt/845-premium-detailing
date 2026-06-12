// Builds the static GitHub Pages version of the customer site into docs/.
//   npm run build-pages
//
// Pages can't run the Node backend, so this bakes data/content.json into
// the page and rewrites absolute asset paths to relative ones (Pages serves
// from a /845-premium-detailing/ subpath). Booking talks to the URL in
// docs/config.js if set; otherwise the Book page shows call/text options.
// Re-run after editing site content in the admin, then commit and push.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'docs');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

copyDir(SRC, OUT);

// Absolute -> relative paths so the site works from a subpath.
const indexPath = path.join(OUT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html
  .replace(/(href|src)="\/(?!\/)/g, '$1="')
  .replace('<script src="app.js"></script>',
    '<script src="content.js"></script>\n  <script src="config.js"></script>\n  <script src="app.js"></script>');
fs.writeFileSync(indexPath, html);

const fontsPath = path.join(OUT, 'assets', 'fonts.css');
fs.writeFileSync(fontsPath,
  fs.readFileSync(fontsPath, 'utf8').replace(/url\("\/assets\/fonts\//g, 'url("fonts/'));

// Bake the live site content into the static page.
const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content.json'), 'utf8'));
fs.writeFileSync(path.join(OUT, 'content.js'),
  'window.STATIC_SITE = true;\nwindow.SITE_CONTENT = ' + JSON.stringify(content, null, 2) + ';\n');

// Booking backend URL - kept across rebuilds so a configured URL survives.
const configPath = path.join(OUT, 'config.js');
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, [
    '// Set this to your deployed booking server to enable live booking on the',
    '// static site, e.g. window.BOOKING_API = "https://your-app.onrender.com";',
    '// Leave empty to show call/text contact options on the Book page instead.',
    'window.BOOKING_API = "";',
    ''
  ].join('\n'));
}

// Pages serves files starting with no Jekyll processing.
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log('Built static site into docs/ (' + fs.readdirSync(OUT).length + ' top-level entries).');
const apiMatch = fs.readFileSync(configPath, 'utf8').match(/^window\.BOOKING_API = "(.*)";/m);
console.log('Booking API: ' + ((apiMatch && apiMatch[1]) || '(none - Book page shows call/text)'));
