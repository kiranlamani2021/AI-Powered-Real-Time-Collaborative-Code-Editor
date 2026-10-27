import { useState } from "react";

import axios from "axios";

import { useNavigate } from "react-router-dom";

function Login() {

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const navigate = useNavigate();

  const handleLogin = async () => {
    setError("");

  try {

    const res = await axios.post(
      "http://localhost:5000/api/auth/login",
      {
        email,
        password,
      }
    );

    localStorage.setItem(
      "token",
      res.data.token
    );

    localStorage.setItem(
      "username",
      res.data.user.username
    );

    navigate("/");

  } catch (error) {

    console.log(error);

    setError(error.response?.data?.message || "Login failed. Check your details and try again.");
  }
};

  return (

    <div className="auth-container">

      <div className="auth-box">

        <p className="eyebrow">WELCOME BACK</p><h1 className="auth-title">Sign in to your workspace</h1><p className="auth-subtitle">Pick up where your team left off.</p>

        <input
          className="auth-input"
          type="email"
          placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="auth-input"
          type="password"
          placeholder="Password"
          value={password} onChange={(e) => setPassword(e.target.value)}
        />

        <button
          className="auth-button"
          onClick={handleLogin}
        >
          Continue to workspace <span>→</span>
        </button>
        {error && <p className="form-error">{error}</p>}
        <p className="auth-switch">New to CodeTogether? <a href="/register">Create an account</a></p>

      </div>

    </div>
  );
}

export default Login;