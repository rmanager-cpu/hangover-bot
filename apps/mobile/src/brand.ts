// The owner's RosterBots marks, as shipped in assets/brand, made from docs/brand/rosterbots by
// apps/mobile/scripts/brand-assets.ps1 (docs/brand/README.md). Each image carries its width:height
// so a screen can size it by width alone. Both are transparent and drawn for Midnight.

// The lockup carries the robot and "by TURBO DEVS"; it serves as the wordmark too until a
// smaller one is drawn.
export const LOCKUP = { source: require("../assets/brand/rosterbots-lockup.png"), aspect: 2.9106 } as const;
export const WORDMARK = LOCKUP;
export const ROBOT_PEEK = { source: require("../assets/brand/robot-peek.png"), aspect: 1.1928 } as const;
