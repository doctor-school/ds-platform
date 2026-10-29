import { describe, expect, it } from "vitest";

import { withoutPresignNonces } from "./presigned-url";

// Two reads of the same expert photo, one second apart, as the stage api
// answered them in Stage main run 40857309501 (#3521): same object, same
// expiry, different signing instant and therefore a different signature.
const object =
  "https://s3.stage.doctor.school/ds-main/golden/experts/1001.webp";
const signed = (date: string, signature: string) =>
  `${object}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=stageminio%2F${date.slice(0, 8)}%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=${date}&X-Amz-Expires=900&X-Amz-Signature=${signature}&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject`;

describe("withoutPresignNonces — per-request presign nonces are not content", () => {
  it("020 EARS-1: two signings of one object a second apart compare equal", () => {
    const a = JSON.stringify({
      photoUrl: signed("20261029T111525Z", "05399ba4"),
    });
    const b = JSON.stringify({
      photoUrl: signed("20261029T111526Z", "5a11aef7"),
    });
    expect(a).not.toBe(b);
    expect(withoutPresignNonces(b)).toBe(withoutPresignNonces(a));
  });

  it("020 EARS-1: signings straddling UTC midnight still compare equal (the credential scope carries the date)", () => {
    expect(withoutPresignNonces(signed("20261029T235959Z", "aaaa"))).toBe(
      withoutPresignNonces(signed("20261030T000000Z", "bbbb")),
    );
  });

  it("020 EARS-1: a different object, region or expiry still differs", () => {
    const base = withoutPresignNonces(signed("20261029T111525Z", "aaaa"));
    expect(
      withoutPresignNonces(
        signed("20261029T111525Z", "aaaa").replace("1001.webp", "1002.webp"),
      ),
    ).not.toBe(base);
    expect(
      withoutPresignNonces(
        signed("20261029T111525Z", "aaaa").replace("us-east-1", "ru-1"),
      ),
    ).not.toBe(base);
    expect(
      withoutPresignNonces(
        signed("20261029T111525Z", "aaaa").replace(
          "X-Amz-Expires=900",
          "X-Amz-Expires=60",
        ),
      ),
    ).not.toBe(base);
  });

  it("020 EARS-1: text without a presigned URL passes through unchanged", () => {
    const text = '{"title":"Вебинар","photoUrl":null}';
    expect(withoutPresignNonces(text)).toBe(text);
  });
});
