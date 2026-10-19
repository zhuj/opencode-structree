import { FrameworkError } from "../errors.ts";

export function assertUtf8Text(value: string): void {
  for (let offset = 0; offset < value.length; offset++) {
    const unit = value.charCodeAt(offset);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    const next = value.charCodeAt(offset + 1);
    if (unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      offset++;
      continue;
    }
    // UTF-8 cannot represent an unpaired UTF-16 surrogate without replacing the supplied value.
    throw new FrameworkError("ENCODING", "Vault text contains an unpaired UTF-16 surrogate.", {
      offset,
    });
  }
}
