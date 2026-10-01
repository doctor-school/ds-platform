import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@ds/design-system';

export const Filled = () => (
  <InputOTP maxLength={6} value="482913" readOnly onChange={() => {}} aria-label="Код из письма">
    <InputOTPGroup>
      <InputOTPSlot index={0} />
      <InputOTPSlot index={1} />
      <InputOTPSlot index={2} />
    </InputOTPGroup>
    <InputOTPSeparator />
    <InputOTPGroup>
      <InputOTPSlot index={3} />
      <InputOTPSlot index={4} />
      <InputOTPSlot index={5} />
    </InputOTPGroup>
  </InputOTP>
);

export const Partial = () => (
  <InputOTP maxLength={6} value="48" onChange={() => {}} aria-label="Код из СМС">
    <InputOTPGroup>
      <InputOTPSlot index={0} />
      <InputOTPSlot index={1} />
      <InputOTPSlot index={2} />
      <InputOTPSlot index={3} />
      <InputOTPSlot index={4} />
      <InputOTPSlot index={5} />
    </InputOTPGroup>
  </InputOTP>
);

export const FourDigit = () => (
  <InputOTP maxLength={4} value="7305" readOnly onChange={() => {}} aria-label="Код подтверждения телефона">
    <InputOTPGroup>
      <InputOTPSlot index={0} />
      <InputOTPSlot index={1} />
      <InputOTPSlot index={2} />
      <InputOTPSlot index={3} />
    </InputOTPGroup>
  </InputOTP>
);
