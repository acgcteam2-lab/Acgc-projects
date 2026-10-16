import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
} from "lucide-react";
import { requestPasswordReset, resendPasswordResetCode, resetPassword, verifyPasswordResetCode } from "@/api/auth";
import OtpCodeInput from "@/components/OtpCodeInput";
import { getPasswordStrength, isPasswordPolicySatisfied, PASSWORD_POLICY_HINT, PASSWORD_POLICY_MESSAGE } from "@/lib/passwordStrength";
import logo from "../../assets/images/ACGCLOGO1.png";

function ForgotPassword() {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState(null);
  const [resendAvailableAt, setResendAvailableAt] = useState(null);
  const [rateLimitUntil, setRateLimitUntil] = useState(null);
  const [serverTimeOffset, setServerTimeOffset] = useState(0);
  const [clockNow, setClockNow] = useState(0);
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const passwordStrength = getPasswordStrength(password);
  const serverNow = clockNow + serverTimeOffset;
  const secondsUntilExpiry = expiresAt ? Math.max(0, Math.ceil((expiresAt - serverNow) / 1000)) : null;
  const secondsUntilResend = Math.max(
    0,
    Math.ceil((Math.max(resendAvailableAt || 0, rateLimitUntil || 0) - serverNow) / 1000),
  );
  const codeExpired = step === 2 && secondsUntilExpiry === 0;

  useEffect(() => {
    if (step !== 2) return undefined;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  const syncResetTiming = (response) => {
    const clientNow = Date.now();
    const serverNowValue = new Date(response.serverNow).getTime();
    setServerTimeOffset(Number.isFinite(serverNowValue) ? serverNowValue - clientNow : 0);
    setExpiresAt(response.expiresAt ? new Date(response.expiresAt).getTime() : null);
    setResendAvailableAt(response.resendAvailableAt ? new Date(response.resendAvailableAt).getTime() : null);
    setRateLimitUntil(null);
    setClockNow(clientNow);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      if (step === 1) {
        const response = await requestPasswordReset(email);
        syncResetTiming(response);
        setCode("");
        setStep(2);
        setSuccess("A verification code has been sent to your email.");
      } else if (step === 2) {
        const response = await verifyPasswordResetCode(email, code);
        setResetToken(response.resetToken);
        setStep(3);
      } else if (step === 3) {
        if (!isPasswordPolicySatisfied(password)) {
          throw new Error(PASSWORD_POLICY_MESSAGE);
        }
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }
        const response = await resetPassword(resetToken, password);
        setStep(4);
        setSuccess(response.message || "Password reset successfully.");
      }
    } catch (requestError) {
      setError(requestError.data?.message || requestError.message || "Unable to continue.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const response = await resendPasswordResetCode(email);
      syncResetTiming(response);
      setCode("");
      setSuccess(response.message || "A new verification code has been sent.");
    } catch (requestError) {
      const retrySeconds = Number(requestError.data?.retry_after_seconds);
      if (retrySeconds > 0) {
        setRateLimitUntil(Date.now() + serverTimeOffset + retrySeconds * 1000);
      }
      setError(requestError.data?.message || requestError.message || "Unable to send a new verification code.");
    } finally {
      setLoading(false);
    }
  };

  const formatCountdown = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <main className="auth-light-canvas flex h-[100dvh] min-h-[100dvh] items-stretch justify-center overflow-hidden lg:items-center lg:px-4 lg:py-5">
      <motion.section
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative z-10 grid h-full w-full max-w-none grid-rows-[minmax(10rem,30dvh)_minmax(0,1fr)] overflow-hidden bg-white lg:h-auto lg:max-w-5xl lg:grid-cols-2 lg:grid-rows-1 lg:rounded-[22px] lg:border lg:border-white/10 lg:shadow-[0_28px_90px_rgba(2,6,23,0.65)]"
      >
        <div className="relative flex min-h-0 flex-col items-center justify-center gap-2 overflow-hidden bg-gradient-to-br from-slate-950 via-[#111827] to-[#450a0a] p-4 text-white sm:gap-3 lg:min-h-[560px] lg:p-8">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border border-white/10" />
          <div className="relative z-10 text-center">
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.28em] text-red-100 sm:text-xs lg:mb-6 lg:tracking-[0.3em]">Welcome To</p>
            <img src={logo} alt="ACGC" className="mx-auto mb-2 w-28 drop-shadow-[0_0_4px_rgba(255,255,255,0.7)] sm:mb-3 sm:w-36 lg:w-56" />
            <p className="mx-auto max-w-sm text-xs font-medium leading-5 text-red-50">
              Regain access securely with a verification code sent to your registered email.
            </p>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto bg-white px-4 py-3 text-slate-900 sm:px-6 sm:py-4 lg:flex lg:items-center lg:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="mx-auto w-full max-w-md"
            >
            <p className="text-xs font-black uppercase tracking-[0.28em] text-red-700">Account recovery</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
              {step === 4 ? "Password updated" : "Reset your password"}
            </h1>
            <p className="mt-2 max-w-lg text-xs leading-5 text-slate-500">
              {step === 1 && "Enter the email connected to your ACGC account."}
              {step === 2 && `Enter the six-digit code sent to ${email}.`}
              {step === 3 && "Choose a new password for your account."}
              {step === 4 && "Your account is secured with the new password."}
            </p>

            {step < 4 ? (
              <div className="mt-6 flex items-center gap-3" aria-label="Password reset steps">
                <Step number="1" label="Email" active={step >= 1} complete={step > 1} />
                <motion.div animate={{ opacity: step > 1 ? 1 : 0.55 }} transition={{ duration: 0.25 }} className={`h-px flex-1 ${step > 1 ? "bg-red-200" : "bg-slate-200"}`} />
                <Step number="2" label="Verify" active={step >= 2} complete={step > 2} />
                <motion.div animate={{ opacity: step > 2 ? 1 : 0.55 }} transition={{ duration: 0.25 }} className={`h-px flex-1 ${step > 2 ? "bg-red-200" : "bg-slate-200"}`} />
                <Step number="3" label="Reset" active={step >= 3} />
              </div>
            ) : null}

            {error ? <div role="alert" aria-live="assertive" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
            {success ? <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-700">{success}</div> : null}

            {step < 4 ? (
              <form onSubmit={handleSubmit} className="mt-6">
                {step === 1 ? <EmailField value={email} onChange={(value) => { setEmail(value); setError(""); }} /> : null}
                {step === 2 ? (
                  <div>
                    <label htmlFor="password-reset-code" className="mb-2 block text-sm font-semibold text-slate-700">Verification code</label>
                    <OtpCodeInput id="password-reset-code" value={code} onChange={setCode} autoFocus />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs">
                      <p className={codeExpired ? "font-semibold text-red-700" : "text-slate-500"} role="status" aria-live="polite">
                        {codeExpired
                          ? "Your verification code has expired. Please request a new code."
                          : secondsUntilExpiry !== null
                            ? `Code expires in ${formatCountdown(secondsUntilExpiry)}`
                            : null}
                      </p>
                      {secondsUntilResend > 0 ? (
                        <span className="text-slate-500">Resend code in {secondsUntilResend} seconds</span>
                      ) : (
                        <button
                          type="button"
                          onClick={handleResendCode}
                          disabled={loading}
                          className="font-bold text-brand underline decoration-transparent underline-offset-2 transition hover:decoration-current disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Resend Code
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
                {step === 3 ? (
                  <div className="space-y-4">
                    <Field
                      label="New password"
                      icon={LockKeyhole}
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={setPassword}
                      minLength={8}
                      maxLength={128}
                      placeholder="Enter new password"
                      showPasswordToggle
                      passwordVisible={showPassword}
                      onToggleVisibility={() => setShowPassword((visible) => !visible)}
                    />
                    <Field
                      label="Confirm new password"
                      icon={LockKeyhole}
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      minLength={8}
                      maxLength={128}
                      placeholder="Confirm new password"
                      showPasswordToggle
                      passwordVisible={showConfirmPassword}
                      onToggleVisibility={() => setShowConfirmPassword((visible) => !visible)}
                      isValid={confirmPassword.length > 0 && password === confirmPassword}
                    />
                    {confirmPassword ? (
                      <p className={`-mt-2 text-xs font-semibold ${password === confirmPassword ? "text-green-600" : "text-red-600"}`} role="status">
                        {password === confirmPassword ? "Passwords match" : "Passwords do not match"}
                      </p>
                    ) : null}
                    {password ? (
                      <div aria-live="polite">
                        <div
                          className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
                          role="progressbar"
                          aria-label="Password strength"
                          aria-valuemin="0"
                          aria-valuemax="4"
                          aria-valuenow={passwordStrength.score}
                        >
                          <div
                            className="h-full rounded-full transition-all duration-500 ease-out"
                            style={{
                              width: `${passwordStrength.score * 25}%`,
                              backgroundColor: passwordStrength.color,
                            }}
                          />
                        </div>
                        <p className="mt-1 text-xs font-semibold transition-colors duration-300" style={{ color: passwordStrength.color }}>
                          {passwordStrength.label} password
                        </p>
                      </div>
                    ) : null}
                    <p className="text-xs leading-4 text-slate-500">
                      {PASSWORD_POLICY_HINT}
                    </p>
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : null}
                  {loading ? "Please wait..." : step === 1 ? "Send verification code" : step === 2 ? "Verify code" : "Reset password"}
                  {!loading && <ArrowRight size={18} aria-hidden="true" />}
                </button>
              </form>
            ) : (
              <Link to="/login" className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
                Continue to login
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            )}

            {step > 1 && step < 4 ? (
              <button type="button" onClick={() => { setError(""); setSuccess(""); setStep(step - 1); }} className="mx-auto mt-4 flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-red-700">
                <ArrowLeft size={16} aria-hidden="true" /> Back
              </button>
            ) : null}

            <p className="mt-4 text-center text-xs text-slate-500">
              Remember your password?
              <Link to="/login" className="ml-2 font-bold text-brand transition-opacity hover:opacity-80">Back to login</Link>
            </p>
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.section>
    </main>
  );
}

function EmailField({ value, onChange }) {
  return <Field label="Registered email" icon={Mail} type="email" value={value} onChange={onChange} placeholder="you@example.com" />;
}

function Field({ label, icon: Icon, value, onChange, showPasswordToggle = false, passwordVisible = false, onToggleVisibility, isValid = false, ...props }) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      <span>{label}</span>
      <span className="relative mt-2 block">
        <Icon size={19} strokeWidth={1.8} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input {...props} value={value} onChange={(event) => onChange(event.target.value)} required className={`w-full rounded-2xl border ${isValid ? "border-green-500 focus:border-green-500 focus:ring-green-500/10" : "border-slate-300 focus:border-red-500 focus:ring-red-500/10"} bg-slate-50 py-3 pl-12 ${showPasswordToggle ? "pr-12" : "pr-4"} text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4`} />
        {showPasswordToggle ? (
          <button
            type="button"
            onClick={onToggleVisibility}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-red-700"
            aria-label={passwordVisible ? "Hide password" : "Show password"}
          >
            {passwordVisible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
          </button>
        ) : null}
      </span>
    </label>
  );
}

function Step({ number, label, active, complete = false }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <motion.span
        animate={{ scale: active ? 1 : 0.94 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
        className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${active ? "bg-red-700 text-white" : "border border-slate-300 bg-white text-slate-400"}`}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={complete ? "complete" : number}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.18 }}
          >
            {complete ? <Check size={15} aria-hidden="true" /> : number}
          </motion.span>
        </AnimatePresence>
      </motion.span>
      <motion.span animate={{ opacity: active ? 1 : 0.65 }} transition={{ duration: 0.25 }} className={`text-[10px] font-bold uppercase tracking-[0.16em] ${active ? "text-red-700" : "text-slate-400"}`}>
        {label}
      </motion.span>
    </div>
  );
}

export default ForgotPassword;
