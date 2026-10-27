// The owner's RosterBots marks, as shipped in assets/brand, made from docs/brand/rosterbots by
// apps/mobile/scripts/brand-assets.ps1 (docs/brand/README.md). Each image carries its width:height
// so a screen can size it by width alone. Both are transparent and drawn for Midnight.

// The lockup carries the robot and "by TURBO DEVS"; it serves as the wordmark too until a
// smaller one is drawn.
export const LOCKUP = { source: require("../assets/brand/rosterbots-lockup.png"), aspect: 2.9106 } as const;
export const WORDMARK = LOCKUP;
export const ROBOT_PEEK = { source: require("../assets/brand/robot-peek.png"), aspect: 1.1928 } as const;
// The splash image itself: Android's 288 dp splash square with the lockup in its middle. Loading
// draws it at the same size, so the launch runs on from the splash without the lockup moving.
export const SPLASH = { source: require("../assets/splash-icon.png"), size: 288 } as const;
