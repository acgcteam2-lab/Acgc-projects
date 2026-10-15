export const PASSWORD_POLICY_MIN_LENGTH = 12;
export const PASSWORD_POLICY_MESSAGE = "Use 12-128 characters with uppercase, lowercase, a number, and a symbol.";
export const PASSWORD_POLICY_HINT = "Use 12+ characters with uppercase, lowercase, a number, and a symbol for a stronger password.";

export const isPasswordPolicySatisfied = (password) => (
  typeof password === "string" &&
  password.length >= PASSWORD_POLICY_MIN_LENGTH &&
  password.length <= 128 &&
  /[a-z]/.test(password) &&
  /[A-Z]/.test(password) &&
  /\d/.test(password) &&
  /[^A-Za-z0-9]/.test(password)
);

export const getPasswordStrength = (password) => {
  if (!password) return { score: 0, label: "", color: "#cbd5e1" };

  const hasMinimumLength = password.length >= PASSWORD_POLICY_MIN_LENGTH;
  const hasMixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  let score = 1;

  if (!hasMinimumLength) score = 1;
  else if (isPasswordPolicySatisfied(password)) score = 4;
  else if (hasMixedCase && hasNumber) score = 3;
  else if (hasMixedCase || hasNumber || hasSymbol) score = 2;

  const levels = [
    { label: "Weak", color: "#ef4444" },
    { label: "Fair", color: "#f59e0b" },
    { label: "Good", color: "#eab308" },
    { label: "Strong", color: "#16a34a" },
  ];

  return { score, ...levels[Math.max(score - 1, 0)] };
};