// delete-account: permanently deletes the caller's own account and everything attached to
// it. The migration's five tables all reference auth.users(id) on delete cascade, including
// credentials, whose own after-delete trigger drops the ESPN session from Vault, so deleting
// the auth user is the one call that removes every row: credentials, leagues, moves,
// receipts and this phone's push token. Works for an anonymous account too: Google Play's
// account-deletion requirement applies the moment an account exists, not only once it is
// claimed by email.
//   {} -> { ok: true }

import { requireUser } from "../_lib/auth.ts";
import { HttpError, json, serve } from "../_lib/http.ts";
import { adminClient } from "../_lib/store.ts";

serve("delete-account", async (req) => {
  const db = adminClient();
  const user = await requireUser(req, db);
  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) {
    // Name and status only: never anything that could be the user's own data.
    console.error(`delete-account: admin.deleteUser refused (${error.status ?? "no status"} ${error.name})`);
    throw new HttpError(500, "internal", "Couldn't delete your account. Try again in a minute.");
  }
  console.log(`delete-account: ${user.id} deleted`);
  return json({ ok: true });
});
