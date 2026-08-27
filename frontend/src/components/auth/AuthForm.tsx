import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Alert } from "../ui/Alert";

type Mode = "login" | "signup";

interface AuthFormProps {
  mode: Mode;
  onSubmit: (email: string, password: string) => Promise<void>;
}

function validate(email: string, password: string): Record<string, string> {
  const errors: Record<string, string> = {};
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isLogin = mode === "login";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const nextErrors = validate(email, password);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    setLoading(true);
    try {
      await onSubmit(email.trim(), password);
      // navigation handled by the page
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form className="auth__form" onSubmit={handleSubmit} noValidate>
      <h1 className="auth__title">{isLogin ? "Welcome back" : "Create your account"}</h1>
      <p className="auth__subtitle">
        {isLogin
          ? "Sign in to join or start a meeting."
          : "Sign up with just your email and a password."}
      </p>

      {formError && <Alert tone="error">{formError}</Alert>}

      <Field label="Email" htmlFor={`${mode}-email`} error={errors.email}>
        <Input
          id={`${mode}-email`}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          invalid={Boolean(errors.email)}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field label="Password" htmlFor={`${mode}-password`} error={errors.password}>
        <Input
          id={`${mode}-password`}
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          placeholder="Your password"
          value={password}
          invalid={Boolean(errors.password)}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <Button type="submit" variant="primary" size="lg" loading={loading} className="auth__submit">
        {isLogin ? "Sign in" : "Create account"}
      </Button>

      <p className="auth__switch">
        {isLogin ? (
          <>
            New here?{" "}
            <Link to="/signup" className="auth__link">
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
