import { Config } from "@remotion/cli/config";
import { existsSync } from "node:fs";

// Windows can refuse to run the unsigned headless Chrome that Remotion
// downloads (Smart App Control blocks unsigned programs), so render with an
// installed, signed Chrome when one exists.
const installedChrome = [
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((path) => existsSync(path));

if (installedChrome) {
  Config.setBrowserExecutable(installedChrome);
  Config.setChromeMode("chrome-for-testing");
}
