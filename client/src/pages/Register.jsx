import { useState } from "react";

import axios from "axios";
import { useNavigate } from "react-router-dom";
import API_URL from "../api";

function Register() {
  const navigate = useNavigate();

  const [username, setUsername] = useState("");

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleRegister = async (e) => {
  e.preventDefault();
  setError("");

  try {
    const response = await axios.post(
      `${API_URL}/api/auth/register`,
      {
        username,
        email,
        password,
      }
    );

    if (response.data.token) {
      localStorage.setItem("token", response.data.token);
      localStorage.setItem("username", response.data.user.username);
      navigate("/");
    }
  } catch (error) {
    setError(error.response?.data?.message || "Registration failed. Please try again.");
  }
};
  return (

    <div className="auth-container">

      <div className="auth-box">

        <p className="eyebrow">START BUILDING</p><h1 className="auth-title">Create your account</h1><p className="auth-subtitle">A better place for your team to make things.</p>

        <input
          className="auth-input"
          type="text"
          placeholder="Username"
          value={username} onChange={(e) => setUsername(e.target.value)}
        />

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
          onClick={handleRegister}
        >
          Create account <span>→</span>
        </button>
        {error && <p className="form-error">{error}</p>}
        <p className="auth-switch">Already have an account? <a href="/login">Sign in</a></p>

      </div>

    </div>
  );
}

export default Register;