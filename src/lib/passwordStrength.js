export const getPasswordStrength = (password) => {
  if (!password) return { score: 0, label: "", color: "#cbd5e1" };

  const hasMinimumLength = password.length >= 8;
  const hasLongLength = password.length >= 12;
  const hasMixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  let score = 1;

  if (!hasMinimumLength) score = 1;
  else if (hasLongLength && hasMixedCase && hasNumber && hasSymbol) score = 4;
  else if (hasMixedCase && hasNumber && (hasLongLength || hasSymbol)) score = 3;
  else if (hasLongLength || hasMixedCase || hasNumber || hasSymbol) score = 2;

  const levels = [
    { label: "Weak", color: "#ef4444" },
    { label: "Fair", color: "#f59e0b" },
    { label: "Good", color: "#eab308" },
    { label: "Strong", color: "#16a34a" },
  ];

  return { score, ...levels[Math.max(score - 1, 0)] };
};