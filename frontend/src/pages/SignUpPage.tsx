import { Navigate, useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/auth/AuthLayout";
import { AuthForm } from "../components/auth/AuthForm";
import { useAuth } from "../context/AuthContext";

export function SignUpPage() {
  const { signup, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthLayout>
      <AuthForm
        mode="signup"
        onSubmit={async (email, password, name) => {
          await signup(name || "", email, password);
          navigate("/", { replace: true });
        }}
      />
    </AuthLayout>
  );
}
