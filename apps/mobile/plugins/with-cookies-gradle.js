// @react-native-cookies/cookies 6.2.1 (May 2022, the last release) still names jcenter()
// in its android/build.gradle. Gradle 9, which React Native 0.86 builds with, no longer
// has jcenter(), so that one line would stop the Android build. This swaps it for
// mavenCentral() during prebuild, on whichever machine builds the app, EAS included.
// It changes nothing else, and does nothing once the library stops saying jcenter().

const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

function libraryGradle(projectRoot) {
  try {
    const pkg = require.resolve("@react-native-cookies/cookies/package.json", { paths: [projectRoot] });
    return path.join(path.dirname(pkg), "android", "build.gradle");
  } catch {
    return null;
  }
}

module.exports = function withCookiesGradle(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const file = libraryGradle(cfg.modRequest.projectRoot);
      if (!file || !fs.existsSync(file)) return cfg;
      const before = fs.readFileSync(file, "utf8");
      const after = before.split("jcenter()").join("mavenCentral()");
      if (after !== before) fs.writeFileSync(file, after);
      return cfg;
    },
  ]);
};
