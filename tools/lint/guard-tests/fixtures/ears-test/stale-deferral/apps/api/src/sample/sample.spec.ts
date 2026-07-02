describe("sms otp", () => {
  // EARS-7 IS covered here, yet the injected allowlist still defers it → the guard
  // must flag the allowlist entry as stale (remove it) and fail.
  it("EARS-7: sends the SMS OTP", () => {});
});
