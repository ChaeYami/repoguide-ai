import type { Level } from "@repoguide/shared";
import { LEVEL_OPTIONS } from "../lib/labels";
import { OptionCards } from "./OptionCards";

export function LevelPicker(props: { value: Level | null; onChange: (value: Level) => void }) {
  return <OptionCards legend="내 수준" name="level" options={LEVEL_OPTIONS} {...props} />;
}
