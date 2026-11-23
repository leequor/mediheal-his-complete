// Supabase connection for MediHeal HIS.
//
// Both values below are safe to publish: the anon key is designed to live in a browser, and it only
// reaches rows that RLS (supabase/migrations/0001_init.sql) allows for the visitor's own anonymous
// identity. NEVER put a service_role key here — it bypasses every policy.
//
// Leave both strings empty to run the site exactly as before, with no backend at all. That is the
// committed default, so a fresh clone and the public demo work with no configuration.
window.MEDIHEAL_SUPABASE = {
  url: '',   // e.g. 'https://abcdefghijklmnop.supabase.co'
  key: ''    // the anon / publishable key: eyJhbGciOi...
};
