import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";
import { verifyEmail } from "@/api/auth";
import { consumePendingProductRedirect } from "@/lib/pendingProductAction";

function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Verifying your email address...");
  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) return;

    verifyEmail(token)
      .then(() => {
        setStatus("success");
        setMessage("Your account has been successfully verified!");
      })
      .catch((error) => {
        setStatus("error");
        setMessage(error.data?.message || error.message || "Unable to verify your email.");
      });
  }, [navigate, token]);

  const visibleStatus = token ? status : "error";
  const visibleMessage = token ? message : "This verification link is missing its token.";
  const isSuccess = visibleStatus === "success";
  const handleContinue = () => {
    const from = consumePendingProductRedirect();
    navigate("/login", {
      replace: true,
      state: {
        ...(from ? { from } : {}),
        message: "Email verified successfully. You can now log in.",
      },
    });
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-8">
      {isSuccess && (
        <div className="verify-confetti-layer" aria-hidden="true">
          {Array.from({ length: 36 }, (_, index) => (
            <span
              key={index}
              className="verify-confetti-piece"
              style={{
                left: `${(index * 37 + 7) % 100}%`,
                animationDelay: `${(index % 12) * 0.09}s`,
                animationDuration: `${2.2 + (index % 7) * 0.22}s`,
                backgroundColor: ["#dc2626", "#f59e0b", "#10b981", "#3b82f6", "#a855f7"][index % 5],
                transform: `rotate(${(index * 53) % 180}deg)`,
              }}
            />
          ))}
        </div>
      )}
      <section key={visibleStatus} className={`relative z-10 w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-2xl ${isSuccess ? "verify-success-card" : ""}`}>
        {visibleStatus === "loading" ? (
          <LoaderCircle size={48} className="mx-auto animate-spin text-red-600" aria-hidden="true" />
        ) : isSuccess ? (
          <span className="verify-success-icon mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 size={42} aria-hidden="true" />
          </span>
        ) : (
          <XCircle size={48} className="mx-auto text-red-600" aria-hidden="true" />
        )}
        <h1 className="mt-5 text-2xl font-black text-slate-900">
          {visibleStatus === "loading" ? "Verifying email" : isSuccess ? "Account Verified" : "Verification failed"}
        </h1>
        <p className={`mt-3 text-sm text-slate-600 ${isSuccess ? "text-base leading-7" : ""}`}>
          {isSuccess ? <>Your account has been<br />successfully verified!</> : visibleMessage}
        </p>
        {isSuccess ? (
          <button type="button" onClick={handleContinue} className="mt-7 inline-flex min-w-36 items-center justify-center rounded-2xl bg-red-700 px-6 py-3 font-bold text-white shadow-lg shadow-red-700/20 transition hover:-translate-y-0.5 hover:bg-red-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-200">
            Continue
          </button>
        ) : visibleStatus !== "loading" ? (
          <Link to="/login" className="mt-6 inline-flex rounded-2xl bg-red-700 px-6 py-3 font-bold text-white hover:bg-red-800">
            Go to login
          </Link>
        ) : null}
      </section>
    </main>
  );
}

export default VerifyEmail;
