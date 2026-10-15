export const PASSWORD_POLICY_MIN_LENGTH = 12;
export const PASSWORD_POLICY_MESSAGE = "Use 12-128 characters with uppercase, lowercase, a number, and a symbol.";

export const isPasswordPolicySatisfied = (password) => (
  typeof password === "string" &&
  password.length >= PASSWORD_POLICY_MIN_LENGTH &&
  password.length <= 128 &&
  /[a-z]/.test(password) &&
  /[A-Z]/.test(password) &&
  /\d/.test(password) &&
  /[^A-Za-z0-9]/.test(password)
);