const mongoose = require("mongoose");

const projectSchema =
  new mongoose.Schema({

    roomId: {
      type: String,
      required: true,
      unique: true,
    },

    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    members: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],

    files: {
      type: Object,
      required: true,
    },

    language: {
      type: String,
      default: "javascript",
    },

    activeFile: {
      type: String,
      default: "main.js",
    },

   fileLanguages: {
  type: Object,
  default: {
    "main.js": "javascript",
  },
},

  }, { timestamps: true });

module.exports = mongoose.model(
  "Project",
  projectSchema
);