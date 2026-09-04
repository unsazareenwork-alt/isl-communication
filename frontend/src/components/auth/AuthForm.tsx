import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { Envelope, Lock, User, ArrowRight } from "@phosphor-icons/react";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Alert } from "../ui/Alert";

type Mode = "login" | "signup";

interface AuthFormProps {
  mode: Mode;
  onSubmit: (email: string, password: string, name?: string, remember?: boolean) => Promise<void>;
}

function validate(email: string, password: string, name?: string, mode?: Mode): Record<string, string> {
  const errors: Record<string, string> = {};
  if (mode === "signup" && (!name || !name.trim())) {
    errors.name = "Name is required.";
  }
  if (!email.trim()) {
    errors.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  if (!password) {
    errors.password = "Password is required.";
  } else if (password.length < 6) {
    errors.password = "Password must be at least 6 characters.";
  }
  return errors;
}

export function AuthForm({ mode, onSubmit }: AuthFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);
  const location = useLocation();

  const isLogin = mode === "login";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const nextErrors = validate(email, password, name, mode);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    setLoading(true);
    try {
      if (isLogin) {
        await onSubmit(email.trim(), password, undefined, remember);
      } else {
        await onSubmit(email.trim(), password, name.trim());
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form className="auth__form" onSubmit={handleSubmit} noValidate>
      <div className="auth__heading">
        <span className="auth__kicker">{isLogin ? "Welcome back" : "Get started"}</span>
        <h2 className="auth__title">{isLogin ? "Sign in" : "Create your account"}</h2>
        <p className="auth__subtitle">
          {isLogin ? "Join or start a meeting." : "Set up your account to begin."}
        </p>
      </div>

      {formError && <Alert tone="error">{formError}</Alert>}

      {!isLogin && (
        <Field label="Full name" htmlFor="signup-name" error={errors.name}>
          <div className="input-wrap">
            <span className="input-wrap__icon" aria-hidden="true">
              <User size={18} weight="regular" />
            </span>
            <Input
              id="signup-name"
              type="text"
              autoComplete="name"
              placeholder="Your full name"
              value={name}
              invalid={Boolean(errors.name)}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </Field>
      )}

      <Field label="Email address" htmlFor={`${mode}-email`} error={errors.email}>
        <div className="input-wrap">
          <span className="input-wrap__icon" aria-hidden="true">
            <Envelope size={18} weight="regular" />
          </span>
          <Input
            id={`${mode}-email`}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            invalid={Boolean(errors.email)}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </Field>

      <Field label="Password" htmlFor={`${mode}-password`} error={errors.password}>
        <div className="input-wrap">
          <span className="input-wrap__icon" aria-hidden="true">
            <Lock size={18} weight="regular" />
          </span>
          <Input
            id={`${mode}-password`}
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            placeholder="Your password"
            value={password}
            invalid={Boolean(errors.password)}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      </Field>

      {isLogin && (
        <label className="auth__remember">
          <input
            type="checkbox"
            className="auth__remember-input"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span className="auth__remember-label">Remember me</span>
        </label>
      )}

      <Button type="submit" variant="primary" size="lg" loading={loading} className="auth__submit">
        {isLogin ? "Sign in" : "Create account"}
        {!loading && <ArrowRight size={18} weight="bold" aria-hidden="true" />}
      </Button>

      <p className="auth__switch">
        {isLogin ? (
          <>
            New here?{" "}
            <Link to="/signup" state={location.state} className="auth__link">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link to="/login" className="auth__link">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
