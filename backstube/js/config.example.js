/* Template. start.sh generates js/config.js from ~/Smittenbrot-App/.credentials/aoryok.env.
 *
 * The ANON key is public by design — it already ships inside the public website's
 * JS bundle, and every bs_ table is RLS-locked to is_admin(). It is kept out of git
 * anyway, so there is no question to answer later.
 *
 * NEVER put the service_role key in this folder.
 */
const CONFIG = {
  url:  'https://aoryokgzmpezanmlgxtl.supabase.co',
  anon: 'PASTE_ANON_KEY_OR_RUN_start.sh',
};
