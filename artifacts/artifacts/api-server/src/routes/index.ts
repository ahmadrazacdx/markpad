import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import filesRouter from "./files";
import historyRouter from "./history";
import exportRouter from "./export";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(filesRouter);
router.use(historyRouter);
router.use(exportRouter);

export default router;
