// GTM built-in trigger display name -> fixed numeric trigger id. These trigger objects always
// exist in every container but are never returned by triggers.list or triggers.get (confirmed
// live against the sandbox container 2026-08-29: 404 on triggers.get for both ids below, even
// though a tag's firingTriggerId referencing them creates and reads back successfully). Only the
// two ids confirmed live are listed; "Consent Initialization - All Pages" is a known GTM UI
// trigger but its numeric id could not be discovered through the API (triggers.get 404s
// regardless of the id tried, and the earlier discovery of the two below required watching the
// GTM UI auto-attach one when saving a tag through it, not an API call), so it's left out rather
// than guessed.
export const BUILT_IN_TRIGGERS: Record<string, string> = {
  'All Pages': '2147479553',
  'Initialization - All Pages': '2147479573',
};

export const BUILT_IN_TRIGGER_NAMES = Object.keys(BUILT_IN_TRIGGERS);

export const BUILT_IN_TRIGGER_IDS: Record<string, string> = Object.fromEntries(
  Object.entries(BUILT_IN_TRIGGERS).map(([name, id]) => [id, name]),
);
