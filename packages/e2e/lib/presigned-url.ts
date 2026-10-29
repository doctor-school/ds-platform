/**
 * Blank the per-request nonces of every S3 SigV4 presigned URL in `text`, so
 * two reads of the same content compare equal (#3521).
 *
 * A speaker photo (and any other object-storage asset a read model carries) is
 * a presigned GET minted per request: `X-Amz-Date` is the signing instant to
 * the second, the date segment of `X-Amz-Credential` is its UTC day, and
 * `X-Amz-Signature` is derived from both. Two reads that straddle a second (or
 * UTC midnight) therefore differ in those three values while naming the same
 * object with the same expiry. They are request nonces, not content: every
 * other byte — the object key, bucket, region, access key, expiry and signed
 * headers — is kept, so a different object still compares unequal.
 *
 * Works on raw text (HTML or a JSON body before `JSON.parse`): a value ends at
 * `&`, `"` or whitespace.
 */
export function withoutPresignNonces(text: string): string {
  return text
    .replace(/(X-Amz-(?:Date|Signature))=[^&"\s]*/gu, "$1=")
    .replace(/(X-Amz-Credential=[^&"\s%]*%2F)\d{8}(?=%2F)/gu, "$1");
}
