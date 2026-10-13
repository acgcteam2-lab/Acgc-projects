export const PASSWORD_POLICY_MESSAGE = "Use 8-128 characters with uppercase, lowercase, a number, and a symbol.";

export const isPasswordPolicySatisfied = (password) => (
  typeof password === "string" &&
  password.length >= 8 &&
  password.length <= 128 &&
  /[a-z]/.test(password) &&
  /[A-Z]/.test(password) &&
  /\d/.test(password) &&
  /[^A-Za-z0-9]/.test(password)
);