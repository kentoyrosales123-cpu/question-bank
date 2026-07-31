const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const connectDB = require("./config/db");
const seedDefaultAdmin = require("./services/defaultAdmin");

const authRoutes = require("./routes/authRoutes");
const questionRoutes = require("./routes/questionRoutes");
const examRoutes = require("./routes/examRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const parserRoutes = require("./routes/parserRoutes");
const itemAnalysisRoutes = require("./routes/itemAnalysisRoutes");
const supportTicketRoutes = require("./routes/supportTicketRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const obeRoutes = require("./routes/obeRoutes");
const aiQuestionRoutes = require("./routes/aiQuestionRoutes");

const app = express();

connectDB()
  .then(seedDefaultAdmin)
  .catch((error) => {
    console.error("Startup failed:", error.message);
    process.exit(1);
  });

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/auth", authRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/parser", parserRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/item-analysis", itemAnalysisRoutes);
app.use("/api/support-tickets", supportTicketRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/obe", obeRoutes);
app.use("/api/ai/questions", aiQuestionRoutes);

app.use("/api/users", require("./routes/userRoutes"));

app.get("/item-analysis/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "item-analysis.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Question Bank System running on port ${PORT}`);
});
