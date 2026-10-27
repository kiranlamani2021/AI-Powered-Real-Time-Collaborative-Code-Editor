const express = require("express");

const router = express.Router();

const Project = require(
  "../models/Project"
);

router.post("/save", async (req, res) => {
  try {
    const { roomId, files, language, activeFile, fileLanguages } =
      req.body;

    if (
      typeof roomId !== "string" ||
      !/^[a-zA-Z0-9_-]{3,64}$/.test(roomId) ||
      !files ||
      typeof files !== "object" ||
      Array.isArray(files)
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid project payload",
      });
    }

    let project = await Project.findOne({
      roomId,
    });

    if (project) {
      // Mirror the /load access rule: only the owner or a member may write.
      // (Previously any authenticated user could overwrite any room's project
      // — and was auto-added to its members.)
      const isOwner =
        project.ownerId && project.ownerId.toString() === req.user.id;
      const isMember = (project.members || []).some(
        (member) => member.toString() === req.user.id
      );

      if (project.ownerId && !isOwner && !isMember) {
        return res.status(403).json({
          success: false,
          error: "Access denied.",
        });
      }

      project.files = files;
      project.language = language;
      project.activeFile = activeFile || project.activeFile;
      project.fileLanguages = fileLanguages || project.fileLanguages;
      project.members = project.members || [];
      if (!project.ownerId) project.ownerId = req.user.id;
      if (!project.members.some((member) => member.toString() === req.user.id)) {
        project.members.push(req.user.id);
      }
    } else {
      project = new Project({
        roomId,
        ownerId: req.user.id,
        members: [req.user.id],
        files,
        language,
        activeFile,
        fileLanguages,
      });
    }

    await project.save();

    res.json({
      success: true,
      message: "Project Saved",
    });
   } catch (err) {
    console.error("[Project Save Error]", err);
    res.status(500).json({
      success: false,
      error: "Failed to save project.",
    });
  }
});

router.get("/load/:roomId", async (req, res) => {
  try {
    const { roomId } = req.params;

    if (typeof roomId !== "string" || !/^[a-zA-Z0-9_-]{3,64}$/.test(roomId)) {
      return res.status(400).json({ success: false, error: "Invalid room ID." });
    }

    const project = await Project.findOne({ roomId });

    if (!project) {
      return res.json(null);
    }

    if (
      project.ownerId &&
      !project.members.some((member) => member.toString() === req.user.id) &&
      project.ownerId.toString() !== req.user.id
    ) {
      return res.status(403).json({ success: false, error: "Access denied." });
    }

    res.json(project);
  } catch (err) {
    console.error("[Project Load Error]", err);
    res.status(500).json({ success: false, error: "Failed to load project." });
  }
});

module.exports = router;