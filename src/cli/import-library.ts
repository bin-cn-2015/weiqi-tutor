import { runImportCli } from "../library/import-life-and-death.js";
runImportCli().catch(error=>{console.error(error);process.exitCode=1;});
