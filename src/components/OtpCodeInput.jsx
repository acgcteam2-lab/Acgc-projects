function OtpCodeInput({ value, onChange, disabled = false, darkMode = false, id = "otp-code", autoFocus = false }) {
  const digits = String(value || "").slice(0, 6);
  const inputClass = darkMode
    ? "border-slate-600 bg-slate-900 text-white"
    : "border-slate-200 bg-slate-50 text-slate-900";

  const keepCaretAtEnd = (event) => {
    const input = event.currentTarget;
    requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
  };

  return (
    <div className={`relative grid grid-cols-6 gap-2 ${disabled ? "opacity-60" : ""}`}>
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={`flex aspect-[4/5] min-w-0 items-center justify-center rounded-xl border text-xl font-bold transition-colors sm:aspect-[5/6] sm:text-2xl ${inputClass} ${index === digits.length ? "border-red-500 ring-2 ring-red-500/20" : ""}`}
        >
          {digits[index] || ""}
        </div>
      ))}
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="Six-digit verification code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        disabled={disabled}
        autoFocus={autoFocus}
        value={digits}
        onFocus={keepCaretAtEnd}
        onClick={keepCaretAtEnd}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
      />
    </div>
  );
}

export default OtpCodeInput;