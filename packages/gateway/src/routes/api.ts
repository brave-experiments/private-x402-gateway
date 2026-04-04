import { Router } from "express";

const router = Router();

router.get("/weather", (_req, res) => {
  res.json({
    temperature: 72,
    condition: "sunny",
    location: "San Francisco",
  });
});

router.get("/quote", (_req, res) => {
  res.json({
    quote: "The only way to do great work is to love what you do.",
    author: "Steve Jobs",
  });
});

export { router as apiRouter };
