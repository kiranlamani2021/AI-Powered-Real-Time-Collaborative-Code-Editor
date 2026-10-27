import Home from "./pages/Home";
import { useEffect, useState } from "react";
import {
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router-dom";

import Login from "./pages/Login";
import Register from "./pages/Register";
import ProtectedRoute from "./components/ProtectedRoute";
import EditorPage from "./pages/EditorPage";

import "./App.css";

function App() {
  const location = useLocation();
  const isEditor = location.pathname.startsWith("/editor/");
  const isAuthenticated = Boolean(localStorage.getItem("token"));
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((current) => current === "light" ? "dark" : "light");

  const handleLogout = () => {
    localStorage.removeItem("token");

    window.location.href = "/login";
  };

  return (
    <div className={`app-container ${isEditor ? "editor-app" : ""}`}>
      {!isEditor && <nav className="navbar">
        <Link className="brand" to="/">
          <span className="brand-mark">&gt;_</span>
          <span>CodeTogether</span>
        </Link>
        <div className="nav-links">
          <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}>
            <span className="theme-icon" aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span><span className="theme-label">{theme === "light" ? "Dark" : "Light"}</span>
          </button>
          {isAuthenticated ? <Link to="/">Workspace</Link> : <>
            <Link to="/login">Sign in</Link>
            <Link className="nav-cta" to="/register">Create account</Link>
          </>}
          {isAuthenticated && <button className="logout-btn" onClick={handleLogout}>Sign out</button>}
        </div>
      </nav>}
      {isEditor && <button className="theme-toggle editor-theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}>
        <span className="theme-icon" aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span><span className="theme-label">{theme === "light" ? "Dark" : "Light"}</span>
      </button>}

      <Routes>

  <Route
    path="/"
    element={<Home />}
  />

  <Route
  path="/editor/:roomId"
  element={
    <ProtectedRoute>
      <EditorPage />
    </ProtectedRoute>
  }
/>

  <Route
    path="/login"
    element={<Login />}
  />

  <Route
    path="/register"
    element={<Register />}
  />

</Routes>

    </div>
  );
}

export default App;