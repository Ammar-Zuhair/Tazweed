import { downloadOnce } from "./update-policy";
import * as Updates from "expo-updates";
import Constants from "expo-constants";
let requested = false;
export async function downloadUpdateForNextLaunch(): Promise<void> {
  if (
    requested ||
    __DEV__ ||
    Constants.executionEnvironment === "storeClient" ||
    !Updates.isEnabled
  )
    return;
  requested = true;
  await downloadOnce(Updates);
}
