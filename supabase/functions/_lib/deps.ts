// The service's outside world, as the Edge Functions provide it.

import { BETA_AUTOMATION } from "@rosterbots/core";
import { espnConnector } from "@rosterbots/connectors";
import { expoPush, type Deps } from "@rosterbots/service";
import type { AppStore } from "./store.ts";

export function makeDeps(store: AppStore): Deps {
  return {
    store,
    push: expoPush(),
    connector: (credentials, season) => espnConnector({ season, credentials }),
    now: () => new Date(),
    policy: BETA_AUTOMATION,
  };
}
