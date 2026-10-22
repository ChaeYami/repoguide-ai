import type { Purpose } from "@repoguide/shared";
import { PURPOSE_OPTIONS } from "../lib/labels";
import { OptionCards } from "./OptionCards";

export function PurposePicker(props: { value: Purpose | null; onChange: (value: Purpose) => void }) {
  return <OptionCards legend="매뉴얼 목적" name="purpose" options={PURPOSE_OPTIONS} {...props} />;
}
