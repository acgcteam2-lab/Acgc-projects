export const normalizePhoneInput = (value) => {
  const input = String(value ?? "").trimStart();
  const digits = input.replace(/\D/g, "");
  return `${input.startsWith("+") ? "+" : ""}${digits}`;
};

export const isValidPhilippinePhone = (value) =>
  /^(?:09\d{9}|\+639\d{9}|639\d{9})$/.test(String(value ?? "").trim());

export const getPhilippinePhoneError = (value) => (
  isValidPhilippinePhone(value)
    ? ""
    : "Enter an 11-digit PH mobile number (09XXXXXXXXX) or +63 format (+639XXXXXXXXX)."
);