import { router } from "expo-router";

/** Leaves the setup screens behind for good: Home, with nothing to go back to. */
export function finishSetup(): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace("/home");
}
