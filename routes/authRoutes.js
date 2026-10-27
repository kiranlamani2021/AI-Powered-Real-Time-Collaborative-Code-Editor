const express = require("express");
const router = express.Router();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");

const validate = (req, res, next) => {
  const { username, email, password } = req.body;

  if (!username || typeof username !== "string" || username.trim().length < 2 || username.trim().length > 30) {
    return res.status(400).json({ message: "Username must be 2-30 characters." });
  }

  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ message: "A valid email is required." });
  }

  if (!password || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters." });
  }

  next();
};

const validateLogin = (req, res, next) => {
  const { email, password } = req.body;

  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ message: "A valid email is required." });
  }

  if (!password || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters." });
  }

  next();
};

// REGISTER
router.post("/register", validate, async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const trimmedEmail = email.trim();
    const trimmedUsername = username.trim();

    const existingUser = await User.findOne({
      $or: [{ email: trimmedEmail }, { username: trimmedUsername }],
    });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      username: trimmedUsername,
      email: trimmedEmail,
      password: hashedPassword,
    });

    await newUser.save();

    const token = jwt.sign(
      { id: newUser._id, username: newUser.username },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
      },
    });
  } catch (error) {
    console.error("[Auth Register Error]", error);
    res.status(500).json({ message: "Registration failed." });
  }
});

// LOGIN
router.post("/login", validateLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    const trimmedEmail = email.trim();

    const user = await User.findOne({ email: trimmedEmail });

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("[Auth Login Error]", error);
    res.status(500).json({ message: "Login failed." });
  }
});

module.exports = router;
