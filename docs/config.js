// Set this to your booking backend to enable live slot booking on the
// public site. Easiest: deploy apps-script/Code.gs as a web app (see
// README) and paste its URL here, e.g.
//   window.BOOKING_API = "https://script.google.com/macros/s/XXXX/exec";
// A hosted copy of server.js works too. Leave empty to show call/text
// contact options on the Book page instead.
window.BOOKING_API = "https://script.google.com/macros/s/AKfycbxBoG2TmeV5LAygkvViCUhcLO6Ad9gsksrph6l4E7ERBHKh8CTkwQDvbMSwE50kgh9l/exec";

// Optional Cloudflare Turnstile site key (bot protection on the booking form).
// Leave empty to keep booking open. To enable: paste your Turnstile *site key*
// here AND add the matching *secret* as a TURNSTILE_SECRET Script Property in
// the Apps Script project, then redeploy the script.
window.TURNSTILE_SITEKEY = "0x4AAAAAADkLDpfqEh9N-xbH";
